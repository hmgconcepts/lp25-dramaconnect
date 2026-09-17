#!/usr/bin/env node
/**
 * Diagnostic: run database/complete-schema.sql and report whether the four
 * objects the UI cannot find actually exist afterwards, plus whether a
 * PostgREST-style privilege filter would expose them.
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
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL, owner uuid, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
`;

const db = new PGlite();
await db.exec(bootstrap);

const targetRels = ['member_directory', 'rehearsal_schedule'];
const targetFuncs = ['public.poll_results()', 'public.event_rsvp_results()'];

async function report(label) {
  const out = { label, relations: {}, functions: {}, privileges: {} };
  for (const rel of targetRels) {
    const q = await db.query(
      `SELECT c.relkind, c.relowner::regrole::text AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=$1`,
      [rel]
    );
    out.relations[rel] = q.rows[0] || null;
  }
  for (const fn of targetFuncs) {
    const q = await db.query(
      `SELECT to_regprocedure($1) IS NOT NULL AS exists,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS auth_exec,
              has_function_privilege('anon', $1, 'EXECUTE') AS anon_exec`,
      [fn]
    );
    out.functions[fn] = q.rows[0];
  }
  const p = await db.query(
    `SELECT relname,
            has_table_privilege('authenticated', 'public.'||relname, 'SELECT') AS auth_sel,
            has_table_privilege('anon', 'public.'||relname, 'SELECT') AS anon_sel
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname = ANY($1)`,
    [targetRels]
  );
  out.privileges = p.rows;
  console.log(JSON.stringify(out, null, 2));
  return out;
}

try {
  await db.exec(sql);
  console.log('RUN 1: completed without throwing');
} catch (e) {
  console.log('RUN 1 FAILED:', e.message);
}
await report('after-run-1');

try {
  await db.exec(sql);
  console.log('RUN 2: completed without throwing');
} catch (e) {
  console.log('RUN 2 FAILED:', e.message);
}
await report('after-run-2');
