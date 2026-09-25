#!/usr/bin/env node
/**
 * Functional + privilege suite for component 05 (identity_and_programs.sql):
 * verifiable ID cards, public programme registration/check-in/insights,
 * duty roster and member care. Runs the GENERATED complete schema in PGlite,
 * simulates Supabase users through request.jwt.claim.*, and switches to the
 * real anon/authenticated roles to prove the GRANT allow-list.
 */
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('database/complete-schema.sql', root), 'utf8');

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

const ADMIN  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEADER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMBER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER  = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PENDING= 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let passed = 0, failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
};
const db = new PGlite();
const as = async (uid, role = 'authenticated') => {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`SELECT set_config('request.jwt.claim.role', $1, false)`, [role]);
};
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const rpc = async (sql, params = []) => {
  try { const row = await one(sql, params); return { ok: true, value: row ? Object.values(row)[0] : null }; }
  catch (error) { return { ok: false, message: String(error.message || error) }; }
};

await db.exec(bootstrap);
await db.exec(schema);

// Docs/schema drift guard: the DR runbook's verification query must return zero
// rows against the generated schema, and it must name every archived table.
{
  const runbook = await fs.readFile(new URL('docs/DISASTER-RECOVERY-RUNBOOK.md', root), 'utf8');
  const query = (runbook.match(/```sql\n(SELECT t AS missing_table[\s\S]*?)```/) || [])[1];
  ok(Boolean(query), 'DR runbook contains the archived-table verification query');
  const portability = await fs.readFile(new URL('assets/js/data-portability.js', root), 'utf8');
  const archived = [...portability.split('const TABLES = Object.freeze([')[1].split(']);')[0].matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]);
  ok(archived.every((t) => query && query.includes(`'${t}'`)), `DR runbook query names all ${archived.length} archived tables`);
  const missing = query ? (await db.query(query)).rows : [{ missing_table: 'query-not-found' }];
  ok(missing.length === 0, 'DR runbook query returns zero rows on the complete schema', JSON.stringify(missing));
}
await db.query(`INSERT INTO auth.users (id, email) VALUES ($1,'a@x.io'),($2,'l@x.io'),($3,'m@x.io'),($4,'o@x.io'),($5,'p@x.io') ON CONFLICT DO NOTHING`,
  [ADMIN, LEADER, MEMBER, OTHER, PENDING]);
await db.query(`INSERT INTO public.profiles (id, full_name, email, phone, role, status, unit, is_unit_leader, created_at) VALUES
  ($1,'Ada Admin','a@x.io','08030000001','admin','approved','Acting',false, now() - interval '400 days'),
  ($2,'Lola Leader','l@x.io','08030000002','member','approved','Acting',true, now() - interval '400 days'),
  ($3,'Musa Member','m@x.io','08030000003','member','approved','Acting',false, now() - interval '400 days'),
  ($4,'Ola Other','o@x.io','08030000004','member','approved','Sound',false, now() - interval '400 days'),
  ($5,'Pat Pending','p@x.io','08030000005','member','pending','Acting',false, now())
  ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name, phone=EXCLUDED.phone, role=EXCLUDED.role,
    status=EXCLUDED.status, unit=EXCLUDED.unit, is_unit_leader=EXCLUDED.is_unit_leader, created_at=EXCLUDED.created_at`,
  [ADMIN, LEADER, MEMBER, OTHER, PENDING]);

console.log('ID cards');
await as(MEMBER);
let r = await rpc(`SELECT public.dc_my_card()`);
ok(r.ok && r.value.status === 'valid', 'member receives a valid card on first open', r.message);
const card = r.value;
ok(/^DC-\d{6}$/.test(card.member_no), `member number is human readable (${card.member_no})`);
ok(/^[a-f0-9]{32}$/.test(card.card_token), 'card token is 128-bit hex');
ok(!('phone' in card) || card.phone === null, 'phone hidden on card unless settings.show_phone');
r = await rpc(`SELECT public.dc_my_card()`);
ok(r.value.card_token === card.card_token && r.value.member_no === card.member_no, 'reopening is idempotent (same token and number)');
await as(PENDING);
r = await rpc(`SELECT public.dc_my_card()`);
ok(!r.ok, 'pending accounts cannot obtain a card');

