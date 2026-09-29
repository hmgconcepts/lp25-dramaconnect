#!/usr/bin/env node
/**
 * Regression suite for the "Could not find ... in the schema cache" class of
 * failure.
 *
 * Scenario A — self-heal: start from a database where the four UI-critical
 *              objects are absent (exactly the state produced when component
 *              02's transaction rolls back) and confirm a single re-run of
 *              complete-schema.sql restores them.
 *
 * Scenario B — independence: component 05 must depend only on the base tables
 *              from component 01, never on component 02, so it can repair a
 *              database even when the hardening transaction itself is the part
 *              that failed.
 *
 * Scenario C — grants: the objects must be usable by `authenticated` and
 *              invisible to `anon`, otherwise PostgREST hides them from the
 *              schema cache and the browser sees PGRST205.
 */
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFile(new URL(p, root), 'utf8');

const full = await read('database/complete-schema.sql');
const base = await read('database/repair_and_upgrade.sql');
const heal = await read('database/post_install_selfheal.sql');

const bootstrap = String.raw`
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text NOT NULL,
  public boolean NOT NULL DEFAULT false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id), name text NOT NULL, owner uuid, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
`;

const PROBE = `
  SELECT
    to_regclass('public.member_directory')         IS NOT NULL AS member_directory,
    to_regclass('public.rehearsal_schedule')       IS NOT NULL AS rehearsal_schedule,
    to_regprocedure('public.poll_results()')       IS NOT NULL AS poll_results,
    to_regprocedure('public.event_rsvp_results()') IS NOT NULL AS event_rsvp_results,
    (CASE WHEN to_regclass('public.member_directory') IS NULL THEN false
          ELSE has_table_privilege('authenticated','public.member_directory','SELECT') END)   AS dir_grant,
    (CASE WHEN to_regclass('public.rehearsal_schedule') IS NULL THEN false
          ELSE has_table_privilege('authenticated','public.rehearsal_schedule','SELECT') END) AS sched_grant,
    (CASE WHEN to_regprocedure('public.poll_results()') IS NULL THEN false
          ELSE has_function_privilege('authenticated','public.poll_results()','EXECUTE') END) AS poll_grant,
    (CASE WHEN to_regprocedure('public.event_rsvp_results()') IS NULL THEN false
          ELSE has_function_privilege('authenticated','public.event_rsvp_results()','EXECUTE') END) AS rsvp_grant,
    (CASE WHEN to_regclass('public.member_directory') IS NULL THEN true
          ELSE has_table_privilege('anon','public.member_directory','SELECT') END) AS dir_leak_anon,
    (CASE WHEN to_regclass('public.rehearsal_schedule') IS NULL THEN true
          ELSE has_table_privilege('anon','public.rehearsal_schedule','SELECT') END) AS sched_leak_anon
`;

const MUST_EXIST = ['member_directory', 'rehearsal_schedule', 'poll_results', 'event_rsvp_results'];
const MUST_BE_GRANTED = ['dir_grant', 'sched_grant', 'poll_grant', 'rsvp_grant'];
const MUST_BE_HIDDEN = ['dir_leak_anon', 'sched_leak_anon'];

function assertAll(object, label) {
  const bad = [];
  for (const key of MUST_EXIST) if (object[key] !== true) bad.push(`${key} missing`);
  for (const key of MUST_BE_GRANTED) if (object[key] !== true) bad.push(`${key} not granted`);
  for (const key of MUST_BE_HIDDEN) if (object[key] !== false) bad.push(`${key} leaks to anon`);
  if (bad.length) throw new Error(`${label}: ${bad.join(', ')}`);
}

const wipe = `
  DROP VIEW IF EXISTS public.member_directory;
  DROP VIEW IF EXISTS public.rehearsal_schedule;
  DROP FUNCTION IF EXISTS public.poll_results();
  DROP FUNCTION IF EXISTS public.event_rsvp_results();
`;

let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  PASS  ${name}`))
    .catch((error) => { failures += 1; console.log(`  FAIL  ${name}: ${error.message}`); });
}

console.log('self-heal regression suite');

// --- Scenario A: full install, wipe the four objects, re-run, expect repair ---
{
  const db = new PGlite();
  await db.exec(bootstrap);
  await db.exec(full);
  await db.exec(wipe);
  const before = (await db.query(PROBE)).rows[0];
  if (before.member_directory || before.poll_results) {
    console.log('  FAIL  wipe did not remove the objects; test invalid');
    failures += 1;
  }
  await db.exec(full);
  const after = (await db.query(PROBE)).rows[0];
  await check('A. complete-schema.sql restores the four UI-critical objects', () => assertAll(after, 'scenario A'));
  await db.close();
}

// --- Scenario B: component 01 + component 05 only, no component 02/03/04 -----
{
  const db = new PGlite();
  await db.exec(bootstrap);
  await db.exec(base);
  await db.exec(heal);
  const rows = (await db.query(PROBE)).rows[0];
  await check('B. component 05 is self-sufficient on top of component 01', () => assertAll(rows, 'scenario B'));
  await db.close();
}

// --- Scenario C: grants are usable by authenticated and hidden from anon -----
{
  const db = new PGlite();
  await db.exec(bootstrap);
  await db.exec(full);
  const rows = (await db.query(PROBE)).rows[0];
  await check('C. grants usable by authenticated', () => {
    for (const key of ['dir_grant', 'sched_grant', 'poll_grant', 'rsvp_grant']) {
      if (rows[key] !== true) throw new Error(`${key} is not granted to authenticated`);
    }
  });
  await check('C. objects remain hidden from anon', () => {
    for (const key of ['dir_leak_anon', 'sched_leak_anon']) {
      if (rows[key] !== false) throw new Error(`${key} leaks the view to anon`);
    }
  });
  await check('C. anon has no execute on the aggregate RPCs', async () => {
    const r = (await db.query(`
      SELECT has_function_privilege('anon','public.poll_results()','EXECUTE')       AS p,
             has_function_privilege('anon','public.event_rsvp_results()','EXECUTE') AS e
    `)).rows[0];
    if (r.p || r.e) throw new Error('anon can execute aggregate RPCs');
  });
  await db.close();
}

console.log(failures === 0 ? 'self-heal regression suite: PASS' : `self-heal regression suite: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
