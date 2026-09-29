/*
 * Item 21 — Fleet Console contract, organisation settings, venue geofence,
 * analytics, table sizes, login audit, Schema Doctor and the Archive Vault.
 * Runs complete-schema.sql twice (rerun safety) in PGlite.
 */
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('database/complete-schema.sql', root), 'utf8');
let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
const rejects = async (label, sql, params, pattern) => {
  try { await db.query(sql, params); check(label, false, 'no error raised'); }
  catch (e) { check(label, !pattern || pattern.test(e.message), e.message); }
};
const db = new PGlite();
const bootstrap = String.raw`
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
`;
await db.exec(bootstrap);
await db.exec(schema);
await db.exec(schema); // rerun safety
check('complete-schema.sql runs twice without error', true);

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-0000000000b1';
await db.query(`INSERT INTO auth.users (id,email) VALUES ($1,'admin@example.com'),($2,'mem@example.com') ON CONFLICT DO NOTHING`, [ADMIN, MEMBER]);
await db.query(`INSERT INTO public.profiles (id,full_name,email,role,status,unit,gender,parish,created_at)
  VALUES ($1,'Admin One','admin@example.com','admin','approved','Directors','female','LP25', now()-interval '90 days'),
         ($2,'Member Two','mem@example.com','member','approved','Actors','male','LP25', now()-interval '90 days')
  ON CONFLICT (id) DO UPDATE SET full_name=excluded.full_name, role=excluded.role, status='approved', unit=excluded.unit, gender=excluded.gender, parish=excluded.parish, created_at=excluded.created_at`, [ADMIN, MEMBER]);
const as = async (id) => {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [id || '']);
  await db.query(`SELECT set_config('request.jwt.claim.role', $1, false)`, [id ? 'authenticated' : 'anon']);
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

console.log('\nA. HMG Fleet Console contract');
{
  const r = await one(`SELECT public.sc_keep_alive('hmg-fleet-console') AS t`);
  check('sc_keep_alive returns a timestamp', r.t instanceof Date, String(r.t));
  const hb = await one(`SELECT pinged_at, src, ping_count FROM public.sc_keepalive WHERE id = 1`);
  check('sc_keepalive heartbeat row written', hb && hb.pinged_at && hb.ping_count >= 1, JSON.stringify(hb));
  const src = await one(`SELECT count(*)::int n FROM public.dc_heartbeat_sources WHERE source='fleet-console'`);
  check('fleet ping recorded under the fleet-console source', src.n === 1);
  await db.query(`SELECT public.sc_keep_alive('github-actions-fleet')`);
  const s2 = await one(`SELECT count(*)::int n FROM public.dc_heartbeat_sources WHERE source='fleet-actions'`);
  check('GitHub fleet workflow mapped to fleet-actions', s2.n === 1);
  await db.query('SET ROLE anon');
  const lic = await one(`SELECT public.sc_license_status() AS l`);
  const hbAnon = await one(`SELECT pinged_at FROM public.sc_keepalive LIMIT 1`);
  await db.query('RESET ROLE');
  check('sc_license_status callable by anon and reports lifetime', lic.l.state === 'lifetime' && lic.l.status === 'lifetime', JSON.stringify(lic.l));
  check('licence probe leaks no licensee name', !JSON.stringify(lic.l).includes('licensed_to'));
  check('sc_keepalive readable by anon (Fleet heartbeat read)', !!hbAnon?.pinged_at);
  await db.query(`UPDATE public.dc_site_license SET license_model='subscription', expires_on=CURRENT_DATE-3, grace_days=7 WHERE id=1`);
  check('subscription inside grace reports grace', (await one(`SELECT public.sc_license_status()->>'state' s`)).s === 'grace');
  await db.query(`UPDATE public.dc_site_license SET expires_on=CURRENT_DATE-30 WHERE id=1`);
  check('lapsed subscription reports expired', (await one(`SELECT public.sc_license_status()->>'state' s`)).s === 'expired');
  await db.query(`UPDATE public.dc_site_license SET license_model='lifetime', expires_on=NULL WHERE id=1`);
  const h = await one(`SELECT public.dc_heartbeat_health() h`);
  check('heartbeat health exposes the fleet block and last source', h.h.fleet !== undefined && !!h.h.lastSource, JSON.stringify({ f: h.h.fleet, s: h.h.lastSource }));
}

