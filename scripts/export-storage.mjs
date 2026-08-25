#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const output = path.resolve(process.argv[2] || 'storage-export');
if (!/^https:\/\/[^/]+\.supabase\.co$/.test(base) || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };
const safeSegment = value => typeof value === 'string'
  && value.length > 0
  && value.length <= 255
  && !/[\/\\\0-\x1f\x7f]/.test(value)
  && value !== '.'
  && value !== '..';
const apiPath = value => String(value).split('/').map(encodeURIComponent).join('/');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const MAX_OBJECTS = 100_000;
const MAX_LIST_ENTRIES = 200_000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_DEPTH = 100;

async function request(endpoint, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(`${base}/storage/v1${endpoint}`, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
        signal: controller.signal
      });
      if (response.ok) return response;
      const message = (await response.text()).slice(0, 1000);
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        await delay(attempt * 1000);
        continue;
      }
      throw new Error(`${endpoint}: HTTP ${response.status} ${message}`);
    } catch (error) {
      lastError = error;
      if (attempt >= 4 || (error.name !== 'AbortError' && !/fetch|network/i.test(error.message))) throw error;
      await delay(attempt * 1000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function listPrefix(bucket, prefix, state) {
  const entries = [];
  const names = new Set();
  let offset = 0;
  while (true) {
    const response = await request(`/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
    });
    const page = await response.json();
    if (!Array.isArray(page) || page.length > 100) throw new Error(`Malformed Storage listing for ${bucket}/${prefix}`);
    for (const entry of page) {
      if (!entry || !safeSegment(entry.name)) throw new Error(`Unsafe Storage object name in ${bucket}: ${entry?.name}`);
      if (names.has(entry.name)) throw new Error(`Duplicate Storage listing entry in ${bucket}/${prefix}: ${entry.name}`);
      names.add(entry.name);
      entries.push(entry);
      state.listEntries += 1;
      if (state.listEntries > MAX_LIST_ENTRIES) throw new Error('Storage listing exceeds the guarded export limit.');
    }
    if (page.length < 100) break;
    offset += page.length;
  }
  return entries;
}

async function walk(bucket, prefix = '', state = { files: new Set(), directories: new Set(), listEntries: 0 }, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error(`Storage directory nesting exceeds ${MAX_DEPTH} levels in bucket ${bucket}.`);
  const files = [];
  for (const entry of await listPrefix(bucket, prefix, state)) {
    const objectName = `${prefix}${entry.name}`;
    if (!entry.id && !entry.metadata) {
      if (state.directories.has(objectName) || state.files.has(objectName)) throw new Error(`Duplicate Storage path in ${bucket}: ${objectName}`);
      state.directories.add(objectName);
      files.push(...await walk(bucket, `${objectName}/`, state, depth + 1));
    } else {
      if (state.files.has(objectName) || state.directories.has(objectName)) throw new Error(`Duplicate Storage object in ${bucket}: ${objectName}`);
      state.files.add(objectName);
      if (state.files.size > MAX_OBJECTS) throw new Error('Storage export exceeds the guarded object-count limit.');
      files.push({ name: objectName, metadata: entry.metadata || {}, created_at: entry.created_at, updated_at: entry.updated_at });
    }
  }
  return files;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest('hex') };
}

async function writeResponseToFile(response, target, remainingBytes) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > remainingBytes)) {
    throw new Error(`Storage object exceeds the guarded export byte limit: ${target}`);
  }
  if (!response.body) throw new Error(`Storage download returned no body: ${target}`);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.byteLength;
      if (size > remainingBytes) return callback(new Error(`Storage export exceeds the guarded byte limit while writing ${target}`));
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }
  const digest = hash.digest('hex');
  const written = await hashFile(target);
  if (written.size !== size || written.sha256 !== digest) throw new Error(`Local verification failed after writing ${target}`);
  return { size, sha256: digest };
}

try {
  await lstat(output);
  throw new Error(`Refusing to export into an existing path: ${output}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(output, { recursive: false, mode: 0o700 });
const bucketResponse = await request('/bucket', { method: 'GET' });
const bucketRows = await bucketResponse.json();
if (!Array.isArray(bucketRows)) throw new Error('Malformed Storage bucket listing.');
const bucketIds = new Set();
const buckets = [];
for (const bucket of bucketRows) {
  const bucketId = String(bucket?.id || '');
  if (!safeSegment(bucketId)) throw new Error(`Unsafe bucket id: ${bucketId}`);
  if (bucketIds.has(bucketId)) throw new Error(`Duplicate bucket returned by Storage API: ${bucketId}`);
  bucketIds.add(bucketId);
  if (bucketId !== 'dramaconnect-backups') buckets.push(bucket);
}
buckets.sort((left, right) => String(left.id).localeCompare(String(right.id)));
const manifest = { format: 'dramaconnect-storage-export', version: 1, exportedAt: new Date().toISOString(), buckets: [], totalObjects: 0, totalBytes: 0 };

for (const bucket of buckets) {
  const bucketId = String(bucket.id);
  const bucketManifest = {
    id: bucketId,
    public: Boolean(bucket.public),
    fileSizeLimit: bucket.file_size_limit ?? null,
    allowedMimeTypes: bucket.allowed_mime_types ?? null,
    objects: []
  };
  for (const object of await walk(bucketId)) {
    const response = await request(`/object/authenticated/${encodeURIComponent(bucketId)}/${apiPath(object.name)}`, { method: 'GET' });
    const target = path.join(output, bucketId, ...object.name.split('/'));
    if (!target.startsWith(path.join(output, bucketId) + path.sep)) throw new Error(`Unsafe output path: ${object.name}`);
    const remaining = MAX_TOTAL_BYTES - manifest.totalBytes;
    const written = await writeResponseToFile(response, target, remaining);
    bucketManifest.objects.push({
      name: object.name,
      size: written.size,
      sha256: written.sha256,
      contentType: object.metadata?.mimetype || response.headers.get('content-type') || 'application/octet-stream',
      createdAt: object.created_at || null,
      updatedAt: object.updated_at || null
    });
    manifest.totalObjects += 1;
    manifest.totalBytes += written.size;
    console.log(`Exported ${bucketId}/${object.name} (${written.size} bytes)`);
  }
  manifest.buckets.push(bucketManifest);
}
await writeFile(path.join(output, '.storage-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
// Read back the manifest so an incomplete filesystem write is not reported as success.
JSON.parse(await readFile(path.join(output, '.storage-manifest.json'), 'utf8'));
console.log(`Storage export complete: ${manifest.totalObjects} object(s), ${manifest.totalBytes} bytes.`);
