#!/usr/bin/env node
/**
 * Proof-of-cause: if ANY statement inside the security_hardening transaction
 * fails (here: public.gallery absent, exactly like the already-reported
 * tenant_settings 42P01), the whole component rolls back and the four objects
 * the UI needs disappear -- while every other table keeps working.
 */
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const sql = await fs.readFile(new URL('database/complete-schema.sql', root), 'utf8');

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

async function probe(db, label) {
  const q = await db.query(`
    SELECT
      to_regclass('public.member_directory')    IS NOT NULL AS member_directory,
      to_regclass('public.rehearsal_schedule')  IS NOT NULL AS rehearsal_schedule,
      to_regclass('public.profiles')            IS NOT NULL AS profiles,
      to_regclass('public.rehearsals')          IS NOT NULL AS rehearsals,
      to_regclass('public.tenant_settings')     IS NOT NULL AS tenant_settings,
      to_regclass('public.dc_site_license')     IS NOT NULL AS dc_site_license,
      to_regprocedure('public.poll_results()')        IS NOT NULL AS poll_results,
      to_regprocedure('public.event_rsvp_results()')  IS NOT NULL AS event_rsvp_results,
      to_regprocedure('public.is_admin()')            IS NOT NULL AS is_admin,
      to_regprocedure('public.dc_access_state()')     IS NOT NULL AS dc_access_state
  `);
  console.log(label, JSON.stringify(q.rows[0], null, 2));
}

// Scenario: a real install where one hardening dependency is missing.
const db = new PGlite();
await db.exec(bootstrap);
try {
  await db.exec(sql);
  console.log('baseline install: OK');
} catch (e) { console.log('baseline install threw:', e.message); }
await probe(db, 'BASELINE:');

// Now break it the way a live project breaks: remove gallery, then rerun.
await db.exec('DROP TABLE public.gallery CASCADE;');
try {
  await db.exec(sql);
  console.log('\nrerun with public.gallery missing: completed');
} catch (e) {
  console.log('\nrerun with public.gallery missing: ABORTED ->', e.message);
}
await probe(db, 'AFTER RERUN (gallery missing):');
await db.close();
