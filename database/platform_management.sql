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
-- Record the schema the application expects, so Platform Health, the Schema
-- Doctor and the Fleet Console all report the same number.
UPDATE public.dc_platform_settings SET schema_version = '14.2', updated_at = NOW()
 WHERE id = 1 AND schema_version <> '14.2';

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
  -- NULL means "keep the current value": retention is owned by the Storage Manager, so
  -- Platform Health saves security state without supplying it.
  IF p_login_audit_retention_days IS NOT NULL AND p_login_audit_retention_days NOT BETWEEN 7 AND 730 THEN RAISE EXCEPTION 'Login audit retention must be between 7 and 730 days'; END IF;

  UPDATE public.dc_platform_settings SET
    lockdown_enabled = COALESCE(p_lockdown_enabled, FALSE),
    lockdown_message = left(COALESCE(NULLIF(btrim(p_lockdown_message), ''), 'DramaConnect is temporarily in maintenance mode.'), 500),
    idle_timeout_minutes = p_idle_timeout_minutes,
    login_audit_retention_days = COALESCE(p_login_audit_retention_days, login_audit_retention_days),
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1 RETURNING * INTO v_row;

  -- Retention has ONE owner: public.dc_retention_settings (edited on the Storage Manager
  -- page). dc_retention_preview()/dc_apply_retention() read login_audit_days from there,
  -- so a value written only to dc_platform_settings would silently do nothing. Mirror it
  -- to keep the two tables consistent for any caller that still supplies this argument.
  UPDATE public.dc_retention_settings SET
    login_audit_days = greatest(7, least(730, p_login_audit_retention_days)),
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1 AND p_login_audit_retention_days IS NOT NULL;

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
  SELECT COALESCE(NULLIF(btrim(full_name), ''), email, 'Administrator'), 'retention_purge',
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

