-- ============================================================================
-- DramaConnect — COMPONENT 05: POST-INSTALL SELF-HEAL AND API RELOAD
-- Source: database/post_install_selfheal.sql
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
-- Components 02-04 run inside explicit transactions. If any single statement in
-- one of them errors on a particular project, PostgreSQL aborts and rolls back
-- that whole component. When that happened to component 02 the database kept
-- working, but four objects silently disappeared while every base table stayed
-- in place, producing exactly these runtime errors:
--
--     Could not find the function public.poll_results without parameters
--     Could not find the function public.event_rsvp_results without parameters
--     Could not find the table 'public.member_directory' in the schema cache
--     Could not find the table 'public.rehearsal_schedule' in the schema cache
--
-- A second, independent cause of the identical message is a stale PostgREST
-- schema cache: PostgREST caches the catalog on startup and reports PGRST205
-- ("not found in the schema cache") for objects that exist perfectly well in
-- the database until it is told to reload.
--
-- WHAT THIS COMPONENT DOES
--   1. Re-creates the safe projections, the aggregate RPCs and the
--      authorisation helpers unconditionally, so they can never be missing.
--   2. Re-applies every grant those objects need.
--   3. Tells PostgREST to rebuild its schema cache.
--   4. Emits a verification row that must be all-true.
--
-- It is fully idempotent, depends only on base tables created in component 01,
-- and runs in its own transaction so it is independent of the others.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Authorization helpers (recursion-safe, independent of any policy)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_member()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_gallery_manager()
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

-- ---------------------------------------------------------------------------
-- 2. Safe projections
-- The directory view exposes only the columns a member is entitled to see and
-- omits addresses, emergency contacts and costume measurements. The schedule
-- view omits the secret six-digit check-in code entirely. Both filter on
-- is_approved_member() so an unapproved or signed-out caller gets zero rows
-- rather than an error.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.member_directory;
CREATE VIEW public.member_directory
WITH (security_barrier = true)
AS
SELECT
  id, full_name, email, phone, parish, role, status, unit, occupation,
  avatar_url, whatsapp, facebook, instagram, tiktok, twitter,
  birth_month, birth_day, is_unit_leader, created_at
FROM public.profiles
WHERE status = 'approved'
  AND public.is_approved_member();

DROP VIEW IF EXISTS public.rehearsal_schedule;
CREATE VIEW public.rehearsal_schedule
WITH (security_barrier = true)
AS
SELECT id, rehearsal_date, notes, checkin_open, created_at
FROM public.rehearsals
WHERE public.is_approved_member();