await as('', 'anon');
const url = `https://example.org/pages/verify.html?c=${card.card_token}`;
r = await rpc(`SELECT public.dc_verify_card($1)`, [url]);
ok(r.ok && r.value.status === 'valid' && r.value.full_name === 'Musa Member', 'anonymous verify via full QR URL is valid', r.message);
ok(!('phone' in r.value) && !('email' in r.value) && !('card_token' in r.value) && !('member_id' in r.value), 'public verification exposes no phone/email/token/id');
r = await rpc(`SELECT public.dc_verify_card($1)`, [card.card_token.toUpperCase()]);
ok(r.value.status === 'valid', 'bare token (any case) verifies');
r = await rpc(`SELECT public.dc_verify_card($1)`, [card.member_no]);
ok(r.value.status === 'invalid', 'member number is NOT accepted publicly (no enumeration)');
r = await rpc(`SELECT public.dc_verify_card($1)`, ['0'.repeat(32)]);
ok(r.value.status === 'not_found', 'unknown token reports not_found');
r = await rpc(`SELECT public.dc_verify_card($1)`, [`dramaconnect:verify:${MEMBER}`]);
ok(r.value.status === 'invalid', 'legacy uuid payload is not publicly resolvable');
const vc = await one(`SELECT verify_count FROM public.dc_member_cards WHERE member_id=$1`, [MEMBER]);
ok(vc.verify_count === 2, `verification counter increments without inserting rows (${vc.verify_count})`);

await as(MEMBER);
r = await rpc(`SELECT public.dc_lookup_card($1)`, [card.member_no]);
ok(!r.ok, 'ordinary members cannot use the scanner lookup');
await as(LEADER);
for (const [code, kind] of [[url, 'qr'], [card.member_no.toLowerCase(), 'barcode'], [`dramaconnect:verify:${MEMBER}`, 'legacy'], [MEMBER, 'legacy']]) {
  r = await rpc(`SELECT public.dc_lookup_card($1)`, [code]);
  ok(r.ok && r.value.member_id === MEMBER && r.value.source === kind, `leader scanner resolves ${kind} code "${code.slice(0, 28)}…"`, r.message || JSON.stringify(r.value));
}
r = await rpc(`SELECT public.dc_lookup_card($1)`, ['hello world']);
ok(r.value.status === 'invalid', 'garbage scan is reported invalid, not an error');

await as(LEADER);
r = await rpc(`SELECT public.dc_admin_card_action($1,'revoke','lost')`, [MEMBER]);
ok(!r.ok, 'leaders cannot revoke cards');
await as(ADMIN);
r = await rpc(`SELECT public.dc_admin_card_action($1,'revoke','')`, [MEMBER]);
ok(!r.ok && /reason/i.test(r.message), 'revocation requires a reason');
r = await rpc(`SELECT public.dc_admin_card_action($1,'revoke','Reported lost')`, [MEMBER]);
ok(r.ok && r.value.status === 'revoked', 'admin revokes a card');
await as('', 'anon');
r = await rpc(`SELECT public.dc_verify_card($1)`, [card.card_token]);
ok(r.value.status === 'revoked', 'revoked card shows REVOKED to the public');
await as(ADMIN);
r = await rpc(`SELECT public.dc_admin_card_action($1,'reissue')`, [MEMBER]);
ok(r.ok && r.value.status === 'valid' && r.value.card_token !== card.card_token && r.value.member_no === card.member_no && r.value.reissue_count === 1,
  'reissue rotates the token, keeps the member number, clears revocation');