-- ============================================================================
-- ITEM 21 — Organisation settings, venue geofence, HMG Fleet Console licence
-- endpoint, department analytics, table sizes, login-audit report and the
-- Archive Vault (export -> verify upload -> purge -> restore).
-- Every object here is idempotent and safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Organisation-wide settings (single row). Read by every approved member
--    because attendance (call time, geofence), the sidebar (module access) and
--    the assistant honour them. Written only through dc_update_org_settings.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_org_settings (
  id                      INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_language        TEXT NOT NULL DEFAULT 'en',
  timezone                TEXT NOT NULL DEFAULT 'Africa/Lagos',
  call_time               TIME NOT NULL DEFAULT '16:00',
  late_after_minutes      INTEGER NOT NULL DEFAULT 15,
  geofence_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  geofence_lat            DOUBLE PRECISION,
  geofence_lng            DOUBLE PRECISION,
  geofence_radius_m       INTEGER NOT NULL DEFAULT 150,
  geofence_max_accuracy_m INTEGER NOT NULL DEFAULT 200,
  venue_name              TEXT,
  disabled_modules        TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  require_admin_mfa       BOOLEAN NOT NULL DEFAULT FALSE,
  assistant_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  high_contrast_default   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
-- Columns added after first release are declared again so older installs heal.
ALTER TABLE public.dc_org_settings ADD COLUMN IF NOT EXISTS venue_name TEXT;
ALTER TABLE public.dc_org_settings ADD COLUMN IF NOT EXISTS high_contrast_default BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  ALTER TABLE public.dc_org_settings ADD CONSTRAINT dc_org_settings_language
    CHECK (default_language IN ('en','yo','ig','ha','pcm','fr'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.dc_org_settings ADD CONSTRAINT dc_org_settings_ranges CHECK (
    late_after_minutes BETWEEN 0 AND 240
    AND geofence_radius_m BETWEEN 20 AND 5000
    AND geofence_max_accuracy_m BETWEEN 10 AND 5000
    AND (geofence_lat IS NULL OR geofence_lat BETWEEN -90 AND 90)
    AND (geofence_lng IS NULL OR geofence_lng BETWEEN -180 AND 180)
    AND (NOT geofence_enabled OR (geofence_lat IS NOT NULL AND geofence_lng IS NOT NULL))
    AND (venue_name IS NULL OR char_length(venue_name) <= 120)
    AND cardinality(disabled_modules) <= 60
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.dc_org_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dc_org_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dc_org_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dc_org_settings TO authenticated;
DROP POLICY IF EXISTS "Approved members read organisation settings" ON public.dc_org_settings;
CREATE POLICY "Approved members read organisation settings"
  ON public.dc_org_settings FOR SELECT TO authenticated
  USING (public.is_approved_member());

CREATE OR REPLACE FUNCTION public.dc_update_org_settings(p_settings JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.dc_org_settings%ROWTYPE;
  v_new public.dc_org_settings%ROWTYPE;
  v_modules TEXT[];
  v_protected CONSTANT TEXT[] := ARRAY['home','profile','help','settings','admin-data','storage-manager',
    'platform-health','roles-status','site-license','activity'];
  v_actor TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN RAISE EXCEPTION 'Settings must be a JSON object'; END IF;

  SELECT * INTO v_old FROM public.dc_org_settings WHERE id = 1 FOR UPDATE;
  v_new := v_old;

  IF p_settings ? 'default_language' THEN v_new.default_language := p_settings->>'default_language'; END IF;
  IF p_settings ? 'timezone' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_settings->>'timezone') THEN
      RAISE EXCEPTION 'Unknown time zone: %', p_settings->>'timezone' USING ERRCODE = '22023';
    END IF;
    v_new.timezone := p_settings->>'timezone';
  END IF;
  IF p_settings ? 'call_time' THEN v_new.call_time := (p_settings->>'call_time')::TIME; END IF;
  IF p_settings ? 'late_after_minutes' THEN v_new.late_after_minutes := (p_settings->>'late_after_minutes')::INTEGER; END IF;
  IF p_settings ? 'geofence_enabled' THEN v_new.geofence_enabled := (p_settings->>'geofence_enabled')::BOOLEAN; END IF;
  IF p_settings ? 'geofence_lat' THEN v_new.geofence_lat := nullif(p_settings->>'geofence_lat', '')::DOUBLE PRECISION; END IF;
  IF p_settings ? 'geofence_lng' THEN v_new.geofence_lng := nullif(p_settings->>'geofence_lng', '')::DOUBLE PRECISION; END IF;
  IF p_settings ? 'geofence_radius_m' THEN v_new.geofence_radius_m := (p_settings->>'geofence_radius_m')::INTEGER; END IF;
  IF p_settings ? 'geofence_max_accuracy_m' THEN v_new.geofence_max_accuracy_m := (p_settings->>'geofence_max_accuracy_m')::INTEGER; END IF;
  IF p_settings ? 'venue_name' THEN v_new.venue_name := nullif(btrim(p_settings->>'venue_name'), ''); END IF;
  IF p_settings ? 'require_admin_mfa' THEN v_new.require_admin_mfa := (p_settings->>'require_admin_mfa')::BOOLEAN; END IF;
  IF p_settings ? 'assistant_enabled' THEN v_new.assistant_enabled := (p_settings->>'assistant_enabled')::BOOLEAN; END IF;
  IF p_settings ? 'high_contrast_default' THEN v_new.high_contrast_default := (p_settings->>'high_contrast_default')::BOOLEAN; END IF;
  IF p_settings ? 'disabled_modules' THEN
    IF jsonb_typeof(p_settings->'disabled_modules') <> 'array' THEN RAISE EXCEPTION 'disabled_modules must be an array'; END IF;
    SELECT COALESCE(array_agg(DISTINCT m ORDER BY m), '{}'::TEXT[]) INTO v_modules
    FROM jsonb_array_elements_text(p_settings->'disabled_modules') AS m;
    IF EXISTS (SELECT 1 FROM unnest(v_modules) m WHERE m !~ '^[a-z0-9-]{2,30}$') THEN
      RAISE EXCEPTION 'Invalid module identifier' USING ERRCODE = '22023';
    END IF;
    IF v_modules && v_protected THEN
      RAISE EXCEPTION 'Core administration modules cannot be disabled' USING ERRCODE = '22023';
    END IF;
    v_new.disabled_modules := v_modules;
  END IF;

  UPDATE public.dc_org_settings SET
    default_language = v_new.default_language, timezone = v_new.timezone,
    call_time = v_new.call_time, late_after_minutes = v_new.late_after_minutes,
    geofence_enabled = v_new.geofence_enabled, geofence_lat = v_new.geofence_lat,
    geofence_lng = v_new.geofence_lng, geofence_radius_m = v_new.geofence_radius_m,
    geofence_max_accuracy_m = v_new.geofence_max_accuracy_m, venue_name = v_new.venue_name,
    disabled_modules = v_new.disabled_modules, require_admin_mfa = v_new.require_admin_mfa,
    assistant_enabled = v_new.assistant_enabled, high_contrast_default = v_new.high_contrast_default,
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO v_new;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), email, 'Administrator') INTO v_actor FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.activity_log (actor_name, action, detail)
  VALUES (v_actor, 'org_settings_updated', left(p_settings::TEXT, 900));

  IF v_new.require_admin_mfa IS DISTINCT FROM v_old.require_admin_mfa
     OR v_new.geofence_enabled IS DISTINCT FROM v_old.geofence_enabled
     OR v_new.disabled_modules IS DISTINCT FROM v_old.disabled_modules THEN
    INSERT INTO public.dc_login_audit (user_id, email, event_type, metadata)
    SELECT id, email, 'security_changed', jsonb_build_object(
      'requireAdminMfa', v_new.require_admin_mfa, 'geofence', v_new.geofence_enabled,
      'disabledModules', to_jsonb(v_new.disabled_modules))
    FROM public.profiles WHERE id = auth.uid();
  END IF;

  RETURN to_jsonb(v_new);
END;
$$;

-- ---------------------------------------------------------------------------
-- B. Venue geofence for self check-in. The original self_check_in(uuid,text)
--    refuses when the geofence is on unless this verifier has run first in the
--    same transaction, so an old client cannot bypass the fence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_distance_m(
  p_lat1 DOUBLE PRECISION, p_lng1 DOUBLE PRECISION,
  p_lat2 DOUBLE PRECISION, p_lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )));
$$;

