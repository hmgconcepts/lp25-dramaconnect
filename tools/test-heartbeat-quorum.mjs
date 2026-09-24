/*
 * Layer 11 — heartbeat quorum and dead-scheduler detection.
 *
 * The point of this layer is that a single "last heartbeat" timestamp lies.
 * If UptimeRobot keeps pinging while the GitHub Actions scheduler dies
 * silently, a naive dashboard says "healthy" while the site has quietly
 * fallen from four independent safety nets to one.
 *
 * These checks prove the database can tell those two situations apart and
 * name the source that went quiet.
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

const db = new PGlite();

// Reuse the exact bootstrap from the schema test so this environment matches
// the schema's assumptions rather than approximating them.
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

const health = async () => {
  const r = await db.query('SELECT public.dc_heartbeat_health() AS h');
  return r.rows[0].h;
};

console.log('\nLayer 11 — heartbeat quorum and dead-scheduler detection\n');

/* ---------------- 1. no heartbeat yet ---------------- */
console.log('A. Before any heartbeat');
{
  const h = await health();
  check('reports the "no-heartbeat" state instead of pretending all is well', h.status === 'no-heartbeat', h.status);
  check('does NOT claim a quorum', h.quorum !== true);
}

/* ---------------- 2. one source only ---------------- */
console.log('\nB. A single scheduler is running');
{
  await db.query("SELECT public.dc_keep_alive('github-actions')");
  const h = await health();
  check('status is healthy while the heartbeat is fresh', h.status === 'healthy', h.status);
  check('flags a single point of failure', h.singlePointOfFailure === true);
  check('withholds quorum', h.quorum === false);
  check('counts one fresh source', h.sourcesFresh === 1 && h.sourcesTotal === 1,
    `fresh=${h.sourcesFresh} total=${h.sourcesTotal}`);
  check('reports the pause countdown', typeof h.daysUntilPause === 'number' && h.daysUntilPause > 6,
    String(h.daysUntilPause));
}

/* ---------------- 3. four independent sources ---------------- */
console.log('\nC. Four independent schedulers are running');
{
  for (const src of ['vercel-cron', 'apps-script', 'cron-job-org']) {
    await db.query('SELECT public.dc_keep_alive($1)', [src]);
  }
  const h = await health();
  check('all four sources are counted', h.sourcesTotal === 4, `total=${h.sourcesTotal}`);
  check('quorum is granted', h.quorum === true);
  check('single point of failure is cleared', h.singlePointOfFailure === false);
  check('no sources are reported silent', Array.isArray(h.silentSources) && h.silentSources.length === 0,
    JSON.stringify(h.silentSources));
}

/* ---------------- 4. the killer scenario ---------------- */
console.log('\nD. A scheduler dies silently while others keep pinging');
{
  // Rewind github-actions to 10 days ago. UptimeRobot etc. keep the DB warm,
  // so a naive "last heartbeat" check would still report healthy.
  await db.query("UPDATE public.dc_heartbeat_sources SET last_ping_at = now() - interval '10 days' WHERE source = 'github-actions'");
  const h = await health();

  check('the database itself still looks healthy', h.status === 'healthy', h.status);
  check('...but the dead scheduler is named', h.silentSources.includes('github-actions'),
    JSON.stringify(h.silentSources));
  check('fresh count drops to three', h.sourcesFresh === 3, `fresh=${h.sourcesFresh}`);
  check('quorum is still held, so this is a repair not an emergency', h.quorum === true);
}

/* ---------------- 5. all but one die ---------------- */
console.log('\nE. Three of four schedulers die');
{
  await db.query("UPDATE public.dc_heartbeat_sources SET last_ping_at = now() - interval '10 days' WHERE source <> 'cron-job-org'");
  const h = await health();
  check('fresh count drops to one', h.sourcesFresh === 1, `fresh=${h.sourcesFresh}`);
  check('single point of failure is raised again', h.singlePointOfFailure === true);
  check('quorum is withdrawn', h.quorum === false);
  check('three sources are listed as silent', h.silentSources.length === 3, JSON.stringify(h.silentSources));
}

/* ---------------- 6. approaching the pause ---------------- */
console.log('\nF. The pause countdown');
{
  await db.query("UPDATE public.dc_heartbeat_sources SET last_ping_at = now() - interval '5 days'");
  const h = await health();
  check('five days idle reads as a warning', h.status === 'warning', `${h.status} (${h.hoursSinceHeartbeat}h)`);
  check('days until pause is about two', h.daysUntilPause > 1.5 && h.daysUntilPause < 2.5, String(h.daysUntilPause));

  await db.query("UPDATE public.dc_heartbeat_sources SET last_ping_at = now() - interval '6 days'");
  const critical = await health();
  check('six days idle reads as critical', critical.status === 'critical', critical.status);

  await db.query("UPDATE public.dc_heartbeat_sources SET last_ping_at = now() - interval '8 days'");
  const paused = await health();
  check('eight days idle reads as paused', paused.status === 'paused', paused.status);
  check('hours until pause never goes negative', paused.hoursUntilPause === 0, String(paused.hoursUntilPause));
}

/* ---------------- 7. source allow-list still enforced ---------------- */
console.log('\nG. Unauthenticated callers cannot invent sources');
{
  await db.query("SELECT public.dc_keep_alive('<script>evil</script>')");
  const r = await db.query("SELECT count(*)::int AS n FROM public.dc_heartbeat_sources WHERE source = 'external'");
  check('a hostile source name collapses into the external bucket', r.rows[0].n === 1, `n=${r.rows[0].n}`);
}

await db.close();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — heartbeat quorum: ${pass} passed, ${fail} failed.\n`);
process.exit(fail === 0 ? 0 : 1);
