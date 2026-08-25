#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';

const MAX_BYTES = 100 * 1024 * 1024;
const FORMAT = 'dramaconnect-portable-archive';
const FORMAT_VERSION = 2;
const SCHEMA_VERSION = '13.2';
const expected = [
  ['profiles', 'id'], ['productions', 'id'], ['rehearsals', 'id'], ['events', 'id'],
  ['polls', 'id'], ['finances', 'id'], ['announcements', 'id'], ['messages', 'id'],
  ['reminders', 'id'], ['resources', 'id'], ['inventory', 'id'], ['tenant_settings', 'id'],
  ['activity_log', 'id'], ['budgets', 'production_id'], ['cast_list', 'id'],
  ['attendance', 'id'], ['inbox', 'id'], ['tasks', 'id'], ['poll_votes', 'id'],
  ['event_rsvps', 'id'], ['gallery', 'id'], ['suggestions', 'id']
];
const expectedNames = expected.map(([name]) => name);
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactSequence = (actual, wanted) => Array.isArray(actual)
  && actual.length === wanted.length
  && actual.every((value, index) => value === wanted[index]);

function stable(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Archive contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => stable(item === undefined ? null : item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`Unsupported value: ${typeof value}`);
}
const sha256 = value => createHash('sha256').update(stable(value)).digest('hex');

const filename = process.argv[2];
if (!filename) {
  console.error('Usage: node scripts/verify-portable-archive.mjs ARCHIVE.json');
  process.exit(2);
}

try {
  const file = await lstat(filename);
  if (!file.isFile() || file.isSymbolicLink()) throw new Error('Archive path must be a regular file, not a symlink.');
  if (file.size > MAX_BYTES) throw new Error('Archive exceeds the 100 MB independent-verification limit.');
  const archive = JSON.parse(await readFile(filename, 'utf8'));
  const errors = [];
  const warnings = [];

  if (!isRecord(archive)) throw new Error('Archive root is not a JSON object.');
  if (archive.format !== FORMAT || archive.formatVersion !== FORMAT_VERSION) errors.push('Unsupported format/version.');
  if (!isRecord(archive.application) || archive.application.schemaVersion !== SCHEMA_VERSION) errors.push('Unsupported or missing schema version.');
  if (!isRecord(archive.manifest) || !isRecord(archive.data)) errors.push('Archive manifest or data section is missing.');
  if (!isRecord(archive.seal)
      || archive.seal.algorithm !== 'SHA-256'
      || archive.seal.canonicalization !== 'stable-json-v1'
      || !/^[a-f0-9]{64}$/.test(String(archive.seal.digest || '').toLowerCase())) {
    errors.push('Supported SHA-256 seal metadata is missing or malformed.');
  }

  if (errors.length === 0) {
    if (!exactSequence(archive.manifest.expectedTables, expectedNames)) {
      errors.push('Expected-table manifest is incomplete, duplicated, extra, or out of order.');
    }
    const manifestItems = Array.isArray(archive.manifest.tables) ? archive.manifest.tables : [];
    if (!exactSequence(manifestItems.map(item => item?.name), expectedNames)) {
      errors.push('Per-table manifest is incomplete, duplicated, extra, or out of order.');
    }
    const manifests = new Map(manifestItems.map(item => [item?.name, item]));
    const extras = Object.keys(archive.data).filter(name => !expectedNames.includes(name));
    if (extras.length) warnings.push(`Unknown tables will not be restored: ${extras.join(', ')}.`);

    let total = 0;
    for (const [table, primaryKey] of expected) {
      const rows = archive.data[table];
      const manifest = manifests.get(table);
      if (!Array.isArray(rows) || !manifest) { errors.push(`${table}: missing data/manifest.`); continue; }
      total += rows.length;
      if (manifest.primaryKey !== primaryKey) errors.push(`${table}: primary key metadata mismatch.`);
      if (manifest.rowCount !== rows.length) errors.push(`${table}: row count mismatch.`);
      if (String(manifest.sha256 || '').toLowerCase() !== sha256(rows)) errors.push(`${table}: SHA-256 mismatch.`);
      const keys = new Set();
      rows.forEach((row, index) => {
        if (!isRecord(row)) { errors.push(`${table}[${index}]: row is not an object.`); return; }
        if (row[primaryKey] === null || row[primaryKey] === undefined || row[primaryKey] === '') {
          errors.push(`${table}[${index}]: missing primary key.`);
        }
        const key = String(row[primaryKey]);
        if (keys.has(key)) errors.push(`${table}: duplicate primary key ${key}.`);
        keys.add(key);
      });
    }
    if (!Number.isSafeInteger(archive.manifest.totalRows) || archive.manifest.totalRows !== total) errors.push('Total row count mismatch.');
    if (!Number.isSafeInteger(archive.manifest.tableCount) || archive.manifest.tableCount !== expected.length) errors.push('Table count mismatch.');
    if (!archive.application?.exportedAt || !Number.isFinite(Date.parse(archive.application.exportedAt))) errors.push('Export timestamp is missing or invalid.');
    const content = { ...archive }; delete content.seal;
    if (String(archive.seal.digest || '').toLowerCase() !== sha256(content)) errors.push('Full archive seal mismatch.');

    if (!errors.length) {
      console.log(`VALID ${filename}`);
      console.log(`SHA-256 seal: ${archive.seal.digest}`);
      console.log(`Tables: ${expected.length}; rows: ${total}; exported: ${archive.application.exportedAt}`);
      warnings.forEach(warning => console.warn(`WARNING: ${warning}`));
      process.exit(0);
    }
  }

  console.error(`INVALID ${filename}`);
  errors.forEach(error => console.error(`- ${error}`));
  warnings.forEach(warning => console.error(`- warning: ${warning}`));
  process.exit(1);
} catch (error) {
  console.error(`INVALID ${filename}: ${error.message}`);
  process.exit(1);
}
