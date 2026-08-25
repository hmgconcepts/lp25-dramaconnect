/* Google Drive Backup & Sync — GIS token model + least-privilege drive.file. */
(() => {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const ARCHIVE_MIME = 'application/json';
  const WARNING_KEY = 'dc_drive_warning_day_v1';
  const RETRY_KEY = 'dc_drive_retry_after_v1';
  const CHECK_INTERVAL_MS = 15 * 60 * 1000;

  let settingsCache = null;
  let tokenClient = null;
  let token = null;
  let tokenExpiresAt = 0;
  let account = null;
  let schedulerRunning = false;
  let schedulerInstalled = false;
  let intervalId = null;
  let gisPromise = null;

  const db = () => window.supabaseClient;
  const cleanError = error => window.Resilience?.cleanError(error) || String(error?.message || error || 'Operation failed.');

  function hasUsableToken() {
    return Boolean(token && Date.now() < tokenExpiresAt - 60_000);
  }

  function validateClientId(clientId) {
    return /^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(String(clientId || '').trim());
  }

  async function getSettings(force = false) {
    if (settingsCache && !force) return settingsCache;
    const { data, error } = await db().from('dc_backup_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw new Error(`${cleanError(error)} ${Resilience.MIGRATION_HINT}`);
    settingsCache = data || null;
    return settingsCache;
  }

  function loadGIS() {
    if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById('dc-google-gis');
      const script = existing || document.createElement('script');
      const timer = setTimeout(() => reject(new Error('Google Identity Services timed out. Check your connection.')), 20_000);
      script.addEventListener('load', () => {
        clearTimeout(timer);
        if (window.google?.accounts?.oauth2) resolve(window.google);
        else reject(new Error('Google Identity Services did not initialize.'));
      }, { once: true });
      script.addEventListener('error', () => {
        clearTimeout(timer);
        gisPromise = null;
        reject(new Error('Could not load Google Identity Services.'));
      }, { once: true });
      if (!existing) {
        script.id = 'dc-google-gis';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    });
    return gisPromise;
  }

  async function ensureTokenClient() {
    const settings = await getSettings();
    const clientId = String(settings?.google_client_id || '').trim();
    if (!validateClientId(clientId)) throw new Error('Save a valid Google OAuth Web Client ID first.');
    await loadGIS();
    if (!tokenClient || tokenClient.__dcClientId !== clientId) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        include_granted_scopes: true,
        callback: () => {}
      });
      tokenClient.__dcClientId = clientId;
    }
    return tokenClient;
  }

  // This method is called only from an explicit user click. Automatic checks
  // never call requestAccessToken(), so they can never open an OAuth popup.
  async function connect() {
    const client = await ensureTokenClient();
    const response = await new Promise((resolve, reject) => {
      client.callback = result => {
        if (result?.error) reject(new Error(result.error_description || result.error));
        else resolve(result);
      };
      client.error_callback = error => reject(new Error(error?.message || error?.type || 'Google authorization was closed.'));
      client.requestAccessToken({ prompt: 'select_account' });
    });
    if (!google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
      throw new Error('Google Drive file permission was not granted.');
    }
    token = response.access_token;
    tokenExpiresAt = Date.now() + Math.max(1, Number(response.expires_in || 3600)) * 1000;
    account = await driveRequest('/about?fields=user(displayName,emailAddress,permissionId)');
    window.dispatchEvent(new CustomEvent('dc:drive-connected', { detail: status() }));
    return status();
  }

  function disconnect() {
    if (token && window.google?.accounts?.oauth2) {
      try { google.accounts.oauth2.revoke(token, () => {}); } catch (_) { /* best effort */ }
    }
    token = null;
    tokenExpiresAt = 0;
    account = null;
    window.dispatchEvent(new CustomEvent('dc:drive-disconnected'));
  }

  async function driveRequest(path, options = {}) {
    if (!hasUsableToken()) {
      const error = new Error('Google Drive authorization is missing or expired. Click Connect Google Drive.');
      error.code = 'DRIVE_RECONNECT_REQUIRED';
      throw error;
    }
    const url = /^https:\/\//.test(path) ? path : `${DRIVE_API}${path}`;
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers, cache: 'no-store' });
    if (response.status === 401) {
      token = null;
      tokenExpiresAt = 0;
      const error = new Error('Google Drive authorization expired. Reconnect manually.');
      error.code = 'DRIVE_RECONNECT_REQUIRED';
      throw error;
    }
    if (!response.ok) {
      let message = `Google Drive request failed (${response.status}).`;
      try {
        const payload = await response.json();
        message = payload?.error?.message || message;
      } catch (_) { /* preserve HTTP message */ }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function escapeDriveQuery(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function folderStorageKey(permissionId) {
    return `dc_drive_folder_v1_${String(permissionId || 'account').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}`;
  }

  async function validateFolder(id) {
    if (!id) return null;
    try {
      const folder = await driveRequest(`/files/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed`);
      return folder?.mimeType === FOLDER_MIME && folder.trashed !== true ? folder : null;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function ensureFolder() {
    const settings = await getSettings();
    const folderName = String(settings?.drive_folder_name || 'DramaConnect Backups').trim();
    if (!account) account = await driveRequest('/about?fields=user(displayName,emailAddress,permissionId)');
    const permissionId = account?.user?.permissionId || 'account';
    const storageKey = folderStorageKey(permissionId);
    let savedId = null;
    try { savedId = localStorage.getItem(storageKey); } catch (_) { /* private mode */ }
    const savedFolder = await validateFolder(savedId);
    if (savedFolder) return savedFolder;

    const query = `name = '${escapeDriveQuery(folderName)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const found = await driveRequest(`/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=10&fields=files(id,name,mimeType,trashed,createdTime)`);
    let folder = found.files?.[0];
    if (!folder) {
      folder = await driveRequest('/files?fields=id,name,mimeType', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME })
      });
    }
    try { localStorage.setItem(storageKey, folder.id); } catch (_) { /* private mode */ }
    return folder;
  }

  async function uploadArchive(folderId, archive, serialized) {
    const boundary = `dc_${crypto.randomUUID().replace(/-/g, '')}`;
    const metadata = {
      name: DataPortability.archiveFileName(archive),
      parents: [folderId],
      mimeType: ARCHIVE_MIME,
      description: `DramaConnect portable archive v${archive.formatVersion}; ${archive.manifest.totalRows} rows; SHA-256 ${archive.seal.digest}`,
      appProperties: {
        dc_format: archive.format,
        dc_format_version: String(archive.formatVersion),
        dc_schema_version: archive.application.schemaVersion,
        dc_sha256: archive.seal.digest
      }
    };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${ARCHIVE_MIME}\r\n\r\n`,
      serialized,
      `\r\n--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` });
    return driveRequest(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size,appProperties,description`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
  }

  async function listBackups() {
    const folder = await ensureFolder();
    const files = [];
    let pageToken = '';
    do {
      const query = `'${escapeDriveQuery(folder.id)}' in parents and trashed = false and mimeType = '${ARCHIVE_MIME}'`;
      const params = new URLSearchParams({
        q: query,
        spaces: 'drive',
        pageSize: '100',
        orderBy: 'createdTime desc',
        fields: 'nextPageToken,files(id,name,createdTime,modifiedTime,size,appProperties,description)'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await driveRequest(`/files?${params}`);
      files.push(...(page.files || []).filter(file => file.appProperties?.dc_format === DataPortability.FORMAT));
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return files;
  }

  async function fetchArchive(fileId) {
    const encodedId = encodeURIComponent(fileId);
    const metadata = await driveRequest(`/files/${encodedId}?fields=id,size,mimeType,trashed,appProperties`);
    const size = Number(metadata?.size);
    if (metadata?.trashed || metadata?.mimeType !== ARCHIVE_MIME || metadata?.appProperties?.dc_format !== DataPortability.FORMAT) {
      throw new Error('The selected Drive file is not an active DramaConnect portable archive.');
    }
    if (!Number.isSafeInteger(size) || size < 0 || size > DataPortability.MAX_ARCHIVE_BYTES) {
      throw new Error('Drive archive size is missing, unsafe, or exceeds the 100 MB browser restore limit.');
    }
    const archive = await driveRequest(`/files/${encodedId}?alt=media`);
    DataPortability.assertArchiveSize(JSON.stringify(archive));
    const verification = await DataPortability.verifyArchive(archive);
    if (!verification.ok) {
      const error = new Error(`Drive archive integrity check failed: ${verification.errors.join(' ')}`);
      error.code = 'ARCHIVE_INTEGRITY_FAILED';
      throw error;
    }
    return { archive, verification };
  }

  async function trimRetention(retentionCount, protectedId) {
    const files = await listBackups();
    const keep = Math.min(50, Math.max(1, Number(retentionCount) || 12));
    const failures = [];
    for (const file of files.slice(keep)) {
      if (file.id === protectedId) continue;
      try { await driveRequest(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' }); }
      catch (error) { failures.push(`${file.name}: ${cleanError(error)}`); }
    }
    return failures;
  }

  async function backup(triggerSource = 'manual', options = {}) {
    if (!hasUsableToken()) {
      const error = new Error('Connect Google Drive before starting a backup.');
      error.code = 'DRIVE_RECONNECT_REQUIRED';
      throw error;
    }
    return Resilience.withBackupLease('drive', triggerSource, async () => {
      const settings = await getSettings(true);
      const folder = await ensureFolder();
      const archive = await DataPortability.buildArchive(options);
      const serialized = DataPortability.serializeArchive(archive);
      const uploaded = await uploadArchive(folder.id, archive, serialized);
      try {
        const verified = await fetchArchive(uploaded.id);
        if (verified.verification.digest !== archive.seal.digest) throw new Error('Uploaded archive digest differs from the local seal.');
      } catch (error) {
        try { await driveRequest(`/files/${encodeURIComponent(uploaded.id)}`, { method: 'DELETE' }); } catch (_) { /* quarantine by deletion best effort */ }
        throw error;
      }
      const retentionWarnings = await trimRetention(settings?.retention_count, uploaded.id);
      return {
        archive,
        file: uploaded,
        warnings: retentionWarnings,
        metadata: {
          ...DataPortability.archiveMetadata(archive, serialized),
          remoteFileId: uploaded.id
        }
      };
    }, 3600);
  }

  async function restore(fileId, mode = 'merge', options = {}) {
    const { archive } = await fetchArchive(fileId);
    return DataPortability.restoreVerifiedArchive(archive, mode, { ...options, destination: 'drive-restore' });
  }

  async function download(fileId) {
    const { archive } = await fetchArchive(fileId);
    const serialized = DataPortability.serializeArchive(archive);
    const blob = new Blob([serialized], { type: ARCHIVE_MIME });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = DataPortability.archiveFileName(archive);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  async function remove(fileId) {
    await driveRequest(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    return true;
  }

  function scheduleState(settings) {
    const intervalMs = Math.max(1, Number(settings?.interval_days || 7)) * 86_400_000;
    const graceMs = Math.max(0, Number(settings?.overdue_grace_hours || 24)) * 3_600_000;
    const anchor = settings?.last_success_at || settings?.updated_at || new Date().toISOString();
    const dueAt = new Date(anchor).getTime() + intervalMs;
    const overdueAt = dueAt + graceMs;
    return {
      enabled: Boolean(settings?.schedule_enabled),
      due: Date.now() >= dueAt,
      overdue: Date.now() >= overdueAt,
      dueAt: new Date(dueAt).toISOString(),
      overdueAt: new Date(overdueAt).toISOString()
    };
  }

  function showReconnectWarning(state) {
    const today = new Date().toISOString().slice(0, 10);
    let shown = '';
    try { shown = localStorage.getItem(WARNING_KEY) || ''; } catch (_) { /* private mode */ }
    window.dispatchEvent(new CustomEvent('dc:drive-overdue', { detail: state }));
    if (shown === today) return;
    try { localStorage.setItem(WARNING_KEY, today); } catch (_) { /* private mode */ }
    if (window.UI?.toast) {
      UI.toast('Google Drive backup is overdue. An administrator must reconnect Drive from Settings; no popup was opened automatically.', 'warning', 12_000);
    }
  }

  async function isApprovedAdmin() {
    const { data: authData } = await db().auth.getUser();
    const user = authData?.user;
    if (!user) return false;
    const { data, error } = await db().from('profiles').select('role,status').eq('id', user.id).maybeSingle();
    return !error && data?.role === 'admin' && data?.status === 'approved';
  }

  async function runScheduledCheck(reason = 'interval') {
    if (schedulerRunning || document.visibilityState === 'hidden') return { status: 'deferred' };
    schedulerRunning = true;
    try {
      if (!(await isApprovedAdmin())) return { status: 'not-admin' };
      const settings = await getSettings(true);
      const state = scheduleState(settings);
      if (!state.enabled || !state.due) return { status: 'not-due', state };

      let retryAfter = 0;
      try { retryAfter = Number(localStorage.getItem(RETRY_KEY) || 0); } catch (_) { /* private mode */ }
      if (Date.now() < retryAfter) return { status: 'retry-throttled', state };

      // Critical UX/security rule: an automatic check uses only a still-valid,
      // in-memory token. It never invokes GIS and therefore never opens a popup.
      if (!hasUsableToken()) {
        if (state.overdue) showReconnectWarning(state);
        return { status: 'reconnect-required', state };
      }

      const result = await backup('scheduled');
      try { localStorage.removeItem(RETRY_KEY); } catch (_) { /* private mode */ }
      window.dispatchEvent(new CustomEvent('dc:scheduled-drive-backup', { detail: { reason, result } }));
      return { status: 'backed-up', state, result };
    } catch (error) {
      try { localStorage.setItem(RETRY_KEY, String(Date.now() + 30 * 60 * 1000)); } catch (_) { /* private mode */ }
      console.warn('[DriveSync] Scheduled check failed:', cleanError(error));
      return { status: 'failed', error };
    } finally {
      schedulerRunning = false;
    }
  }

  function initScheduler() {
    if (schedulerInstalled) return;
    schedulerInstalled = true;
    const check = () => runScheduledCheck('page-activity');
    setTimeout(check, 2500);
    intervalId = setInterval(() => runScheduledCheck('interval'), CHECK_INTERVAL_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  }

  function stopScheduler() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    schedulerInstalled = false;
  }

  function status() {
    return {
      connected: hasUsableToken(),
      expiresAt: tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : null,
      account: account?.user || null,
      scope: SCOPE
    };
  }

  window.addEventListener('dc:backup-settings-changed', event => {
    settingsCache = event.detail || null;
    tokenClient = null;
  });

  window.DriveSync = Object.freeze({
    SCOPE,
    getSettings,
    connect,
    disconnect,
    status,
    ensureFolder,
    listBackups,
    backup,
    fetchArchive,
    restore,
    download,
    remove,
    scheduleState,
    runScheduledCheck,
    initScheduler,
    stopScheduler
  });
})();
