-- DramaConnect v14.0 — resilience, keep-alive, backup coordination and archive vault
-- Apply after database/repair_and_upgrade.sql and database/security_hardening.sql.
-- Safe to re-run. No production secret is stored in this migration.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Missing public.is_admin(). Apply database/security_hardening.sql first.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Throttled, source-aware heartbeat (public execution; no public table read)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_heartbeat_sources (
  source text PRIMARY KEY,
  last_ping_at timestamptz NOT NULL DEFAULT now(),
  ping_count bigint NOT NULL DEFAULT 1 CHECK (ping_count > 0),
  last_actor uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dc_heartbeat_source_format CHECK (source ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);

ALTER TABLE public.dc_heartbeat_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dc_heartbeat_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dc_heartbeat_sources TO authenticated;

DROP POLICY IF EXISTS "Approved admins can read resilience heartbeats" ON public.dc_heartbeat_sources;
CREATE POLICY "Approved admins can read resilience heartbeats"
  ON public.dc_heartbeat_sources FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.dc_keep_alive(p_source text DEFAULT 'external')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text;
  v_row public.dc_heartbeat_sources%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  -- A fixed allow-list prevents an unauthenticated caller from creating
  -- unbounded source rows. Unknown values collapse into one external bucket.
  v_source := lower(trim(coalesce(p_source, 'external')));
  IF v_source NOT IN (
    'site-visit', 'github-actions', 'edge-ping', 'pg-cron',
    'manual-button', 'vercel-cron', 'apps-script', 'cron-job-org',
    'auto-restore', 'database-backup', 'external'
  ) THEN
    v_source := 'external';
  END IF;

  INSERT INTO public.dc_heartbeat_sources (
    source, last_ping_at, ping_count, last_actor, created_at, updated_at
  )
  VALUES (v_source, v_now, 1, auth.uid(), v_now, v_now)
  ON CONFLICT (source) DO UPDATE
    SET last_ping_at = EXCLUDED.last_ping_at,
        ping_count = public.dc_heartbeat_sources.ping_count + 1,
        last_actor = EXCLUDED.last_actor,
        updated_at = EXCLUDED.updated_at
    WHERE public.dc_heartbeat_sources.last_ping_at <= v_now - interval '5 minutes'
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'written',
      'source', v_source,
      'at', v_row.last_ping_at
    );
  END IF;

  SELECT * INTO v_row
  FROM public.dc_heartbeat_sources
  WHERE source = v_source;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', 'throttled',
    'source', v_source,
    'at', v_row.last_ping_at,
    'retryAfterSeconds', greatest(
      1,
      ceil(extract(epoch FROM ((v_row.last_ping_at + interval '5 minutes') - v_now)))::integer
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dc_keep_alive(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dc_keep_alive(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Shared administrator configuration and immutable-ish run history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_backup_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  google_client_id text NULL,
  drive_folder_name text NOT NULL DEFAULT 'DramaConnect Backups',
  schedule_enabled boolean NOT NULL DEFAULT false,
  interval_days integer NOT NULL DEFAULT 7 CHECK (interval_days BETWEEN 1 AND 30),
  retention_count integer NOT NULL DEFAULT 12 CHECK (retention_count BETWEEN 1 AND 50),
  overdue_grace_hours integer NOT NULL DEFAULT 24 CHECK (overdue_grace_hours BETWEEN 0 AND 168),
  last_success_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_failure_message text NULL,
  last_archive_sha256 text NULL,
  last_archive_size bigint NULL CHECK (last_archive_size IS NULL OR last_archive_size >= 0),
  last_archive_rows bigint NULL CHECK (last_archive_rows IS NULL OR last_archive_rows >= 0),
  last_drive_file_id text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

INSERT INTO public.dc_backup_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dc_backup_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dc_backup_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dc_backup_settings TO authenticated;

DROP POLICY IF EXISTS "Approved admins can read backup settings" ON public.dc_backup_settings;
DROP POLICY IF EXISTS "Approved admins can create backup settings" ON public.dc_backup_settings;
DROP POLICY IF EXISTS "Approved admins can update backup settings" ON public.dc_backup_settings;

CREATE POLICY "Approved admins can read backup settings"
  ON public.dc_backup_settings FOR SELECT TO authenticated
  USING (public.is_admin());

-- Browser callers cannot directly falsify last-success/failure metadata. This
-- narrow RPC changes only administrator-configurable scheduling fields and
-- normalizes the audit identity/time on the server.
CREATE OR REPLACE FUNCTION public.dc_update_backup_settings(
  p_google_client_id text,
  p_drive_folder_name text,
  p_schedule_enabled boolean,
  p_interval_days integer,
  p_retention_count integer,
  p_overdue_grace_hours integer
)
RETURNS public.dc_backup_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_client_id text := nullif(trim(coalesce(p_google_client_id, '')), '');
  v_folder text := trim(coalesce(p_drive_folder_name, ''));
  v_result public.dc_backup_settings%ROWTYPE;
BEGIN
  IF v_user IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator approval required' USING ERRCODE = '42501';
  END IF;
  IF v_client_id IS NOT NULL AND v_client_id !~ '^[0-9]+-[A-Za-z0-9_-]+[.]apps[.]googleusercontent[.]com$' THEN
    RAISE EXCEPTION 'Invalid Google OAuth Web Client ID' USING ERRCODE = '22023';
  END IF;
  IF length(v_folder) NOT BETWEEN 1 AND 120 OR v_folder ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid Drive folder name' USING ERRCODE = '22023';
  END IF;
  IF p_interval_days NOT BETWEEN 1 AND 30
     OR p_retention_count NOT BETWEEN 1 AND 50
     OR p_overdue_grace_hours NOT BETWEEN 0 AND 168 THEN
    RAISE EXCEPTION 'Backup schedule value out of range' USING ERRCODE = '22023';
  END IF;

  UPDATE public.dc_backup_settings
  SET google_client_id = v_client_id,
      drive_folder_name = v_folder,
      schedule_enabled = coalesce(p_schedule_enabled, false),
      interval_days = p_interval_days,
      retention_count = p_retention_count,
      overdue_grace_hours = p_overdue_grace_hours,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = v_user
  WHERE id = 1
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE INSERT, UPDATE ON TABLE public.dc_backup_settings FROM authenticated;
REVOKE ALL ON FUNCTION public.dc_update_backup_settings(text, text, boolean, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dc_update_backup_settings(text, text, boolean, integer, integer, integer) TO authenticated;

CREATE TABLE IF NOT EXISTS public.dc_backup_leases (
  destination text PRIMARY KEY,
  lease_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  acquired_by uuid NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT dc_backup_lease_destination CHECK (
    destination IN ('local', 'drive', 'vault', 'local-restore', 'drive-restore', 'vault-restore')
  ),
  CONSTRAINT dc_backup_lease_expiry CHECK (expires_at > acquired_at)
);

CREATE TABLE IF NOT EXISTS public.dc_backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination text NOT NULL,
  trigger_source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  requested_by uuid NOT NULL,
  lease_token uuid NOT NULL,
  archive_sha256 text NULL,
  archive_size bigint NULL CHECK (archive_size IS NULL OR archive_size >= 0),
  archive_rows bigint NULL CHECK (archive_rows IS NULL OR archive_rows >= 0),
  remote_file_id text NULL,
  error_code text NULL,
  error_message text NULL,
  CONSTRAINT dc_backup_run_destination CHECK (
    destination IN ('local', 'drive', 'vault', 'local-restore', 'drive-restore', 'vault-restore')
  ),
  CONSTRAINT dc_backup_run_trigger CHECK (
    trigger_source IN ('manual', 'scheduled', 'overdue-recovery', 'import')
  ),
  CONSTRAINT dc_backup_run_status CHECK (
    status IN ('running', 'succeeded', 'failed', 'skipped')
  )
);

CREATE INDEX IF NOT EXISTS dc_backup_runs_started_idx
  ON public.dc_backup_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS dc_backup_runs_destination_idx
  ON public.dc_backup_runs (destination, started_at DESC);

ALTER TABLE public.dc_backup_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_backup_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dc_backup_leases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dc_backup_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dc_backup_runs TO authenticated;

DROP POLICY IF EXISTS "Approved admins can read backup runs" ON public.dc_backup_runs;
CREATE POLICY "Approved admins can read backup runs"
  ON public.dc_backup_runs FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.dc_begin_backup_run(
  p_destination text,
  p_trigger_source text DEFAULT 'manual',
  p_ttl_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_destination text := lower(trim(coalesce(p_destination, '')));
  v_trigger text := lower(trim(coalesce(p_trigger_source, 'manual')));
  v_ttl integer := least(greatest(coalesce(p_ttl_seconds, 900), 60), 3600);
  v_token uuid := gen_random_uuid();
  v_user uuid := auth.uid();
  v_lease public.dc_backup_leases%ROWTYPE;
  v_run public.dc_backup_runs%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator approval required' USING ERRCODE = '42501';
  END IF;
  IF v_destination NOT IN ('local', 'drive', 'vault', 'local-restore', 'drive-restore', 'vault-restore') THEN
    RAISE EXCEPTION 'Unsupported backup destination' USING ERRCODE = '22023';
  END IF;
  IF v_trigger NOT IN ('manual', 'scheduled', 'overdue-recovery', 'import') THEN
    v_trigger := 'manual';
  END IF;

  -- Serialize acquisition even for different destinations. This prevents a
  -- restore from racing a backup and prevents two full-table exports from
  -- competing for browser/database resources. A crashed operation expires.
  PERFORM pg_catalog.pg_advisory_xact_lock(1320132001);
  DELETE FROM public.dc_backup_leases WHERE expires_at <= v_now;
  SELECT * INTO v_lease
  FROM public.dc_backup_leases
  WHERE expires_at > v_now
  ORDER BY acquired_at
  LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'busy',
      'destination', v_lease.destination,
      'expiresAt', v_lease.expires_at
    );
  END IF;

  INSERT INTO public.dc_backup_leases (
    destination, lease_token, acquired_by, acquired_at, expires_at
  ) VALUES (
    v_destination, v_token, v_user, v_now, v_now + pg_catalog.make_interval(secs => v_ttl)
  )
  RETURNING * INTO v_lease;

  INSERT INTO public.dc_backup_runs (
    destination, trigger_source, status, started_at, requested_by, lease_token
  ) VALUES (
    v_destination, v_trigger, 'running', v_now, v_user, v_token
  ) RETURNING * INTO v_run;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', 'started',
    'runId', v_run.id,
    'leaseToken', v_token,
    'expiresAt', v_lease.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_finish_backup_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_status text,
  p_archive_sha256 text DEFAULT NULL,
  p_archive_size bigint DEFAULT NULL,
  p_archive_rows bigint DEFAULT NULL,
  p_remote_file_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status, 'failed')));
  v_run public.dc_backup_runs%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator approval required' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('succeeded', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'Invalid terminal backup status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM public.dc_backup_runs
  WHERE id = p_run_id
    AND lease_token = p_lease_token
    AND requested_by = v_user
    AND status = 'running'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup run not found, already finished, or owned by another administrator'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.dc_backup_runs
  SET status = v_status,
      completed_at = v_now,
      archive_sha256 = CASE WHEN p_archive_sha256 ~ '^[0-9a-fA-F]{64}$' THEN lower(p_archive_sha256) ELSE NULL END,
      archive_size = CASE WHEN p_archive_size >= 0 THEN p_archive_size ELSE NULL END,
      archive_rows = CASE WHEN p_archive_rows >= 0 THEN p_archive_rows ELSE NULL END,
      remote_file_id = nullif(left(coalesce(p_remote_file_id, ''), 255), ''),
      error_code = nullif(left(coalesce(p_error_code, ''), 80), ''),
      error_message = nullif(left(coalesce(p_error_message, ''), 500), '')
  WHERE id = p_run_id;

  DELETE FROM public.dc_backup_leases
  WHERE destination = v_run.destination
    AND lease_token = p_lease_token;

  IF v_run.destination = 'drive' THEN
    IF v_status = 'succeeded' THEN
      UPDATE public.dc_backup_settings
      SET last_success_at = v_now,
          last_failure_message = NULL,
          last_archive_sha256 = CASE WHEN p_archive_sha256 ~ '^[0-9a-fA-F]{64}$' THEN lower(p_archive_sha256) ELSE NULL END,
          last_archive_size = CASE WHEN p_archive_size >= 0 THEN p_archive_size ELSE NULL END,
          last_archive_rows = CASE WHEN p_archive_rows >= 0 THEN p_archive_rows ELSE NULL END,
          last_drive_file_id = nullif(left(coalesce(p_remote_file_id, ''), 255), ''),
          updated_at = v_now,
          updated_by = v_user
      WHERE id = 1;
    ELSIF v_status = 'failed' THEN
      UPDATE public.dc_backup_settings
      SET last_failure_at = v_now,
          last_failure_message = nullif(left(coalesce(p_error_message, 'Backup failed'), 500), ''),
          updated_at = v_now,
          updated_by = v_user
      WHERE id = 1;
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', v_status,
    'runId', p_run_id,
    'completedAt', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dc_begin_backup_run(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_finish_backup_run(uuid, uuid, text, text, bigint, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dc_begin_backup_run(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_finish_backup_run(uuid, uuid, text, text, bigint, bigint, text, text, text) TO authenticated;

-- Administrators need an explicit path to restore RSVP records. Member access
-- remains self-only through the existing policy in security_hardening.sql.
DROP POLICY IF EXISTS "Approved admins can manage event RSVPs" ON public.event_rsvps;
CREATE POLICY "Approved admins can manage event RSVPs"
  ON public.event_rsvps FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Private, administrator-only Supabase Storage archive vault
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dramaconnect-backups',
  'dramaconnect-backups',
  false,
  52428800,
  ARRAY['application/json', 'application/octet-stream']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Approved admins can read backup vault objects" ON storage.objects;
DROP POLICY IF EXISTS "Approved admins can create backup vault objects" ON storage.objects;
DROP POLICY IF EXISTS "Approved admins can update backup vault objects" ON storage.objects;
DROP POLICY IF EXISTS "Approved admins can delete backup vault objects" ON storage.objects;

CREATE POLICY "Approved admins can read backup vault objects"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dramaconnect-backups' AND public.is_admin());
CREATE POLICY "Approved admins can create backup vault objects"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dramaconnect-backups' AND public.is_admin());
CREATE POLICY "Approved admins can update backup vault objects"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'dramaconnect-backups' AND public.is_admin())
  WITH CHECK (bucket_id = 'dramaconnect-backups' AND public.is_admin());
CREATE POLICY "Approved admins can delete backup vault objects"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'dramaconnect-backups' AND public.is_admin());

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. Optional internal pg_cron layer (best-effort and safe when unavailable)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  -- Enable pg_cron when the platform offers it (Supabase does). Earlier
  -- releases only scheduled the job if someone had ALREADY enabled the
  -- extension by hand, so on most projects this layer silently never ran.
  -- SchoolConnect/GOSA create the extension here; DramaConnect now does too.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
      RAISE NOTICE 'pg_cron extension enabled for the internal heartbeat layer.';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron could not be enabled automatically (%). Enable it under Database -> Extensions, then re-run this file.', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR v_job_id IN
      SELECT jobid FROM cron.job WHERE jobname = 'dramaconnect-internal-heartbeat'
    LOOP
      PERFORM cron.unschedule(v_job_id);
    END LOOP;

    PERFORM cron.schedule(
      'dramaconnect-internal-heartbeat',
      '17 3 * * *',
      $job$SELECT public.dc_keep_alive('pg-cron');$job$
    );
    RAISE NOTICE 'Scheduled dramaconnect-internal-heartbeat via pg_cron.';
  ELSE
    RAISE NOTICE 'pg_cron is not enabled. External heartbeat layers remain available.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END;
$$;

-- ============================================================================
-- LAYER 11 — Heartbeat quorum and dead-scheduler detection.
--
-- Why this exists. A single "last heartbeat" timestamp is dangerously
-- reassuring. If UptimeRobot keeps pinging while your GitHub Actions
-- scheduler dies silently (the 60-day inactivity freeze), the platform still
-- reports "healthy" — yet you have quietly fallen from four independent
-- schedulers to one. One bad week later that single scheduler fails too and
-- the project pauses with no warning.
--
-- DramaConnect records each heartbeat SOURCE separately, so the database can
-- tell the difference between "the database is alive" and "all my safety
-- nets are alive". This function reports both, and names the sources that
-- have gone quiet so you can repair them before you need them.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dc_heartbeat_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Supabase pauses a free-tier project after this much inactivity.
  c_pause_after_hours constant numeric := 168;      -- 7 days
  -- A scheduler is "fresh" if it has run within this window. Slack is
  -- generous: a weekly cron is not stale after eight days.
  c_source_stale_hours constant numeric := 192;     -- 8 days
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_newest timestamptz;
  v_hours numeric;
  v_remaining numeric;
  v_sources jsonb;
  v_fresh int := 0;
  v_total int := 0;
  v_status text;
BEGIN
  SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'source',      s.source,
             'lastPingAt',  s.last_ping_at,
             'ageHours',    round((extract(epoch FROM (v_now - s.last_ping_at)) / 3600.0)::numeric, 1),
             'pingCount',   s.ping_count,
             'fresh',       (s.last_ping_at >= v_now - make_interval(hours => c_source_stale_hours::int))
           )
           ORDER BY s.last_ping_at DESC
         )
  INTO v_sources
  FROM public.dc_heartbeat_sources s;

  IF v_sources IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'no-heartbeat',
      'message', 'No heartbeat has been recorded yet. Run one heartbeat layer before relying on this report.',
      'pauseAfterHours', c_pause_after_hours,
      'hoursUntilPause', null,
      'sources', '[]'::jsonb
    );
  END IF;

  SELECT count(*) INTO v_total FROM pg_catalog.jsonb_array_elements(v_sources) AS e
   WHERE (e.value ->> 'source') IS NOT NULL;

  SELECT count(*) INTO v_fresh FROM pg_catalog.jsonb_array_elements(v_sources) AS e
   WHERE (e.value ->> 'fresh') = 'true';

  SELECT max((e.value ->> 'lastPingAt')::timestamptz) INTO v_newest
  FROM pg_catalog.jsonb_array_elements(v_sources) AS e;

  v_hours := round((extract(epoch FROM (v_now - v_newest)) / 3600.0)::numeric, 1);
  v_remaining := round(c_pause_after_hours - v_hours, 1);

  v_status := CASE
    WHEN v_hours <= 72    THEN 'healthy'
    WHEN v_hours <= 120   THEN 'warning'
    WHEN v_hours <  c_pause_after_hours THEN 'critical'
    ELSE 'paused'
  END;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', v_status,
    'lastHeartbeatAt', v_newest,
    'hoursSinceHeartbeat', v_hours,
    'pauseAfterHours', c_pause_after_hours,
    'hoursUntilPause', greatest(v_remaining, 0),
    'daysUntilPause', round(greatest(v_remaining, 0) / 24.0, 1),
    'sourcesTotal', v_total,
    'sourcesFresh', v_fresh,
    -- The number that matters most: how many INDEPENDENT safety nets are
    -- actually running. Two or more means a single failure cannot pause you.
    'quorum', (v_fresh >= 2),
    'singlePointOfFailure', (v_fresh = 1),
    -- Human-driven sources (site visits, the manual button, ad-hoc external
    -- calls) stop during holidays. Only UNATTENDED schedulers protect an idle
    -- project, so they are counted separately. A live audit found a project
    -- reporting quorum from human traffic while every scheduler was failing.
    'automatedSourcesFresh', (
      SELECT count(*) FROM pg_catalog.jsonb_array_elements(v_sources) AS e
       WHERE (e.value ->> 'fresh') = 'true'
         AND (e.value ->> 'source') NOT IN ('site-visit', 'manual-button', 'external')),
    'automatedQuorum', ((
      SELECT count(*) FROM pg_catalog.jsonb_array_elements(v_sources) AS e
       WHERE (e.value ->> 'fresh') = 'true'
         AND (e.value ->> 'source') NOT IN ('site-visit', 'manual-button', 'external')) >= 2),
    'neverReported', (
      SELECT COALESCE(pg_catalog.jsonb_agg(x ORDER BY x), '[]'::jsonb)
      FROM pg_catalog.unnest(ARRAY['github-actions','vercel-cron','pg-cron','auto-restore','edge-ping','cron-job-org','apps-script']) AS x
      WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_sources) AS e WHERE (e.value ->> 'source') = x)),
    'silentSources', COALESCE((
      SELECT pg_catalog.jsonb_agg(e.value ->> 'source' ORDER BY e.value ->> 'source')
      FROM pg_catalog.jsonb_array_elements(v_sources) AS e
      WHERE (e.value ->> 'fresh') = 'false'
    ), '[]'::jsonb),
    'sources', v_sources
  );
END;
$$;

COMMENT ON FUNCTION public.dc_heartbeat_health() IS
  'Layer 11: reports per-source heartbeat freshness, pause countdown and scheduler quorum. Detects a silently dead keep-alive scheduler even while other layers keep the database warm.';

GRANT EXECUTE ON FUNCTION public.dc_heartbeat_health() TO authenticated;
