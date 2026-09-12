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
