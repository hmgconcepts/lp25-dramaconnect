#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const rootArgument = process.argv[2] || '';
if (!rootArgument || process.env.RESTORE_CONFIRM !== 'RESTORE') {
  console.error('Usage: RESTORE_CONFIRM=RESTORE SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-storage.mjs EXTRACTED_DIRECTORY');
  process.exit(2);
}
if (!/^https:\/\/[^/]+\.supabase\.co$/.test(base) || !serviceKey) {
  console.error('Set target SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Never use the service key in browser code.');
  process.exit(2);
}

const root = await realpath(path.resolve(rootArgument));
const manifestPath = path.join(root, '.storage-manifest.json');
const manifestInfo = await lstat(manifestPath);
if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error('Storage manifest must be a regular file.');
if (manifestInfo.size > 50 * 1024 * 1024) throw new Error('Storage manifest exceeds the 50 MB parsing limit.');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest?.format !== 'dramaconnect-storage-export' || manifest.version !== 1 || !Array.isArray(manifest.buckets)) {
  throw new Error('Unsupported or malformed Storage export manifest.');
}
if (typeof manifest.exportedAt !== 'string' || !Number.isFinite(Date.parse(manifest.exportedAt)) || new Date(manifest.exportedAt).toISOString() !== manifest.exportedAt) {
  throw new Error('Storage manifest has an invalid export timestamp.');
}
if (!Number.isSafeInteger(manifest.totalObjects) || manifest.totalObjects < 0 || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0) {
  throw new Error('Storage manifest has malformed totals.');
}

const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
const safeSegment = value => typeof value === 'string'
  && value.length > 0
  && value.length <= 255
  && !/[\/\\\0-\x1f\x7f]/.test(value)
  && value !== '.'
  && value !== '..';
const apiPath = value => String(value).split('/').map(encodeURIComponent).join('/');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const MAX_OBJECTS = 100_000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024 * 1024;