await as('', 'anon');
r = await rpc(`SELECT public.dc_verify_card($1)`, [card.card_token]);
ok(r.value.status === 'not_found', 'the old (lost) card no longer verifies after reissue');
await db.query(`UPDATE public.dc_member_cards SET expires_at = now() - interval '1 day' WHERE member_id=$1`, [MEMBER]);
const token2 = (await one(`SELECT card_token FROM public.dc_member_cards WHERE member_id=$1`, [MEMBER])).card_token;
r = await rpc(`SELECT public.dc_verify_card($1)`, [token2]);
ok(r.value.status === 'expired', 'expired card shows EXPIRED');
await as(ADMIN);
r = await rpc(`SELECT public.dc_admin_card_action($1,'extend')`, [MEMBER]);
ok(r.value.status === 'valid', 'extend renews validity');
await as(OTHER);
r = await rpc(`SELECT public.dc_my_card()`);
const otherToken = r.value.card_token;
await as('', 'service_role');
await db.query(`UPDATE public.profiles SET status='rejected' WHERE id=$1`, [OTHER]);
await as('', 'anon');
r = await rpc(`SELECT public.dc_verify_card($1)`, [otherToken]);
ok(r.value.status === 'suspended', 'a card of a no-longer-approved account shows SUSPENDED');
await as('', 'service_role');
await db.query(`UPDATE public.profiles SET status='approved' WHERE id=$1`, [OTHER]);
await as(ADMIN);
r = await rpc(`SELECT public.dc_admin_list_cards()`);
ok(r.ok && r.value.length === 4 && r.value.every((c) => /^DC-\d{6}$/.test(c.member_no)), `bulk list issues/returns a card for all 4 approved members (${r.value?.length})`);
const nos = new Set(r.value.map((c) => c.member_no));
ok(nos.size === 4, 'member numbers are unique');

console.log('Programmes');
await as(ADMIN);
const questions = JSON.stringify([
  { id: 'q1', label: 'Which session?', type: 'select', options: ['Morning', 'Evening'], required: true },
  { id: 'q2', label: 'Need transport?', type: 'yesno' }]);
const prog = await one(`INSERT INTO public.dc_programs (slug, title, starts_at, status, capacity, allow_waitlist, max_party_size, custom_questions, created_by)
  VALUES ('easter-drama-2026','Easter Drama Night', now() + interval '3 days','open', 3, true, 2, $1::jsonb, $2) RETURNING id`, [questions, ADMIN]);
await db.query(`INSERT INTO public.dc_programs (slug, title, starts_at, status) VALUES ('secret-draft','Secret draft', now() + interval '9 days','draft')`);