CREATE OR REPLACE FUNCTION public.dc_self_check_in_geo(
  p_rehearsal_id UUID,
  p_code TEXT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_accuracy DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.dc_org_settings%ROWTYPE;
  v_distance DOUBLE PRECISION;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.dc_org_settings WHERE id = 1;

  IF COALESCE(s.geofence_enabled, FALSE) THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      RAISE EXCEPTION 'Location is required: allow location access to check in at the venue' USING ERRCODE = '22023';
    END IF;
    IF p_accuracy IS NOT NULL AND p_accuracy > s.geofence_max_accuracy_m THEN
      RAISE EXCEPTION 'Your location is too imprecise (±% m). Move near a window or enable GPS, then retry', round(p_accuracy::numeric)
        USING ERRCODE = '22023';
    END IF;
    v_distance := public.dc_distance_m(p_lat, p_lng, s.geofence_lat, s.geofence_lng);
    -- Tolerate the reported GPS error, capped at the radius itself.
    IF v_distance > s.geofence_radius_m + least(COALESCE(p_accuracy, 0), s.geofence_radius_m) THEN
      RAISE EXCEPTION 'You appear to be % m from %. Self check-in works within % m of the venue',
        round(v_distance::numeric), COALESCE(s.venue_name, 'the rehearsal venue'), s.geofence_radius_m
        USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('dc.geo_verified', 'on', true);
  END IF;

  PERFORM public.self_check_in(p_rehearsal_id, p_code);
  PERFORM set_config('dc.geo_verified', '', true);

  RETURN jsonb_build_object('ok', TRUE, 'geofence', COALESCE(s.geofence_enabled, FALSE),
    'distanceM', CASE WHEN v_distance IS NULL THEN NULL ELSE round(v_distance::numeric) END);
END;
$$;

-- ---------------------------------------------------------------------------
-- C. HMG Fleet Console licence endpoint (anon). Same effective-status logic as
--    dc_access_state; exposes no names, emails or URLs.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sc_license_status();
CREATE FUNCTION public.sc_license_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  l public.dc_site_license%ROWTYPE;
  v_status TEXT;
BEGIN
  SELECT * INTO l FROM public.dc_site_license WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'unknown', 'status', 'unknown', 'product', 'dramaconnect');
  END IF;
  IF l.license_model = 'lifetime' THEN
    v_status := CASE WHEN l.license_status = 'active' THEN 'lifetime' ELSE l.license_status END;
  ELSE
    v_status := CASE
      WHEN l.license_status IN ('suspended', 'expired') THEN l.license_status
      WHEN CURRENT_DATE <= l.expires_on THEN 'active'
      WHEN CURRENT_DATE <= (l.expires_on + l.grace_days) THEN 'grace'
      ELSE 'expired'
    END;
  END IF;
  RETURN jsonb_build_object(
    'state', v_status,
    'status', v_status,
    'product', 'dramaconnect',
    'model', l.license_model,
    'plan', l.plan_name,
    'expires_on', l.expires_on,
    'grace_days', l.grace_days,
    'days_left', CASE WHEN l.expires_on IS NULL THEN NULL ELSE (l.expires_on - CURRENT_DATE) END,
    'checked_at', NOW()
  );
END;
$$;
COMMENT ON FUNCTION public.sc_license_status() IS
  'HMG Fleet Console licence probe (anon). state: lifetime|active|grace|expired|suspended|past_due.';

-- ---------------------------------------------------------------------------
-- D. Department analytics. One round-trip; admins and unit leaders receive the
--    member-level lists; finance is included for administrators only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_analytics_overview(p_months INTEGER DEFAULT 12)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin BOOLEAN := public.is_admin();
  v_manager BOOLEAN := public.is_gallery_manager();
  v_months INTEGER := greatest(3, least(COALESCE(p_months, 12), 36));
  v_tz TEXT;
  v_call TIME;
  v_late INTEGER;
  v_from DATE;
  v_out JSONB;
