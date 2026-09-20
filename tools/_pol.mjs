import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const b = String.raw`
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
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL, owner uuid, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name,'/') $$;
`;
const db = new PGlite();
await db.exec(b); await db.exec(await fs.readFile('database/complete-schema.sql','utf8'));
const { rows } = await db.query(`
  SELECT schemaname, tablename, policyname, cmd,
         coalesce(qual,'') AS using_expr, coalesce(with_check,'') AS check_expr
  FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname`);
for (const r of rows) {
  console.log(`${r.tablename}.${r.policyname} [${r.cmd}]`);
  if (r.using_expr) console.log(`    USING  ${String(r.using_expr).replace(/\s+/g,' ').slice(0,150)}`);
  if (r.check_expr) console.log(`    CHECK  ${String(r.check_expr).replace(/\s+/g,' ').slice(0,150)}`);
}
await db.close();