console.log('\nB. Organisation settings');
{
  await as(MEMBER);
  await rejects('members cannot update organisation settings', `SELECT public.dc_update_org_settings('{"call_time":"17:00"}')`, [], /Administrator/);
  await as(ADMIN);
  const r = await one(`SELECT public.dc_update_org_settings($1::jsonb) s`, [JSON.stringify({ call_time: '17:30', late_after_minutes: 10, timezone: 'Africa/Lagos', default_language: 'yo', disabled_modules: ['gallery', 'polls'] })]);
  check('admin saves call time, grace, language and modules', r.s.call_time.startsWith('17:30') && r.s.default_language === 'yo' && r.s.disabled_modules.length === 2, JSON.stringify(r.s));
  await rejects('unknown time zone rejected', `SELECT public.dc_update_org_settings('{"timezone":"Mars/Olympus"}')`, [], /time zone/);
  await rejects('core modules cannot be disabled', `SELECT public.dc_update_org_settings('{"disabled_modules":["settings"]}')`, [], /cannot be disabled/);
  await rejects('invalid module id rejected', `SELECT public.dc_update_org_settings('{"disabled_modules":["Bad Id!"]}')`, [], /Invalid module/);
  await rejects('enabling geofence without coordinates rejected', `SELECT public.dc_update_org_settings('{"geofence_enabled":true,"geofence_lat":null,"geofence_lng":null}')`, [], /check constraint|violates/i);
  const log = await one(`SELECT count(*)::int n FROM public.activity_log WHERE action='org_settings_updated'`);
  check('settings changes are written to the activity log', log.n >= 1);
  const sec = await one(`SELECT count(*)::int n FROM public.dc_login_audit WHERE event_type='security_changed'`);
  check('module-access change recorded as a security event', sec.n >= 1);
}

console.log('\nC. Venue geofence');
{
  await as(ADMIN);
  // Venue: Lagos (6.5244, 3.3792), 150 m radius.
  await db.query(`SELECT public.dc_update_org_settings('{"geofence_enabled":true,"geofence_lat":6.5244,"geofence_lng":3.3792,"geofence_radius_m":150,"geofence_max_accuracy_m":100,"venue_name":"Main Hall"}')`);
  const reh = await one(`INSERT INTO public.rehearsals (rehearsal_date, notes, checkin_code, checkin_open) VALUES (CURRENT_DATE,'Geo test','GEO25',true) RETURNING id`);
  await as(MEMBER);
  await rejects('legacy self_check_in refused while geofence is on', `SELECT public.self_check_in($1,'GEO25')`, [reh.id], /Location check required/);
  await rejects('missing location rejected', `SELECT public.dc_self_check_in_geo($1,'GEO25')`, [reh.id], /Location is required/);
  await rejects('imprecise location rejected', `SELECT public.dc_self_check_in_geo($1,'GEO25',6.5244,3.3792,900)`, [reh.id], /imprecise/);
  await rejects('member 2 km away rejected', `SELECT public.dc_self_check_in_geo($1,'GEO25',6.5424,3.3792,20)`, [reh.id], /m from Main Hall/);
  const ok = await one(`SELECT public.dc_self_check_in_geo($1,'GEO25',6.5250,3.3795,25) r`, [reh.id]);
  check('member inside the fence is checked in', ok.r.ok === true && ok.r.distanceM < 150, JSON.stringify(ok.r));
  const flag = await one(`SELECT COALESCE(current_setting('dc.geo_verified', true),'') v`);
  check('geo verification flag does not leak past the call', flag.v !== 'on', flag.v);
  const att = await one(`SELECT status FROM public.attendance WHERE rehearsal_id=$1 AND member_id=$2`, [reh.id, MEMBER]);
  check('attendance row written as present', att?.status === 'present');
  await as(ADMIN);
  await db.query(`SELECT public.dc_update_org_settings('{"geofence_enabled":false}')`);
  await as(MEMBER);
  await db.query(`SELECT public.self_check_in($1,'GEO25')`, [reh.id]);
  check('legacy self_check_in works again once geofence is off', true);
  const plain = await one(`SELECT public.dc_self_check_in_geo($1,'GEO25') r`, [reh.id]);
  check('geo RPC works without location when geofence is off', plain.r.ok === true && plain.r.geofence === false);
}

