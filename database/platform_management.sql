-- ============================================================================
-- DramaConnect v14 — control plane, storage governance, access and licensing
-- Run after security_hardening.sql and resilience_and_backup.sql.
-- Safe to rerun. The canonical installer is database/complete-schema.sql.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Profile access metadata and singleton control-plane settings
-- --------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS access_version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.dc_platform_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lockdown_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  lockdown_message TEXT NOT NULL DEFAULT 'DramaConnect is temporarily in maintenance mode.',
  idle_timeout_minutes INTEGER NOT NULL DEFAULT 30 CHECK (idle_timeout_minutes BETWEEN 10 AND 720),
  login_audit_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (login_audit_retention_days BETWEEN 7 AND 730),
  schema_version TEXT NOT NULL DEFAULT '14.0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.dc_platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dc_retention_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  database_quota_mb INTEGER NOT NULL DEFAULT 500 CHECK (database_quota_mb BETWEEN 50 AND 102400),
  storage_quota_mb INTEGER NOT NULL DEFAULT 1024 CHECK (storage_quota_mb BETWEEN 50 AND 1048576),
  warning_percent INTEGER NOT NULL DEFAULT 70 CHECK (warning_percent BETWEEN 20 AND 95),
  critical_percent INTEGER NOT NULL DEFAULT 90 CHECK (critical_percent BETWEEN 40 AND 99),
  activity_log_days INTEGER NOT NULL DEFAULT 365 CHECK (activity_log_days BETWEEN 30 AND 3650),
  backup_run_days INTEGER NOT NULL DEFAULT 180 CHECK (backup_run_days BETWEEN 30 AND 3650),
  heartbeat_days INTEGER NOT NULL DEFAULT 90 CHECK (heartbeat_days BETWEEN 14 AND 730),
  login_audit_days INTEGER NOT NULL DEFAULT 90 CHECK (login_audit_days BETWEEN 7 AND 730),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK (warning_percent < critical_percent)
);

INSERT INTO public.dc_retention_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dc_site_license (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  license_model TEXT NOT NULL DEFAULT 'lifetime' CHECK (license_model IN ('lifetime', 'subscription')),
  plan_name TEXT NOT NULL DEFAULT 'DramaConnect Lifetime',
  license_status TEXT NOT NULL DEFAULT 'active' CHECK (license_status IN ('active', 'past_due', 'suspended', 'expired')),
  licensed_to TEXT NOT NULL DEFAULT 'RCCG LP 25 Drama Department',
  starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_on DATE,
  grace_days INTEGER NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 0 AND 90),
  renewal_url TEXT,
  support_email TEXT,
  public_message TEXT,
  registry_url TEXT,
  last_validated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK (license_model = 'lifetime' OR expires_on IS NOT NULL),
  CHECK (renewal_url IS NULL OR renewal_url ~* '^https://'),
  CHECK (registry_url IS NULL OR registry_url ~* '^https://')
);

INSERT INTO public.dc_site_license (
  id, license_model, plan_name, license_status, licensed_to, starts_on,
  expires_on, grace_days, public_message
)
VALUES (
  1, 'lifetime', 'DramaConnect Lifetime', 'active',
  'RCCG LP 25 Drama Department', CURRENT_DATE, NULL, 14,
  'Lifetime ownership is active for this DramaConnect deployment.'
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dc_login_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'sign_in', 'sign_out', 'idle_timeout', 'lockdown_denied',
    'license_denied', 'access_changed', 'security_changed'
  )),
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dc_license_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  previous_state JSONB,
  next_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profiles_access_idx ON public.profiles(status, role, created_at DESC);
CREATE INDEX IF NOT EXISTS dc_login_audit_created_idx ON public.dc_login_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS dc_login_audit_user_idx ON public.dc_login_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dc_license_events_created_idx ON public.dc_license_events(created_at DESC);

-- --------------------------------------------------------------------------
-- 2. RLS: visibility is narrow; all mutations go through checked RPCs
-- --------------------------------------------------------------------------
ALTER TABLE public.dc_platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_retention_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_site_license ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_login_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_license_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dc_platform_settings_admin_read ON public.dc_platform_settings;
CREATE POLICY dc_platform_settings_admin_read ON public.dc_platform_settings
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS dc_retention_settings_admin_read ON public.dc_retention_settings;
CREATE POLICY dc_retention_settings_admin_read ON public.dc_retention_settings
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS dc_site_license_member_read ON public.dc_site_license;
CREATE POLICY dc_site_license_member_read ON public.dc_site_license
  FOR SELECT USING (public.is_approved_member());

