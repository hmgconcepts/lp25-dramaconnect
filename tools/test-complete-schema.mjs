#!/usr/bin/env node
/**
 * Execute database/complete-schema.sql twice against a disposable PostgreSQL
 * (PGlite) database with the minimum auth/storage primitives supplied by a
 * hosted Supabase project. This is a development validation harness only.
 */
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const sql = await fs.readFile(new URL('database/complete-schema.sql', root), 'utf8');
const securitySql = await fs.readFile(new URL('database/security_hardening.sql', root), 'utf8');
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

function message(error) {
  return error?.cause?.message || error?.message || String(error);
}

try {
  await db.exec(bootstrap);
  for (let pass = 1; pass <= 2; pass += 1) {
    try {
      await db.exec(sql);
      console.log(`complete-schema.sql pass ${pass}: OK`);
    } catch (error) {
      throw new Error(`complete-schema.sql pass ${pass} failed: ${message(error)}`, { cause: error });
    }
  }

  const { rows: tableRows } = await db.query(`
    SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
  `);
  const { rows: policyRows } = await db.query(`
    SELECT count(*)::int AS count FROM pg_policies WHERE schemaname IN ('public','storage')
  `);
  const { rows: functionRows } = await db.query(`
    SELECT count(*)::int AS count FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  `);
  const { rows: requiredRows } = await db.query(`
    SELECT to_regclass('public.tenant_settings')::text AS tenant_settings,
           to_regclass('public.dc_platform_settings')::text AS platform_settings,
           to_regclass('public.dc_site_license')::text AS site_license,
           to_regclass('public.dc_login_audit')::text AS login_audit,
           to_regclass('public.dc_backup_runs')::text AS backup_runs
  `);
  const tableCount = tableRows[0].count;
  const policyCount = policyRows[0].count;
  const functionCount = functionRows[0].count;
  const missing = Object.entries(requiredRows[0]).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Required relations missing: ${missing.join(', ')}`);
  if (Number(tableCount) < 25) throw new Error(`Expected at least 25 public tables; found ${tableCount}`);
  if (Number(policyCount) < 25) throw new Error(`Expected at least 25 RLS policies; found ${policyCount}`);

  console.log(`schema assertions: ${tableCount} public tables, ${policyCount} policies, ${functionCount} public functions`);

  // Regression guard: these four objects power the polls, events, birthdays,
  // casting, members, directory, dashboard, attendance and rehearsals pages.
  // When component 02 rolled back on a project they vanished and every one of
  // those pages reported "Could not find ... in the schema cache".
  const { rows: uiObjects } = await db.query(`
    SELECT
      to_regclass('public.member_directory')         IS NOT NULL AS member_directory,
      to_regclass('public.rehearsal_schedule')       IS NOT NULL AS rehearsal_schedule,
      to_regprocedure('public.poll_results()')       IS NOT NULL AS poll_results,
      to_regprocedure('public.event_rsvp_results()') IS NOT NULL AS event_rsvp_results
  `);
  const missingUi = Object.entries(uiObjects[0]).filter(([, ok]) => !ok).map(([k]) => k);
  if (missingUi.length) throw new Error(`UI-critical database objects missing: ${missingUi.join(', ')}`);
  console.log('UI-critical objects present: member_directory, rehearsal_schedule, poll_results, event_rsvp_results');

  if (!/NOTIFY\s+pgrst,\s*'reload schema'/i.test(sql)) {
    throw new Error('complete-schema.sql does not request a PostgREST schema-cache reload');
  }
  console.log('PostgREST schema-cache reload present: PASS');

  // Reproduce the reported legacy failure condition: the rest of the app schema
  // exists, but tenant_settings is absent when security_hardening.sql starts.
  await db.exec('DROP TABLE public.tenant_settings CASCADE;');
  await db.exec(securitySql);
  const { rows: repairedRows } = await db.query("SELECT to_regclass('public.tenant_settings')::text AS relation");
  if (!repairedRows[0].relation) throw new Error('security_hardening.sql did not recreate tenant_settings');
  console.log('security_hardening.sql missing-tenant_settings repair: PASS');
  console.log('complete schema rerun validation: PASS');
} finally {
  await db.close();
}