await as('', 'anon');
r = await rpc(`SELECT public.dc_public_program('easter-drama-2026')`);
ok(r.ok && r.value.found && r.value.phase === 'open' && r.value.seats_left === 3, 'public programme page loads with capacity', r.message);
r = await rpc(`SELECT public.dc_public_program('secret-draft')`);
ok(r.value.found === false, 'draft programmes are invisible to the public');
const reg = (payload) => rpc(`SELECT public.dc_register_for_program('easter-drama-2026', $1::jsonb)`, [JSON.stringify({ consent: true, ...payload })]);
r = await reg({ full_name: 'Tunde Guest', phone: '0803 111 2222', answers: { q1: 'Evening', q2: 'yes', junk: 'x' }, source: 'whatsapp', party_size: 2, is_first_timer: true });
ok(r.ok && r.value.result === 'created' && r.value.status === 'registered' && /^[A-F0-9]{8}$/.test(r.value.ticket_code), 'anonymous registration succeeds with ticket', r.message);
const ticket1 = r.value;
const stored = await one(`SELECT phone, answers, source, party_size FROM public.dc_program_registrations WHERE ticket_code=$1`, [ticket1.ticket_code]);
ok(stored.phone === '08031112222' && !('junk' in stored.answers) && stored.source === 'whatsapp' && stored.party_size === 2, 'phone normalised, unknown answers dropped, source + party recorded');
r = await reg({ full_name: 'Tunde Guest', phone: '08031112222', answers: { q1: 'Evening' } });
ok(r.ok && r.value.result === 'duplicate' && r.value.ticket_code === ticket1.ticket_code, 'same person re-registering gets the same ticket back');
r = await reg({ full_name: 'Somebody Else', phone: '08031112222', answers: { q1: 'Evening' } });
ok(!r.ok && /already registered/i.test(r.message), 'another name cannot hijack a registered phone');
r = await reg({ full_name: 'No Answer', phone: '08030000999' });
ok(!r.ok && /Which session/.test(r.message), 'required custom question enforced');
r = await reg({ full_name: 'Bad Option', phone: '08030000998', answers: { q1: 'Midnight' } });
ok(!r.ok && /valid option/i.test(r.message), 'select options enforced');
r = await reg({ full_name: 'Bot', phone: '08030000997', answers: { q1: 'Evening' }, website: 'http://spam' });
ok(!r.ok, 'honeypot blocks bots');
r = await rpc(`SELECT public.dc_register_for_program('easter-drama-2026', $1::jsonb)`, [JSON.stringify({ full_name: 'No Consent', phone: '08030000996', answers: { q1: 'Evening' } })]);
ok(!r.ok && /privacy/i.test(r.message), 'consent is mandatory');
r = await reg({ full_name: 'Bad Phone', phone: '12', answers: { q1: 'Evening' } });
ok(!r.ok && /valid phone/i.test(r.message), 'phone validated');
r = await reg({ full_name: 'Grace One', phone: '08030000100', answers: { q1: 'Morning' }, source: 'facebook' });
ok(r.ok && r.value.status === 'registered', 'third seat registered');
r = await reg({ full_name: 'Late Comer', phone: '08030000101', answers: { q1: 'Morning' }, source: 'x' });
ok(r.ok && r.value.status === 'waitlisted', 'over capacity goes to waitlist');
r = await rpc(`SELECT public.dc_register_for_program('secret-draft', $1::jsonb)`, [JSON.stringify({ consent: true, full_name: 'X Y', phone: '08030000102' })]);
ok(!r.ok, 'cannot register for a draft');
r = await rpc(`SELECT public.dc_program_ticket($1)`, [`https://e.org/pages/register.html?t=${ticket1.ticket_token}`]);
ok(r.ok && r.value.found && r.value.full_name === 'Tunde Guest' && r.value.checked_in === false, 'ticket lookup by URL works');
r = await rpc(`SELECT public.dc_submit_program_feedback($1, 5, 'Great')`, [ticket1.ticket_token]);
ok(!r.ok && /opens when/i.test(r.message), 'feedback is refused before the programme starts');

