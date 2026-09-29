/*
 * V15 Disaster Recovery mode — regression test.
 *
 * Background (the bug this file exists to prevent):
 *   The previous fresh-database path was the `degraded` restore mode, which
 *   DROPPED WHOLE TABLES: profiles, cast_list, attendance, inbox, tasks,
 *   poll_votes and event_rsvps. On a fresh Supabase project that silently
 *   destroyed every attendance record, cast assignment, task, inbox message,
 *   poll vote and RSVP — which is exactly the operational history a disaster
 *   recovery exists to preserve.
 *
 *   `recovery` mode keeps those rows and neutralises only the account-reference
 *   columns, recording each severed link in a ledger so it can be re-attached
 *   later by email.
 *
 * This test proves both halves: the rows survive, and the links can be rebuilt.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let pass = 0;
let fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

/* ------------------------------------------------------------------ *
 * A minimal fake of the browser surface data-portability.js relies on.*
 * ------------------------------------------------------------------ */
function makeHarness() {
  const writes = [];   // every upsert the module attempts
  const updates = [];  // every .update() the module attempts
  const profilesRows = [];

  const client = {
    from(table) {
      const chain = {
        upsert(rows) {
          writes.push({ table, rows: JSON.parse(JSON.stringify(rows)) });
          return Promise.resolve({ error: null });
        },
        update(values) {
          const rec = { table, values: JSON.parse(JSON.stringify(values)) };
          return {
            eq(column, value) {
              rec.column = column;
              rec.value = value;
              updates.push(rec);
              return Promise.resolve({ error: null });
            }
          };
        },
        select() {
          if (table === 'profiles') {
            return Promise.resolve({ data: profilesRows, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        }
      };
      return chain;
    }
  };

  return { client, writes, updates, profilesRows };
}

/** Load the module into a VM that looks enough like a browser. */
function loadModule(client) {
  const code = readFileSync(resolve(root, 'assets/js/data-portability.js'), 'utf8');
  const sandbox = {
    window: {},
    globalThis: {},
    crypto: globalThis.crypto,
    TextEncoder,
    Blob: class Blob { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    document: {
      createElement: () => ({ click: () => {}, set href(v) {}, style: {} }),
      body: { appendChild: () => {}, removeChild: () => {} }
    },
    setTimeout, clearTimeout, console
  };
  // The module records every restore through the resilience lease API.
  // Stub it so the test exercises restore logic, not operational bookkeeping.
  sandbox.window.Resilience = {
    beginBackup: async () => ({ id: 'test-run' }),
    finishBackup: async () => ({ ok: true })
  };
  sandbox.Resilience = sandbox.window.Resilience;
  sandbox.window.supabaseClient = client;
  sandbox.window.sb = client;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.DataPortability;
}

/* ------------------------------------------------------------------ *
 * A realistic archive: two members, attendance, casting, tasks, votes.*
 * ------------------------------------------------------------------ */
function makeArchive(DP) {
  const seed = {
    profiles: [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'ada@example.org', full_name: 'Ada Okonjo', status: 'approved', role: 'member' },
      { id: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'bisi@example.org', full_name: 'Bisi Adeyemi', status: 'approved', role: 'admin' }
    ],
    productions: [{ id: 'pppppppp-0000-4000-8000-000000000001', title: 'The Prodigal' }],
    attendance: [
      { id: '11111111-0000-4000-8000-000000000001', member_id: 'aaaaaaaa-0000-4000-8000-000000000001', rehearsal_date: '2026-03-04', status: 'present' },
      { id: '11111111-0000-4000-8000-000000000002', member_id: 'aaaaaaaa-0000-4000-8000-000000000002', rehearsal_date: '2026-03-04', status: 'absent' }
    ],
    cast_list: [
      { id: '22222222-0000-4000-8000-000000000001', member_id: 'aaaaaaaa-0000-4000-8000-000000000001', role_name: 'The Father' }
    ],
    tasks: [
      { id: '33333333-0000-4000-8000-000000000001', assignee_id: 'aaaaaaaa-0000-4000-8000-000000000002', title: 'Source the costumes', status: 'open' }
    ],
    poll_votes: [
      { id: '44444444-0000-4000-8000-000000000001', voter_id: 'aaaaaaaa-0000-4000-8000-000000000001', option: 'Friday' }
    ],
    event_rsvps: [
      { id: '55555555-0000-4000-8000-000000000001', member_id: 'aaaaaaaa-0000-4000-8000-000000000002', response: 'yes' }
    ],
    inbox: [
      { id: '66666666-0000-4000-8000-000000000001', recipient_id: 'aaaaaaaa-0000-4000-8000-000000000001', sender_id: 'aaaaaaaa-0000-4000-8000-000000000002', subject: 'Call time', body: '6pm sharp' }
    ],
    suggestions: [
      { id: '77777777-0000-4000-8000-000000000001', author_id: 'aaaaaaaa-0000-4000-8000-000000000001', text: 'More lighting' }
    ]
  };

  // Every one of the 25 tables must be present, even when empty, or the
  // archive fails structural verification before any restore logic runs.
  const data = {};
  for (const definition of DP.TABLES) data[definition.name] = seed[definition.name] || [];

  const tables = [];
  let totalRows = 0;
  for (const definition of DP.TABLES) {
    const rows = data[definition.name];
    tables.push({
      name: definition.name,
      primaryKey: definition.key,
      rowCount: rows.length,
      pages: rows.length ? 1 : 0,
      sha256: DP.stableStringify ? null : null
    });
    totalRows += rows.length;
  }

  const archive = {
    format: DP.FORMAT,
    formatVersion: DP.FORMAT_VERSION,
    application: {
      name: 'DramaConnect',
      version: '15.0.0',
      schemaVersion: DP.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      origin: 'https://example.org'
    },
    scope: { included: 'test fixture', excludes: [] },
    manifest: {
      pageSize: DP.PAGE_SIZE,
      expectedTables: DP.TABLES.map(t => t.name),
      tableCount: DP.TABLES.length,
      totalRows,
      tables
    },
    data
  };
  return archive;
}

/**
 * Seal the archive exactly the way the production exporter does:
 * SHA-256 over the stable-stringified envelope with the seal removed.
 */
async function sealArchive(DP, archive) {
  const tables = archive.manifest.tables;
  for (const item of tables) {
    item.sha256 = await DP.sha256Text(DP.stableStringify(archive.data[item.name]));
  }
  const withoutSeal = { ...archive };
  delete withoutSeal.seal;
  archive.seal = {
    algorithm: 'SHA-256',
    canonicalization: 'stable-json-v1',
    digest: await DP.sha256Text(DP.stableStringify(withoutSeal))
  };
  const verification = await DP.verifyArchive(archive);
  if (!verification.ok) throw new Error(`Fixture archive is invalid: ${verification.errors.join(' ')}`);
  return archive;
}

console.log('\nV15 Disaster Recovery mode\n');

/* ================= 1. the bug that was fixed ================= */
console.log('A. Legacy degraded mode (documents the data-loss bug)');
{
  const h = makeHarness();
  const DP = loadModule(h.client);
  const report = await DP.restoreVerifiedArchive(await sealArchive(DP, makeArchive(DP)), 'degraded');

  const attendance = report.tables.find(t => t.table === 'attendance');
  check('degraded mode discards attendance entirely', attendance.restoredRows === 0 && attendance.skippedRows === 2,
    `restored=${attendance.restoredRows} skipped=${attendance.skippedRows}`);

  const cast = report.tables.find(t => t.table === 'cast_list');
  check('degraded mode discards cast_list entirely', cast.restoredRows === 0,
    `restored=${cast.restoredRows}`);
}

/* ================= 2. the fix ================= */
console.log('\nB. Recovery mode preserves operational history');
let recoveryReport;
{
  const h = makeHarness();
  const DP = loadModule(h.client);
  const archive = await sealArchive(DP, makeArchive(DP));
  recoveryReport = await DP.restoreVerifiedArchive(archive, 'recovery');

  for (const table of ['attendance', 'cast_list', 'tasks', 'poll_votes', 'event_rsvps', 'inbox']) {
    const t = recoveryReport.tables.find(x => x.table === table);
    const expected = archive.data[table].length;
    check(`${table}: all ${expected} row(s) restored`, t.restoredRows === expected,
      `restored=${t.restoredRows} failed=${t.failedRows}`);
  }

  const profiles = recoveryReport.tables.find(t => t.table === 'profiles');
  check('profiles still skipped (auth users are re-created by sign-up)', profiles.skippedRows === 2,
    `skipped=${profiles.skippedRows}`);
}

/* ================= 3. columns neutralised, not rows ========== */
console.log('\nC. Account references neutralised; drama data intact');
{
  const h = makeHarness();
  const DP = loadModule(h.client);
  await DP.restoreVerifiedArchive(await sealArchive(DP, makeArchive(DP)), 'recovery');

  const attendance = h.writes.filter(w => w.table === 'attendance').flatMap(w => w.rows);
  check('attendance rows keep their dates and status',
    attendance.length === 2 && attendance.every(r => r.rehearsal_date === '2026-03-04' && r.status),
    JSON.stringify(attendance));
  check('attendance member_id is neutralised to null',
    attendance.every(r => r.member_id === null),
    JSON.stringify(attendance.map(r => r.member_id)));

  const inbox = h.writes.filter(w => w.table === 'inbox').flatMap(w => w.rows);
  check('inbox keeps its message body while both links are nulled',
    inbox[0]?.body === '6pm sharp' && inbox[0]?.recipient_id === null && inbox[0]?.sender_id === null,
    JSON.stringify(inbox));

  const tasks = h.writes.filter(w => w.table === 'tasks').flatMap(w => w.rows);
  check('task content survives with assignee deferred',
    tasks[0]?.title === 'Source the costumes' && tasks[0]?.assignee_id === null,
    JSON.stringify(tasks));
}

/* ================= 4. the ledger ================= */
console.log('\nD. Recovery ledger records every deferred link');
{
  const r = recoveryReport.recovery;
  const expected = 2 /* attendance */ + 1 /* cast */ + 1 /* task */ + 1 /* vote */
                 + 1 /* rsvp */ + 2 /* inbox has two links */ + 1 /* suggestion */;
  check(`ledger captures all ${expected} severed references`, r.severedReferences === expected,
    `got ${r.severedReferences}`);
  check('ledger names the affected tables', r.affectedTables.includes('attendance') && r.affectedTables.includes('inbox'),
    JSON.stringify(r.affectedTables));
  check('ledger entries carry table, row, column and old user id',
    r.ledger.every(e => e.table && e.rowId && e.column && e.previousUserId),
    JSON.stringify(r.ledger[0]));
}

/* ================= 5. the re-link pass ================= */
console.log('\nE. Re-link pass rebuilds links by email (DramaConnect-only)');
{
  const h = makeHarness();
  const DP = loadModule(h.client);
  const archive = await sealArchive(DP, makeArchive(DP));
  const report = await DP.restoreVerifiedArchive(archive, 'recovery');

  const manifest = DP.buildRecoveryManifest(report, archive);
  check('manifest resolves each old UUID to an email',
    manifest.entries.length === 9 && manifest.entries.every(e => e.email),
    JSON.stringify(manifest.entries.map(e => e.email)));

  // Members have re-registered: same emails, brand-new UUIDs.
  h.profilesRows.push(
    { id: 'bbbbbbbb-0000-4000-8000-000000000001', email: 'Ada@Example.ORG' },   // case differs on purpose
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'bisi@example.org' }
  );

  const result = await DP.relinkRecoveryManifest(manifest);

  check('every deferred reference is matched by email', result.unmatched === 0,
    `matched=${result.matched} unmatched=${result.unmatched}`);
  check('all 9 links rewritten', result.updated === 9, `updated=${result.updated}`);

  const attendanceUpdates = h.updates.filter(u => u.table === 'attendance');
  check('attendance rows are re-pointed at the NEW uuids',
    attendanceUpdates.length === 2
    && attendanceUpdates.some(u => u.values.member_id === 'bbbbbbbb-0000-4000-8000-000000000001')
    && attendanceUpdates.some(u => u.values.member_id === 'bbbbbbbb-0000-4000-8000-000000000002'),
    JSON.stringify(attendanceUpdates));
  check('email matching is case-insensitive',
    attendanceUpdates.some(u => u.values.member_id === 'bbbbbbbb-0000-4000-8000-000000000001'));
}

/* ================= 6. honest failure reporting =============== */
console.log('\nF. Re-link reports what it could NOT match');
{
  const h = makeHarness();
  const DP = loadModule(h.client);
  const archive = await sealArchive(DP, makeArchive(DP));
  const report = await DP.restoreVerifiedArchive(archive, 'recovery');
  const manifest = DP.buildRecoveryManifest(report, archive);

  // Nobody has re-registered yet.
  const result = await DP.relinkRecoveryManifest(manifest);
  check('unmatched count is reported, not hidden', result.unmatched === 9, `unmatched=${result.unmatched}`);
  check('nothing is written when nobody matches', result.updated === 0, `updated=${result.updated}`);
}

/* ================= 7. mode validation ================= */
console.log('\nG. Mode validation');
{
  const h = makeHarness();
  const DP = loadModule(h.client);
  let threw = false;
  try { await DP.restoreVerifiedArchive(await sealArchive(DP, makeArchive(DP)), 'nonsense'); } catch (_) { threw = true; }
  check('an unknown restore mode is rejected', threw);

  const ok = await DP.restoreVerifiedArchive(await sealArchive(DP, makeArchive(DP)), 'merge');
  check('merge mode still accepted (same-project restore unchanged)', ok.ok === true);
  check('merge mode does NOT neutralise references',
    h.writes.filter(w => w.table === 'attendance').flatMap(w => w.rows).every(r => r.member_id !== null));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — recovery mode: ${pass} passed, ${fail} failed.\n`);
process.exit(fail === 0 ? 0 : 1);
