import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
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
const sql = await fs.readFile('database/complete-schema.sql', 'utf8');
const db = new PGlite();
await db.exec(bootstrap); await db.exec(sql);

const { rows } = await db.query(`
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count,
         (SELECT string_agg(DISTINCT p.polcmd, ',') FROM pg_policy p WHERE p.polrelid = c.oid) AS cmds
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','v','m') AND c.relname NOT LIKE 'dc_%'
  ORDER BY c.relname`);

console.log('table'.padEnd(22), 'RLS', 'policies', 'commands');
console.log('-'.repeat(70));
const problems = [];
for (const r of rows) {
  const line = `${r.table_name.padEnd(22)} ${String(r.rls_enabled).padEnd(5)} ${String(r.policy_count).padEnd(9)} ${r.cmds || '-'}`;
  const isView = ['member_directory','rehearsal_schedule'].includes(r.table_name);
  if (!isView && !r.rls_enabled) problems.push(`${r.table_name}: RLS NOT ENABLED — any authenticated user can read/write every row`);
  else if (!isView && r.policy_count === 0) problems.push(`${r.table_name}: RLS enabled but ZERO policies — nobody (incl. admins) can access it`);
  // PostgreSQL polcmd codes: r=SELECT a=INSERT w=UPDATE d=DELETE *=ALL
  else if (!isView && r.cmds && !r.cmds.includes('*') && !r.cmds.split(',').includes('r'))
    problems.push(`${r.table_name}: RLS enabled but NO SELECT policy — reads will always return zero rows`);
  console.log(line);
}
console.log('\n=== PROBLEMS ===');
console.log(problems.length ? problems.map(p => '  ! ' + p).join('\n') : '  (none)');
await db.close();