console.log('Check-in desk');
await as(MEMBER);
r = await rpc(`SELECT public.dc_program_checkin($1,$2)`, [prog.id, ticket1.ticket_code]);
ok(!r.ok, 'ordinary members cannot check people in');
await as(LEADER);
r = await rpc(`SELECT public.dc_program_checkin($1,$2)`, [prog.id, `https://e.org/pages/register.html?t=${ticket1.ticket_token}`]);
ok(r.ok && r.value.result === 'checked_in' && r.value.party_size === 2, 'ticket QR checks in (party of 2)', r.message);
r = await rpc(`SELECT public.dc_program_checkin($1,$2)`, [prog.id, ticket1.ticket_code.toLowerCase()]);
ok(r.value.result === 'already', 'second scan reports already checked in (no double count)');
const memberCard = (await one(`SELECT card_token, member_no FROM public.dc_member_cards WHERE member_id=$1`, [OTHER]));
r = await rpc(`SELECT public.dc_program_checkin($1,$2)`, [prog.id, memberCard.member_no]);
ok(r.ok && r.value.result === 'checked_in' && r.value.walk_in === true, 'a member ID card barcode checks in as a walk-in', r.message || JSON.stringify(r.value));
r = await rpc(`SELECT public.dc_program_checkin($1,$2)`, [prog.id, `https://e.org/pages/verify.html?c=${memberCard.card_token}`]);
ok(r.value.result === 'already', 'the same member scanning the QR is recognised as already in');
r = await rpc(`SELECT public.dc_program_checkin($1,$2)`, [prog.id, 'ZZZZ']);
ok(r.value.result === 'not_found' || r.value.result === 'invalid', 'unknown code reports not_found');
const waitRow = await one(`SELECT ticket_code FROM public.dc_program_registrations WHERE full_name='Late Comer'`);
r = await rpc(`SELECT public.dc_program_checkin($1,$2)`, [prog.id, waitRow.ticket_code]);
ok(r.value.result === 'checked_in', 'a waitlisted guest who turns up can be admitted');
await as(MEMBER);
r = await rpc(`SELECT public.dc_program_walkin($1,$2::jsonb)`, [prog.id, JSON.stringify({ full_name: 'Door Guest' })]);
ok(!r.ok, 'ordinary members cannot admit walk-ins');
await as(LEADER);
r = await rpc(`SELECT public.dc_program_walkin($1,$2::jsonb)`, [prog.id, JSON.stringify({ full_name: 'Door Guest', phone: '0809 000 0001', is_first_timer: 'yes', how_heard: 'Friend' })]);
ok(r.ok && r.value.result === 'checked_in' && r.value.walk_in === true, 'door walk-in form registers and checks in', r.message);
r = await rpc(`SELECT public.dc_program_walkin($1,$2::jsonb)`, [prog.id, JSON.stringify({ full_name: 'Door Guest', phone: '08090000001' })]);
ok(r.value.result === 'already', 'repeating the walk-in form does not duplicate the guest');
r = await rpc(`SELECT public.dc_program_walkin($1,$2::jsonb)`, [prog.id, JSON.stringify({ full_name: 'Grace One', phone: '08030000100' })]);
ok(r.value.result === 'checked_in' && r.value.matched === 'phone', 'a registered guest without their ticket is found by phone');
r = await rpc(`SELECT public.dc_program_walkin($1,$2::jsonb)`, [prog.id, JSON.stringify({ full_name: '1' })]);
ok(!r.ok, 'walk-in name validated');
const other = await one(`INSERT INTO public.dc_programs (slug, title, starts_at, status) VALUES ('other-prog','Other', now() + interval '1 day','open') RETURNING id`);
r = await rpc(`SELECT public.dc_program_checkin($1,$2)`, [other.id, ticket1.ticket_code]);
ok(r.value.result === 'wrong_program', 'a ticket for another programme is flagged');
r = await rpc(`SELECT public.dc_program_insights($1)`, [prog.id]);
const ins = r.value;
ok(r.ok && ins.totals.registrations === 5 && ins.totals.checked_in === 5 && ins.totals.walk_ins === 2 && ins.totals.first_timers === 2,
  'insights totals are correct', JSON.stringify(ins?.totals));
ok(ins.by_source.whatsapp === 1 && ins.by_source.facebook === 1 && ins.by_source['member-card'] === 1, 'insights split registrations by share channel');
ok(ins.questions.length === 2 && ins.questions[0].counts.Evening === 1, 'insights aggregate custom question answers');
await db.query(`UPDATE public.dc_programs SET starts_at = now() - interval '1 hour' WHERE id=$1`, [prog.id]);
await as('', 'anon');
r = await rpc(`SELECT public.dc_submit_program_feedback($1, 5, 'Wonderful night')`, [ticket1.ticket_token]);
ok(r.ok, 'feedback accepted once the programme has started', r.message);
r = await rpc(`SELECT public.dc_submit_program_feedback($1, 9)`, [ticket1.ticket_token]);
ok(!r.ok, 'rating outside 1..5 refused');
await as(ADMIN);
r = await rpc(`SELECT public.dc_program_insights($1)`, [prog.id]);
ok(Number(r.value.totals.feedback_avg) === 5 && r.value.totals.no_shows === 0, 'feedback average and no-show count computed');

console.log('Duty roster');
await as(LEADER);
const duty = await one(`INSERT INTO public.dc_duty_roster (duty_date, service_label, duty_role, member_id, created_by) VALUES (current_date + 3, 'Sunday Service', 'Lead actor', $1, $2) RETURNING id`, [MEMBER, LEADER]);
await as(OTHER);
r = await rpc(`SELECT public.dc_respond_duty($1,'confirmed')`, [duty.id]);
ok(!r.ok, 'members cannot answer someone else\'s duty');
await as(MEMBER);
r = await rpc(`SELECT public.dc_respond_duty($1,'declined','')`, [duty.id]);
ok(!r.ok && /reason/i.test(r.message), 'declining requires a reason');
r = await rpc(`SELECT public.dc_respond_duty($1,'confirmed')`, [duty.id]);
ok(r.ok && r.value.status === 'confirmed', 'member confirms own duty');

