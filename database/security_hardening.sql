-- ============================================================================
-- DramaConnect security hardening and missing backend objects
-- Run AFTER database/repair_and_upgrade.sql in Supabase SQL Editor.
-- Idempotent: policies, views, functions and triggers are replaced safely.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Missing columns and data-integrity checks
-- --------------------------------------------------------------------------
ALTER TABLE public.gallery
  ADD COLUMN IF NOT EXISTS uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#003399';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_valid
  CHECK (role IN ('member', 'admin')) NOT VALID;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_valid
  CHECK (status IN ('pending', 'approved', 'rejected')) NOT VALID;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_birth_month_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_birth_month_valid
  CHECK (birth_month IS NULL OR birth_month BETWEEN 1 AND 12) NOT VALID;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_birth_day_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_birth_day_valid
  CHECK (birth_day IS NULL OR birth_day BETWEEN 1 AND 31) NOT VALID;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_unit_length;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_unit_length
  CHECK (unit IS NULL OR char_length(unit) <= 80) NOT VALID;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_status_valid;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_status_valid
  CHECK (status IN ('present', 'absent', 'excused', 'late')) NOT VALID;
ALTER TABLE public.event_rsvps DROP CONSTRAINT IF EXISTS event_rsvps_response_valid;
ALTER TABLE public.event_rsvps ADD CONSTRAINT event_rsvps_response_valid
  CHECK (response IN ('going', 'maybe', 'no')) NOT VALID;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_valid;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_valid
  CHECK (status IN ('open', 'in_progress', 'done')) NOT VALID;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_priority_valid;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_priority_valid
  CHECK (priority IN ('low', 'normal', 'high')) NOT VALID;
ALTER TABLE public.gallery DROP CONSTRAINT IF EXISTS gallery_image_url_safe;
ALTER TABLE public.gallery ADD CONSTRAINT gallery_image_url_safe
  CHECK (image_url ~* '^https://') NOT VALID;
ALTER TABLE public.resources DROP CONSTRAINT IF EXISTS resources_url_safe;
ALTER TABLE public.resources ADD CONSTRAINT resources_url_safe
  CHECK (url ~* '^https?://') NOT VALID;
ALTER TABLE public.productions DROP CONSTRAINT IF EXISTS productions_script_url_safe;
ALTER TABLE public.productions ADD CONSTRAINT productions_script_url_safe
  CHECK (script_url IS NULL OR script_url ~* '^https?://') NOT VALID;
ALTER TABLE public.tenant_settings DROP CONSTRAINT IF EXISTS tenant_primary_color_valid;
ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_primary_color_valid
  CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$') NOT VALID;
ALTER TABLE public.tenant_settings DROP CONSTRAINT IF EXISTS tenant_logo_url_safe;
ALTER TABLE public.tenant_settings ADD CONSTRAINT tenant_logo_url_safe
  CHECK (logo_url ~* '^https?://' OR logo_url ~ '^(\.{0,2}/|/)(?!/)') NOT VALID;