BEGIN
  IF NOT v_manager THEN RAISE EXCEPTION 'Administrator or unit-leader access required' USING ERRCODE = '42501'; END IF;
  SELECT timezone, call_time, late_after_minutes INTO v_tz, v_call, v_late FROM public.dc_org_settings WHERE id = 1;
  v_tz := COALESCE(v_tz, 'Africa/Lagos'); v_call := COALESCE(v_call, '16:00'); v_late := COALESCE(v_late, 15);
  v_from := (date_trunc('month', CURRENT_DATE) - make_interval(months => v_months - 1))::DATE;

  WITH approved AS (
    SELECT p.* FROM public.profiles p WHERE p.status = 'approved'
  ),
  sess AS (
    SELECT r.id, r.rehearsal_date FROM public.rehearsals r WHERE r.rehearsal_date <= CURRENT_DATE
  ),
  -- Expected attendance counts only sessions held after a member joined.
  member_stats AS (
    SELECT a.id, COALESCE(NULLIF(btrim(a.full_name), ''), a.email, 'Member') AS name, a.unit, a.gender, a.role,
      (SELECT count(*) FROM sess s WHERE s.rehearsal_date >= a.created_at::DATE) AS expected,
      (SELECT count(*) FROM public.attendance t JOIN sess s ON s.id = t.rehearsal_id
        WHERE t.member_id = a.id AND t.status = 'present') AS present,
      (SELECT count(*) FROM public.attendance t JOIN sess s ON s.id = t.rehearsal_id
        WHERE t.member_id = a.id AND t.status = 'excused') AS excused,
      (SELECT max(s.rehearsal_date) FROM public.attendance t JOIN sess s ON s.id = t.rehearsal_id
        WHERE t.member_id = a.id AND t.status = 'present') AS last_present,
      -- consecutive most-recent sessions missed (not present, not excused)
      (SELECT count(*) FROM sess s
        WHERE s.rehearsal_date >= a.created_at::DATE
          AND s.rehearsal_date > COALESCE((SELECT max(s2.rehearsal_date) FROM public.attendance t2
                JOIN sess s2 ON s2.id = t2.rehearsal_id
                WHERE t2.member_id = a.id AND t2.status IN ('present','excused')), '-infinity'::DATE)) AS missed_streak
    FROM approved a
  ),
  months AS (
    SELECT generate_series(v_from, date_trunc('month', CURRENT_DATE)::DATE, interval '1 month')::DATE AS m
  )
  SELECT jsonb_build_object(
    'generatedAt', NOW(),
    'months', v_months,
    'isAdmin', v_admin,
    'settings', jsonb_build_object('timezone', v_tz, 'callTime', v_call, 'lateAfterMinutes', v_late),
    'kpis', jsonb_build_object(
      'membersApproved', (SELECT count(*) FROM approved),
      'membersPending', (SELECT count(*) FROM public.profiles WHERE status = 'pending'),
      'admins', (SELECT count(*) FROM approved WHERE role = 'admin'),
      'unitLeaders', (SELECT count(*) FROM approved WHERE is_unit_leader IS TRUE),
      'newMembers30d', (SELECT count(*) FROM public.profiles WHERE created_at >= NOW() - interval '30 days'),
      'rehearsalsTotal', (SELECT count(*) FROM sess),
      'rehearsals30d', (SELECT count(*) FROM sess WHERE rehearsal_date >= CURRENT_DATE - 30),
      'rehearsalsUpcoming', (SELECT count(*) FROM public.rehearsals WHERE rehearsal_date > CURRENT_DATE),
      'attendanceRate30d', (SELECT round(100.0 * count(*) FILTER (WHERE t.status = 'present')
                              / NULLIF((SELECT sum(1) FROM sess s2 CROSS JOIN approved a2
                                        WHERE s2.rehearsal_date >= CURRENT_DATE - 30 AND s2.rehearsal_date >= a2.created_at::DATE), 0), 1)
                            FROM public.attendance t JOIN sess s ON s.id = t.rehearsal_id
                            JOIN approved a ON a.id = t.member_id
                            WHERE s.rehearsal_date >= CURRENT_DATE - 30),
      'attendanceRateAll', (SELECT round(100.0 * sum(present) / NULLIF(sum(expected), 0), 1) FROM member_stats),
      'eventsUpcoming', (SELECT count(*) FROM public.events WHERE event_date >= NOW()),
      'productionsUpcoming', (SELECT count(*) FROM public.productions WHERE performance_date >= CURRENT_DATE),
      'programmesOpen', (SELECT count(*) FROM public.dc_programs WHERE status = 'open'),
      'registrations', (SELECT count(*) FROM public.dc_program_registrations WHERE status <> 'cancelled'),
      'checkedIn', (SELECT count(*) FROM public.dc_program_registrations WHERE checked_in_at IS NOT NULL),
      'tasksOpen', (SELECT count(*) FROM public.tasks WHERE COALESCE(status, 'open') <> 'done'),
      'tasksOverdue', (SELECT count(*) FROM public.tasks WHERE COALESCE(status, 'open') <> 'done' AND due_date < CURRENT_DATE),
      'careOpen', (SELECT count(*) FROM public.dc_care_cases WHERE status <> 'resolved'),
      'cardsActive', (SELECT count(*) FROM public.dc_member_cards WHERE revoked_at IS NULL AND expires_at > NOW()),
      'suggestionsNew', (SELECT count(*) FROM public.suggestions WHERE COALESCE(status, 'new') = 'new'),
      'birthdaysThisMonth', (SELECT count(*) FROM approved WHERE birth_month = extract(month FROM CURRENT_DATE)::INT),
      'income', CASE WHEN v_admin THEN (SELECT COALESCE(sum(amount), 0) FROM public.finances WHERE type = 'income' AND date >= v_from) END,
      'expense', CASE WHEN v_admin THEN (SELECT COALESCE(sum(amount), 0) FROM public.finances WHERE type = 'expense' AND date >= v_from) END
    ),
    'monthly', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'month', to_char(mo.m, 'YYYY-MM'),
        'newMembers', (SELECT count(*) FROM public.profiles p WHERE date_trunc('month', p.created_at)::DATE = mo.m),
        'totalMembers', (SELECT count(*) FROM approved a WHERE a.created_at < (mo.m + interval '1 month')),
        'rehearsals', (SELECT count(*) FROM sess s WHERE date_trunc('month', s.rehearsal_date)::DATE = mo.m),
        'present', (SELECT count(*) FROM public.attendance t JOIN sess s ON s.id = t.rehearsal_id
                    WHERE t.status = 'present' AND date_trunc('month', s.rehearsal_date)::DATE = mo.m),
        'expected', (SELECT count(*) FROM sess s CROSS JOIN approved a
                     WHERE date_trunc('month', s.rehearsal_date)::DATE = mo.m AND s.rehearsal_date >= a.created_at::DATE),
        'registrations', (SELECT count(*) FROM public.dc_program_registrations g
                          WHERE g.status <> 'cancelled' AND date_trunc('month', g.created_at)::DATE = mo.m),
        'income', CASE WHEN v_admin THEN (SELECT COALESCE(sum(amount), 0) FROM public.finances f
                          WHERE f.type = 'income' AND date_trunc('month', f.date)::DATE = mo.m) END,
        'expense', CASE WHEN v_admin THEN (SELECT COALESCE(sum(amount), 0) FROM public.finances f
                          WHERE f.type = 'expense' AND date_trunc('month', f.date)::DATE = mo.m) END
      ) ORDER BY mo.m), '[]'::JSONB) FROM months mo),
    'recentRehearsals', (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'date' DESC), '[]'::JSONB) FROM (
        SELECT jsonb_build_object(
          'date', s.rehearsal_date,
          'present', count(*) FILTER (WHERE t.status = 'present'),
          'excused', count(*) FILTER (WHERE t.status = 'excused'),
          'absent', count(*) FILTER (WHERE t.status = 'absent'),
          'eligible', (SELECT count(*) FROM approved a WHERE a.created_at::DATE <= s.rehearsal_date)
        ) AS x
        FROM sess s LEFT JOIN public.attendance t ON t.rehearsal_id = s.id
        GROUP BY s.id, s.rehearsal_date ORDER BY s.rehearsal_date DESC LIMIT 12) q),
    'byUnit', (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit', u, 'members', n,
                 'rate', CASE WHEN e > 0 THEN round(100.0 * pr / e, 1) END) ORDER BY n DESC), '[]'::JSONB)
               FROM (SELECT COALESCE(NULLIF(btrim(unit), ''), 'Unassigned') AS u, count(*) n,
                            sum(present) pr, sum(expected) e FROM member_stats GROUP BY 1) q),
    'byRole', jsonb_build_object(
      'admin', (SELECT count(*) FROM approved WHERE role = 'admin'),
      'unitLeader', (SELECT count(*) FROM approved WHERE role <> 'admin' AND is_unit_leader IS TRUE),
      'member', (SELECT count(*) FROM approved WHERE role <> 'admin' AND is_unit_leader IS NOT TRUE)),
    'gender', (SELECT COALESCE(jsonb_object_agg(g, n), '{}'::JSONB) FROM (
        SELECT COALESCE(NULLIF(lower(btrim(gender)), ''), 'unspecified') g, count(*) n FROM approved GROUP BY 1) q),
    'parishes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('parish', p, 'members', n) ORDER BY n DESC), '[]'::JSONB)
                 FROM (SELECT COALESCE(NULLIF(btrim(parish), ''), 'Not set') p, count(*) n FROM approved GROUP BY 1 ORDER BY 2 DESC LIMIT 10) q),
    'birthdays', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', COALESCE(NULLIF(btrim(full_name), ''), 'Member'), 'day', birth_day, 'unit', unit)
                   ORDER BY birth_day), '[]'::JSONB)
                  FROM approved WHERE birth_month = extract(month FROM CURRENT_DATE)::INT),
    -- Punctuality: self check-in timestamps on the rehearsal's local day vs call time.
    'punctuality', (SELECT jsonb_build_object(
        'measured', count(*),
        'onTime', count(*) FILTER (WHERE (t.marked_at AT TIME ZONE v_tz)::TIME <= v_call + make_interval(mins => v_late)),
        'late', count(*) FILTER (WHERE (t.marked_at AT TIME ZONE v_tz)::TIME > v_call + make_interval(mins => v_late)),
        'byHour', (SELECT COALESCE(jsonb_object_agg(h, n), '{}'::JSONB) FROM (
            SELECT extract(hour FROM t2.marked_at AT TIME ZONE v_tz)::INT h, count(*) n
            FROM public.attendance t2 JOIN sess s2 ON s2.id = t2.rehearsal_id
            WHERE t2.status = 'present' AND (t2.marked_at AT TIME ZONE v_tz)::DATE = s2.rehearsal_date
              AND s2.rehearsal_date >= v_from GROUP BY 1) hq))
      FROM public.attendance t JOIN sess s ON s.id = t.rehearsal_id
      WHERE t.status = 'present' AND (t.marked_at AT TIME ZONE v_tz)::DATE = s.rehearsal_date AND s.rehearsal_date >= v_from),
    -- Full per-member breakdown (the Attendance tab table). Managers only, so
    -- it is safe here; the browser never sees it as a bare table read.
    'members', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit,
                     'present', present, 'excused', excused, 'expected', expected,
                     'rate', round(100.0 * present / NULLIF(expected, 0), 1)) ORDER BY name), '[]'::JSONB)
                 FROM member_stats),
    'topMembers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'unit', unit, 'present', present,
                     'expected', expected, 'rate', round(100.0 * present / expected, 1)) ORDER BY 100.0 * present / expected DESC, present DESC), '[]'::JSONB)
                   FROM (SELECT * FROM member_stats WHERE expected >= 3 ORDER BY 100.0 * present / expected DESC, present DESC LIMIT 10) q),
    'atRisk', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'present', present,
                 'expected', expected, 'rate', round(100.0 * present / NULLIF(expected, 0), 1),
                 'missedStreak', missed_streak, 'lastPresent', last_present) ORDER BY missed_streak DESC, present), '[]'::JSONB)
               FROM (SELECT * FROM member_stats WHERE expected >= 3
                       AND (missed_streak >= 3 OR 100.0 * present / NULLIF(expected, 0) < 50)
                     ORDER BY missed_streak DESC, present LIMIT 15) q),
    'programmes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('title', title, 'status', status, 'startsAt', starts_at,
                     'capacity', capacity, 'registered', reg, 'checkedIn', chk, 'firstTimers', ft, 'rating', rating) ORDER BY starts_at DESC), '[]'::JSONB)
                   FROM (SELECT pr.title, pr.status, pr.starts_at, pr.capacity,
                           count(g.*) FILTER (WHERE g.status <> 'cancelled') reg,
                           count(g.*) FILTER (WHERE g.checked_in_at IS NOT NULL) chk,
                           count(g.*) FILTER (WHERE g.is_first_timer) ft,
                           round(avg(g.feedback_rating), 2) rating
                         FROM public.dc_programs pr LEFT JOIN public.dc_program_registrations g ON g.program_id = pr.id
                         GROUP BY pr.id ORDER BY pr.starts_at DESC LIMIT 10) q),
    'registrationSources', (SELECT COALESCE(jsonb_object_agg(source, n), '{}'::JSONB) FROM (
        SELECT source, count(*) n FROM public.dc_program_registrations WHERE status <> 'cancelled' GROUP BY 1) q),
    'care', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::JSONB) FROM (
        SELECT status, count(*) n FROM public.dc_care_cases GROUP BY 1) q),
    'tasks', (SELECT COALESCE(jsonb_object_agg(st, n), '{}'::JSONB) FROM (
        SELECT COALESCE(status, 'open') st, count(*) n FROM public.tasks GROUP BY 1) q),
    'eventRsvps', (SELECT COALESCE(jsonb_object_agg(r, n), '{}'::JSONB) FROM (
        SELECT COALESCE(v.response, 'going') r, count(*) n FROM public.event_rsvps v
        JOIN public.events e ON e.id = v.event_id WHERE e.event_date >= NOW() GROUP BY 1) q)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- E. Table sizes (Storage Manager) — exact row counts for every public table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_table_sizes()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_rows BIGINT;
  v_oldest TIMESTAMPTZ;
  v_col TEXT;
  v_out JSONB := '[]'::JSONB;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  FOR r IN
    SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO v_rows;
    SELECT a.attname INTO v_col FROM pg_attribute a
     WHERE a.attrelid = r.oid AND NOT a.attisdropped
       AND a.attname IN ('created_at', 'marked_at', 'started_at', 'last_ping_at', 'pinged_at')
     ORDER BY array_position(ARRAY['created_at','marked_at','started_at','last_ping_at','pinged_at']::NAME[], a.attname) LIMIT 1;
    v_oldest := NULL;
    IF v_col IS NOT NULL THEN
      EXECUTE format('SELECT min(%I)::timestamptz FROM public.%I', v_col, r.relname) INTO v_oldest;
    END IF;
    v_out := v_out || jsonb_build_object(
      'table', r.relname, 'rows', v_rows,
      'bytes', pg_total_relation_size(r.oid),
      'tableBytes', pg_relation_size(r.oid),
      'indexBytes', pg_indexes_size(r.oid),
      'dateColumn', v_col, 'oldest', v_oldest);
  END LOOP;
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- F. Login audit report — who signed in, from which device, with summary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_login_audit_report(
  p_days INTEGER DEFAULT 30,
  p_limit INTEGER DEFAULT 200,
  p_event TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - make_interval(days => greatest(1, least(COALESCE(p_days, 30), 730)));
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'since', v_since,
    'summary', jsonb_build_object(
      'signIns24h', (SELECT count(*) FROM public.dc_login_audit WHERE event_type = 'sign_in' AND created_at >= NOW() - interval '24 hours'),
      'signIns7d', (SELECT count(*) FROM public.dc_login_audit WHERE event_type = 'sign_in' AND created_at >= NOW() - interval '7 days'),
      'uniqueUsers7d', (SELECT count(DISTINCT user_id) FROM public.dc_login_audit WHERE event_type = 'sign_in' AND created_at >= NOW() - interval '7 days'),
      'denied', (SELECT count(*) FROM public.dc_login_audit WHERE event_type IN ('lockdown_denied','license_denied') AND created_at >= v_since),
      'idleTimeouts', (SELECT count(*) FROM public.dc_login_audit WHERE event_type = 'idle_timeout' AND created_at >= v_since),
      'securityChanges', (SELECT count(*) FROM public.dc_login_audit WHERE event_type IN ('security_changed','access_changed') AND created_at >= v_since),
      'byEvent', (SELECT COALESCE(jsonb_object_agg(event_type, n), '{}'::JSONB) FROM (
          SELECT event_type, count(*) n FROM public.dc_login_audit WHERE created_at >= v_since GROUP BY 1) q)
    ),
    'neverSignedIn', (SELECT count(*) FROM public.profiles p WHERE p.status = 'approved'
                       AND NOT EXISTS (SELECT 1 FROM public.dc_login_audit l WHERE l.user_id = p.id AND l.event_type = 'sign_in')),
    'rows', (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'createdAt' DESC), '[]'::JSONB) FROM (
        SELECT jsonb_build_object(
          'id', l.id, 'createdAt', l.created_at, 'event', l.event_type,
          'email', l.email, 'name', COALESCE(NULLIF(btrim(p.full_name), ''), l.email, 'Unknown'),
          'role', p.role, 'unit', p.unit, 'userAgent', l.user_agent, 'metadata', l.metadata) AS x
        FROM public.dc_login_audit l LEFT JOIN public.profiles p ON p.id = l.user_id
        WHERE l.created_at >= v_since AND (p_event IS NULL OR p_event = '' OR l.event_type = p_event)
        ORDER BY l.created_at DESC
        LIMIT greatest(1, least(COALESCE(p_limit, 200), 1000))) q)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- F. Activity feed — the operational audit trail with server-side filtering,