console.log('Member care');
const rh = [];
for (let d = 5; d >= 1; d -= 1) rh.push((await one(`INSERT INTO public.rehearsals (rehearsal_date) VALUES (current_date - $1::int) RETURNING id`, [d * 7])).id);
for (const id of rh) {
  await db.query(`INSERT INTO public.attendance (rehearsal_id, member_id, status) VALUES ($1,$2,'present'),($1,$3,'present')`, [id, ADMIN, LEADER]);
}
await db.query(`INSERT INTO public.attendance (rehearsal_id, member_id, status) VALUES ($1,$2,'present')`, [rh[0], MEMBER]);
await db.query(`INSERT INTO public.attendance (rehearsal_id, member_id, status) VALUES ($1,$2,'absent')`, [rh[4], MEMBER]);
await as(LEADER);
r = await one(`SELECT json_agg(x) AS v FROM public.dc_absentee_candidates(3) x`);
const names = (r.v || []).map((x) => x.full_name);
ok(names.includes('Musa Member') && !names.includes('Ola Other'), `leader sees own-unit absentees only (${names.join(', ')})`);
const musa = (r.v || []).find((x) => x.full_name === 'Musa Member');
ok(musa && musa.missed_in_a_row === 4, `consecutive misses counted correctly (${musa?.missed_in_a_row})`);
await as(ADMIN);
r = await one(`SELECT json_agg(x) AS v FROM public.dc_absentee_candidates(3) x`);
ok((r.v || []).some((x) => x.full_name === 'Ola Other'), 'admin sees all units');
await as(LEADER);
const cs = await one(`INSERT INTO public.dc_care_cases (member_id, reason, summary, opened_by, assigned_to) VALUES ($1,'absence','Missed 4 rehearsals',$2,$2) RETURNING id`, [MEMBER, LEADER]);
r = await rpc(`SELECT public.dc_care_add_note($1,'Called — he was ill','contacted')`, [cs.id]);
ok(r.ok && r.value.status === 'contacted' && r.value.followup_log.length === 1, 'follow-up note appended with status change');
await as(MEMBER);
r = await rpc(`SELECT public.dc_care_add_note($1,'peek')`, [cs.id]);
ok(!r.ok, 'members cannot read or write pastoral cases');