DROP POLICY IF EXISTS dc_login_audit_admin_read ON public.dc_login_audit;
CREATE POLICY dc_login_audit_admin_read ON public.dc_login_audit
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS dc_license_events_admin_read ON public.dc_license_events;
CREATE POLICY dc_license_events_admin_read ON public.dc_license_events
  FOR SELECT USING (public.is_admin());

-- --------------------------------------------------------------------------
-- 3. Session access state and browser audit events
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_access_state()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_platform public.dc_platform_settings%ROWTYPE;
  v_license public.dc_site_license%ROWTYPE;
  v_license_allowed BOOLEAN := FALSE;
  v_license_effective TEXT := 'expired';
  v_allowed BOOLEAN := FALSE;
  v_reason TEXT := 'profile_unavailable';
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'authentication_required');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO v_platform FROM public.dc_platform_settings WHERE id = 1;
  SELECT * INTO v_license FROM public.dc_site_license WHERE id = 1;

  IF NOT FOUND OR v_profile.id IS NULL THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'profile_unavailable');
  END IF;

  IF v_profile.status <> 'approved' THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'account_' || COALESCE(v_profile.status, 'pending'));
  END IF;

  IF v_license.license_model = 'lifetime' THEN
    v_license_allowed := v_license.license_status = 'active';
    v_license_effective := v_license.license_status;
  ELSE
    v_license_allowed := v_license.license_status IN ('active', 'past_due')
      AND CURRENT_DATE <= (v_license.expires_on + v_license.grace_days);
    v_license_effective := CASE
      WHEN v_license.license_status IN ('suspended', 'expired') THEN v_license.license_status
      WHEN CURRENT_DATE <= v_license.expires_on THEN 'active'
      WHEN CURRENT_DATE <= (v_license.expires_on + v_license.grace_days) THEN 'grace'
      ELSE 'expired'
    END;
  END IF;

  IF v_profile.role = 'admin' THEN
    v_allowed := TRUE;
    v_reason := CASE
      WHEN v_platform.lockdown_enabled THEN 'admin_lockdown_bypass'
      WHEN NOT v_license_allowed THEN 'admin_license_bypass'
      ELSE 'ok'
    END;
  ELSIF v_platform.lockdown_enabled THEN
    v_reason := 'lockdown';
  ELSIF NOT v_license_allowed THEN
    v_reason := 'license_' || v_license_effective;
  ELSE
    v_allowed := TRUE;
    v_reason := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'isAdmin', v_profile.role = 'admin',
    'lockdownEnabled', v_platform.lockdown_enabled,
    'lockdownMessage', v_platform.lockdown_message,
    'idleTimeoutMinutes', v_platform.idle_timeout_minutes,
    'schemaVersion', v_platform.schema_version,
    'license', jsonb_build_object(
      'model', v_license.license_model,
      'status', v_license_effective,
      'planName', v_license.plan_name,
      'licensedTo', v_license.licensed_to,
      'startsOn', v_license.starts_on,
      'expiresOn', v_license.expires_on,
      'graceDays', v_license.grace_days,
      'renewalUrl', v_license.renewal_url,
      'supportEmail', v_license.support_email,
      'message', v_license.public_message
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_record_login_event(
  p_event_type TEXT,
  p_user_agent TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_event_type NOT IN ('sign_in','sign_out','idle_timeout','lockdown_denied','license_denied') THEN
    RAISE EXCEPTION 'Unsupported login event';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.dc_login_audit (user_id, email, event_type, user_agent, metadata)
  VALUES (
    auth.uid(), v_email, p_event_type,
    left(COALESCE(p_user_agent, ''), 500),
    COALESCE(p_metadata, '{}'::jsonb)
  );
  RETURN jsonb_build_object('ok', TRUE, 'recordedAt', NOW());
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Administrator settings, member access and license lifecycle
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_update_platform_settings(
  p_lockdown_enabled BOOLEAN,
  p_lockdown_message TEXT,
  p_idle_timeout_minutes INTEGER,
  p_login_audit_retention_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.dc_platform_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_idle_timeout_minutes NOT BETWEEN 10 AND 720 THEN RAISE EXCEPTION 'Idle timeout must be between 10 and 720 minutes'; END IF;
  IF p_login_audit_retention_days NOT BETWEEN 7 AND 730 THEN RAISE EXCEPTION 'Login audit retention must be between 7 and 730 days'; END IF;

  UPDATE public.dc_platform_settings SET
    lockdown_enabled = COALESCE(p_lockdown_enabled, FALSE),
    lockdown_message = left(COALESCE(NULLIF(btrim(p_lockdown_message), ''), 'DramaConnect is temporarily in maintenance mode.'), 500),
    idle_timeout_minutes = p_idle_timeout_minutes,
    login_audit_retention_days = p_login_audit_retention_days,
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1 RETURNING * INTO v_row;

  -- Retention has ONE owner: public.dc_retention_settings (edited on the Storage Manager
  -- page). dc_retention_preview()/dc_apply_retention() read login_audit_days from there,
  -- so a value written only to dc_platform_settings would silently do nothing. Mirror it
  -- to keep the two tables consistent for any caller that still supplies this argument.
  UPDATE public.dc_retention_settings SET
    login_audit_days = greatest(7, least(730, p_login_audit_retention_days)),
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1;

  INSERT INTO public.dc_login_audit (user_id, email, event_type, metadata)
  SELECT auth.uid(), p.email, 'security_changed',
    jsonb_build_object('lockdownEnabled', v_row.lockdown_enabled, 'idleTimeoutMinutes', v_row.idle_timeout_minutes)
  FROM public.profiles p WHERE p.id = auth.uid();
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_update_retention_settings(
  p_database_quota_mb INTEGER,
  p_storage_quota_mb INTEGER,
  p_warning_percent INTEGER,
  p_critical_percent INTEGER,
  p_activity_log_days INTEGER,
  p_backup_run_days INTEGER,
  p_heartbeat_days INTEGER,
  p_login_audit_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.dc_retention_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_warning_percent NOT BETWEEN 20 AND 95 OR p_critical_percent NOT BETWEEN 40 AND 99 OR p_warning_percent >= p_critical_percent THEN
    RAISE EXCEPTION 'Usage thresholds are invalid';
  END IF;
  UPDATE public.dc_retention_settings SET
    database_quota_mb = greatest(50, least(102400, p_database_quota_mb)),
    storage_quota_mb = greatest(50, least(1048576, p_storage_quota_mb)),
    warning_percent = p_warning_percent, critical_percent = p_critical_percent,
    activity_log_days = greatest(30, least(3650, p_activity_log_days)),
    backup_run_days = greatest(30, least(3650, p_backup_run_days)),
    heartbeat_days = greatest(14, least(730, p_heartbeat_days)),
    login_audit_days = greatest(7, least(730, p_login_audit_days)),
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1 RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_list_member_access()
RETURNS TABLE (
  id UUID, full_name TEXT, email TEXT, phone TEXT, unit TEXT,
  role TEXT, status TEXT, is_unit_leader BOOLEAN,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, access_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT p.id, p.full_name, p.email, p.phone, p.unit,
    p.role, p.status, COALESCE(p.is_unit_leader, FALSE),
    p.created_at, p.updated_at, p.access_version
  FROM public.profiles p
  ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, lower(COALESCE(p.full_name, p.email, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_update_member_access(
  p_member_id UUID,
  p_role TEXT,
  p_status TEXT,
  p_unit TEXT,
  p_is_unit_leader BOOLEAN,
  p_expected_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.profiles%ROWTYPE;
  v_new public.profiles%ROWTYPE;
  v_other_admins INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_role NOT IN ('member','admin') THEN RAISE EXCEPTION 'Unsupported role'; END IF;
  IF p_status NOT IN ('pending','approved','rejected') THEN RAISE EXCEPTION 'Unsupported account status'; END IF;
  IF p_role = 'admin' AND p_status <> 'approved' THEN RAISE EXCEPTION 'Administrators must be approved'; END IF;
  IF char_length(COALESCE(p_unit, '')) > 80 THEN RAISE EXCEPTION 'Unit name is too long'; END IF;

  SELECT * INTO v_old FROM public.profiles WHERE profiles.id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF v_old.access_version <> p_expected_version THEN RAISE EXCEPTION 'This member changed in another session. Refresh and retry' USING ERRCODE = '40001'; END IF;

  IF v_old.role = 'admin' AND v_old.status = 'approved' AND (p_role <> 'admin' OR p_status <> 'approved') THEN
    SELECT count(*) INTO v_other_admins FROM public.profiles
    WHERE id <> p_member_id AND role = 'admin' AND status = 'approved';
    IF v_other_admins = 0 THEN RAISE EXCEPTION 'The last approved administrator cannot be demoted or blocked'; END IF;
  END IF;

  UPDATE public.profiles SET
    role = p_role,
    status = p_status,
    unit = NULLIF(btrim(p_unit), ''),
    is_unit_leader = CASE WHEN p_role = 'admin' THEN FALSE ELSE COALESCE(p_is_unit_leader, FALSE) END,
    updated_at = NOW(), access_version = access_version + 1
  WHERE profiles.id = p_member_id
  RETURNING * INTO v_new;

  INSERT INTO public.dc_login_audit (user_id, email, event_type, metadata)
  SELECT auth.uid(), p.email, 'access_changed', jsonb_build_object(
    'memberId', p_member_id, 'previousRole', v_old.role, 'nextRole', v_new.role,
    'previousStatus', v_old.status, 'nextStatus', v_new.status,
    'unitLeader', v_new.is_unit_leader
  ) FROM public.profiles p WHERE p.id = auth.uid();

  RETURN jsonb_build_object(
    'id', v_new.id, 'role', v_new.role, 'status', v_new.status,
    'unit', v_new.unit, 'isUnitLeader', v_new.is_unit_leader,
    'accessVersion', v_new.access_version, 'updatedAt', v_new.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_update_site_license(
  p_license_model TEXT,
  p_plan_name TEXT,
  p_license_status TEXT,
  p_licensed_to TEXT,
  p_starts_on DATE,
  p_expires_on DATE,
  p_grace_days INTEGER,
  p_renewal_url TEXT,
  p_support_email TEXT,
  p_public_message TEXT,
  p_registry_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old JSONB;
  v_new public.dc_site_license%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_license_model NOT IN ('lifetime','subscription') THEN RAISE EXCEPTION 'Unsupported license model'; END IF;
  IF p_license_status NOT IN ('active','past_due','suspended','expired') THEN RAISE EXCEPTION 'Unsupported license status'; END IF;
  IF p_license_model = 'subscription' AND p_expires_on IS NULL THEN RAISE EXCEPTION 'Subscription expiry is required'; END IF;
  IF p_grace_days NOT BETWEEN 0 AND 90 THEN RAISE EXCEPTION 'Grace period must be between 0 and 90 days'; END IF;
  IF p_renewal_url IS NOT NULL AND p_renewal_url !~* '^https://' THEN RAISE EXCEPTION 'Renewal URL must use HTTPS'; END IF;
  IF p_registry_url IS NOT NULL AND p_registry_url !~* '^https://' THEN RAISE EXCEPTION 'Registry URL must use HTTPS'; END IF;

  SELECT to_jsonb(l) INTO v_old FROM public.dc_site_license l WHERE id = 1;
  UPDATE public.dc_site_license SET
    license_model = p_license_model,
    plan_name = left(COALESCE(NULLIF(btrim(p_plan_name), ''), 'DramaConnect'), 120),
    license_status = p_license_status,
    licensed_to = left(COALESCE(NULLIF(btrim(p_licensed_to), ''), 'Organization'), 160),
    starts_on = COALESCE(p_starts_on, CURRENT_DATE),
    expires_on = CASE WHEN p_license_model = 'lifetime' THEN NULL ELSE p_expires_on END,
    grace_days = p_grace_days,
    renewal_url = NULLIF(btrim(p_renewal_url), ''),
    support_email = NULLIF(btrim(p_support_email), ''),
    public_message = left(COALESCE(p_public_message, ''), 500),
    registry_url = NULLIF(btrim(p_registry_url), ''),
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1 RETURNING * INTO v_new;

  INSERT INTO public.dc_license_events (actor_id, event_type, previous_state, next_state)
  VALUES (auth.uid(), 'license_updated', v_old, to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Storage/quota visibility and guarded retention
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_storage_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
STABLE
AS $$
DECLARE
  v_database_bytes BIGINT := 0;
  v_storage_bytes BIGINT := 0;
  v_storage_objects BIGINT := 0;
  v_buckets JSONB := '[]'::jsonb;
  v_settings public.dc_retention_settings%ROWTYPE;
  v_db_percent NUMERIC := 0;
  v_storage_percent NUMERIC := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.dc_retention_settings WHERE id = 1;
  SELECT pg_database_size(current_database()) INTO v_database_bytes;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT COALESCE(sum(bucket_bytes), 0), COALESCE(sum(object_count), 0),
        COALESCE(jsonb_agg(jsonb_build_object(
          'bucket', bucket_id, 'objects', object_count, 'bytes', bucket_bytes
        ) ORDER BY bucket_id), '[]'::jsonb)
      FROM (
        SELECT bucket_id, count(*) AS object_count,
          COALESCE(sum(CASE WHEN COALESCE(metadata->>'size', '') ~ '^[0-9]+$' THEN (metadata->>'size')::bigint ELSE 0 END), 0) AS bucket_bytes
        FROM storage.objects GROUP BY bucket_id
      ) bucket_totals
    $sql$ INTO v_storage_bytes, v_storage_objects, v_buckets;
  END IF;

  v_db_percent := round((v_database_bytes::numeric / (v_settings.database_quota_mb * 1024 * 1024)) * 100, 2);
  v_storage_percent := round((v_storage_bytes::numeric / (v_settings.storage_quota_mb * 1024 * 1024)) * 100, 2);

  RETURN jsonb_build_object(
    'databaseBytes', v_database_bytes,
    'databaseQuotaBytes', v_settings.database_quota_mb::bigint * 1024 * 1024,
    'databasePercent', v_db_percent,
    'storageBytes', v_storage_bytes,
    'storageQuotaBytes', v_settings.storage_quota_mb::bigint * 1024 * 1024,
    'storagePercent', v_storage_percent,
    'storageObjects', v_storage_objects,
    'buckets', v_buckets,
    'warningPercent', v_settings.warning_percent,
    'criticalPercent', v_settings.critical_percent,
    'measuredAt', NOW()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_retention_preview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v public.dc_retention_settings%ROWTYPE;
  a BIGINT; b BIGINT; h BIGINT; l BIGINT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.dc_retention_settings WHERE id = 1;
  SELECT count(*) INTO a FROM public.activity_log WHERE created_at < NOW() - make_interval(days => v.activity_log_days);
  SELECT count(*) INTO b FROM public.dc_backup_runs WHERE started_at < NOW() - make_interval(days => v.backup_run_days) AND status <> 'running';
  SELECT count(*) INTO h FROM public.dc_heartbeat_sources WHERE updated_at < NOW() - make_interval(days => v.heartbeat_days);
  SELECT count(*) INTO l FROM public.dc_login_audit WHERE created_at < NOW() - make_interval(days => v.login_audit_days);
  RETURN jsonb_build_object(
    'activity_log', jsonb_build_object('rows', a, 'before', NOW() - make_interval(days => v.activity_log_days)),
    'dc_backup_runs', jsonb_build_object('rows', b, 'before', NOW() - make_interval(days => v.backup_run_days)),
    'dc_heartbeat_sources', jsonb_build_object('rows', h, 'before', NOW() - make_interval(days => v.heartbeat_days)),
    'dc_login_audit', jsonb_build_object('rows', l, 'before', NOW() - make_interval(days => v.login_audit_days))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_apply_retention(
  p_table_name TEXT,
  p_before TIMESTAMPTZ,
  p_confirmation TEXT,
  p_verified_backup_sha256 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted BIGINT := 0;
  v_backup_ok BOOLEAN := FALSE;
  v_column TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_table_name NOT IN ('activity_log','dc_backup_runs','dc_heartbeat_sources','dc_login_audit') THEN RAISE EXCEPTION 'Unsupported retention target'; END IF;
  IF p_confirmation <> 'PURGE ' || p_table_name THEN RAISE EXCEPTION 'Typed confirmation does not match'; END IF;
  IF p_before IS NULL OR p_before > NOW() - INTERVAL '24 hours' THEN RAISE EXCEPTION 'Retention cutoff must be at least 24 hours old'; END IF;
  IF p_verified_backup_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'A lowercase SHA-256 from a verified backup is required'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.dc_backup_runs
    WHERE status = 'succeeded' AND archive_sha256 = p_verified_backup_sha256
      AND completed_at > NOW() - INTERVAL '30 days'
  ) INTO v_backup_ok;
  IF NOT v_backup_ok THEN RAISE EXCEPTION 'No matching successful verified backup was recorded in the last 30 days'; END IF;

  v_column := CASE p_table_name WHEN 'dc_backup_runs' THEN 'started_at' WHEN 'dc_heartbeat_sources' THEN 'updated_at' ELSE 'created_at' END;
  EXECUTE format('DELETE FROM public.%I WHERE %I < $1', p_table_name, v_column) USING p_before;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.activity_log (actor_name, action, detail)
  SELECT COALESCE(full_name, email, 'Administrator'), 'retention_purge',
    format('Purged %s row(s) from %s before %s after verified backup %s', v_deleted, p_table_name, p_before, p_verified_backup_sha256)
  FROM public.profiles WHERE id = auth.uid();

  RETURN jsonb_build_object('ok', TRUE, 'table', p_table_name, 'deletedRows', v_deleted, 'cutoff', p_before);
END;
$$;

-- --------------------------------------------------------------------------
-- 6. Consolidated platform health snapshot
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_platform_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_profiles BIGINT := 0;
  v_pending BIGINT := 0;
  v_admins BIGINT := 0;
  v_last_backup public.dc_backup_runs%ROWTYPE;
  v_last_heartbeat TIMESTAMPTZ;
  v_platform public.dc_platform_settings%ROWTYPE;
  v_license public.dc_site_license%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT count(*), count(*) FILTER (WHERE status = 'pending'), count(*) FILTER (WHERE role = 'admin' AND status = 'approved')
    INTO v_profiles, v_pending, v_admins FROM public.profiles;
  SELECT * INTO v_last_backup FROM public.dc_backup_runs ORDER BY started_at DESC LIMIT 1;
  SELECT max(last_ping_at) INTO v_last_heartbeat FROM public.dc_heartbeat_sources;
  SELECT * INTO v_platform FROM public.dc_platform_settings WHERE id = 1;
  SELECT * INTO v_license FROM public.dc_site_license WHERE id = 1;

  RETURN jsonb_build_object(
    'ok', TRUE, 'schemaVersion', v_platform.schema_version, 'checkedAt', NOW(),
    'database', jsonb_build_object('reachable', TRUE),
    'members', jsonb_build_object('total', v_profiles, 'pending', v_pending, 'approvedAdmins', v_admins),
    'security', jsonb_build_object('lockdownEnabled', v_platform.lockdown_enabled, 'idleTimeoutMinutes', v_platform.idle_timeout_minutes),
    'license', jsonb_build_object('model', v_license.license_model, 'status', v_license.license_status, 'expiresOn', v_license.expires_on),
    'heartbeat', jsonb_build_object('lastPingAt', v_last_heartbeat),
    'backup', CASE WHEN v_last_backup.id IS NULL THEN jsonb_build_object('status', 'never') ELSE jsonb_build_object(
      'status', v_last_backup.status, 'destination', v_last_backup.destination,
      'startedAt', v_last_backup.started_at, 'completedAt', v_last_backup.completed_at,
      'sha256', v_last_backup.archive_sha256
    ) END
  );
END;
$$;

-- Storage operators: approved administrators can manage application buckets.
DROP POLICY IF EXISTS avatars_admin_manage ON storage.objects;
CREATE POLICY avatars_admin_manage ON storage.objects FOR ALL
  USING (bucket_id = 'avatars' AND public.is_admin())
  WITH CHECK (bucket_id = 'avatars' AND public.is_admin());
DROP POLICY IF EXISTS gallery_admin_manage ON storage.objects;
CREATE POLICY gallery_admin_manage ON storage.objects FOR ALL
  USING (bucket_id = 'gallery' AND public.is_admin())
  WITH CHECK (bucket_id = 'gallery' AND public.is_admin());

-- --------------------------------------------------------------------------
-- 7. Function privileges (deny anonymous/public execution explicitly)
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dc_access_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_record_login_event(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_update_platform_settings(BOOLEAN, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_update_retention_settings(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_list_member_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_update_member_access(UUID, TEXT, TEXT, TEXT, BOOLEAN, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_update_site_license(TEXT, TEXT, TEXT, TEXT, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_storage_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_retention_preview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_apply_retention(TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_platform_health() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dc_access_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_record_login_event(TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_update_platform_settings(BOOLEAN, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_update_retention_settings(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_list_member_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_update_member_access(UUID, TEXT, TEXT, TEXT, BOOLEAN, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_update_site_license(TEXT, TEXT, TEXT, TEXT, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_storage_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_retention_preview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_apply_retention(TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_platform_health() TO authenticated;

COMMIT;