async function request(endpoint, options = {}, accepted = []) {
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
      if (response.ok || accepted.includes(response.status)) return response;
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

function validateContentType(value) {
  const type = value || 'application/octet-stream';
  if (typeof type !== 'string' || type.length > 200 || /[\0-\x1f\x7f]/.test(type) || !type.includes('/')) {
    throw new Error(`Unsafe object content type: ${String(value)}`);
  }
  return type;
}

async function resolveObjectFile(bucketId, objectName) {
  const segments = String(objectName).split('/');
  if (!segments.every(safeSegment)) throw new Error(`Unsafe manifest path: ${objectName}`);
  const expectedPrefix = path.join(root, bucketId) + path.sep;
  const lexical = path.join(root, bucketId, ...segments);
  if (!lexical.startsWith(expectedPrefix)) throw new Error(`Unsafe manifest path: ${objectName}`);
  const info = await lstat(lexical);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Storage object must be a regular file: ${bucketId}/${objectName}`);
  const resolved = await realpath(lexical);
  if (!resolved.startsWith(expectedPrefix)) throw new Error(`Storage object escapes the export directory: ${bucketId}/${objectName}`);
  return { file: resolved, size: info.size };
}

// Validate the entire manifest and every local object before the first write.
const bucketIds = new Set();
const verified = [];
let totalObjects = 0;
let totalBytes = 0;
for (const bucket of manifest.buckets) {
  if (!bucket || !safeSegment(bucket.id) || bucket.id === 'dramaconnect-backups') throw new Error(`Unsafe or excluded bucket id: ${bucket?.id}`);
  if (bucketIds.has(bucket.id)) throw new Error(`Duplicate bucket in manifest: ${bucket.id}`);
  bucketIds.add(bucket.id);
  if (typeof bucket.public !== 'boolean') throw new Error(`Malformed public/private setting for bucket: ${bucket.id}`);
  if (!Array.isArray(bucket.objects)) throw new Error(`Malformed object list for bucket: ${bucket.id}`);
  if (bucket.allowedMimeTypes !== null && (!Array.isArray(bucket.allowedMimeTypes) || bucket.allowedMimeTypes.some(type => typeof type !== 'string' || type.length > 200 || /[\0-\x1f\x7f]/.test(type) || !type.includes('/')))) {
    throw new Error(`Malformed MIME allowlist for bucket: ${bucket.id}`);
  }
  if (bucket.fileSizeLimit !== null && (!Number.isSafeInteger(bucket.fileSizeLimit) || bucket.fileSizeLimit < 0)) {
    throw new Error(`Malformed file-size limit for bucket: ${bucket.id}`);
  }

  const objectNames = new Set();
  for (const object of bucket.objects) {
    if (!object || typeof object.name !== 'string' || objectNames.has(object.name)) throw new Error(`Missing or duplicate object name in bucket: ${bucket.id}`);
    objectNames.add(object.name);
    if (!Number.isSafeInteger(object.size) || object.size < 0 || !/^[a-f0-9]{64}$/.test(String(object.sha256 || ''))) {
      throw new Error(`Malformed object integrity metadata: ${bucket.id}/${object.name}`);
    }
    const contentType = validateContentType(object.contentType);
    const local = await resolveObjectFile(bucket.id, object.name);
    if (local.size !== object.size) throw new Error(`Storage size check failed: ${bucket.id}/${object.name}`);
    const bytes = await readFile(local.file);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== object.sha256) throw new Error(`Storage SHA-256 check failed: ${bucket.id}/${object.name}`);
    verified.push({ bucket, object, contentType, file: local.file });
    totalObjects += 1;
    totalBytes += object.size;
    if (totalObjects > MAX_OBJECTS || totalBytes > MAX_TOTAL_BYTES) throw new Error('Storage manifest exceeds guarded recovery limits.');
  }
}
if (manifest.totalObjects !== totalObjects || manifest.totalBytes !== totalBytes) {
  throw new Error('Storage manifest totals do not match the verified objects.');
}
console.log(`All ${totalObjects} local Storage object hash(es) verified before remote writes.`);

// Read and compare every target bucket before making the first remote write.
// A recovery must not silently make an existing private bucket public, tighten a
// size limit, or replace its MIME policy. Reconciliation requires a second,
// explicit operator confirmation.
const targetResponse = await request('/bucket', { method: 'GET' });
const targetRows = await targetResponse.json();
if (!Array.isArray(targetRows)) throw new Error('Target Storage bucket listing is malformed.');
const targetBuckets = new Map();
for (const bucket of targetRows) {
  const id = String(bucket?.id || '');
  if (!safeSegment(id) || targetBuckets.has(id)) throw new Error(`Unsafe or duplicate target bucket id: ${id}`);
  if (typeof bucket.public !== 'boolean'
      || (bucket.file_size_limit !== null && bucket.file_size_limit !== undefined && (!Number.isSafeInteger(bucket.file_size_limit) || bucket.file_size_limit < 0))
      || (bucket.allowed_mime_types !== null && bucket.allowed_mime_types !== undefined && !Array.isArray(bucket.allowed_mime_types))) {
    throw new Error(`Malformed target bucket settings: ${id}`);
  }
  targetBuckets.set(id, bucket);
}
const normalizeMime = value => value === null || value === undefined ? null : [...value].sort();
const bucketDiffers = (target, source) => Boolean(target.public) !== source.public
  || (target.file_size_limit ?? null) !== source.fileSizeLimit
  || JSON.stringify(normalizeMime(target.allowed_mime_types)) !== JSON.stringify(normalizeMime(source.allowedMimeTypes));
const reconcileBuckets = process.env.RESTORE_RECONCILE_BUCKETS === 'RECONCILE';
const plans = manifest.buckets.map(bucket => {
  const target = targetBuckets.get(bucket.id);
  if (!target) return { bucket, action: 'create' };
  if (!bucketDiffers(target, bucket)) return { bucket, action: 'keep' };
  if (!reconcileBuckets) {
    throw new Error(`Target bucket settings conflict for ${bucket.id}. Review the target and rerun with RESTORE_RECONCILE_BUCKETS=RECONCILE only if replacing its public, size, and MIME settings is intended.`);
  }
  return { bucket, action: 'update' };
});

for (const { bucket, action } of plans) {
  const bucketPayload = {
    id: bucket.id,
    name: bucket.id,
    public: bucket.public,
    file_size_limit: bucket.fileSizeLimit,
    allowed_mime_types: bucket.allowedMimeTypes
  };
  if (action === 'create') {
    await request('/bucket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bucketPayload)
    });
  } else if (action === 'update') {
    const { id: _id, name: _name, ...updatePayload } = bucketPayload;
    await request(`/bucket/${encodeURIComponent(bucket.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });
  }
}

for (const bucket of manifest.buckets) {
  for (const item of verified.filter(candidate => candidate.bucket === bucket)) {
    const bytes = await readFile(item.file);
    await request(`/object/${encodeURIComponent(bucket.id)}/${apiPath(item.object.name)}`, {
      method: 'POST',
      headers: { 'content-type': item.contentType, 'x-upsert': 'true' },
      body: bytes
    });

    // A successful upload response is not sufficient recovery evidence: read
    // the object back and compare both size and digest before reporting success.
    const remote = await request(`/object/authenticated/${encodeURIComponent(bucket.id)}/${apiPath(item.object.name)}`);
    const remoteBytes = new Uint8Array(await remote.arrayBuffer());
    const remoteDigest = createHash('sha256').update(remoteBytes).digest('hex');
    if (remoteBytes.byteLength !== item.object.size || remoteDigest !== item.object.sha256) {
      throw new Error(`Remote verification failed after restore: ${bucket.id}/${item.object.name}`);
    }
    console.log(`Restored and verified ${bucket.id}/${item.object.name}`);
  }
}
console.log(`Storage restore complete and remotely verified: ${totalObjects} object(s), ${totalBytes} bytes.`);