console.log('Rehearsal door scanning');
{
  const musaCard = await one(`SELECT member_no, card_token FROM public.dc_member_cards WHERE member_id=$1`, [MEMBER]);
  const olaCard = await one(`SELECT card_token FROM public.dc_member_cards WHERE member_id=$1`, [OTHER]);
  const door = [];
  for (let i = 0; i < 3; i += 1) door.push((await one(`INSERT INTO public.rehearsals (rehearsal_date) VALUES (current_date + $1::int) RETURNING id`, [i + 1])).id);
  await as(LEADER);
  r = await rpc(`SELECT public.dc_scan_attendance($1, $2)`, [door[0], musaCard.member_no.toLowerCase()]);
  ok(r.ok && r.value.result === 'checked_in' && r.value.source === 'barcode', 'unit leader scans a Code 128 member number → present', r.message || JSON.stringify(r.value));
  r = await rpc(`SELECT public.dc_scan_attendance($1, $2)`, [door[0], musaCard.member_no]);
  ok(r.ok && r.value.result === 'already', 'second scan of the same card is reported as already present');
  r = await one(`SELECT status FROM public.attendance WHERE rehearsal_id=$1 AND member_id=$2`, [door[0], MEMBER]);
  ok(r && r.status === 'present', 'attendance row written as present');
  r = await rpc(`SELECT public.dc_scan_attendance($1, $2)`, [door[0], `https://example.org/pages/verify.html?c=${olaCard.card_token}`]);
  ok(r.ok && r.value.result === 'checked_in' && r.value.source === 'qr', 'QR verification URL checks the member in');
  r = await rpc(`SELECT public.dc_scan_attendance($1, $2)`, [door[1], `dramaconnect:verify:${MEMBER}`]);
  ok(r.ok && r.value.result === 'checked_in' && r.value.source === 'legacy', 'cards printed before v14.1 still scan (legacy payload)');
  r = await rpc(`SELECT public.dc_scan_attendance($1, $2)`, [door[1], `dramaconnect:verify:${PENDING}`]);
  ok(r.ok && r.value.result === 'card_suspended', 'a non-approved member is refused at the door', JSON.stringify(r.value));
  r = await rpc(`SELECT public.dc_scan_attendance($1, 'DC-999999')`, [door[1]]);
  ok(r.ok && r.value.result === 'not_found', 'unknown member number → not_found');
  r = await rpc(`SELECT public.dc_scan_attendance($1, 'hello world')`, [door[1]]);
  ok(r.ok && r.value.result === 'invalid', 'garbage input → invalid');
  r = await one(`SELECT count(*)::int AS n FROM public.activity_log WHERE action = 'Attendance scan'`);
  ok(r.n >= 3, 'each scan check-in is written to the activity log');
  await as(MEMBER);
  r = await rpc(`SELECT public.dc_scan_attendance($1, $2)`, [door[2], musaCard.member_no]);
  ok(!r.ok && /administrators and unit leaders/i.test(r.message), 'ordinary members cannot scan attendance');
}

console.log('Privilege allow-list (real roles)');
await as('', 'anon');
await db.exec('SET ROLE anon');
for (const [sql, label] of [
  [`SELECT public.dc_verify_card('x')`, 'anon may verify a card'],
  [`SELECT public.dc_public_program('easter-drama-2026')`, 'anon may open a programme page'],
  [`SELECT public.dc_program_ticket('x')`, 'anon may open a ticket'],
]) { r = await rpc(sql); ok(r.ok, label, r.message); }
for (const [sql, label] of [
  [`SELECT * FROM public.dc_member_cards`, 'anon cannot read the card table'],
  [`SELECT * FROM public.dc_program_registrations`, 'anon cannot read registrations'],
  [`SELECT public.dc_lookup_card('x')`, 'anon cannot call the scanner lookup'],
  [`SELECT public.dc_admin_list_cards()`, 'anon cannot list cards'],
  [`SELECT public.dc_scan_attendance('${prog.id}', 'x')`, 'anon cannot scan attendance'],
  [`SELECT public.dc_program_walkin('${prog.id}', '{}'::jsonb)`, 'anon cannot admit walk-ins'],
  [`SELECT public.dc_program_insights('${prog.id}')`, 'anon cannot read insights'],
  [`SELECT * FROM public.dc_care_cases`, 'anon cannot read care cases'],
]) { r = await rpc(sql); ok(!r.ok && /permission denied/i.test(r.message), label, r.message); }
await db.exec('RESET ROLE');

