/* DramaConnect v14 control-plane client and session security guard. */
(() => {
  'use strict';

  const ACTIVITY_KEY = 'dc_last_activity_v2';
  const ACCESS_CACHE_MS = 60 * 1000;
  let accessCache = null;
  let accessCachedAt = 0;
  let guardTimer = null;
  let activityWired = false;

  const client = () => window.supabaseClient || window.sb;
  const clean = (error, fallback = 'The operation failed.') => {
    const message = String(error?.message || error?.error_description || error || fallback).replace(/\s+/g, ' ').trim();
    return message.slice(0, 500) || fallback;
  };
  const requireClient = () => {
    if (!client()) throw new Error('The database client is not initialized.');
    return client();
  };
  const unwrapRpc = async (name, parameters = {}) => {
    const { data, error } = await requireClient().rpc(name, parameters);
    if (error) throw new Error(clean(error));
    return data;
  };
  const one = async (table, columns = '*') => {
    const { data, error } = await requireClient().from(table).select(columns).eq('id', 1).maybeSingle();
    if (error) throw new Error(clean(error));
    return data;
  };

  async function accessState(force = false) {
    if (!force && accessCache && Date.now() - accessCachedAt < ACCESS_CACHE_MS) return accessCache;
    accessCache = await unwrapRpc('dc_access_state');
    accessCachedAt = Date.now();
    return accessCache;
  }

  async function recordLoginEvent(eventType, metadata = {}) {
    try {
      return await unwrapRpc('dc_record_login_event', {
        p_event_type: eventType,
        p_user_agent: navigator.userAgent.slice(0, 500),
        p_metadata: metadata && typeof metadata === 'object' ? metadata : {}
      });
    } catch (error) {
      console.warn('[DramaConnect] Login audit unavailable:', clean(error));
      return null;
    }
  }

  function restrictedUrl(reason) {
    const inPages = window.location.pathname.includes('/pages/');
    const base = inPages ? '' : 'pages/';
    return `${base}site-license.html?restricted=${encodeURIComponent(reason || 'access')}`;
  }

  function readLastActivity() {
    try { return Number(localStorage.getItem(ACTIVITY_KEY) || Date.now()); }
    catch (_) { return Date.now(); }
  }
  function touchActivity() {
    try { localStorage.setItem(ACTIVITY_KEY, String(Date.now())); } catch (_) { /* private mode */ }
  }

  function startSessionGuard(state) {
    const timeoutMinutes = Math.max(10, Math.min(720, Number(state?.idleTimeoutMinutes || 30)));
    touchActivity();
    if (!activityWired) {
      activityWired = true;
      let lastWrite = 0;
      const mark = () => {
        if (Date.now() - lastWrite < 5000) return;
        lastWrite = Date.now();
        touchActivity();
      };
      ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(event =>
        window.addEventListener(event, mark, { passive: true })
      );
      document.addEventListener('visibilitychange', () => { if (!document.hidden) mark(); });
    }
    if (guardTimer) clearInterval(guardTimer);
    guardTimer = setInterval(async () => {
      if (Date.now() - readLastActivity() < timeoutMinutes * 60 * 1000) return;
      clearInterval(guardTimer);
      guardTimer = null;
      await recordLoginEvent('idle_timeout', { timeoutMinutes });
      try { await client()?.auth.signOut(); } catch (_) { /* continue */ }
      window.location.href = window.location.pathname.includes('/pages/') ? '../index.html?reason=idle' : 'index.html?reason=idle';
    }, 30 * 1000);
  }

  async function enforceAccess(options = {}) {
    let state;
    try {
      state = await accessState(Boolean(options.force));
    } catch (error) {
      // A rolling deployment must not lock users out before complete-schema.sql
      // is installed. Dedicated control-plane pages will surface this clearly.
      console.warn('[DramaConnect] Access-state RPC unavailable; continuing in compatibility mode:', clean(error));
      return { allowed: true, reason: 'compatibility_mode', idleTimeoutMinutes: 30 };
    }
    startSessionGuard(state);
    if (!state?.allowed && !options.allowRestricted) {
      const event = String(state?.reason || '').startsWith('license_') ? 'license_denied' : 'lockdown_denied';
      await recordLoginEvent(event, { reason: state?.reason || 'unknown' });
      window.location.href = restrictedUrl(state?.reason);
      return null;
    }
    return state;
  }

  const PlatformManagement = {
    clean,
    accessState,
    enforceAccess,
    recordLoginEvent,
    clearAccessCache() { accessCache = null; accessCachedAt = 0; },

    getPlatformSettings: () => one('dc_platform_settings'),
    getRetentionSettings: () => one('dc_retention_settings'),
    getLicense: () => one('dc_site_license'),

    savePlatformSettings(values) {
      this.clearAccessCache();
      return unwrapRpc('dc_update_platform_settings', {
        p_lockdown_enabled: Boolean(values.lockdown_enabled),
        p_lockdown_message: String(values.lockdown_message || ''),
        p_idle_timeout_minutes: Number(values.idle_timeout_minutes),
        // Omitted/blank → null → the RPC keeps the Storage Manager's value.
        p_login_audit_retention_days: (values.login_audit_retention_days === undefined || values.login_audit_retention_days === null || values.login_audit_retention_days === '')
          ? null : Number(values.login_audit_retention_days)
      });
    },

    saveRetentionSettings(values) {
      return unwrapRpc('dc_update_retention_settings', {
        p_database_quota_mb: Number(values.database_quota_mb),
        p_storage_quota_mb: Number(values.storage_quota_mb),
        p_warning_percent: Number(values.warning_percent),
        p_critical_percent: Number(values.critical_percent),
        p_activity_log_days: Number(values.activity_log_days),
        p_backup_run_days: Number(values.backup_run_days),
        p_heartbeat_days: Number(values.heartbeat_days),
        p_login_audit_days: Number(values.login_audit_days)
      });
    },

    listMemberAccess: () => unwrapRpc('dc_list_member_access'),
    updateMemberAccess(values) {
      return unwrapRpc('dc_update_member_access', {
        p_member_id: values.id,
        p_role: values.role,
        p_status: values.status,
        p_unit: values.unit || '',
        p_is_unit_leader: Boolean(values.is_unit_leader),
        p_expected_version: Number(values.access_version)
      });
    },

    saveLicense(values) {
      this.clearAccessCache();
      return unwrapRpc('dc_update_site_license', {
        p_license_model: values.license_model,
        p_plan_name: values.plan_name,
        p_license_status: values.license_status,
        p_licensed_to: values.licensed_to,
        p_starts_on: values.starts_on || null,
        p_expires_on: values.license_model === 'lifetime' ? null : (values.expires_on || null),
        p_grace_days: Number(values.grace_days),
        p_renewal_url: values.renewal_url || null,
        p_support_email: values.support_email || null,
        p_public_message: values.public_message || null,
        p_registry_url: values.registry_url || null
      });
    },

    platformHealth: () => unwrapRpc('dc_platform_health'),
    storageOverview: () => unwrapRpc('dc_storage_overview'),
    retentionPreview: () => unwrapRpc('dc_retention_preview'),
    applyRetention(values) {
      return unwrapRpc('dc_apply_retention', {
        p_table_name: values.table,
        p_before: values.before,
        p_confirmation: values.confirmation,
        p_verified_backup_sha256: values.sha256
      });
    },

    async listAudit(limit = 100) {
      const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
      const { data, error } = await requireClient().from('dc_login_audit')
        .select('id,user_id,email,event_type,user_agent,metadata,created_at')
        .order('created_at', { ascending: false }).limit(safeLimit);
      if (error) throw new Error(clean(error));
      return data || [];
    },

    async listLicenseEvents(limit = 50) {
      const { data, error } = await requireClient().from('dc_license_events')
        .select('id,actor_id,event_type,previous_state,next_state,created_at')
        .order('created_at', { ascending: false }).limit(Math.max(1, Math.min(200, Number(limit) || 50)));
      if (error) throw new Error(clean(error));
      return data || [];
    },

    async listStorage(bucket, prefix = '', options = {}) {
      if (!['avatars', 'gallery', 'dramaconnect-backups'].includes(bucket)) throw new Error('Unsupported storage bucket.');
      const { data, error } = await requireClient().storage.from(bucket).list(prefix, {
        limit: Math.max(1, Math.min(1000, Number(options.limit) || 200)),
        offset: Math.max(0, Number(options.offset) || 0),
        sortBy: { column: 'updated_at', order: 'desc' }
      });
      if (error) throw new Error(clean(error));
      return data || [];
    },

    async deleteStorageObject(bucket, path) {
      if (!['avatars', 'gallery', 'dramaconnect-backups'].includes(bucket)) throw new Error('Unsupported storage bucket.');
      const safePath = String(path || '').replace(/^\/+/, '');
      if (!safePath || safePath.includes('..')) throw new Error('Invalid storage path.');
      const { data, error } = await requireClient().storage.from(bucket).remove([safePath]);
      if (error) throw new Error(clean(error));
      return data;
    },

    /* ---- Item 21: organisation settings, analytics, audit, doctor, vault ---- */
    async orgSettings(force = false) {
      const cacheKey = 'dc-org-settings';
      if (!force) {
        try {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
          if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;
        } catch (_) { /* ignore */ }
      }
      const { data, error } = await requireClient().from('dc_org_settings').select('*').eq('id', 1).maybeSingle();
      if (error) {
        // 42P01/PGRST205 = pack 04 not yet re-run; callers fall back to defaults.
        if (/42P01|PGRST205|does not exist|schema cache/i.test(`${error.code} ${error.message}`)) return null;
        throw new Error(clean(error));
      }
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data }));
        localStorage.setItem('dc-modules-off', JSON.stringify(data?.disabled_modules || []));
      } catch (_) { /* storage full or disabled */ }
      return data;
    },
    async updateOrgSettings(values) {
      const data = await unwrapRpc('dc_update_org_settings', { p_settings: values || {} });
      try {
        localStorage.setItem('dc-org-settings', JSON.stringify({ at: Date.now(), data }));
        localStorage.setItem('dc-modules-off', JSON.stringify(data?.disabled_modules || []));
      } catch (_) { /* ignore */ }
      return data;
    },
    analytics: (months = 12) => unwrapRpc('dc_analytics_overview', { p_months: Number(months) || 12 }),
    tableSizes: () => unwrapRpc('dc_table_sizes'),
    schemaDoctor: () => unwrapRpc('dc_schema_doctor'),
    heartbeatHealth: () => unwrapRpc('dc_heartbeat_health'),
    licenseProbe: () => unwrapRpc('sc_license_status'),
    loginAuditReport(days = 30, limit = 200, event = null) {
      return unwrapRpc('dc_login_audit_report', { p_days: Number(days) || 30, p_limit: Number(limit) || 200, p_event: event || null });
    },
    activityFeed(options = {}) {
      return unwrapRpc('dc_activity_feed', {
        p_days: Number(options.days) || 90, p_limit: Number(options.limit) || 300,
        p_action: options.action || null, p_search: options.search || null, p_actor: options.actor || null
      });
    },
    archivePurge(values) {
      return unwrapRpc('dc_archive_purge', {
        p_table: values.table, p_before: values.before, p_object_path: values.path,
        p_sha256: values.sha256, p_row_count: Number(values.rows), p_confirmation: values.confirmation
      });
    },
    archiveRestore: (archiveId, rows) => unwrapRpc('dc_archive_restore', { p_archive_id: archiveId, p_rows: rows }),
    async listArchives() {
      const { data, error } = await requireClient().from('dc_archive_vault')
        .select('id,table_name,object_path,sha256,row_count,cutoff,created_at,restored_at,restored_rows')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error(clean(error));
      return data || [];
    },
    /** Client-side fallback for Schema Doctor: HEAD-probe tables with limit 0. */
    async probeTables(tables) {
      const out = {};
      await Promise.all((tables || []).map(async (table) => {
        const { error } = await requireClient().from(table).select('*', { head: true, count: 'exact' }).limit(0);
        out[table] = !error ? 'present'
          : (/42P01|PGRST205|does not exist|schema cache/i.test(`${error.code} ${error.message}`) ? 'missing' : 'restricted');
      }));
      return out;
    }
  };

  window.PlatformManagement = Object.freeze(PlatformManagement);
})();
