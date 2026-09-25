-- ============================================================================
-- DramaConnect v14.1 — COMPONENT 05: Identity cards, public programmes,
-- duty roster and member care
-- ============================================================================
-- Safe to rerun. Every table, index, policy and function is created with
-- IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS semantics. No existing
-- application row is modified.
--
-- WHAT THIS COMPONENT ADDS
--   1. Verifiable membership cards
--        dc_card_settings        one-row card design + validity policy
--        dc_member_cards         one card per member: human member number,
--                                unguessable verification token, expiry,
--                                revocation and re-issue history counters
--        dc_my_card()            member: fetch (and lazily issue) own card
--        dc_verify_card(token)   PUBLIC: what a phone camera lands on
--        dc_lookup_card(code)    admin/leader: resolve any scanned code
--        dc_admin_card_action()  admin: issue / reissue / revoke / restore / extend
--        dc_admin_list_cards()   admin: every approved member's card (bulk print)
--
--   2. Public programmes with shareable registration links
--        dc_programs                  programme definition (slug = share link)
--        dc_program_registrations     registrations, tickets, check-in, feedback
--        dc_public_program(slug)      PUBLIC: programme page data
--        dc_register_for_program()    PUBLIC: validated, throttled registration
--        dc_program_ticket(token)     PUBLIC: ticket lookup
--        dc_submit_program_feedback() PUBLIC: post-programme rating/comment
--        dc_program_checkin()         admin/leader: scan ticket / member card
--        dc_program_undo_checkin()    admin/leader
--        dc_program_walkin()          admin/leader: door walk-in, registered + checked in
--        dc_program_insights()        admin/leader: analytics as one JSON document
--
--   3. Duty roster (who ministers at which service, in which role)
--        dc_duty_roster, dc_respond_duty()
--
--   4. Member care & follow-up (absentee detection + pastoral case log)
--        dc_care_cases, dc_care_add_note(), dc_absentee_candidates()
--
-- SECURITY MODEL
--   * RLS is enabled on every new table. Nothing is readable by anon directly.
--   * The only anon entry points are the five PUBLIC functions above. They
--     return an explicit allow-list of fields: a verification never returns a
--     phone number or e-mail address; a programme page never returns another
--     registrant's details.
--   * Card tokens and ticket tokens are 128-bit random values (gen_random_uuid
--     is core PostgreSQL, so no extension is required). The printed member
--     number is human-readable but is NOT accepted by the public verifier, so
--     sequential numbers cannot be enumerated from outside.
--   * Free-tier protection: public registration is throttled per programme and
--     globally, capped per programme, size-limited, and honeypot-guarded.
--     Public verification updates a counter instead of inserting a row, so a
--     flood of scans cannot grow the database.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. Shared helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_is_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'approved'
      AND (role = 'admin' OR is_unit_leader IS TRUE)
  );
$$;

CREATE OR REPLACE FUNCTION public.dc_my_unit()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT nullif(trim(unit), '') FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.dc_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_new_token()
RETURNS TEXT
LANGUAGE sql
SET search_path = public, pg_temp
VOLATILE
AS $$
  SELECT replace(gen_random_uuid()::text, '-', '');
$$;