console.log('\nD. Analytics, table sizes, login audit, Schema Doctor');
{
  await as(ADMIN);
  for (let i = 1; i <= 4; i++) {
    const r = await one(`INSERT INTO public.rehearsals (rehearsal_date, notes) VALUES (CURRENT_DATE - $1::int * 7, 'Week') RETURNING id`, [i]);
    await db.query(`INSERT INTO public.attendance (rehearsal_id, member_id, status, marked_at) VALUES ($1,$2,'present', (CURRENT_DATE - $3::int*7) + time '16:05')`, [r.id, ADMIN, i]);
  }
  await db.query(`INSERT INTO public.finances (type, amount, date) VALUES ('income', 5000, CURRENT_DATE), ('expense', 1200, CURRENT_DATE)`);
  const a = (await one(`SELECT public.dc_analytics_overview(12) a`)).a;
  check('analytics returns 12 monthly buckets', a.monthly.length === 12, String(a.monthly.length));
  check('analytics KPIs count approved members', a.kpis.membersApproved === 2, JSON.stringify(a.kpis.membersApproved));
  check('admin sees income/expense', Number(a.kpis.income) === 5000 && Number(a.kpis.expense) === 1200);
  check('member who missed every session is at risk', a.atRisk.some((m) => m.name === 'Member Two'), JSON.stringify(a.atRisk));
  check('regular attender is in the top list', a.topMembers.some((m) => m.name === 'Admin One'));
  check('full per-member breakdown returned for the Attendance table', Array.isArray(a.members) && a.members.length === 2 && a.members.every((m) => 'present' in m && 'expected' in m), JSON.stringify(a.members));
  check('units, gender, parishes and punctuality present', a.byUnit.length >= 2 && a.gender.male === 1 && a.parishes.length >= 1 && a.punctuality.measured >= 0);
  await as(MEMBER);
  await rejects('plain members cannot load department analytics', `SELECT public.dc_analytics_overview(12)`, [], /access required/);
  await rejects('plain members cannot read table sizes', `SELECT public.dc_table_sizes()`, [], /Administrator/);
  await as(ADMIN);
  const ts = (await one(`SELECT public.dc_table_sizes() t`)).t;
  const prof = ts.find((t) => t.table === 'profiles');
  check('table sizes list exact row counts', prof && prof.rows === 2 && prof.bytes > 0, JSON.stringify(prof));
  await db.query(`SELECT public.dc_record_login_event('sign_in', 'test-agent', '{}'::jsonb)`).catch(() => {});
  await db.query(`INSERT INTO public.dc_login_audit (user_id,email,event_type,user_agent) VALUES ($1,'admin@example.com','sign_in','Mozilla/5.0 Android')`, [ADMIN]);
  const la = (await one(`SELECT public.dc_login_audit_report(30, 50, NULL) r`)).r;
  check('login audit shows who signed in', la.rows.some((r) => r.name === 'Admin One' && r.event === 'sign_in'), JSON.stringify(la.rows.slice(0, 2)));
  check('login audit summary counts', la.summary.signIns24h >= 1 && la.summary.uniqueUsers7d >= 1 && la.neverSignedIn >= 1, JSON.stringify(la.summary));
  const doc = (await one(`SELECT public.dc_schema_doctor() d`)).d;
  check('Schema Doctor probes six packs', doc.packs.length === 6);
  const nonBucket = doc.packs.every((p) => p.missing.every((m) => m.startsWith('b:')));
  check('every table/function marker installed (buckets are Supabase-only here)', nonBucket, JSON.stringify(doc.packs.map((p) => [p.id, p.missing])));
}

console.log('\nE. Archive Vault');
{
  await as(ADMIN);
  await db.query(`INSERT INTO public.activity_log (actor_name, action, detail, created_at) SELECT 'x','old','d', now() - interval '400 days' FROM generate_series(1,5)`);
  const path = 'archive-vault/activity_log/activity_log-before-2025.json';
  const sha = 'a'.repeat(64);
  const before = new Date(Date.now() - 300 * 86400000).toISOString();
  await rejects('purge refused until the archive exists in the vault', `SELECT public.dc_archive_purge('activity_log',$1,$2,$3,5,'ARCHIVE activity_log')`, [before, path, sha], /not found/);
  await db.query(`INSERT INTO storage.buckets (id,name) VALUES ('dramaconnect-backups','dramaconnect-backups') ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO storage.objects (bucket_id,name,metadata) VALUES ('dramaconnect-backups',$1,'{"size":1234}')`, [path]);
  await rejects('purge refused when row count differs from export', `SELECT public.dc_archive_purge('activity_log',$1,$2,$3,4,'ARCHIVE activity_log')`, [before, path, sha], /Export again/);
  await rejects('purge refused for non-target table', `SELECT public.dc_archive_purge('profiles',$1,$2,$3,5,'ARCHIVE profiles')`, [before, 'archive-vault/profiles/x.json', sha], /not an archive target/);
  await rejects('purge refused for wrong confirmation', `SELECT public.dc_archive_purge('activity_log',$1,$2,$3,5,'yes')`, [before, path, sha], /confirmation/);
  const rows = (await db.query(`SELECT * FROM public.activity_log WHERE created_at < $1`, [before])).rows;
  const res = (await one(`SELECT public.dc_archive_purge('activity_log',$1,$2,$3,5,'ARCHIVE activity_log') r`, [before, path, sha])).r;
  check('verified archive purges exactly the exported rows', res.archivedRows === 5, JSON.stringify(res));
  const left = await one(`SELECT count(*)::int n FROM public.activity_log WHERE created_at < $1`, [before]);
  check('old rows gone after purge', left.n === 0);
  const v = await one(`SELECT id FROM public.dc_archive_vault WHERE object_path=$1`, [path]);
  const rr = (await one(`SELECT public.dc_archive_restore($1, $2::jsonb) r`, [v.id, JSON.stringify(rows)])).r;
  check('restore re-inserts archived rows', rr.restoredRows === 5, JSON.stringify(rr));
  const rr2 = (await one(`SELECT public.dc_archive_restore($1, $2::jsonb) r`, [v.id, JSON.stringify(rows)])).r;
  check('second restore is idempotent (no duplicates)', rr2.restoredRows === 0, JSON.stringify(rr2));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — platform operations: ${pass} passed, ${fail} failed.\n`);
process.exit(fail === 0 ? 0 : 1);