--    a summary and the distinct action list used by the Activity Log page.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_activity_feed(
  p_days INTEGER DEFAULT 90,
  p_limit INTEGER DEFAULT 300,
  p_action TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_actor TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_days INTEGER := greatest(1, least(COALESCE(p_days, 90), 3650));
  v_limit INTEGER := greatest(1, least(COALESCE(p_limit, 300), 1000));
  v_since TIMESTAMPTZ := NOW() - make_interval(days => v_days);
  v_search TEXT := nullif(btrim(COALESCE(p_search, '')), '');
  v_action TEXT := nullif(btrim(COALESCE(p_action, '')), '');
  v_actor TEXT := nullif(btrim(COALESCE(p_actor, '')), '');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;

  RETURN jsonb_build_object(
    'since', v_since,
    'days', v_days,
    'summary', jsonb_build_object(
      'total', (SELECT count(*) FROM public.activity_log WHERE created_at >= v_since),
      'today', (SELECT count(*) FROM public.activity_log WHERE created_at >= date_trunc('day', NOW())),
      'week', (SELECT count(*) FROM public.activity_log WHERE created_at >= NOW() - interval '7 days'),
      'purges', (SELECT count(*) FROM public.activity_log WHERE action IN ('retention_purge','archive_vault_purge') AND created_at >= v_since),
      'oldest', (SELECT min(created_at) FROM public.activity_log),
      'byAction', (SELECT COALESCE(jsonb_object_agg(action, n), '{}'::JSONB) FROM (
          SELECT COALESCE(NULLIF(btrim(action), ''), 'unknown') AS action, count(*) AS n
          FROM public.activity_log WHERE created_at >= v_since GROUP BY 1 ORDER BY 2 DESC LIMIT 40) q),
      'topActors', (SELECT COALESCE(jsonb_agg(jsonb_build_object('actor', actor, 'entries', n) ORDER BY n DESC), '[]'::JSONB) FROM (
          SELECT COALESCE(NULLIF(btrim(actor_name), ''), 'system') AS actor, count(*) AS n
          FROM public.activity_log WHERE created_at >= v_since GROUP BY 1 ORDER BY 2 DESC LIMIT 10) q)
    ),
    'actions', (SELECT COALESCE(jsonb_agg(action ORDER BY action), '[]'::JSONB) FROM (
        SELECT DISTINCT COALESCE(NULLIF(btrim(action), ''), 'unknown') AS action FROM public.activity_log) q),
    'actors', (SELECT COALESCE(jsonb_agg(actor ORDER BY actor), '[]'::JSONB) FROM (
        SELECT DISTINCT COALESCE(NULLIF(btrim(actor_name), ''), 'system') AS actor FROM public.activity_log) q),
    'rows', (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'createdAt' DESC), '[]'::JSONB) FROM (
        SELECT jsonb_build_object('id', l.id, 'createdAt', l.created_at,
          'actor', COALESCE(NULLIF(btrim(l.actor_name), ''), 'system'),
          'action', COALESCE(NULLIF(btrim(l.action), ''), 'unknown'),
          'detail', l.detail) AS x
        FROM public.activity_log l
        WHERE l.created_at >= v_since
          AND (v_action IS NULL OR COALESCE(l.action, 'unknown') = v_action)
          AND (v_actor IS NULL OR COALESCE(NULLIF(btrim(l.actor_name), ''), 'system') = v_actor)
          AND (v_search IS NULL OR COALESCE(l.action, '') ILIKE '%' || v_search || '%'
               OR COALESCE(l.detail, '') ILIKE '%' || v_search || '%'
               OR COALESCE(l.actor_name, '') ILIKE '%' || v_search || '%')
        ORDER BY l.created_at DESC LIMIT v_limit) q)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.dc_activity_feed(INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dc_activity_feed(INTEGER, INTEGER, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- G. Archive Vault. Old rows are exported by the browser to the PRIVATE
--    dramaconnect-backups bucket (archive-vault/<table>/...json), then this RPC
--    verifies the object exists, that the row count still matches, and only
--    then deletes. Restores re-insert rows without overwriting newer ones.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_archive_vault (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   TEXT NOT NULL,
  object_path  TEXT NOT NULL UNIQUE,
  sha256       TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  row_count    INTEGER NOT NULL CHECK (row_count >= 0),
  cutoff       TIMESTAMPTZ NOT NULL,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at  TIMESTAMPTZ,
  restored_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  restored_rows INTEGER
);
ALTER TABLE public.dc_archive_vault ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dc_archive_vault FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dc_archive_vault TO authenticated;
DROP POLICY IF EXISTS "Admins read the archive vault" ON public.dc_archive_vault;
CREATE POLICY "Admins read the archive vault" ON public.dc_archive_vault
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.dc_archive_targets()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '{"activity_log":"created_at","dc_login_audit":"created_at","attendance":"marked_at",
           "messages":"created_at","inbox":"created_at","announcements":"created_at",
           "suggestions":"created_at","event_rsvps":"created_at","poll_votes":"created_at",
           "dc_program_registrations":"created_at","dc_backup_runs":"started_at"}'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.dc_archive_purge(
  p_table TEXT,
  p_before TIMESTAMPTZ,
  p_object_path TEXT,
  p_sha256 TEXT,
  p_row_count INTEGER,
  p_confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_col TEXT := public.dc_archive_targets() ->> p_table;
  v_count BIGINT;
  v_exists BOOLEAN := FALSE;
  v_deleted BIGINT;
  v_actor TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF v_col IS NULL THEN RAISE EXCEPTION 'Table % is not an archive target', p_table USING ERRCODE = '22023'; END IF;
  IF p_confirmation IS DISTINCT FROM 'ARCHIVE ' || p_table THEN RAISE EXCEPTION 'Typed confirmation does not match'; END IF;
  IF p_before IS NULL OR p_before > NOW() - interval '24 hours' THEN RAISE EXCEPTION 'Cutoff must be at least 24 hours old'; END IF;
  IF p_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'A lowercase SHA-256 of the exported file is required'; END IF;
  IF p_object_path !~ ('^archive-vault/' || p_table || '/[A-Za-z0-9._-]+\.json$') THEN
    RAISE EXCEPTION 'Archive path must be archive-vault/%/<file>.json', p_table;
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'dramaconnect-backups' AND name = $1
              AND COALESCE((metadata->>'size')::BIGINT, 1) > 0)$q$ INTO v_exists USING p_object_path;
  END IF;
  IF NOT v_exists THEN RAISE EXCEPTION 'The exported archive was not found in the private vault; nothing was deleted'; END IF;

  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I < $1', p_table, v_col) INTO v_count USING p_before;
  IF v_count <> p_row_count THEN
    RAISE EXCEPTION 'Rows changed since export (% now vs % exported). Export again; nothing was deleted', v_count, p_row_count;
  END IF;

  EXECUTE format('DELETE FROM public.%I WHERE %I < $1', p_table, v_col) USING p_before;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.dc_archive_vault (table_name, object_path, sha256, row_count, cutoff, created_by)
  VALUES (p_table, p_object_path, p_sha256, v_deleted, p_before, auth.uid())
  ON CONFLICT (object_path) DO NOTHING;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), email, 'Administrator') INTO v_actor FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.activity_log (actor_name, action, detail)
  VALUES (v_actor, 'archive_vault_purge', format('Archived %s row(s) of %s before %s to %s (sha256 %s)',
    v_deleted, p_table, p_before, p_object_path, p_sha256));

  RETURN jsonb_build_object('ok', TRUE, 'table', p_table, 'archivedRows', v_deleted, 'path', p_object_path);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_archive_restore(p_archive_id UUID, p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.dc_archive_vault%ROWTYPE;
  v_inserted BIGINT;
  v_actor TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.dc_archive_vault WHERE id = p_archive_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Archive not found'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'Rows must be a JSON array'; END IF;
  IF public.dc_archive_targets() ->> v.table_name IS NULL THEN RAISE EXCEPTION 'Unsupported table'; END IF;

  -- Rows whose foreign keys no longer exist (e.g. a deleted member) are skipped
  -- one by one instead of failing the whole restore.
  v_inserted := 0;
  DECLARE
    r JSONB;
    n BIGINT;
  BEGIN
    FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      BEGIN
        EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1) ON CONFLICT DO NOTHING',
          v.table_name, v.table_name) USING r;
        GET DIAGNOSTICS n = ROW_COUNT;
        v_inserted := v_inserted + n;
      EXCEPTION WHEN foreign_key_violation OR check_violation OR not_null_violation THEN
        NULL;
      END;
    END LOOP;
  END;

  UPDATE public.dc_archive_vault SET restored_at = NOW(), restored_by = auth.uid(), restored_rows = v_inserted WHERE id = v.id;
  SELECT COALESCE(NULLIF(btrim(full_name), ''), email, 'Administrator') INTO v_actor FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.activity_log (actor_name, action, detail)
  VALUES (v_actor, 'archive_vault_restore', format('Restored %s of %s row(s) into %s from %s',
    v_inserted, jsonb_array_length(p_rows), v.table_name, v.object_path));
  RETURN jsonb_build_object('ok', TRUE, 'table', v.table_name, 'restoredRows', v_inserted, 'offered', jsonb_array_length(p_rows));
END;
$$;

REVOKE ALL ON FUNCTION public.dc_update_org_settings(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_distance_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_self_check_in_geo(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sc_license_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_analytics_overview(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_table_sizes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_login_audit_report(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_archive_targets() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_archive_purge(TEXT, TIMESTAMPTZ, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_archive_restore(UUID, JSONB) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dc_update_org_settings(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_distance_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_self_check_in_geo(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sc_license_status() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dc_analytics_overview(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_table_sizes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_login_audit_report(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_archive_targets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_archive_purge(TEXT, TIMESTAMPTZ, TEXT, TEXT, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_archive_restore(UUID, JSONB) TO authenticated;

COMMIT;
