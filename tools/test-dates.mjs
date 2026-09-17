#!/usr/bin/env node
/**
 * Timezone regression suite for Utils date handling.
 *
 * Bug this locks down: `new Date('2025-09-17')` is UTC midnight by specification, so
 * rendering it with toLocaleDateString() in any timezone behind UTC (all of the
 * Americas) showed the PREVIOUS day. PostgreSQL DATE columns arrive as plain
 * 'YYYY-MM-DD', so every rehearsal date, production date, task due date and finance
 * date rendered one day early for those users.
 *
 * Each timezone is exercised in a child process with TZ set, because Node caches the
 * timezone at first use and changing process.env.TZ later is not reliable.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEZONES = [
  'UTC',
  'Africa/Lagos',          // UTC+1  — deployment locale
  'Pacific/Kiritimati',    // UTC+14 — furthest ahead
  'America/New_York',      // UTC-4  — behind UTC, the broken case
  'America/Los_Angeles',   // UTC-7
  'Pacific/Midway',        // UTC-11 — furthest behind
];

/** Load assets/js/utils.js into a sandbox and return the Utils object. */
async function loadUtils() {
  const source = await fs.readFile(path.join(root, 'assets', 'js', 'utils.js'), 'utf8');
  const sandbox = {
    window: {},
    UI: { esc: (v) => String(v ?? ''), toast: () => {} },
    CONFIG: { CURRENCY: '\u20a6' },
    XLSX: undefined,
    console,
  };
  sandbox.window.UI = sandbox.UI;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(source, { filename: 'assets/js/utils.js' }).runInContext(sandbox);
  return sandbox.window.Utils;
}

const checks = [];
const check = (name, condition, detail = '') =>
  checks.push({ name, ok: Boolean(condition), detail });

async function runAssertions() {
  const Utils = await loadUtils();
  const EN_GB = { day: 'numeric', month: 'short', year: 'numeric' };
  const tz = process.env.TZ;

  // 1. Core invariant: a date-only string resolves to the same LOCAL calendar day.
  for (const value of ['2025-09-17', '2025-01-01', '2025-12-31', '2024-02-29']) {
    const d = Utils.parseLocalDate(value);
    const [y, m, day] = value.split('-').map(Number);
    check(
      `[${tz}] parseLocalDate('${value}') keeps the calendar day`,
      d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day,
      `got ${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    );
  }

  // 2. formatDate matches a locally-constructed Date (this is what broke).
  for (const value of ['2025-09-17', '2025-03-01', '2025-11-30']) {
    const [y, m, day] = value.split('-').map(Number);
    const expected = new Date(y, m - 1, day).toLocaleDateString('en-GB', EN_GB);
    const actual = Utils.formatDate(value);
    check(
      `[${tz}] formatDate('${value}') === ${expected}`,
      actual === expected,
      `got ${actual}`
    );
  }

  // 3. Adjacent days must not render identically (the one-day shift collapsed them).
  check(
    `[${tz}] consecutive dates render differently`,
    Utils.formatDate('2025-09-17') !== Utils.formatDate('2025-09-16')
  );

  // 4. Real instants (timestamptz) must be preserved exactly — no regression for
  //    created_at / event_date / next_run.
  check(
    `[${tz}] 'Z' instant preserved`,
    Utils.parseLocalDate('2025-09-17T12:00:00Z').toISOString() === '2025-09-17T12:00:00.000Z',
    Utils.parseLocalDate('2025-09-17T12:00:00Z').toISOString()
  );
  check(
    `[${tz}] numeric offset preserved`,
    Utils.parseLocalDate('2025-09-17T00:00:00+02:00').getTime() ===
      Date.parse('2025-09-17T00:00:00+02:00')
  );

  // 5. formatDateTime still renders a time component for timestamps.
  check(
    `[${tz}] formatDateTime shows a time for timestamps`,
    /\d{1,2}[:.]\d{2}/.test(Utils.formatDateTime('2025-09-17T18:30:00Z')),
    Utils.formatDateTime('2025-09-17T18:30:00Z')
  );

  // 6. daysUntil agrees with a locally-built date, for today / tomorrow / yesterday.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  for (const offset of [-1, 0, 1, 7]) {
    const target = new Date(midnight);
    target.setDate(target.getDate() + offset);
    const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    check(
      `[${tz}] daysUntil('${iso}') === ${offset}`,
      Utils.daysUntil(iso) === offset,
      `got ${Utils.daysUntil(iso)}`
    );
  }

  // 7. Degenerate inputs stay safe.
  for (const value of [null, undefined, '', 'not-a-date']) {
    check(`[${tz}] formatDate(${JSON.stringify(value)}) -> em dash`, Utils.formatDate(value) === '\u2014', String(Utils.formatDate(value)));
  }
  check(`[${tz}] daysUntil(null) === null`, Utils.daysUntil(null) === null);
}

if (process.argv.includes('--child')) {
  await runAssertions();
  for (const c of checks) {
    if (!c.ok) console.log(`FAIL ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  console.log(`CHECKS ${checks.length} FAILED ${checks.filter((c) => !c.ok).length}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

console.log('date/timezone regression suite\n');
let total = 0;
let failed = 0;
for (const tz of TIMEZONES) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), '--child'],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' }
  );
  const out = (result.stdout || '') + (result.stderr || '');
  const line = out.trim().split('\n').filter(Boolean);
  const summary = line.find((l) => l.startsWith('CHECKS ')) || 'CHECKS ? FAILED ?';
  const [, n, , f] = summary.split(' ');
  total += Number(n) || 0;
  failed += Number(f) || 0;
  console.log(`  ${tz.padEnd(20)} ${summary}${result.status === 0 ? '  PASS' : '  FAIL'}`);
  for (const l of line) if (l.startsWith('FAIL ')) console.log(`      ${l}`);
}

console.log(`\n  total checks: ${total}, failures: ${failed}`);
if (failed) {
  console.log('date/timezone regression suite: FAILURE(S)');
  process.exit(1);
}
console.log('date/timezone regression suite: PASS');