-- Extract a 32-hex token from a raw token, a verify/ticket URL or any text that
-- contains "c=<token>" / "t=<token>".
CREATE OR REPLACE FUNCTION public.dc_extract_token(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
SET search_path = public, pg_temp
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_code IS NULL THEN NULL
    WHEN lower(trim(p_code)) ~ '^[a-f0-9]{32}$' THEN lower(trim(p_code))
    WHEN lower(p_code) ~ '[?&#](c|t)=[a-f0-9]{32}' THEN substring(lower(p_code) FROM '[?&#][ct]=([a-f0-9]{32})')
    ELSE NULL
  END;
$$;

-- --------------------------------------------------------------------------
-- 1. Membership cards
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_card_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  member_no_prefix TEXT NOT NULL DEFAULT 'DC' CHECK (member_no_prefix ~ '^[A-Z0-9]{1,6}$'),
  validity_months  INTEGER NOT NULL DEFAULT 24 CHECK (validity_months BETWEEN 1 AND 120),
  template         TEXT NOT NULL DEFAULT 'classic' CHECK (template IN ('classic','royal','stage','minimal')),
  signatory_name   TEXT CHECK (signatory_name IS NULL OR char_length(signatory_name) <= 80),
  signatory_title  TEXT CHECK (signatory_title IS NULL OR char_length(signatory_title) <= 80),
  signature_url    TEXT CHECK (signature_url IS NULL OR char_length(signature_url) <= 500),
  contact_line     TEXT CHECK (contact_line IS NULL OR char_length(contact_line) <= 160),
  back_note        TEXT CHECK (back_note IS NULL OR char_length(back_note) <= 300),
  show_phone       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.dc_card_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS public.dc_member_no_seq START 1;

CREATE TABLE IF NOT EXISTS public.dc_member_cards (
  member_id        UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_no        TEXT NOT NULL UNIQUE CHECK (member_no ~ '^[A-Z0-9]{1,6}-[0-9]{4,10}$'),
  card_token       TEXT NOT NULL UNIQUE CHECK (card_token ~ '^[a-f0-9]{32}$'),
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  revoked_at       TIMESTAMPTZ,
  revoke_reason    TEXT CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 200),
  reissue_count    INTEGER NOT NULL DEFAULT 0 CHECK (reissue_count >= 0),
  verify_count     INTEGER NOT NULL DEFAULT 0 CHECK (verify_count >= 0),
  last_verified_at TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dc_member_cards_expiry_idx ON public.dc_member_cards(expires_at);

-- Keep the serial ahead of any restored member number (safe on every rerun).
DO $dc_seq$
DECLARE v_max BIGINT;
BEGIN
  SELECT max(substring(member_no FROM '-([0-9]+)$')::BIGINT) INTO v_max FROM public.dc_member_cards;
  IF v_max IS NOT NULL THEN PERFORM setval('public.dc_member_no_seq', v_max, true); END IF;
END $dc_seq$;

DROP TRIGGER IF EXISTS trg_dc_card_settings_touch ON public.dc_card_settings;
CREATE TRIGGER trg_dc_card_settings_touch BEFORE UPDATE ON public.dc_card_settings
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();
DROP TRIGGER IF EXISTS trg_dc_member_cards_touch ON public.dc_member_cards;
CREATE TRIGGER trg_dc_member_cards_touch BEFORE UPDATE ON public.dc_member_cards
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();

ALTER TABLE public.dc_card_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_member_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dc_card_settings_read ON public.dc_card_settings;
CREATE POLICY dc_card_settings_read ON public.dc_card_settings
  FOR SELECT TO authenticated USING (public.is_approved_member());
DROP POLICY IF EXISTS dc_card_settings_admin_write ON public.dc_card_settings;
CREATE POLICY dc_card_settings_admin_write ON public.dc_card_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS dc_member_cards_read ON public.dc_member_cards;
CREATE POLICY dc_member_cards_read ON public.dc_member_cards
  FOR SELECT TO authenticated USING (member_id = auth.uid() OR public.is_admin());
-- No INSERT/UPDATE/DELETE policy: cards change only through the RPCs below.

-- Internal: issue a card for one member if none exists. Returns the row.
CREATE OR REPLACE FUNCTION public.dc_issue_card_internal(p_member_id UUID)
RETURNS public.dc_member_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.dc_member_cards;
  v_set  public.dc_card_settings;
  v_no   TEXT;
BEGIN
  SELECT * INTO v_card FROM public.dc_member_cards WHERE member_id = p_member_id;
  IF FOUND THEN RETURN v_card; END IF;
  SELECT * INTO v_set FROM public.dc_card_settings WHERE id = 1;
  LOOP
    v_no := coalesce(v_set.member_no_prefix, 'DC') || '-' || lpad(nextval('public.dc_member_no_seq')::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.dc_member_cards WHERE member_no = v_no);
  END LOOP;
  INSERT INTO public.dc_member_cards (member_id, member_no, card_token, expires_at)
  VALUES (p_member_id, v_no, public.dc_new_token(),
          NOW() + make_interval(months => coalesce(v_set.validity_months, 24)))
  ON CONFLICT (member_id) DO NOTHING
  RETURNING * INTO v_card;
  IF v_card.member_id IS NULL THEN
    SELECT * INTO v_card FROM public.dc_member_cards WHERE member_id = p_member_id;
  END IF;
  RETURN v_card;
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_card_state(p_card public.dc_member_cards, p_profile_status TEXT)
RETURNS TEXT
LANGUAGE sql
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT CASE
    WHEN p_card.member_id IS NULL THEN 'not_found'
    WHEN p_card.revoked_at IS NOT NULL THEN 'revoked'
    WHEN coalesce(p_profile_status, '') <> 'approved' THEN 'suspended'
    WHEN p_card.expires_at < NOW() THEN 'expired'
    ELSE 'valid'
  END;
$$;

CREATE OR REPLACE FUNCTION public.dc_card_json(p_card public.dc_member_cards, p_private BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  p public.profiles;
  s public.dc_card_settings;
  t public.tenant_settings;
  v JSONB;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = p_card.member_id;
  SELECT * INTO s FROM public.dc_card_settings WHERE id = 1;
  SELECT * INTO t FROM public.tenant_settings WHERE id = 1;
  v := jsonb_build_object(
    'status',        public.dc_card_state(p_card, p.status),
    'member_no',     p_card.member_no,
    'full_name',     p.full_name,
    'role',          CASE WHEN p.role = 'admin' THEN 'Administrator'
                          WHEN p.is_unit_leader IS TRUE THEN 'Unit Leader'
                          ELSE 'Member' END,
    'unit',          p.unit,
    'avatar_url',    p.avatar_url,
    'issued_at',     p_card.issued_at,
    'expires_at',    p_card.expires_at,
    'org_name',      t.org_name,
    'app_name',      t.app_name,
    'logo_url',      t.logo_url,
    'checked_at',    NOW()
  );
  IF p_private THEN
    v := v || jsonb_build_object(
      'member_id',      p_card.member_id,
      'card_token',     p_card.card_token,
      'revoked_at',     p_card.revoked_at,
      'revoke_reason',  p_card.revoke_reason,
      'reissue_count',  p_card.reissue_count,
      'verify_count',   p_card.verify_count,
      'last_verified_at', p_card.last_verified_at,
      'phone',          CASE WHEN s.show_phone THEN p.phone ELSE NULL END,
      'parish',         p.parish,
      'occupation',     p.occupation,
      'gender',         p.gender,
      'profile_status', p.status,
      'settings',       to_jsonb(s) - 'id'
    );
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_my_card()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_card public.dc_member_cards;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  v_card := public.dc_issue_card_internal(auth.uid());
  RETURN public.dc_card_json(v_card, TRUE);
END;
$$;

-- PUBLIC. Only a 128-bit token is accepted; never a member number or uuid.
CREATE OR REPLACE FUNCTION public.dc_verify_card(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token TEXT := public.dc_extract_token(p_token);
  v_card  public.dc_member_cards;
BEGIN
  IF v_token IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid', 'checked_at', NOW());
  END IF;
  SELECT * INTO v_card FROM public.dc_member_cards WHERE card_token = v_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'checked_at', NOW());
  END IF;
  UPDATE public.dc_member_cards
     SET verify_count = verify_count + 1, last_verified_at = NOW()
   WHERE member_id = v_card.member_id;
  RETURN public.dc_card_json(v_card, FALSE);
END;
$$;

-- Admin / unit leader: resolve anything a scanner can read.
--   * verify URL or bare 32-hex token      (current QR code)
--   * member number e.g. DC-000123           (Code 128 barcode / typed)
--   * dramaconnect:verify:<uuid> or a uuid   (cards printed before v14.1)
CREATE OR REPLACE FUNCTION public.dc_lookup_card(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw   TEXT := trim(coalesce(p_code, ''));
  v_token TEXT := public.dc_extract_token(v_raw);
  v_uuid  UUID;
  v_card  public.dc_member_cards;
  v_kind  TEXT;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can scan cards' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_raw) = 0 OR char_length(v_raw) > 300 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_token IS NOT NULL THEN
    SELECT * INTO v_card FROM public.dc_member_cards WHERE card_token = v_token;
    v_kind := 'qr';
  ELSIF upper(v_raw) ~ '^[A-Z0-9]{1,6}-[0-9]{4,10}$' THEN
    SELECT * INTO v_card FROM public.dc_member_cards WHERE member_no = upper(v_raw);
    v_kind := 'barcode';
  ELSE
    BEGIN
      v_uuid := regexp_replace(v_raw, '^dramaconnect:verify:', '', 'i')::UUID;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'invalid');
    END;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uuid) THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_card := public.dc_issue_card_internal(v_uuid);
    v_kind := 'legacy';
  END IF;

  IF v_card.member_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  RETURN public.dc_card_json(v_card, FALSE)
      || jsonb_build_object('member_id', v_card.member_id, 'source', v_kind);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_admin_card_action(p_member_id UUID, p_action TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.dc_member_cards;
  v_set  public.dc_card_settings;
  v_reason TEXT := nullif(left(trim(coalesce(p_reason, '')), 200), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('issue','reissue','revoke','restore','extend') THEN
    RAISE EXCEPTION 'Unsupported card action: %', p_action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_member_id) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  SELECT * INTO v_set FROM public.dc_card_settings WHERE id = 1;
  v_card := public.dc_issue_card_internal(p_member_id);

  IF p_action = 'reissue' THEN
    UPDATE public.dc_member_cards
       SET card_token = public.dc_new_token(), issued_at = NOW(),
           expires_at = NOW() + make_interval(months => v_set.validity_months),
           revoked_at = NULL, revoke_reason = NULL, reissue_count = reissue_count + 1
     WHERE member_id = p_member_id RETURNING * INTO v_card;
  ELSIF p_action = 'revoke' THEN
    IF v_reason IS NULL THEN RAISE EXCEPTION 'A reason is required to revoke a card'; END IF;
    UPDATE public.dc_member_cards SET revoked_at = NOW(), revoke_reason = v_reason
     WHERE member_id = p_member_id RETURNING * INTO v_card;
  ELSIF p_action = 'restore' THEN
    UPDATE public.dc_member_cards SET revoked_at = NULL, revoke_reason = NULL
     WHERE member_id = p_member_id RETURNING * INTO v_card;
  ELSIF p_action = 'extend' THEN
    UPDATE public.dc_member_cards
       SET expires_at = greatest(expires_at, NOW()) + make_interval(months => v_set.validity_months)
     WHERE member_id = p_member_id RETURNING * INTO v_card;
  END IF;

  INSERT INTO public.activity_log (actor_name, action, detail)
  SELECT coalesce((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Administrator'),
         'ID card ' || p_action,
         v_card.member_no || coalesce(' — ' || v_reason, '');
  RETURN public.dc_card_json(v_card, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_admin_list_cards()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r RECORD; v_out JSONB := '[]'::JSONB; v_card public.dc_member_cards;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT id FROM public.profiles WHERE status = 'approved' ORDER BY unit NULLS LAST, full_name LOOP
    v_card := public.dc_issue_card_internal(r.id);
    v_out := v_out || jsonb_build_array(public.dc_card_json(v_card, TRUE));
  END LOOP;
  RETURN v_out;
END;
$$;

-- Rehearsal door scanning. Administrators AND unit leaders can scan a member
-- card (QR, Code 128 barcode, typed member number or a pre-v14.1 card) and the
-- member is marked present atomically on the server. Attendance table RLS
-- stays admin-only for direct writes; this reviewed RPC is the only other path.
CREATE OR REPLACE FUNCTION public.dc_scan_attendance(p_rehearsal_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card   JSONB;
  v_member UUID;
  v_prev   TEXT;
  v_actor  TEXT;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can scan attendance' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rehearsals WHERE id = p_rehearsal_id) THEN
    RAISE EXCEPTION 'Rehearsal not found';
  END IF;
  v_card := public.dc_lookup_card(p_code);
  IF NOT (v_card ? 'member_id') THEN
    RETURN jsonb_build_object('result', coalesce(v_card->>'status', 'invalid'));
  END IF;
  IF v_card->>'status' NOT IN ('valid', 'expired') THEN
    RETURN jsonb_build_object('result', 'card_' || (v_card->>'status'),
      'full_name', v_card->>'full_name', 'member_no', v_card->>'member_no');
  END IF;
  v_member := (v_card->>'member_id')::UUID;
  SELECT status INTO v_prev FROM public.attendance
   WHERE rehearsal_id = p_rehearsal_id AND member_id = v_member;
  IF v_prev = 'present' THEN
    RETURN v_card || jsonb_build_object('result', 'already');
  END IF;
  INSERT INTO public.attendance (rehearsal_id, member_id, status, marked_at)
  VALUES (p_rehearsal_id, v_member, 'present', NOW())
  ON CONFLICT (rehearsal_id, member_id) DO UPDATE SET status = 'present', marked_at = NOW();
  SELECT full_name INTO v_actor FROM public.profiles WHERE id = auth.uid();
  BEGIN
    INSERT INTO public.activity_log (actor_name, action, detail)
    VALUES (coalesce(v_actor, 'Scanner'), 'Attendance scan',
            (v_card->>'full_name') || ' marked present by card scan (' || coalesce(v_card->>'source', 'card') || ')');
  EXCEPTION WHEN others THEN NULL;  -- the log must never block a check-in
  END;
  RETURN v_card || jsonb_build_object('result', 'checked_in', 'previous', v_prev,
    'expired_warning', (v_card->>'status') = 'expired');
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Programmes and public registration
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_programs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$'),
  title                   TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 140),
  subtitle                TEXT CHECK (subtitle IS NULL OR char_length(subtitle) <= 200),
  description             TEXT CHECK (description IS NULL OR char_length(description) <= 4000),
  category                TEXT NOT NULL DEFAULT 'special'
                          CHECK (category IN ('special','production','workshop','audition','outreach','conference','other')),
  venue                   TEXT CHECK (venue IS NULL OR char_length(venue) <= 200),
  starts_at               TIMESTAMPTZ NOT NULL,
  ends_at                 TIMESTAMPTZ,
  registration_opens_at   TIMESTAMPTZ,
  registration_closes_at  TIMESTAMPTZ,
  capacity                INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 100000),
  allow_waitlist          BOOLEAN NOT NULL DEFAULT TRUE,
  max_party_size          INTEGER NOT NULL DEFAULT 1 CHECK (max_party_size BETWEEN 1 AND 10),
  phone_mode              TEXT NOT NULL DEFAULT 'required' CHECK (phone_mode IN ('required','optional','hidden')),
  email_mode              TEXT NOT NULL DEFAULT 'optional' CHECK (email_mode IN ('required','optional','hidden')),
  custom_questions        JSONB NOT NULL DEFAULT '[]'::JSONB
                          CHECK (jsonb_typeof(custom_questions) = 'array' AND jsonb_array_length(custom_questions) <= 10),
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','archived')),
  cover_url               TEXT CHECK (cover_url IS NULL OR char_length(cover_url) <= 500),
  contact_phone           TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 40),
  feedback_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS dc_programs_starts_idx ON public.dc_programs(starts_at DESC);

CREATE TABLE IF NOT EXISTS public.dc_program_registrations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       UUID NOT NULL REFERENCES public.dc_programs(id) ON DELETE CASCADE,
  member_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name        TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  phone            TEXT CHECK (phone IS NULL OR char_length(phone) <= 24),
  email            TEXT CHECK (email IS NULL OR char_length(email) <= 160),
  gender           TEXT CHECK (gender IS NULL OR gender IN ('male','female','other')),
  age_group        TEXT CHECK (age_group IS NULL OR age_group IN ('under-13','13-17','18-25','26-35','36-50','51+')),
  organisation     TEXT CHECK (organisation IS NULL OR char_length(organisation) <= 160),
  is_first_timer   BOOLEAN NOT NULL DEFAULT FALSE,
  how_heard        TEXT CHECK (how_heard IS NULL OR char_length(how_heard) <= 60),
  source           TEXT NOT NULL DEFAULT 'direct' CHECK (source ~ '^[a-z0-9-]{1,24}$'),
  party_size       INTEGER NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 10),
  answers          JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(answers) = 'object'),
  status           TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','waitlisted','cancelled')),
  ticket_code      TEXT NOT NULL UNIQUE CHECK (ticket_code ~ '^[A-F0-9]{8}$'),
  ticket_token     TEXT NOT NULL UNIQUE CHECK (ticket_token ~ '^[a-f0-9]{32}$'),
  checked_in_at    TIMESTAMPTZ,
  checked_in_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  feedback_rating  INTEGER CHECK (feedback_rating IS NULL OR feedback_rating BETWEEN 1 AND 5),
  feedback_comment TEXT CHECK (feedback_comment IS NULL OR char_length(feedback_comment) <= 1000),
  feedback_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dc_program_regs_program_idx ON public.dc_program_registrations(program_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS dc_program_regs_phone_uq
  ON public.dc_program_registrations(program_id, phone) WHERE phone IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS dc_program_regs_member_uq
  ON public.dc_program_registrations(program_id, member_id) WHERE member_id IS NOT NULL AND status <> 'cancelled';

DROP TRIGGER IF EXISTS trg_dc_programs_touch ON public.dc_programs;
CREATE TRIGGER trg_dc_programs_touch BEFORE UPDATE ON public.dc_programs
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();

ALTER TABLE public.dc_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_program_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dc_programs_read ON public.dc_programs;
CREATE POLICY dc_programs_read ON public.dc_programs
  FOR SELECT TO authenticated USING (public.is_admin() OR (public.is_approved_member() AND status <> 'draft'));
DROP POLICY IF EXISTS dc_programs_admin_insert ON public.dc_programs;
CREATE POLICY dc_programs_admin_insert ON public.dc_programs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_programs_admin_update ON public.dc_programs;
CREATE POLICY dc_programs_admin_update ON public.dc_programs
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_programs_admin_delete ON public.dc_programs;
CREATE POLICY dc_programs_admin_delete ON public.dc_programs
  FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS dc_program_regs_manager_read ON public.dc_program_registrations;
CREATE POLICY dc_program_regs_manager_read ON public.dc_program_registrations
  FOR SELECT TO authenticated USING (public.dc_is_manager() OR member_id = auth.uid());
DROP POLICY IF EXISTS dc_program_regs_admin_update ON public.dc_program_registrations;
CREATE POLICY dc_program_regs_admin_update ON public.dc_program_registrations
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_program_regs_admin_delete ON public.dc_program_registrations;
CREATE POLICY dc_program_regs_admin_delete ON public.dc_program_registrations
  FOR DELETE TO authenticated USING (public.is_admin());
-- No INSERT policy: registration happens only through dc_register_for_program().

CREATE OR REPLACE FUNCTION public.dc_program_seats(p_program_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT coalesce(sum(party_size), 0)::INTEGER
  FROM public.dc_program_registrations
  WHERE program_id = p_program_id AND status = 'registered';
$$;

CREATE OR REPLACE FUNCTION public.dc_program_phase(p public.dc_programs)
RETURNS TEXT
LANGUAGE sql
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT CASE
    WHEN p.status IN ('draft') THEN 'draft'
    WHEN p.status = 'archived' OR coalesce(p.ends_at, p.starts_at + interval '6 hours') < NOW() THEN 'ended'
    WHEN p.status = 'closed' THEN 'closed'
    WHEN p.registration_opens_at IS NOT NULL AND p.registration_opens_at > NOW() THEN 'not_yet_open'
    WHEN p.registration_closes_at IS NOT NULL AND p.registration_closes_at < NOW() THEN 'closed'
    ELSE 'open'
  END;
$$;

CREATE OR REPLACE FUNCTION public.dc_public_program(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  p public.dc_programs;
  t public.tenant_settings;
  v_seats INTEGER;
BEGIN
  SELECT * INTO p FROM public.dc_programs WHERE slug = lower(trim(coalesce(p_slug, '')));
  IF NOT FOUND OR (p.status = 'draft' AND NOT public.is_admin()) THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  SELECT * INTO t FROM public.tenant_settings WHERE id = 1;
  v_seats := public.dc_program_seats(p.id);
  RETURN jsonb_build_object(
    'found', TRUE,
    'slug', p.slug, 'title', p.title, 'subtitle', p.subtitle, 'description', p.description,
    'category', p.category, 'venue', p.venue, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
    'registration_opens_at', p.registration_opens_at, 'registration_closes_at', p.registration_closes_at,
    'capacity', p.capacity, 'seats_taken', v_seats,
    'seats_left', CASE WHEN p.capacity IS NULL THEN NULL ELSE greatest(p.capacity - v_seats, 0) END,
    'allow_waitlist', p.allow_waitlist, 'max_party_size', p.max_party_size,
    'phone_mode', p.phone_mode, 'email_mode', p.email_mode,
    'custom_questions', p.custom_questions, 'cover_url', p.cover_url,
    'contact_phone', p.contact_phone, 'feedback_enabled', p.feedback_enabled,
    'phase', public.dc_program_phase(p), 'is_draft_preview', p.status = 'draft',
    'org_name', t.org_name, 'app_name', t.app_name, 'logo_url', t.logo_url
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_new_ticket_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_temp
VOLATILE
AS $$
DECLARE v TEXT;
BEGIN
  LOOP
    v := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.dc_program_registrations WHERE ticket_code = v);
  END LOOP;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_register_for_program(p_slug TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p        public.dc_programs;
  j        JSONB := coalesce(p_payload, '{}'::JSONB);
  v_name   TEXT := regexp_replace(trim(coalesce(j->>'full_name', '')), '\s+', ' ', 'g');
  v_phone  TEXT := nullif(regexp_replace(coalesce(j->>'phone', ''), '[^0-9+]', '', 'g'), '');
  v_email  TEXT := nullif(lower(trim(coalesce(j->>'email', ''))), '');
  v_gender TEXT := nullif(lower(trim(coalesce(j->>'gender', ''))), '');
  v_age    TEXT := nullif(trim(coalesce(j->>'age_group', '')), '');
  v_org    TEXT := nullif(left(trim(coalesce(j->>'organisation', '')), 160), '');
  v_heard  TEXT := nullif(left(trim(coalesce(j->>'how_heard', '')), 60), '');
  v_src    TEXT := lower(left(regexp_replace(coalesce(j->>'source', ''), '[^a-zA-Z0-9-]', '', 'g'), 24));
  v_party  INTEGER;
  v_first  BOOLEAN := lower(coalesce(j->>'is_first_timer', '')) IN ('true','1','yes','on');
  v_answers JSONB := '{}'::JSONB;
  v_raw_answers JSONB := CASE WHEN jsonb_typeof(j->'answers') = 'object' THEN j->'answers' ELSE '{}'::JSONB END;
  q        JSONB;
  v_qid    TEXT;
  v_val    TEXT;
  v_seats  INTEGER;
  v_status TEXT := 'registered';
  v_phase  TEXT;
  v_existing public.dc_program_registrations;
  v_row    public.dc_program_registrations;
BEGIN
  IF pg_column_size(j) > 8000 THEN RAISE EXCEPTION 'The form is too large'; END IF;
  -- Honeypot: humans never see this field.
  IF coalesce(j->>'website', '') <> '' THEN RAISE EXCEPTION 'Registration could not be accepted'; END IF;
  IF lower(coalesce(j->>'consent', '')) NOT IN ('true','1','yes','on') THEN
    RAISE EXCEPTION 'Please accept the privacy notice to register';
  END IF;

  SELECT * INTO p FROM public.dc_programs WHERE slug = lower(trim(coalesce(p_slug, ''))) FOR UPDATE;
  IF NOT FOUND OR p.status = 'draft' THEN RAISE EXCEPTION 'This programme was not found'; END IF;
  v_phase := public.dc_program_phase(p);
  IF v_phase = 'not_yet_open' THEN RAISE EXCEPTION 'Registration has not opened yet'; END IF;
  IF v_phase <> 'open' THEN RAISE EXCEPTION 'Registration for this programme is closed'; END IF;

  -- Free-tier flood protection.
  IF (SELECT count(*) FROM public.dc_program_registrations
       WHERE program_id = p.id AND created_at > NOW() - interval '1 minute') >= 40
     OR (SELECT count(*) FROM public.dc_program_registrations
       WHERE created_at > NOW() - interval '1 minute') >= 120 THEN
    RAISE EXCEPTION 'Registration is very busy right now. Please try again in a minute.';
  END IF;
  IF (SELECT count(*) FROM public.dc_program_registrations WHERE program_id = p.id) >= 20000 THEN
    RAISE EXCEPTION 'This programme has reached its registration limit';
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 120 OR v_name !~ '[[:alpha:]]' THEN
    RAISE EXCEPTION 'Please enter your full name';
  END IF;
  IF p.phone_mode = 'hidden' THEN v_phone := NULL; END IF;
  IF p.email_mode = 'hidden' THEN v_email := NULL; END IF;
  IF p.phone_mode = 'required' AND v_phone IS NULL THEN RAISE EXCEPTION 'Please enter your phone number'; END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'Please enter a valid phone number'; END IF;
  IF p.email_mode = 'required' AND v_email IS NULL THEN RAISE EXCEPTION 'Please enter your e-mail address'; END IF;
  IF v_email IS NOT NULL AND (char_length(v_email) > 160 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'Please enter a valid e-mail address';
  END IF;
  IF v_gender IS NOT NULL AND v_gender NOT IN ('male','female','other') THEN v_gender := NULL; END IF;
  IF v_age IS NOT NULL AND v_age NOT IN ('under-13','13-17','18-25','26-35','36-50','51+') THEN v_age := NULL; END IF;
  IF v_src = '' THEN v_src := 'direct'; END IF;
  BEGIN v_party := coalesce((j->>'party_size')::INTEGER, 1);
  EXCEPTION WHEN others THEN v_party := 1; END;
  v_party := greatest(1, least(v_party, p.max_party_size));

  -- Custom questions: keep only known answers; enforce required + select options.
  FOR q IN SELECT * FROM jsonb_array_elements(p.custom_questions) LOOP
    v_qid := q->>'id';
    CONTINUE WHEN v_qid IS NULL;
    v_val := left(trim(coalesce(v_raw_answers->>v_qid, '')), 500);
    IF lower(coalesce(q->>'required', '')) IN ('true','1','yes') AND v_val = '' THEN
      RAISE EXCEPTION 'Please answer: %', coalesce(q->>'label', 'a required question');
    END IF;
    IF v_val <> '' AND q->>'type' = 'select'
       AND NOT (coalesce(q->'options', '[]'::JSONB) ? v_val) THEN
      RAISE EXCEPTION 'Please choose a valid option for: %', coalesce(q->>'label', 'a question');
    END IF;
    IF v_val <> '' AND q->>'type' = 'yesno' AND v_val NOT IN ('yes','no') THEN
      RAISE EXCEPTION 'Please answer yes or no for: %', coalesce(q->>'label', 'a question');
    END IF;
    IF v_val <> '' THEN v_answers := v_answers || jsonb_build_object(v_qid, v_val); END IF;
  END LOOP;

  -- Duplicate protection: the same phone cannot hold two live registrations.
  IF v_phone IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.dc_program_registrations
     WHERE program_id = p.id AND phone = v_phone AND status <> 'cancelled';
    IF FOUND THEN
      IF lower(v_existing.full_name) = lower(v_name) THEN
        RETURN jsonb_build_object('result', 'duplicate', 'status', v_existing.status,
          'ticket_code', v_existing.ticket_code, 'ticket_token', v_existing.ticket_token,
          'full_name', v_existing.full_name, 'title', p.title, 'starts_at', p.starts_at, 'venue', p.venue);
      END IF;
      RAISE EXCEPTION 'This phone number is already registered for this programme';
    END IF;
  END IF;

  v_seats := public.dc_program_seats(p.id);
  IF p.capacity IS NOT NULL AND v_seats + v_party > p.capacity THEN
    IF p.allow_waitlist THEN v_status := 'waitlisted';
    ELSE RAISE EXCEPTION 'Sorry, this programme is fully booked';
    END IF;
  END IF;

  INSERT INTO public.dc_program_registrations
    (program_id, full_name, phone, email, gender, age_group, organisation, is_first_timer,
     how_heard, source, party_size, answers, status, ticket_code, ticket_token)
  VALUES
    (p.id, v_name, v_phone, v_email, v_gender, v_age, v_org, v_first,
     v_heard, v_src, v_party, v_answers, v_status, public.dc_new_ticket_code(), public.dc_new_token())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('result', 'created', 'status', v_row.status,
    'ticket_code', v_row.ticket_code, 'ticket_token', v_row.ticket_token,
    'full_name', v_row.full_name, 'party_size', v_row.party_size,
    'title', p.title, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'venue', p.venue);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_program_ticket(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_token TEXT := public.dc_extract_token(p_token);
  r public.dc_program_registrations;
  p public.dc_programs;
BEGIN
  IF v_token IS NULL THEN RETURN jsonb_build_object('found', FALSE); END IF;
  SELECT * INTO r FROM public.dc_program_registrations WHERE ticket_token = v_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', FALSE); END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = r.program_id;
  RETURN jsonb_build_object('found', TRUE,
    'full_name', r.full_name, 'status', r.status, 'party_size', r.party_size,
    'ticket_code', r.ticket_code, 'ticket_token', r.ticket_token,
    'checked_in', r.checked_in_at IS NOT NULL, 'checked_in_at', r.checked_in_at,
    'feedback_rating', r.feedback_rating, 'feedback_at', r.feedback_at,
    'slug', p.slug, 'title', p.title, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
    'venue', p.venue, 'feedback_enabled', p.feedback_enabled,
    'feedback_open', p.feedback_enabled AND p.starts_at <= NOW() AND r.status <> 'cancelled',
    'phase', public.dc_program_phase(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_submit_program_feedback(p_token TEXT, p_rating INTEGER, p_comment TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token TEXT := public.dc_extract_token(p_token);
  r public.dc_program_registrations;
  p public.dc_programs;
BEGIN
  IF v_token IS NULL THEN RAISE EXCEPTION 'This ticket link is not valid'; END IF;
  SELECT * INTO r FROM public.dc_program_registrations WHERE ticket_token = v_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'This ticket link is not valid'; END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = r.program_id;
  IF NOT p.feedback_enabled THEN RAISE EXCEPTION 'Feedback is not being collected for this programme'; END IF;
  IF p.starts_at > NOW() THEN RAISE EXCEPTION 'Feedback opens when the programme starts'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Please choose a rating from 1 to 5'; END IF;
  UPDATE public.dc_program_registrations
     SET feedback_rating = p_rating,
         feedback_comment = nullif(left(trim(coalesce(p_comment, '')), 1000), ''),
         feedback_at = NOW()
   WHERE id = r.id;
  RETURN jsonb_build_object('ok', TRUE, 'rating', p_rating);
END;
$$;

-- Check-in desk. Accepts a ticket QR/URL, an 8-character ticket code, or a
-- member ID card (QR token, member number or legacy code). A member card that
-- has no registration is admitted as a walk-in registration automatically.
CREATE OR REPLACE FUNCTION public.dc_program_checkin(p_program_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw   TEXT := trim(coalesce(p_code, ''));
  v_token TEXT := public.dc_extract_token(v_raw);
  r       public.dc_program_registrations;
  p       public.dc_programs;
  v_card  JSONB;
  v_prof  public.profiles;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can check people in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = p_program_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme not found'; END IF;
  IF v_raw = '' THEN RETURN jsonb_build_object('result', 'invalid'); END IF;

  IF v_token IS NOT NULL THEN
    SELECT * INTO r FROM public.dc_program_registrations WHERE ticket_token = v_token;
  ELSIF upper(v_raw) ~ '^[A-F0-9]{8}$' THEN
    SELECT * INTO r FROM public.dc_program_registrations WHERE ticket_code = upper(v_raw);
  END IF;

  IF r.id IS NULL THEN
    -- Not a ticket: try a member card.
    BEGIN
      v_card := public.dc_lookup_card(v_raw);
    EXCEPTION WHEN others THEN
      v_card := jsonb_build_object('status', 'invalid');
    END;
    IF v_card ? 'member_id' THEN
      IF v_card->>'status' NOT IN ('valid','expired') THEN
        RETURN jsonb_build_object('result', 'card_' || (v_card->>'status'), 'full_name', v_card->>'full_name');
      END IF;
      SELECT * INTO r FROM public.dc_program_registrations
       WHERE program_id = p.id AND member_id = (v_card->>'member_id')::UUID AND status <> 'cancelled';
      IF r.id IS NULL THEN
        SELECT * INTO v_prof FROM public.profiles WHERE id = (v_card->>'member_id')::UUID;
        INSERT INTO public.dc_program_registrations
          (program_id, member_id, full_name, phone, email, gender, source, status,
           ticket_code, ticket_token, checked_in_at, checked_in_by)
        VALUES
          (p.id, v_prof.id, coalesce(nullif(trim(v_prof.full_name), ''), 'Member'),
           nullif(regexp_replace(coalesce(v_prof.phone, ''), '[^0-9+]', '', 'g'), ''),
           v_prof.email,
           CASE WHEN lower(v_prof.gender) IN ('male','female','other') THEN lower(v_prof.gender) END,
           'member-card', 'registered', public.dc_new_ticket_code(), public.dc_new_token(), NOW(), auth.uid())
        ON CONFLICT DO NOTHING
        RETURNING * INTO r;
        IF r.id IS NULL THEN
          RETURN jsonb_build_object('result', 'duplicate_phone', 'full_name', v_prof.full_name);
        END IF;
        RETURN jsonb_build_object('result', 'checked_in', 'walk_in', TRUE, 'full_name', r.full_name,
          'party_size', r.party_size, 'registration_id', r.id, 'checked_in_at', r.checked_in_at);
      END IF;
    ELSE
      RETURN jsonb_build_object('result', 'not_found');
    END IF;
  END IF;

  IF r.program_id <> p.id THEN
    RETURN jsonb_build_object('result', 'wrong_program', 'full_name', r.full_name,
      'program', (SELECT title FROM public.dc_programs WHERE id = r.program_id));
  END IF;
  IF r.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled', 'full_name', r.full_name);
  END IF;
  IF r.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already', 'full_name', r.full_name,
      'party_size', r.party_size, 'registration_id', r.id, 'checked_in_at', r.checked_in_at);
  END IF;
  UPDATE public.dc_program_registrations
     SET checked_in_at = NOW(), checked_in_by = auth.uid(),
         status = CASE WHEN status = 'waitlisted' THEN 'registered' ELSE status END
   WHERE id = r.id RETURNING * INTO r;
  RETURN jsonb_build_object('result', 'checked_in', 'walk_in', FALSE, 'full_name', r.full_name,
    'party_size', r.party_size, 'registration_id', r.id, 'checked_in_at', r.checked_in_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_program_undo_checkin(p_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can change check-ins' USING ERRCODE = '42501';
  END IF;
  UPDATE public.dc_program_registrations SET checked_in_at = NULL, checked_in_by = NULL
   WHERE id = p_registration_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

-- Door walk-in (no ticket, no member card). Registers and checks in at once.
-- If the phone already holds a registration for this programme, that person is
-- checked in instead of creating a duplicate. Capacity is NOT enforced at the
-- door: the person is physically present and the desk decides.
CREATE OR REPLACE FUNCTION public.dc_program_walkin(p_program_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p        public.dc_programs;
  j        JSONB := coalesce(p_payload, '{}'::JSONB);
  v_name   TEXT := regexp_replace(trim(coalesce(j->>'full_name', '')), '\s+', ' ', 'g');
  v_phone  TEXT := nullif(regexp_replace(coalesce(j->>'phone', ''), '[^0-9+]', '', 'g'), '');
  v_email  TEXT := nullif(lower(trim(coalesce(j->>'email', ''))), '');
  v_gender TEXT := nullif(lower(trim(coalesce(j->>'gender', ''))), '');
  v_age    TEXT := nullif(trim(coalesce(j->>'age_group', '')), '');
  v_heard  TEXT := nullif(left(trim(coalesce(j->>'how_heard', '')), 60), '');
  v_first  BOOLEAN := lower(coalesce(j->>'is_first_timer', '')) IN ('true','1','yes','on');
  v_party  INTEGER;
  r        public.dc_program_registrations;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can admit walk-ins' USING ERRCODE = '42501';
  END IF;
  IF pg_column_size(j) > 8000 THEN RAISE EXCEPTION 'The form is too large'; END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = p_program_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme not found'; END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 OR v_name !~ '[[:alpha:]]' THEN
    RAISE EXCEPTION 'Please enter the guest''s full name';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'Please enter a valid phone number'; END IF;
  IF v_email IS NOT NULL AND (char_length(v_email) > 160 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'Please enter a valid e-mail address';
  END IF;
  IF v_gender IS NOT NULL AND v_gender NOT IN ('male','female','other') THEN v_gender := NULL; END IF;
  IF v_age IS NOT NULL AND v_age NOT IN ('under-13','13-17','18-25','26-35','36-50','51+') THEN v_age := NULL; END IF;
  BEGIN v_party := coalesce((j->>'party_size')::INTEGER, 1);
  EXCEPTION WHEN others THEN v_party := 1; END;
  v_party := greatest(1, least(v_party, 10));

  IF v_phone IS NOT NULL THEN
    SELECT * INTO r FROM public.dc_program_registrations
     WHERE program_id = p.id AND phone = v_phone AND status <> 'cancelled';
    IF FOUND THEN
      IF r.checked_in_at IS NOT NULL THEN
        RETURN jsonb_build_object('result', 'already', 'walk_in', FALSE, 'full_name', r.full_name,
          'party_size', r.party_size, 'registration_id', r.id, 'checked_in_at', r.checked_in_at);
      END IF;
      UPDATE public.dc_program_registrations
         SET checked_in_at = NOW(), checked_in_by = auth.uid(),
             status = CASE WHEN status = 'waitlisted' THEN 'registered' ELSE status END
       WHERE id = r.id RETURNING * INTO r;
      RETURN jsonb_build_object('result', 'checked_in', 'walk_in', FALSE, 'matched', 'phone',
        'full_name', r.full_name, 'party_size', r.party_size, 'registration_id', r.id,
        'ticket_code', r.ticket_code, 'checked_in_at', r.checked_in_at);
    END IF;
  END IF;

  INSERT INTO public.dc_program_registrations
    (program_id, full_name, phone, email, gender, age_group, is_first_timer, how_heard,
     source, party_size, status, ticket_code, ticket_token, checked_in_at, checked_in_by)
  VALUES
    (p.id, v_name, v_phone, v_email, v_gender, v_age, v_first, v_heard,
     'walk-in', v_party, 'registered', public.dc_new_ticket_code(), public.dc_new_token(), NOW(), auth.uid())
  RETURNING * INTO r;
  RETURN jsonb_build_object('result', 'checked_in', 'walk_in', TRUE, 'full_name', r.full_name,
    'party_size', r.party_size, 'registration_id', r.id, 'ticket_code', r.ticket_code,
    'ticket_token', r.ticket_token, 'checked_in_at', r.checked_in_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_program_insights(p_program_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  p public.dc_programs;
  v JSONB;
  q JSONB;
  v_questions JSONB := '[]'::JSONB;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can view programme insights' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = p_program_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme not found'; END IF;

  WITH r AS (SELECT * FROM public.dc_program_registrations WHERE program_id = p.id),
       live AS (SELECT * FROM r WHERE status <> 'cancelled')
  SELECT jsonb_build_object(
    'program', jsonb_build_object('id', p.id, 'title', p.title, 'starts_at', p.starts_at,
                                  'capacity', p.capacity, 'phase', public.dc_program_phase(p)),
    'totals', jsonb_build_object(
      'registrations', (SELECT count(*) FROM live),
      'seats',         (SELECT coalesce(sum(party_size), 0) FROM live WHERE status = 'registered'),
      'waitlisted',    (SELECT count(*) FROM live WHERE status = 'waitlisted'),
      'cancelled',     (SELECT count(*) FROM r WHERE status = 'cancelled'),
      'checked_in',    (SELECT count(*) FROM live WHERE checked_in_at IS NOT NULL),
      'checked_in_people', (SELECT coalesce(sum(party_size), 0) FROM live WHERE checked_in_at IS NOT NULL),
      'walk_ins',      (SELECT count(*) FROM live WHERE source IN ('walk-in','member-card')),
      'first_timers',  (SELECT count(*) FROM live WHERE is_first_timer),
      'members',       (SELECT count(*) FROM live WHERE member_id IS NOT NULL),
      'no_shows',      CASE WHEN p.starts_at < NOW()
                            THEN (SELECT count(*) FROM live WHERE checked_in_at IS NULL AND status = 'registered')
                            ELSE 0 END,
      'feedback_count', (SELECT count(*) FROM live WHERE feedback_rating IS NOT NULL),
      'feedback_avg',   (SELECT round(avg(feedback_rating)::NUMERIC, 2) FROM live WHERE feedback_rating IS NOT NULL)
    ),
    'by_source',    (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (SELECT source k, count(*) n FROM live GROUP BY 1) s),
    'by_gender',    (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (SELECT coalesce(gender, 'unspecified') k, count(*) n FROM live GROUP BY 1) s),
    'by_age_group', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (SELECT coalesce(age_group, 'unspecified') k, count(*) n FROM live GROUP BY 1) s),
    'by_how_heard', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (SELECT coalesce(how_heard, 'unspecified') k, count(*) n FROM live GROUP BY 1) s),
    'by_day',       (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d, 'count', n) ORDER BY d), '[]'::JSONB)
                       FROM (SELECT (created_at AT TIME ZONE 'UTC')::DATE d, count(*) n FROM live GROUP BY 1) s),
    'checkin_by_hour', (SELECT coalesce(jsonb_agg(jsonb_build_object('hour', h, 'count', n) ORDER BY h), '[]'::JSONB)
                       FROM (SELECT date_trunc('hour', checked_in_at) h, count(*) n FROM live WHERE checked_in_at IS NOT NULL GROUP BY 1) s),
    'rating_distribution', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB)
                       FROM (SELECT feedback_rating::TEXT k, count(*) n FROM live WHERE feedback_rating IS NOT NULL GROUP BY 1) s)
  ) INTO v;

  FOR q IN SELECT * FROM jsonb_array_elements(p.custom_questions) LOOP
    CONTINUE WHEN q->>'type' NOT IN ('select','yesno') OR q->>'id' IS NULL;
    v_questions := v_questions || jsonb_build_array(jsonb_build_object(
      'id', q->>'id', 'label', q->>'label',
      'counts', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (
                  SELECT answers->>(q->>'id') k, count(*) n
                  FROM public.dc_program_registrations
                  WHERE program_id = p.id AND status <> 'cancelled' AND answers ? (q->>'id')
                  GROUP BY 1) s)));
  END LOOP;
  RETURN v || jsonb_build_object('questions', v_questions, 'generated_at', NOW());
END;
$$;

-- --------------------------------------------------------------------------
-- 3. Duty roster
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_duty_roster (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_date     DATE NOT NULL,
  service_label TEXT NOT NULL DEFAULT 'Sunday Service' CHECK (char_length(service_label) BETWEEN 2 AND 80),
  duty_role     TEXT NOT NULL CHECK (char_length(duty_role) BETWEEN 2 AND 60),
  member_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notes         TEXT CHECK (notes IS NULL OR char_length(notes) <= 300),
  status        TEXT NOT NULL DEFAULT 'assigned'
                CHECK (status IN ('assigned','confirmed','declined','swap_requested','done','missed')),
  response_note TEXT CHECK (response_note IS NULL OR char_length(response_note) <= 300),
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (duty_date, service_label, duty_role, member_id)
);
CREATE INDEX IF NOT EXISTS dc_duty_roster_date_idx ON public.dc_duty_roster(duty_date);
CREATE INDEX IF NOT EXISTS dc_duty_roster_member_idx ON public.dc_duty_roster(member_id, duty_date);

DROP TRIGGER IF EXISTS trg_dc_duty_roster_touch ON public.dc_duty_roster;
CREATE TRIGGER trg_dc_duty_roster_touch BEFORE UPDATE ON public.dc_duty_roster
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();

ALTER TABLE public.dc_duty_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dc_duty_roster_read ON public.dc_duty_roster;
CREATE POLICY dc_duty_roster_read ON public.dc_duty_roster
  FOR SELECT TO authenticated USING (public.is_approved_member());
DROP POLICY IF EXISTS dc_duty_roster_manage_insert ON public.dc_duty_roster;
CREATE POLICY dc_duty_roster_manage_insert ON public.dc_duty_roster
  FOR INSERT TO authenticated WITH CHECK (public.dc_is_manager());
DROP POLICY IF EXISTS dc_duty_roster_manage_update ON public.dc_duty_roster;
CREATE POLICY dc_duty_roster_manage_update ON public.dc_duty_roster
  FOR UPDATE TO authenticated USING (public.dc_is_manager()) WITH CHECK (public.dc_is_manager());
DROP POLICY IF EXISTS dc_duty_roster_manage_delete ON public.dc_duty_roster;
CREATE POLICY dc_duty_roster_manage_delete ON public.dc_duty_roster
  FOR DELETE TO authenticated USING (public.dc_is_manager());

CREATE OR REPLACE FUNCTION public.dc_respond_duty(p_duty_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE d public.dc_duty_roster;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('confirmed','declined','swap_requested') THEN
    RAISE EXCEPTION 'Choose confirm, decline or request a swap';
  END IF;
  SELECT * INTO d FROM public.dc_duty_roster WHERE id = p_duty_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duty not found'; END IF;
  IF d.member_id <> auth.uid() THEN RAISE EXCEPTION 'You can only respond to your own duties' USING ERRCODE = '42501'; END IF;
  IF d.duty_date < CURRENT_DATE THEN RAISE EXCEPTION 'This duty date has passed'; END IF;
  IF p_status IN ('declined','swap_requested') AND char_length(trim(coalesce(p_note, ''))) < 3 THEN
    RAISE EXCEPTION 'Please add a short reason so your leader can plan a replacement';
  END IF;
  UPDATE public.dc_duty_roster
     SET status = p_status, response_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   WHERE id = d.id RETURNING * INTO d;
  RETURN to_jsonb(d);
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Member care & follow-up
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_care_cases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL DEFAULT 'absence'
               CHECK (reason IN ('absence','welfare','illness','bereavement','celebration','new_member','other')),
  summary      TEXT NOT NULL CHECK (char_length(summary) BETWEEN 3 AND 300),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','contacted','visited','resolved')),
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  assigned_to  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  opened_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  followup_log JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(followup_log) = 'array'),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dc_care_cases_member_idx ON public.dc_care_cases(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dc_care_cases_status_idx ON public.dc_care_cases(status);

DROP TRIGGER IF EXISTS trg_dc_care_cases_touch ON public.dc_care_cases;
CREATE TRIGGER trg_dc_care_cases_touch BEFORE UPDATE ON public.dc_care_cases
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();

-- Admins see every case; unit leaders see cases for their own unit or assigned to them.
CREATE OR REPLACE FUNCTION public.dc_can_see_care(p_member_id UUID, p_assigned_to UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT public.is_admin()
      OR (public.dc_is_manager() AND (
            p_assigned_to = auth.uid()
         OR EXISTS (SELECT 1 FROM public.profiles m
                     WHERE m.id = p_member_id AND public.dc_my_unit() IS NOT NULL
                       AND nullif(trim(m.unit), '') = public.dc_my_unit())));
$$;

ALTER TABLE public.dc_care_cases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dc_care_cases_read ON public.dc_care_cases;
CREATE POLICY dc_care_cases_read ON public.dc_care_cases
  FOR SELECT TO authenticated USING (public.dc_can_see_care(member_id, assigned_to));
DROP POLICY IF EXISTS dc_care_cases_insert ON public.dc_care_cases;
CREATE POLICY dc_care_cases_insert ON public.dc_care_cases
  FOR INSERT TO authenticated WITH CHECK (public.dc_can_see_care(member_id, assigned_to));
DROP POLICY IF EXISTS dc_care_cases_update ON public.dc_care_cases;
CREATE POLICY dc_care_cases_update ON public.dc_care_cases
  FOR UPDATE TO authenticated USING (public.dc_can_see_care(member_id, assigned_to))
  WITH CHECK (public.dc_can_see_care(member_id, assigned_to));
DROP POLICY IF EXISTS dc_care_cases_admin_delete ON public.dc_care_cases;
CREATE POLICY dc_care_cases_admin_delete ON public.dc_care_cases
  FOR DELETE TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.dc_care_add_note(p_case_id UUID, p_note TEXT, p_status TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE c public.dc_care_cases; v_note TEXT := left(trim(coalesce(p_note, '')), 500);
BEGIN
  SELECT * INTO c FROM public.dc_care_cases WHERE id = p_case_id;
  IF NOT FOUND OR NOT public.dc_can_see_care(c.member_id, c.assigned_to) THEN
    RAISE EXCEPTION 'Care case not found' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open','contacted','visited','resolved') THEN
    RAISE EXCEPTION 'Unsupported status';
  END IF;
  IF char_length(v_note) < 2 AND p_status IS NULL THEN RAISE EXCEPTION 'Write a short follow-up note'; END IF;
  IF jsonb_array_length(c.followup_log) >= 200 THEN RAISE EXCEPTION 'This case log is full; resolve it and open a new case'; END IF;
  UPDATE public.dc_care_cases
     SET followup_log = followup_log || jsonb_build_array(jsonb_build_object(
           'at', NOW(), 'by', coalesce((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Leader'),
           'note', nullif(v_note, ''), 'status', p_status)),
         status = coalesce(p_status, status),
         resolved_at = CASE WHEN p_status = 'resolved' THEN NOW()
                            WHEN p_status IS NOT NULL THEN NULL ELSE resolved_at END
   WHERE id = c.id RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

-- Members whose most recent rehearsals were missed in a row.
-- A rehearsal counts only once any attendance has been recorded for it (so an
-- unmarked session never makes the whole department look absent).
CREATE OR REPLACE FUNCTION public.dc_absentee_candidates(p_min_missed INTEGER DEFAULT 3)
RETURNS TABLE (
  member_id UUID, full_name TEXT, unit TEXT, phone TEXT, avatar_url TEXT,
  missed_in_a_row INTEGER, last_present DATE, open_case BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
#variable_conflict use_column
DECLARE v_min INTEGER := greatest(1, least(coalesce(p_min_missed, 3), 20));
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can view follow-up lists' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH sessions AS (
    SELECT r.id, r.rehearsal_date, row_number() OVER (ORDER BY r.rehearsal_date DESC, r.id) AS rn
    FROM public.rehearsals r
    WHERE r.rehearsal_date <= CURRENT_DATE
      AND EXISTS (SELECT 1 FROM public.attendance a WHERE a.rehearsal_id = r.id)
  ),
  recent AS (SELECT * FROM sessions WHERE rn <= 20),
  roster AS (
    SELECT m.id, m.full_name, m.unit, m.phone, m.avatar_url, coalesce(m.created_at, '-infinity'::TIMESTAMPTZ) AS joined
    FROM public.profiles m
    WHERE m.status = 'approved'
      AND (public.is_admin() OR (public.dc_my_unit() IS NOT NULL AND nullif(trim(m.unit), '') = public.dc_my_unit()))
  ),
  marks AS (
    -- Only sessions held on/after the member joined count against them.
    SELECT ro.id AS mid, s.rehearsal_date,
           row_number() OVER (PARTITION BY ro.id ORDER BY s.rehearsal_date DESC, s.id) AS mrn,
           EXISTS (SELECT 1 FROM public.attendance a
                    WHERE a.rehearsal_id = s.id AND a.member_id = ro.id
                      AND a.status IN ('present','late','excused')) AS came
    FROM roster ro JOIN recent s ON s.rehearsal_date >= (ro.joined AT TIME ZONE 'UTC')::DATE OR ro.joined = '-infinity'::TIMESTAMPTZ
  ),
  streak AS (
    SELECT mk.mid,
           coalesce(min(mk.mrn) FILTER (WHERE mk.came), count(*) + 1) - 1 AS missed,
           max(mk.rehearsal_date) FILTER (WHERE mk.came) AS last_came
    FROM marks mk GROUP BY mk.mid
  )
  SELECT ro.id, ro.full_name, ro.unit, ro.phone, ro.avatar_url,
         st.missed::INTEGER, st.last_came,
         EXISTS (SELECT 1 FROM public.dc_care_cases c WHERE c.member_id = ro.id AND c.status <> 'resolved')
  FROM roster ro JOIN streak st ON st.mid = ro.id
  WHERE st.missed >= v_min
  ORDER BY st.missed DESC, ro.full_name;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Privileges (least privilege; explicit grants only)
-- --------------------------------------------------------------------------
REVOKE ALL ON public.dc_card_settings, public.dc_member_cards, public.dc_programs,
              public.dc_program_registrations, public.dc_duty_roster, public.dc_care_cases FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.dc_card_settings TO authenticated;
GRANT SELECT ON public.dc_member_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dc_programs TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.dc_program_registrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dc_duty_roster TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dc_care_cases TO authenticated;
REVOKE ALL ON SEQUENCE public.dc_member_no_seq FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.dc_is_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_my_unit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_new_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_extract_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_issue_card_internal(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_card_state(public.dc_member_cards, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_card_json(public.dc_member_cards, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_my_card() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_verify_card(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_lookup_card(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_admin_card_action(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_admin_list_cards() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_scan_attendance(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_seats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_phase(public.dc_programs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_public_program(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_new_ticket_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_register_for_program(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_ticket(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_submit_program_feedback(TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_checkin(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_undo_checkin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_walkin(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_insights(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_respond_duty(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_can_see_care(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_care_add_note(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_absentee_candidates(INTEGER) FROM PUBLIC;

-- Restore support (v14.1): the in-browser archive restore upserts rows as the
-- signed-in administrator, so admins (only) may insert/update these tables
-- directly. Everyday writes still go through the RPCs above.
DROP POLICY IF EXISTS dc_card_settings_admin_insert ON public.dc_card_settings;
CREATE POLICY dc_card_settings_admin_insert ON public.dc_card_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_member_cards_admin_restore_insert ON public.dc_member_cards;
CREATE POLICY dc_member_cards_admin_restore_insert ON public.dc_member_cards
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_member_cards_admin_restore_update ON public.dc_member_cards;
CREATE POLICY dc_member_cards_admin_restore_update ON public.dc_member_cards
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_program_regs_admin_insert ON public.dc_program_registrations;
CREATE POLICY dc_program_regs_admin_insert ON public.dc_program_registrations
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
GRANT INSERT ON public.dc_card_settings TO authenticated;
GRANT INSERT, UPDATE ON public.dc_member_cards TO authenticated;
GRANT INSERT ON public.dc_program_registrations TO authenticated;

-- Public (anon) entry points: an explicit, reviewed allow-list.
GRANT EXECUTE ON FUNCTION public.dc_verify_card(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dc_public_program(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dc_register_for_program(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_ticket(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dc_submit_program_feedback(TEXT, INTEGER, TEXT) TO anon, authenticated;

-- Signed-in entry points (each function re-checks role internally).
GRANT EXECUTE ON FUNCTION public.dc_is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_my_unit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_can_see_care(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_my_card() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_lookup_card(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_admin_card_action(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_admin_list_cards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_scan_attendance(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_checkin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_undo_checkin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_walkin(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_insights(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_respond_duty(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_care_add_note(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_absentee_candidates(INTEGER) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
