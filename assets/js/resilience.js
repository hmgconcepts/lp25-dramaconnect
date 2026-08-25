/* DramaConnect resilience client: heartbeats, health visibility and backup leases. */
(() => {
  'use strict';

  const VISIT_KEY = 'dc_last_resilience_visit_v1';
  const VISIT_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const MIGRATION_HINT = 'Apply database/resilience_and_backup.sql in Supabase first.';

  const client = () => window.supabaseClient;

  function cleanError(error, fallback = 'The operation failed.') {
    if (!error) return fallback;
    const message = String(error.message || error.error_description || error).replace(/\s+/g, ' ').trim();
    return message.slice(0, 500) || fallback;
  }

  function assertClient() {
    if (!client()) throw new Error('The database client is not initialized.');
    return client();
  }

  async function ping(source = 'external') {
    const { data, error } = await assertClient().rpc('dc_keep_alive', { p_source: source });
    if (error) throw new Error(`${cleanError(error)} ${MIGRATION_HINT}`);
    if (!data?.ok) throw new Error('The resilience heartbeat was not accepted.');
    return data;
  }

  async function pingOncePerVisitWindow() {
    let last = 0;
    try { last = Number(localStorage.getItem(VISIT_KEY) || 0); } catch (_) { /* private mode */ }
    if (Date.now() - last < VISIT_INTERVAL_MS) return { ok: true, status: 'recent' };

    const result = await ping('site-visit');
    try { localStorage.setItem(VISIT_KEY, String(Date.now())); } catch (_) { /* private mode */ }
    return result;
  }

  async function getHealth() {
    const db = assertClient();
    const [heartbeats, settings, runs] = await Promise.all([
      db.from('dc_heartbeat_sources')
        .select('source,last_ping_at,ping_count,updated_at')
        .order('last_ping_at', { ascending: false }),
      db.from('dc_backup_settings')
        .select('id,google_client_id,drive_folder_name,schedule_enabled,interval_days,retention_count,overdue_grace_hours,last_success_at,last_failure_at,last_failure_message,last_archive_sha256,last_archive_size,last_archive_rows,last_drive_file_id,updated_at')
        .eq('id', 1)
        .maybeSingle(),
      db.from('dc_backup_runs')
        .select('id,destination,trigger_source,status,started_at,completed_at,archive_sha256,archive_size,archive_rows,error_code,error_message')
        .order('started_at', { ascending: false })
        .limit(20)
    ]);

    const firstError = heartbeats.error || settings.error || runs.error;
    if (firstError) throw new Error(`${cleanError(firstError)} ${MIGRATION_HINT}`);
    return {
      heartbeats: heartbeats.data || [],
      settings: settings.data || null,
      runs: runs.data || []
    };
  }

  async function saveBackupSettings(values) {
    const boundedInteger = (value, fallback, minimum, maximum) => {
      const parsed = Number(value);
      return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback));
    };
    const allowed = {
      p_google_client_id: String(values.google_client_id || '').trim() || null,
      p_drive_folder_name: String(values.drive_folder_name || 'DramaConnect Backups').trim().slice(0, 120) || 'DramaConnect Backups',
      p_schedule_enabled: Boolean(values.schedule_enabled),
      p_interval_days: boundedInteger(values.interval_days, 7, 1, 30),
      p_retention_count: boundedInteger(values.retention_count, 12, 1, 50),
      p_overdue_grace_hours: boundedInteger(values.overdue_grace_hours, 24, 0, 168)
    };
    const { data, error } = await assertClient().rpc('dc_update_backup_settings', allowed);
    if (error) throw new Error(`${cleanError(error)} ${MIGRATION_HINT}`);
    window.dispatchEvent(new CustomEvent('dc:backup-settings-changed', { detail: data }));
    return data;
  }

  async function beginBackup(destination, triggerSource = 'manual', ttlSeconds = 900) {
    const { data, error } = await assertClient().rpc('dc_begin_backup_run', {
      p_destination: destination,
      p_trigger_source: triggerSource,
      p_ttl_seconds: ttlSeconds
    });
    if (error) throw new Error(`${cleanError(error)} ${MIGRATION_HINT}`);
    if (!data?.ok) {
      const expiry = data?.expiresAt ? new Date(data.expiresAt).toLocaleString() : 'shortly';
      const activeDestination = data?.destination || destination;
      const busy = new Error(`Another ${activeDestination} operation is in progress (lease expires ${expiry}).`);
      busy.code = 'BACKUP_BUSY';
      throw busy;
    }
    return data;
  }

  async function finishBackup(run, status, metadata = {}) {
    if (!run?.runId || !run?.leaseToken) throw new Error('Invalid backup run token.');
    const { data, error } = await assertClient().rpc('dc_finish_backup_run', {
      p_run_id: run.runId,
      p_lease_token: run.leaseToken,
      p_status: status,
      p_archive_sha256: metadata.sha256 || null,
      p_archive_size: Number.isFinite(metadata.size) ? metadata.size : null,
      p_archive_rows: Number.isFinite(metadata.rows) ? metadata.rows : null,
      p_remote_file_id: metadata.remoteFileId || null,
      p_error_code: metadata.errorCode || null,
      p_error_message: metadata.errorMessage ? cleanError(metadata.errorMessage) : null
    });
    if (error) throw new Error(cleanError(error));
    window.dispatchEvent(new CustomEvent('dc:backup-run-finished', { detail: data }));
    return data;
  }

  async function withBackupLease(destination, triggerSource, operation, ttlSeconds = 900) {
    const run = await beginBackup(destination, triggerSource, ttlSeconds);
    try {
      const result = await operation(run);
      await finishBackup(run, 'succeeded', result?.metadata || {});
      return result;
    } catch (error) {
      try {
        await finishBackup(run, 'failed', {
          errorCode: error?.code || 'OPERATION_FAILED',
          errorMessage: cleanError(error)
        });
      } catch (finishError) {
        console.warn('[Resilience] Could not close failed backup run:', cleanError(finishError));
      }
      throw error;
    }
  }

  window.Resilience = Object.freeze({
    ping,
    pingOncePerVisitWindow,
    getHealth,
    saveBackupSettings,
    beginBackup,
    finishBackup,
    withBackupLease,
    cleanError,
    MIGRATION_HINT
  });

  const beginVisitHeartbeat = () => {
    pingOncePerVisitWindow().catch(error => {
      // Heartbeat failure must never block application boot or authentication.
      console.warn('[Resilience] Visit heartbeat unavailable:', cleanError(error));
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', beginVisitHeartbeat, { once: true });
  } else {
    setTimeout(beginVisitHeartbeat, 0);
  }
})();