CREATE INDEX IF NOT EXISTS gallery_uploaded_by_id_idx ON public.gallery(uploaded_by_id);
CREATE INDEX IF NOT EXISTS inbox_recipient_created_idx ON public.inbox(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_assignee_due_idx ON public.tasks(assignee_id, due_date);

-- --------------------------------------------------------------------------
-- 2. Recursion-safe authorization helpers
-- --------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_approved_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_gallery_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_gallery_manager() TO authenticated;

-- --------------------------------------------------------------------------
-- 3. Safe member/schedule projections (sensitive fields and codes omitted)
-- Views intentionally execute with the owner's privileges, but expose only the
-- explicit columns below and only approved profiles.
-- --------------------------------------------------------------------------
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

REVOKE ALL ON public.member_directory FROM PUBLIC, anon;
REVOKE ALL ON public.rehearsal_schedule FROM PUBLIC, anon;
GRANT SELECT ON public.member_directory TO authenticated;
GRANT SELECT ON public.rehearsal_schedule TO authenticated;

-- --------------------------------------------------------------------------
-- 4. Guard profile updates at column level. RLS identifies eligible rows; this
-- trigger prevents self-promotion, approval bypass, unit reassignment and email
-- desynchronization even if a malicious client sends extra columns.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  auth_email TEXT;
BEGIN
  -- SQL Editor, trusted database jobs and the service role remain available for
  -- recovery/automation. Browser requests always have auth.uid().
  IF caller IS NULL OR jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF caller <> OLD.id THEN
    RAISE EXCEPTION 'Only an administrator may update another member profile'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.is_unit_leader IS DISTINCT FROM OLD.is_unit_leader
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.bday_last_sent IS DISTINCT FROM OLD.bday_last_sent THEN
    RAISE EXCEPTION 'Role, approval, unit and leadership fields are administrator-managed'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    SELECT u.email INTO auth_email FROM auth.users u WHERE u.id = OLD.id;
    IF NEW.email IS DISTINCT FROM auth_email THEN
      RAISE EXCEPTION 'Profile email must match the authenticated account email'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_update ON public.profiles;
CREATE TRIGGER trg_guard_profile_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- Keep profiles.email synchronized with Supabase Auth. Email changes must be
-- initiated with sb.auth.updateUser(), never by writing profiles directly.
CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
AFTER UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- Correct the legacy trigger, which referenced nonexistent details/user_id.
CREATE OR REPLACE FUNCTION public.log_critical_admin_actions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO public.activity_log (actor_name, action, detail)
    VALUES (
      'Database', 'role_change',
      'Changed role from ' || COALESCE(OLD.role, 'member') || ' to ' ||
      COALESCE(NEW.role, 'member') || ' for ' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_critical_admin_actions ON public.profiles;
CREATE TRIGGER trg_critical_admin_actions
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_critical_admin_actions();

-- --------------------------------------------------------------------------
-- 5. Server-authoritative operations
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.self_check_in(
  p_rehearsal_id UUID,
  p_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.rehearsals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.rehearsals
  WHERE id = p_rehearsal_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Rehearsal not found'; END IF;
  IF r.checkin_open IS NOT TRUE THEN RAISE EXCEPTION 'Self check-in is closed'; END IF;
  IF r.rehearsal_date <> CURRENT_DATE THEN
    RAISE EXCEPTION 'Self check-in is only available on the rehearsal date';
  END IF;
  IF r.checkin_code IS NULL OR char_length(r.checkin_code) <> 6
     OR trim(COALESCE(p_code, '')) <> r.checkin_code THEN
    RAISE EXCEPTION 'Invalid check-in code' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.attendance (rehearsal_id, member_id, status, marked_at)
  VALUES (p_rehearsal_id, auth.uid(), 'present', NOW())
  ON CONFLICT (rehearsal_id, member_id)
  DO UPDATE SET status = 'present', marked_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_poll_vote(
  p_poll_id UUID,
  p_option_index INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p public.polls%ROWTYPE;
  option_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO p FROM public.polls WHERE id = p_poll_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Poll not found'; END IF;
  IF p.is_open IS NOT TRUE THEN RAISE EXCEPTION 'This poll is closed'; END IF;
  IF jsonb_typeof(p.options) <> 'array' THEN RAISE EXCEPTION 'Poll options are invalid'; END IF;
  option_count := jsonb_array_length(p.options);
  IF option_count < 2 OR option_count > 20
     OR p_option_index < 0 OR p_option_index >= option_count THEN
    RAISE EXCEPTION 'Invalid poll option' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.poll_votes (poll_id, voter_id, option_index)
  VALUES (p_poll_id, auth.uid(), p_option_index)
  ON CONFLICT (poll_id, voter_id)
  DO UPDATE SET option_index = EXCLUDED.option_index, created_at = NOW();
END;
$$;

-- Aggregated results preserve voter privacy while still telling the caller which
-- option they selected.
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

-- RSVP totals are department-visible, while individual response identities stay
-- private to the respondent and administrators.
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

CREATE OR REPLACE FUNCTION public.set_task_status(
  p_task_id UUID,
  p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('open', 'in_progress', 'done') THEN
    RAISE EXCEPTION 'Invalid task status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tasks
  SET status = p_status
  WHERE id = p_task_id
    AND (assignee_id = auth.uid() OR public.is_admin());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found or access denied' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.self_check_in(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cast_poll_vote(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.poll_results() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_rsvp_results() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_task_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.self_check_in(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cast_poll_vote(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.poll_results() TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_rsvp_results() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_task_status(UUID, TEXT) TO authenticated;

-- Normalize identity-bearing rows and reject field tampering.
CREATE OR REPLACE FUNCTION public.guard_inbox_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  caller_name TEXT;
BEGIN
  IF caller IS NULL OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(full_name, email, 'Member') INTO caller_name
    FROM public.profiles WHERE id = caller;
    NEW.sender_id := caller;
    NEW.sender_name := caller_name;
    NEW.read_at := NULL;
    IF NEW.recipient_id IS NOT NULL AND NEW.to_admins IS TRUE THEN
      RAISE EXCEPTION 'Choose either a direct recipient or the admin group';
    END IF;
    IF NOT public.is_admin() AND NEW.recipient_id IS NULL AND NEW.to_admins IS NOT TRUE THEN
      RAISE EXCEPTION 'Only administrators may broadcast to all members'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT public.is_admin() THEN
    IF OLD.recipient_id IS DISTINCT FROM caller
       OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
       OR NEW.sender_name IS DISTINCT FROM OLD.sender_name
       OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
       OR NEW.to_admins IS DISTINCT FROM OLD.to_admins
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Recipients may only update read status'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_inbox_write ON public.inbox;
CREATE TRIGGER trg_guard_inbox_write
BEFORE INSERT OR UPDATE ON public.inbox
FOR EACH ROW EXECUTE FUNCTION public.guard_inbox_write();

CREATE OR REPLACE FUNCTION public.normalize_activity_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(full_name, email, 'Member') INTO NEW.actor_name
    FROM public.profiles WHERE id = auth.uid();
  END IF;
  NEW.action := left(COALESCE(NEW.action, 'unknown'), 100);
  NEW.detail := left(COALESCE(NEW.detail, ''), 1000);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_normalize_activity_log ON public.activity_log;
CREATE TRIGGER trg_normalize_activity_log
BEFORE INSERT ON public.activity_log
FOR EACH ROW EXECUTE FUNCTION public.normalize_activity_log();

CREATE OR REPLACE FUNCTION public.normalize_suggestion_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  NEW.status := 'new';
  IF NEW.anonymous IS TRUE THEN
    NEW.author_id := NULL;
    NEW.author_name := NULL;
  ELSE
    NEW.author_id := auth.uid();
    SELECT COALESCE(full_name, email, 'Member') INTO NEW.author_name
    FROM public.profiles WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_normalize_suggestion_author ON public.suggestions;
CREATE TRIGGER trg_normalize_suggestion_author
BEFORE INSERT ON public.suggestions
FOR EACH ROW EXECUTE FUNCTION public.normalize_suggestion_author();

CREATE OR REPLACE FUNCTION public.normalize_gallery_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.uploaded_by_id := auth.uid();
    SELECT COALESCE(full_name, email, 'Member') INTO NEW.uploaded_by
    FROM public.profiles WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_normalize_gallery_owner ON public.gallery;
CREATE TRIGGER trg_normalize_gallery_owner
BEFORE INSERT ON public.gallery
FOR EACH ROW EXECUTE FUNCTION public.normalize_gallery_owner();

-- --------------------------------------------------------------------------
-- 6. Replace permissive RLS with least-privilege policies
-- --------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles','productions','cast_list','finances','budgets','rehearsals',
        'attendance','announcements','events','activity_log','messages','inbox',
        'tasks','reminders','resources','polls','poll_votes','event_rsvps',
        'gallery','suggestions','inventory','tenant_settings'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_self_admin ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin());
CREATE POLICY profiles_insert_admin ON public.profiles FOR INSERT
  WITH CHECK (public.is_admin());
CREATE POLICY profiles_update_self_admin ON public.profiles FOR UPDATE
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());
-- No browser DELETE policy: the approved-admin Edge Function deletes auth.users
-- first so the cascading profile removal can never leave an orphaned login.

-- Department-wide readable operational data; administrators own writes.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'productions','cast_list','finances','budgets','announcements','events',
    'attendance','resources','polls','gallery','inventory'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_approved_member())', t || '_read', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin())', t || '_admin', t);
    END IF;
  END LOOP;
END $$;

-- Rehearsal secrets are available only to administrators. Members use the view.
ALTER TABLE public.rehearsals ENABLE ROW LEVEL SECURITY;
CREATE POLICY rehearsals_admin ON public.rehearsals FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Direct member attendance writes are denied; self_check_in() is authoritative.
-- The admin policy above is the only write path outside that RPC.

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_select_admin ON public.activity_log FOR SELECT USING (public.is_admin());
CREATE POLICY activity_insert_authenticated ON public.activity_log FOR INSERT
  WITH CHECK (public.is_approved_member());
CREATE POLICY activity_manage_admin ON public.activity_log FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_admin ON public.messages FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_select_visible ON public.inbox FOR SELECT USING (
  public.is_approved_member()
  AND (
    sender_id = auth.uid()
    OR recipient_id = auth.uid()
    OR (recipient_id IS NULL AND to_admins IS FALSE)
    OR (to_admins IS TRUE AND public.is_admin())
  )
);
CREATE POLICY inbox_insert_approved ON public.inbox FOR INSERT
  WITH CHECK (public.is_approved_member());
CREATE POLICY inbox_update_recipient_admin ON public.inbox FOR UPDATE
  USING (public.is_approved_member() AND (recipient_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.is_approved_member() AND (recipient_id = auth.uid() OR public.is_admin()));
CREATE POLICY inbox_delete_participant_admin ON public.inbox FOR DELETE
  USING (public.is_approved_member() AND (sender_id = auth.uid() OR recipient_id = auth.uid() OR public.is_admin()));

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_select_assignee_admin ON public.tasks FOR SELECT
  USING (public.is_approved_member() AND (assignee_id = auth.uid() OR public.is_admin()));
CREATE POLICY tasks_admin ON public.tasks FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Assignees change status only through set_task_status().

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY reminders_admin ON public.reminders FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY poll_votes_select_self_admin ON public.poll_votes FOR SELECT
  USING (public.is_approved_member() AND (voter_id = auth.uid() OR public.is_admin()));
CREATE POLICY poll_votes_admin ON public.poll_votes FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Members vote only through cast_poll_vote().

-- Members can see/manage only their own RSVP identity; administrators can see
-- every identity. Everyone else gets counts only from event_rsvp_results().
CREATE POLICY event_rsvps_select_self_admin ON public.event_rsvps FOR SELECT
  USING (public.is_approved_member() AND (member_id = auth.uid() OR public.is_admin()));
CREATE POLICY event_rsvps_insert_self ON public.event_rsvps FOR INSERT
  WITH CHECK (member_id = auth.uid() AND public.is_approved_member());
CREATE POLICY event_rsvps_update_self ON public.event_rsvps FOR UPDATE
  USING (member_id = auth.uid() AND public.is_approved_member())
  WITH CHECK (member_id = auth.uid() AND public.is_approved_member());
CREATE POLICY event_rsvps_delete_self ON public.event_rsvps FOR DELETE
  USING (member_id = auth.uid() AND public.is_approved_member());

-- Managers may add gallery rows; unit leaders may delete only their own rows.
CREATE POLICY gallery_insert_manager ON public.gallery FOR INSERT
  WITH CHECK (public.is_gallery_manager() AND uploaded_by_id = auth.uid());
CREATE POLICY gallery_delete_owner_manager ON public.gallery FOR DELETE
  USING (public.is_admin() OR (public.is_gallery_manager() AND uploaded_by_id = auth.uid()));

ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY suggestions_read_approved ON public.suggestions FOR SELECT
  USING (public.is_approved_member());
CREATE POLICY suggestions_insert_approved ON public.suggestions FOR INSERT
  WITH CHECK (public.is_approved_member());
CREATE POLICY suggestions_admin ON public.suggestions FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_read ON public.tenant_settings FOR SELECT USING (true);
CREATE POLICY tenant_settings_admin ON public.tenant_settings FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- --------------------------------------------------------------------------
-- 7. Storage ownership and manager checks
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS avatars_public_read ON storage.objects;
DROP POLICY IF EXISTS avatars_user_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_user_update ON storage.objects;
DROP POLICY IF EXISTS avatars_user_delete ON storage.objects;
DROP POLICY IF EXISTS gallery_public_read ON storage.objects;
DROP POLICY IF EXISTS gallery_auth_insert ON storage.objects;
DROP POLICY IF EXISTS gallery_owner_delete ON storage.objects;
DROP POLICY IF EXISTS gallery_manager_insert ON storage.objects;
DROP POLICY IF EXISTS gallery_manager_update ON storage.objects;
DROP POLICY IF EXISTS gallery_manager_delete ON storage.objects;

CREATE POLICY avatars_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
CREATE POLICY avatars_user_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_approved_member()
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND lower(name) ~ '\.(jpg|jpeg|png|webp|gif)$'
  );
CREATE POLICY avatars_user_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND public.is_approved_member()
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_approved_member()
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND lower(name) ~ '\.(jpg|jpeg|png|webp|gif)$'
  );
CREATE POLICY avatars_user_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND public.is_approved_member()
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY gallery_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'gallery');
CREATE POLICY gallery_manager_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'gallery'
    AND public.is_gallery_manager()
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND lower(name) ~ '\.(jpg|jpeg|png|webp|gif)$'
  );
CREATE POLICY gallery_manager_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'gallery'
    AND public.is_gallery_manager()
    AND (public.is_admin() OR auth.uid()::text = (storage.foldername(name))[1])
  )
  WITH CHECK (
    bucket_id = 'gallery'
    AND public.is_gallery_manager()
    AND (public.is_admin() OR auth.uid()::text = (storage.foldername(name))[1])
    AND lower(name) ~ '\.(jpg|jpeg|png|webp|gif)$'
  );
CREATE POLICY gallery_manager_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'gallery'
    AND public.is_gallery_manager()
    AND (public.is_admin() OR auth.uid()::text = (storage.foldername(name))[1])
  );

COMMIT;

-- Optional checks after running:
-- SELECT policyname, tablename, cmd FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;
-- SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='gallery';