-- ---------------------------------------------------------------------------
-- 3. Aggregate RPCs
-- These are SECURITY DEFINER so members can read vote/RSVP totals without ever
-- being granted row-level access to another member's individual ballot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poll_results()
RETURNS TABLE (
  poll_id UUID,
  option_index INTEGER,
  vote_count BIGINT,
  is_mine BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT v.poll_id, v.option_index, COUNT(*)::BIGINT,
           BOOL_OR(v.voter_id = auth.uid())
    FROM public.poll_votes v
    GROUP BY v.poll_id, v.option_index;
END;
$$;

CREATE OR REPLACE FUNCTION public.event_rsvp_results()
RETURNS TABLE (
  event_id UUID,
  response TEXT,
  response_count BIGINT,
  is_mine BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.event_id, r.response, COUNT(*)::BIGINT,
           BOOL_OR(r.member_id = auth.uid())
    FROM public.event_rsvps r
    GROUP BY r.event_id, r.response;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- Revoked from PUBLIC and anon first so a previously leaked grant cannot
-- survive a re-run; then granted to authenticated only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.member_directory FROM PUBLIC, anon;
REVOKE ALL ON public.rehearsal_schedule FROM PUBLIC, anon;
GRANT SELECT ON public.member_directory TO authenticated;
GRANT SELECT ON public.rehearsal_schedule TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_approved_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_gallery_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.poll_results() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_rsvp_results() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_gallery_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.poll_results() TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_rsvp_results() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Schema Doctor — is every SQL pack installed?
-- Probes the catalog for marker objects from each component of
-- complete-schema.sql (and the optional pg_cron heartbeat) so Platform Health
-- can say exactly which pack is missing or out of date. Read-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_schema_doctor()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_packs JSONB := '[
    {"id":"01","name":"Base schema & repair","file":"repair_and_upgrade.sql","required":true,
     "objects":["t:profiles","t:rehearsals","t:attendance","t:finances","t:events","t:announcements","t:messages","t:inbox","t:tasks","t:polls","t:poll_votes","t:gallery","t:inventory","t:suggestions","t:activity_log","t:tenant_settings","f:handle_new_user"]},
    {"id":"02","name":"RLS & server-authoritative security","file":"security_hardening.sql","required":true,
     "objects":["f:is_approved_member","f:is_gallery_manager","f:self_check_in","f:cast_poll_vote","f:set_task_status","f:guard_profile_update","f:sync_profile_email_from_auth"]},
    {"id":"03","name":"Resilience, anti-pause heartbeat & backup","file":"resilience_and_backup.sql","required":true,
     "objects":["t:dc_heartbeat_sources","t:sc_keepalive","f:dc_keep_alive","f:sc_keep_alive","f:dc_heartbeat_health","t:dc_backup_runs","t:dc_backup_settings","f:dc_begin_backup_run","b:dramaconnect-backups"]},
    {"id":"04","name":"Control plane, licensing, storage & analytics","file":"platform_management.sql","required":true,
     "objects":["t:dc_platform_settings","t:dc_site_license","t:dc_login_audit","t:dc_retention_settings","t:dc_org_settings","t:dc_archive_vault","f:dc_access_state","f:sc_license_status","f:dc_apply_retention","f:dc_analytics_overview","f:dc_table_sizes","f:dc_login_audit_report","f:dc_archive_purge","f:dc_self_check_in_geo","f:dc_update_org_settings"]},
    {"id":"05","name":"ID cards, programmes, roster & care","file":"identity_and_programs.sql","required":true,
     "objects":["t:dc_card_settings","t:dc_member_cards","t:dc_programs","t:dc_program_registrations","t:dc_duty_roster","t:dc_care_cases","f:dc_my_card","f:dc_lookup_card","f:dc_program_checkin","f:dc_program_insights"]},
    {"id":"06","name":"Post-install self-heal & views","file":"post_install_selfheal.sql","required":true,
     "objects":["v:member_directory","v:rehearsal_schedule","f:poll_results","f:event_rsvp_results","b:avatars","b:gallery"]}
  ]'::JSONB;
  pk JSONB;
  obj TEXT;
  v_kind TEXT;
  v_name TEXT;
  v_ok BOOLEAN;
  v_missing TEXT[];
  v_present INTEGER;
  v_total INTEGER;
  v_result JSONB := '[]'::JSONB;
  v_all_ok BOOLEAN := TRUE;
  v_cron JSONB;
  v_version TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;

  FOR pk IN SELECT value FROM jsonb_array_elements(v_packs) LOOP
    v_missing := '{}'; v_present := 0; v_total := 0;
    FOR obj IN SELECT jsonb_array_elements_text(pk->'objects') LOOP
      v_kind := split_part(obj, ':', 1); v_name := split_part(obj, ':', 2); v_total := v_total + 1;
      v_ok := CASE v_kind
        WHEN 't' THEN to_regclass('public.' || quote_ident(v_name)) IS NOT NULL
        WHEN 'v' THEN to_regclass('public.' || quote_ident(v_name)) IS NOT NULL
        WHEN 'f' THEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.proname = v_name)
        ELSE NULL END;
      IF v_kind = 'b' THEN
        v_ok := FALSE;
        IF to_regclass('storage.buckets') IS NOT NULL THEN
          EXECUTE 'SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = $1)' INTO v_ok USING v_name;
        END IF;
      END IF;
      IF v_ok THEN v_present := v_present + 1; ELSE v_missing := v_missing || obj; END IF;
    END LOOP;
    IF v_present < v_total THEN v_all_ok := FALSE; END IF;
    v_result := v_result || jsonb_build_object(
      'id', pk->>'id', 'name', pk->>'name', 'file', pk->>'file',
      'installed', v_present = v_total, 'partial', v_present > 0 AND v_present < v_total,
      'present', v_present, 'total', v_total, 'missing', to_jsonb(v_missing));
  END LOOP;

  -- Optional layer: in-database pg_cron heartbeat (Layer 4). Not required.
  v_cron := jsonb_build_object('extension', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'), 'job', FALSE);
  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('dramaconnect-internal-heartbeat','sc-keep-alive'))$q$
        INTO v_ok;
      v_cron := v_cron || jsonb_build_object('job', v_ok);
    EXCEPTION WHEN insufficient_privilege THEN
      v_cron := v_cron || jsonb_build_object('job', NULL, 'note', 'cron schema not readable');
    END;
  END IF;

  BEGIN
    EXECUTE 'SELECT schema_version FROM public.dc_platform_settings WHERE id = 1' INTO v_version;
  EXCEPTION WHEN OTHERS THEN v_version := NULL;
  END;

  RETURN jsonb_build_object(
    'ok', v_all_ok,
    'checkedAt', NOW(),
    'schemaVersion', v_version,
    'postgres', current_setting('server_version'),
    'packs', v_result,
    'pgCron', v_cron,
    'fix', CASE WHEN v_all_ok THEN NULL ELSE
      'Run database/complete-schema.sql once in the Supabase SQL Editor. It is safe to re-run and repairs every missing pack.' END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.dc_schema_doctor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dc_schema_doctor() TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- 5. Force PostgREST to rebuild its schema cache.
-- Without this, a project can keep answering PGRST205 for objects that were
-- created successfully, because PostgREST caches the catalog at startup.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6. Verification. Every column must read true.
-- ---------------------------------------------------------------------------
SELECT
  to_regclass('public.member_directory')             IS NOT NULL AS member_directory_ready,
  to_regclass('public.rehearsal_schedule')           IS NOT NULL AS rehearsal_schedule_ready,
  to_regprocedure('public.poll_results()')           IS NOT NULL AS poll_results_ready,
  to_regprocedure('public.event_rsvp_results()')     IS NOT NULL AS event_rsvp_results_ready,
  to_regprocedure('public.is_admin()')               IS NOT NULL AS is_admin_ready,
  to_regprocedure('public.is_approved_member()')     IS NOT NULL AS is_approved_member_ready,
  to_regclass('public.profiles')                     IS NOT NULL AS profiles_ready,
  to_regclass('public.rehearsals')                   IS NOT NULL AS rehearsals_ready,
  to_regclass('public.tenant_settings')              IS NOT NULL AS tenant_settings_ready;
