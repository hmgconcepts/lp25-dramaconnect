#!/usr/bin/env node
/**
 * Regression suite for the rehearsal self check-in flow.
 *
 * The reported bug: an admin opens check-in with a code such as "SEP12" and
 * every member who enters it is told "Invalid check-in code".
 *
 * Root cause: public.self_check_in() rejected the code unless
 * char_length(checkin_code) = 6 EXACTLY. "SEP12" is five characters, so it
 * failed before the entered code was ever compared. The admin UI accepts any
 * non-empty code and reported success, so the failure was invisible until a
 * member tried to use it.
 *
 * These tests lock in the corrected behaviour: any code of three or more
 * characters works, comparison is case-insensitive and whitespace tolerant on
 * both sides, and a genuinely wrong code is still refused.
 */
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const schemaPath = process.env.CHECKIN_SCHEMA || 'database/complete-schema.sql';
const schema = await fs.readFile(new URL(schemaPath, root), 'utf8');

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

const MEMBER_A = '11111111-1111-4111-8111-111111111111';
const MEMBER_B = '22222222-2222-4222-8222-222222222222';

let failures = 0;

async function attempt(db, code, label, expectSuccess) {
  const result = await db.query('SELECT public.self_check_in($1, $2)', [rehearsalId, code])
    .then(() => ({ ok: true, message: null }))
    .catch((error) => ({ ok: false, message: String(error.message || error) }));

  const pass = result.ok === expectSuccess;
  if (pass) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label} — expected ${expectSuccess ? 'success' : 'rejection'}, got ` +
      (result.ok ? 'success' : `rejection: ${result.message}`));
  }
  return result;
}

let rehearsalId;

const db = new PGlite();
try {
  await db.exec(bootstrap);
  await db.exec(schema);

  // Two approved members. profiles.id references auth.users, so seed auth first.
  await db.query(
    `INSERT INTO auth.users (id, email) VALUES ($1,'ada@example.com'), ($2,'bola@example.com')
     ON CONFLICT (id) DO NOTHING`,
    [MEMBER_A, MEMBER_B]
  );
  await db.query(
    `INSERT INTO public.profiles (id, full_name, email, role, status)
     VALUES ($1,'Ada Okafor','ada@example.com','member','approved'),
            ($2,'Bola Adeyemi','bola@example.com','member','approved')
     ON CONFLICT (id) DO UPDATE SET status='approved'`,
    [MEMBER_A, MEMBER_B]
  );

  // A rehearsal for today, with check-in opened using the code from the report.
  const inserted = await db.query(
    `INSERT INTO public.rehearsals (rehearsal_date, notes, checkin_code, checkin_open)
     VALUES (CURRENT_DATE, 'Evening session', 'SEP12', true) RETURNING id`
  );
  rehearsalId = inserted.rows[0].id;

  // Sign in as member A.
  await db.query(`SELECT set_config('request.jwt.claim.sub', '${MEMBER_A}', false)`);
  await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`);

  console.log('self check-in regression suite');

  // --- The reported defect -------------------------------------------------
  await attempt(db, 'SEP12', 'the reported 5-character code "SEP12" is accepted', true);

  // --- Verify the attendance row was actually written -----------------------
  const { rows: attendanceRows } = await db.query(
    `SELECT status FROM public.attendance WHERE rehearsal_id = $1 AND member_id = $2`,
    [rehearsalId, MEMBER_A]
  );
  if (attendanceRows.length === 1 && attendanceRows[0].status === 'present') {
    console.log('  PASS  attendance row recorded as "present"');
  } else {
    failures += 1;
    console.log(`  FAIL  attendance row expected once as "present", got ${JSON.stringify(attendanceRows)}`);
  }

  // --- Case and whitespace tolerance ---------------------------------------
  await attempt(db, 'sep12', 'lowercase "sep12" matches "SEP12"', true);
  await attempt(db, '  SEP12  ', 'padded "  SEP12  " matches "SEP12"', true);
  await attempt(db, 'WRONGCODE', 'a genuinely wrong code is still rejected', false);

  // --- Codes of other lengths must work ------------------------------------
  for (const code of ['DRAMA25', 'DC1234', 'S12', 'ABCDEFGHIJKLMNOP']) {
    await db.query(
      `UPDATE public.rehearsals SET checkin_code = $1, checkin_open = true WHERE id = $2`,
      [code, rehearsalId]
    );
    await attempt(db, code, `code "${code}" (${code.length} chars) is accepted`, true);
  }

  // --- A trivially short code must not be accepted -------------------------
  await db.query(`UPDATE public.rehearsals SET checkin_code = 'X', checkin_open = true WHERE id = $1`,
    [rehearsalId]);
  const shortResult = await attempt(db, 'X', 'a 1-character code is refused', false);
  if (shortResult.message && /invalid check-in code/i.test(shortResult.message)) {
    failures += 1;
    console.log('  FAIL  a 1-character code should report "no code set", not "invalid code"');
  }

  // --- Check-in must still refuse when closed or on the wrong day ----------
  await db.query(`UPDATE public.rehearsals SET checkin_code = 'SEP12', checkin_open = false WHERE id = $1`,
    [rehearsalId]);
  await attempt(db, 'SEP12', 'closed check-in refuses even a correct code', false);

  await db.query(
    `UPDATE public.rehearsals SET checkin_code = 'SEP12', checkin_open = true,
     rehearsal_date = CURRENT_DATE + 30 WHERE id = $1`,
    [rehearsalId]
  );
  await attempt(db, 'SEP12', 'a rehearsal 30 days away refuses check-in', false);

  // --- The timezone window: same day, and the day either side --------------
  for (const offset of [-1, 0, 1]) {
    await db.query(
      `UPDATE public.rehearsals SET rehearsal_date = CURRENT_DATE + $2::int,
       checkin_open = true, checkin_code = 'SEP12' WHERE id = $1`,
      [rehearsalId, String(offset)]
    );
    await db.query(`DELETE FROM public.attendance WHERE rehearsal_id = $1`, [rehearsalId]);
    await attempt(db, 'SEP12', `rehearsal at CURRENT_DATE ${offset >= 0 ? '+' : ''}${offset} day(s) accepts check-in`, true);
  }

  console.log(failures === 0
    ? 'self check-in regression suite: PASS'
    : `self check-in regression suite: ${failures} FAILURE(S)`);
} finally {
  await db.close();
}

process.exit(failures === 0 ? 0 : 1);