console.log('Row-level security (authenticated role)');
const asRole = async (uid) => { await db.exec('RESET ROLE'); await as(uid); await db.exec('SET ROLE authenticated'); };
await asRole(MEMBER);
r = await one(`SELECT count(*)::int AS n, bool_and(member_id = $1) AS own FROM public.dc_member_cards`, [MEMBER]);
ok(r.n === 1 && r.own === true, 'a member can read only their own card row');
r = await rpc(`UPDATE public.dc_member_cards SET expires_at = now() + interval '50 years' RETURNING 1`);
ok(!r.ok || r.value === null, 'members cannot extend their own card directly', r.message);
r = await one(`SELECT count(*)::int AS n FROM public.dc_member_cards WHERE expires_at > now() + interval '40 years'`);
ok(r.n === 0, 'a member\'s direct card UPDATE changes nothing (RLS filters every row)');
r = await rpc(`INSERT INTO public.dc_member_cards (member_id, member_no, card_token, expires_at) VALUES ($1, 'DC-999999', repeat('a', 32), now() + interval '9 years') RETURNING 1`, [MEMBER]);
ok(!r.ok, 'members cannot forge a card row through the restore policy');
r = await rpc(`INSERT INTO public.dc_program_registrations (program_id, full_name, ticket_code, ticket_token) SELECT id, 'Forged', 'ABCDEF12', repeat('b', 32) FROM public.dc_programs LIMIT 1 RETURNING 1`);
ok(!r.ok || r.value === null, 'members cannot insert registrations directly (only the public RPC can)', r.message);
r = await rpc(`INSERT INTO public.dc_programs (slug, title, starts_at) VALUES ('member-made','Member made', now()) RETURNING 1`);
ok(!r.ok, 'members cannot create programmes');
r = await one(`SELECT count(*)::int AS n FROM public.dc_programs WHERE status = 'draft'`);
ok(r.n === 0, 'members do not see draft programmes');
r = await one(`SELECT count(*)::int AS n FROM public.dc_program_registrations`);
ok(r.n === 0, 'members cannot read other people\'s registrations');
r = await rpc(`INSERT INTO public.dc_duty_roster (duty_date, duty_role, member_id) VALUES (current_date, 'Props', $1) RETURNING 1`, [MEMBER]);
ok(!r.ok, 'members cannot assign duties');
r = await one(`SELECT count(*)::int AS n FROM public.dc_care_cases`);
ok(r.n === 0, 'members cannot see care cases (even about themselves)');
await asRole(LEADER);
r = await rpc(`INSERT INTO public.dc_duty_roster (duty_date, duty_role, member_id) VALUES (current_date + 7, 'Props', $1) RETURNING 1`, [MEMBER]);
ok(r.ok, 'leaders can assign duties', r.message);
r = await one(`SELECT count(*)::int AS n FROM public.dc_program_registrations`);
ok(r.n >= 5, 'leaders (check-in desk) can read registrations');
r = await one(`SELECT count(*)::int AS n, bool_and(member_id = $1) AS own FROM public.dc_member_cards`, [LEADER]);
ok(r.n <= 1 && r.own !== false, 'leaders see at most their own card row (others only via dc_lookup_card)');
await asRole(ADMIN);
r = await rpc(`INSERT INTO public.dc_programs (slug, title, starts_at) VALUES ('admin-made','Admin made', now() + interval '2 days') RETURNING 1`);
ok(r.ok, 'admins create programmes through RLS', r.message);
r = await rpc(`UPDATE public.dc_card_settings SET template = 'royal', validity_months = 24 WHERE id = 1 RETURNING 1`);
ok(r.ok, 'admins edit card settings', r.message);
await db.exec('RESET ROLE');

// Regression (Item 19 audit): Platform Health saves security state WITHOUT the login-audit
// retention (Storage Manager owns it). NULL must mean "keep", never fail or overwrite.
await db.exec(`UPDATE public.dc_retention_settings SET login_audit_days = 120 WHERE id = 1`);
await db.exec(`UPDATE public.dc_platform_settings SET login_audit_retention_days = 120 WHERE id = 1`);
await asRole(ADMIN);
r = await rpc(`SELECT public.dc_update_platform_settings(false, 'Maintenance', 45, NULL) AS j`);
ok(r.ok, 'security state saves without a retention value', r.message);
await db.exec('RESET ROLE');
r = await one(`SELECT (SELECT login_audit_days FROM public.dc_retention_settings WHERE id=1) AS a, (SELECT login_audit_retention_days FROM public.dc_platform_settings WHERE id=1) AS b, (SELECT idle_timeout_minutes FROM public.dc_platform_settings WHERE id=1) AS c`);
ok(r.a === 120 && r.b === 120 && r.c === 45, 'NULL retention keeps the Storage Manager value', JSON.stringify(r));
await asRole(ADMIN);
r = await rpc(`SELECT public.dc_update_platform_settings(false, '', 30, 3)`);
ok(!r.ok, 'an explicit out-of-range retention is still rejected');
await db.exec('RESET ROLE');

process.on('exit', () => {});
console.log(`\ncards/programmes/roster/care suite: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
