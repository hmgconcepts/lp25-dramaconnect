/*
 * DramaConnect portable archives.
 * Full, paginated export of all 22 application/configuration tables with a
 * deterministic manifest and SHA-256 integrity seal. Restore is admin-only,
 * merge/upsert based, verified before the first write, and fully reported.
 */
(() => {
  'use strict';

  const FORMAT = 'dramaconnect-portable-archive';
  const FORMAT_VERSION = 2;
  const SCHEMA_VERSION = '13.2';
  const PAGE_SIZE = 500;
  const MAX_LOCAL_ARCHIVE_BYTES = 100 * 1024 * 1024;
  const MAX_VAULT_ARCHIVE_BYTES = 50 * 1024 * 1024;
  const VAULT_BUCKET = 'dramaconnect-backups';

  // Dependency order is also the normal restore order. These are the 22
  // application/configuration tables; resilience history and leases are
  // intentionally excluded to prevent recursive operational backups.
  const TABLES = Object.freeze([
    { name: 'profiles', key: 'id', identity: true },
    { name: 'productions', key: 'id' },
    { name: 'rehearsals', key: 'id' },
    { name: 'events', key: 'id' },
    { name: 'polls', key: 'id' },
    { name: 'finances', key: 'id' },
    { name: 'announcements', key: 'id' },
    { name: 'messages', key: 'id' },
    { name: 'reminders', key: 'id' },
    { name: 'resources', key: 'id' },
    { name: 'inventory', key: 'id' },
    { name: 'tenant_settings', key: 'id' },
    { name: 'activity_log', key: 'id' },
    { name: 'budgets', key: 'production_id' },
    { name: 'cast_list', key: 'id', identity: true },
    { name: 'attendance', key: 'id', identity: true },
    { name: 'inbox', key: 'id', identity: true },
    { name: 'tasks', key: 'id', identity: true },
    { name: 'poll_votes', key: 'id', identity: true },
    { name: 'event_rsvps', key: 'id', identity: true },
    { name: 'gallery', key: 'id' },
    { name: 'suggestions', key: 'id' }
  ]);

  const TABLE_BY_NAME = new Map(TABLES.map(table => [table.name, table]));
  const IDENTITY_TRIGGER_TABLES = new Set(['activity_log', 'inbox', 'gallery', 'suggestions']);
  const DEGRADED_SKIP_TABLES = new Set([
    'profiles', 'cast_list', 'attendance', 'inbox', 'tasks', 'poll_votes', 'event_rsvps'
  ]);

  const db = () => window.supabaseClient;

  function assertDependencies() {
    if (!db()) throw new Error('The database client is not initialized.');
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable. Use DramaConnect over HTTPS.');
  }

  function stableStringify(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Archive contains a non-finite number.');
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(item => stableStringify(item === undefined ? null : item)).join(',')}]`;
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
      return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    throw new TypeError(`Unsupported archive value type: ${typeof value}`);
  }

  async function sha256Text(text) {
    assertDependencies();
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function countTable(table) {
    const { count, error } = await db().from(table).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`${table}: ${error.message || error}`);
    return Number(count || 0);
  }

  async function readStableTable(definition, onProgress) {
    let lastReason = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const expectedCount = await countTable(definition.name);
      const rows = [];
      let page = 0;

      while (rows.length < expectedCount) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await db().from(definition.name)
          .select('*')
          .order(definition.key, { ascending: true })
          .range(from, to);
        if (error) throw new Error(`${definition.name}: ${error.message || error}`);
        const batch = data || [];
        rows.push(...batch);
        page += 1;
        onProgress?.({ table: definition.name, rows: rows.length, expected: expectedCount, attempt });
        if (batch.length < PAGE_SIZE) break;
      }

      const finalCount = await countTable(definition.name);
      if (expectedCount === finalCount && rows.length === expectedCount) {
        return { rows, pages: page, countBefore: expectedCount, countAfter: finalCount };
      }
      lastReason = `${definition.name} changed while exporting (${expectedCount} → ${finalCount}; read ${rows.length}).`;
    }
    throw new Error(`${lastReason} Try again when writes are quiet, or use the unattended pg_dump workflow.`);
  }

  function appVersion() {
    return document.querySelector('meta[name="app-version"]')?.content || '13.2';
  }

  async function buildArchive(options = {}) {
    assertDependencies();
    const exportedAt = new Date().toISOString();
    const archive = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      application: {
        name: 'DramaConnect',
        version: appVersion(),
        schemaVersion: SCHEMA_VERSION,
        exportedAt,
        origin: location.origin
      },
      scope: {
        included: '22 public application/configuration tables visible to an approved administrator',
        excludes: [
          'Supabase Auth password/session data',
          'Supabase Storage object bytes',
          'resilience heartbeat, lease and run-history tables'
        ]
      },
      manifest: {
        pageSize: PAGE_SIZE,
        expectedTables: TABLES.map(table => table.name),
        tableCount: TABLES.length,
        totalRows: 0,
        tables: []
      },
      data: {}
    };

    for (let index = 0; index < TABLES.length; index += 1) {
      const definition = TABLES[index];
      options.onProgress?.({ phase: 'table', index: index + 1, total: TABLES.length, table: definition.name });
      const result = await readStableTable(definition, options.onProgress);
      archive.data[definition.name] = result.rows;
      const tableDigest = await sha256Text(stableStringify(result.rows));
      archive.manifest.tables.push({
        name: definition.name,
        primaryKey: definition.key,
        rowCount: result.rows.length,
        pages: result.pages,
        sha256: tableDigest
      });
      archive.manifest.totalRows += result.rows.length;
    }

    archive.seal = {
      algorithm: 'SHA-256',
      canonicalization: 'stable-json-v1',
      digest: await sha256Text(stableStringify(archive))
    };
    const verification = await verifyArchive(archive);
    if (!verification.ok) {
      throw new Error(`Generated archive failed its integrity check: ${verification.errors.join(' ')}`);
    }
    return archive;
  }

  function isPlainRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  async function verifyArchive(archive) {
    assertDependencies();
    const errors = [];
    const warnings = [];
    if (!isPlainRecord(archive)) throw new Error('The selected file is not a JSON object.');
    if (archive.format !== FORMAT) errors.push(`Unsupported archive format: ${archive.format || 'missing'}.`);
    if (archive.formatVersion !== FORMAT_VERSION) errors.push(`Unsupported format version: ${archive.formatVersion ?? 'missing'}.`);
    if (!isPlainRecord(archive.application) || archive.application.schemaVersion !== SCHEMA_VERSION) {
      errors.push(`Unsupported schema version: ${archive.application?.schemaVersion ?? 'missing'}.`);
    }
    if (!isPlainRecord(archive.manifest) || !isPlainRecord(archive.data)) errors.push('Archive manifest or data section is missing.');
    if (!isPlainRecord(archive.seal) || archive.seal.algorithm !== 'SHA-256' || archive.seal.canonicalization !== 'stable-json-v1') {
      errors.push('A supported SHA-256 archive seal is missing.');
    } else if (!/^[a-f0-9]{64}$/.test(String(archive.seal.digest || '').toLowerCase())) {
      errors.push('Archive seal digest is malformed.');
    }
    if (errors.length) return { ok: false, errors, warnings };

    const expectedNames = TABLES.map(table => table.name);
    const listedNames = Array.isArray(archive.manifest.expectedTables) ? archive.manifest.expectedTables : [];
    if (listedNames.length !== expectedNames.length || listedNames.some((name, index) => name !== expectedNames[index])) {
      errors.push('Expected-table manifest is incomplete, duplicated, extra, or out of order.');
    }
    const missing = expectedNames.filter(name => !Array.isArray(archive.data[name]));
    if (missing.length) errors.push(`Required tables are missing: ${missing.join(', ')}.`);
    const extras = Object.keys(archive.data).filter(name => !TABLE_BY_NAME.has(name));
    if (extras.length) warnings.push(`Unknown tables will not be restored: ${extras.join(', ')}.`);

    const manifestItems = Array.isArray(archive.manifest.tables) ? archive.manifest.tables : [];
    const manifestNames = manifestItems.map(item => item?.name);
    if (manifestNames.length !== expectedNames.length || manifestNames.some((name, index) => name !== expectedNames[index])) {
      errors.push('Per-table manifest is incomplete, duplicated, extra, or out of order.');
    }
    const manifestTables = new Map(manifestItems.map(item => [item?.name, item]));
    let totalRows = 0;
    for (const definition of TABLES) {
      const rows = archive.data[definition.name];
      if (!Array.isArray(rows)) continue;
      const item = manifestTables.get(definition.name);
      if (!item) {
        errors.push(`${definition.name}: table manifest is missing.`);
        continue;
      }
      if (item.primaryKey !== definition.key) errors.push(`${definition.name}: unexpected primary key metadata.`);
      if (item.rowCount !== rows.length) errors.push(`${definition.name}: row-count mismatch.`);
      totalRows += rows.length;

      const seen = new Set();
      for (const [index, row] of rows.entries()) {
        if (!isPlainRecord(row)) {
          errors.push(`${definition.name}[${index}]: row is not an object.`);
          continue;
        }
        const key = row[definition.key];
        if (key === null || key === undefined || key === '') errors.push(`${definition.name}[${index}]: primary key is missing.`);
        const normalizedKey = String(key);
        if (seen.has(normalizedKey)) errors.push(`${definition.name}: duplicate primary key ${normalizedKey}.`);
        seen.add(normalizedKey);
      }

      const tableDigest = await sha256Text(stableStringify(rows));
      if (tableDigest !== String(item.sha256 || '').toLowerCase()) errors.push(`${definition.name}: SHA-256 mismatch.`);
    }
    if (!Number.isSafeInteger(archive.manifest.totalRows) || archive.manifest.totalRows !== totalRows) {
      errors.push('Total row count does not match the manifest.');
    }
    if (!Number.isSafeInteger(archive.manifest.tableCount) || archive.manifest.tableCount !== TABLES.length) {
      errors.push('Table count does not match this DramaConnect archive version.');
    }
    if (!archive.application?.exportedAt || !Number.isFinite(Date.parse(archive.application.exportedAt))) {
      errors.push('Archive export timestamp is missing or invalid.');
    }

    const withoutSeal = { ...archive };
    delete withoutSeal.seal;
    const digest = await sha256Text(stableStringify(withoutSeal));
    if (digest !== String(archive.seal.digest || '').toLowerCase()) errors.push('Archive SHA-256 seal does not match its contents.');

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      digest,
      totalRows,
      tableCount: TABLES.length,
      exportedAt: archive.application?.exportedAt || null
    };
  }

  function serializedByteSize(serialized) {
    return new TextEncoder().encode(serialized).byteLength;
  }

  function assertArchiveSize(serialized, maximum = MAX_LOCAL_ARCHIVE_BYTES, label = 'browser archive') {
    const size = serializedByteSize(serialized);
    if (size > maximum) {
      throw new Error(`The ${label} is ${(size / 1048576).toFixed(1)} MB and exceeds the ${(maximum / 1048576).toFixed(0)} MB limit. Use the encrypted pg_dump workflow instead.`);
    }
    return size;
  }

  function serializeArchive(archive) {
    const serialized = JSON.stringify(archive, null, 2);
    assertArchiveSize(serialized);
    return serialized;
  }

  function archiveFileName(archive) {
    const stamp = String(archive?.application?.exportedAt || new Date().toISOString())
      .replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
    return `dramaconnect-portable-${stamp}.json`;
  }

  function archiveMetadata(archive, serialized) {
    return {
      sha256: archive.seal.digest,
      size: new Blob([serialized], { type: 'application/json' }).size,
      rows: archive.manifest.totalRows
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadLocal(options = {}) {
    return Resilience.withBackupLease('local', 'manual', async () => {
      const archive = await buildArchive(options);
      const serialized = serializeArchive(archive);
      const filename = archiveFileName(archive);
      downloadBlob(new Blob([serialized], { type: 'application/json' }), filename);
      return { archive, filename, metadata: archiveMetadata(archive, serialized) };
    }, 3600);
  }

  async function parseArchiveFile(file) {
    if (!file) throw new Error('Choose a DramaConnect archive file.');
    if (file.size > MAX_LOCAL_ARCHIVE_BYTES) throw new Error('Archive exceeds the 100 MB browser restore limit. Use pg_restore instead.');
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch (_) { throw new Error('The selected file is not valid JSON.'); }
    return parsed;
  }

  function degradedRows(table, rows) {
    if (DEGRADED_SKIP_TABLES.has(table)) return [];
    if (table === 'suggestions') return rows.map(row => ({ ...row, author_id: null }));
    if (table === 'gallery') return rows.map(row => ({ ...row, uploaded_by_id: null }));
    return rows;
  }

  async function upsertBatch(definition, rows, report) {
    if (!rows.length) return;
    const { error } = await db().from(definition.name)
      .upsert(rows, { onConflict: definition.key, ignoreDuplicates: false });
    if (!error) {
      report.restoredRows += rows.length;
      // Hardened identity triggers normalize browser inserts. A second admin
      // update restores original audit fields after the row safely exists.
      if (IDENTITY_TRIGGER_TABLES.has(definition.name)) {
        for (const row of rows) {
          const { error: updateError } = await db().from(definition.name)
            .update(row)
            .eq(definition.key, row[definition.key]);
          if (updateError) report.warnings.push(`Could not exactly restore ${definition.name}/${row[definition.key]} audit fields: ${updateError.message}`);
        }
      }
      return;
    }

    if (rows.length > 1) {
      const midpoint = Math.ceil(rows.length / 2);
      await upsertBatch(definition, rows.slice(0, midpoint), report);
      await upsertBatch(definition, rows.slice(midpoint), report);
      return;
    }

    report.failedRows += 1;
    if (report.errors.length < 25) {
      report.errors.push({ key: String(rows[0]?.[definition.key] ?? ''), message: String(error.message || error).slice(0, 300) });
    }
  }

  async function restoreVerifiedArchive(archive, mode = 'merge', options = {}) {
    if (!['merge', 'degraded'].includes(mode)) throw new Error('Unsupported restore mode.');
    const verification = await verifyArchive(archive);
    if (!verification.ok) {
      const failure = new Error(`Archive verification failed: ${verification.errors.join(' ')}`);
      failure.code = 'ARCHIVE_INTEGRITY_FAILED';
      failure.verification = verification;
      throw failure;
    }

    const destination = options.destination || 'local-restore';
    const run = await Resilience.beginBackup(destination, 'import', 3600);
    const report = {
      ok: true,
      mode,
      startedAt: new Date().toISOString(),
      completedAt: null,
      archiveDigest: verification.digest,
      archiveRows: verification.totalRows,
      warnings: [...verification.warnings],
      tables: [],
      totals: { restored: 0, failed: 0, skipped: 0 }
    };

    try {
      for (const definition of TABLES) {
        const sourceRows = archive.data[definition.name] || [];
        const rows = mode === 'degraded' ? degradedRows(definition.name, sourceRows) : sourceRows;
        const tableReport = {
          table: definition.name,
          inputRows: sourceRows.length,
          restoredRows: 0,
          failedRows: 0,
          skippedRows: sourceRows.length - rows.length,
          errors: [],
          warnings: []
        };
        options.onProgress?.({ phase: 'restore', table: definition.name, rows: rows.length });
        for (let offset = 0; offset < rows.length; offset += 100) {
          await upsertBatch(definition, rows.slice(offset, offset + 100), tableReport);
        }
        report.tables.push(tableReport);
        report.totals.restored += tableReport.restoredRows;
        report.totals.failed += tableReport.failedRows;
        report.totals.skipped += tableReport.skippedRows;
      }

      if (mode === 'degraded') {
        report.warnings.push('Identity-linked records were skipped because Supabase Auth users must be recreated separately.');
      }
      report.ok = report.totals.failed === 0;
      report.completedAt = new Date().toISOString();
      await Resilience.finishBackup(run, report.ok ? 'succeeded' : 'failed', {
        sha256: verification.digest,
        rows: report.totals.restored,
        errorCode: report.ok ? null : 'PARTIAL_RESTORE',
        errorMessage: report.ok ? null : `${report.totals.failed} row(s) could not be restored.`
      });
      return report;
    } catch (error) {
      report.ok = false;
      report.completedAt = new Date().toISOString();
      try {
        await Resilience.finishBackup(run, 'failed', {
          sha256: verification.digest,
          rows: report.totals.restored,
          errorCode: error.code || 'RESTORE_FAILED',
          errorMessage: error.message
        });
      } catch (_) { /* original failure is more useful */ }
      error.restoreReport = report;
      throw error;
    }
  }

  async function restoreFile(file, mode = 'merge', options = {}) {
    return restoreVerifiedArchive(await parseArchiveFile(file), mode, options);
  }

  async function uploadVault(options = {}) {
    return Resilience.withBackupLease('vault', 'manual', async () => {
      const archive = await buildArchive(options);
      const serialized = serializeArchive(archive);
      assertArchiveSize(serialized, MAX_VAULT_ARCHIVE_BYTES, 'Supabase vault archive');
      const filename = archiveFileName(archive);
      const { data, error } = await db().storage.from(VAULT_BUCKET).upload(filename, serialized, {
        contentType: 'application/json',
        cacheControl: 'no-store',
        upsert: false
      });
      if (error) throw new Error(error.message || String(error));
      return {
        archive,
        filename,
        path: data?.path || filename,
        metadata: { ...archiveMetadata(archive, serialized), remoteFileId: data?.path || filename }
      };
    }, 3600);
  }

  async function listVault() {
    const { data, error } = await db().storage.from(VAULT_BUCKET).list('', {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' }
    });
    if (error) throw new Error(error.message || String(error));
    return (data || []).filter(item => item.name?.endsWith('.json'));
  }

  async function downloadVault(path) {
    const { data, error } = await db().storage.from(VAULT_BUCKET).download(path);
    if (error) throw new Error(error.message || String(error));
    if (data.size > MAX_LOCAL_ARCHIVE_BYTES) {
      throw new Error('Vault object exceeds the 100 MB browser restore limit. Use the guarded recovery tools instead.');
    }
    const text = await data.text();
    let archive;
    try { archive = JSON.parse(text); } catch (_) { throw new Error('Vault object is not valid JSON.'); }
    const verification = await verifyArchive(archive);
    if (!verification.ok) throw new Error(`Vault archive failed verification: ${verification.errors.join(' ')}`);
    return { archive, verification, text };
  }

  async function restoreVault(path, mode = 'merge', options = {}) {
    const { archive } = await downloadVault(path);
    return restoreVerifiedArchive(archive, mode, { ...options, destination: 'vault-restore' });
  }

  async function deleteVault(path) {
    const { error } = await db().storage.from(VAULT_BUCKET).remove([path]);
    if (error) throw new Error(error.message || String(error));
    return true;
  }

  function rowsToCsv(rows) {
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const escape = value => {
      const normalized = value === null || value === undefined ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
      return `"${normalized.replace(/"/g, '""')}"`;
    };
    return [columns.map(escape).join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\r\n');
  }

  async function downloadTableCsv(tableName) {
    const definition = TABLE_BY_NAME.get(tableName);
    if (!definition) throw new Error('Unsupported export table.');
    const { rows } = await readStableTable(definition);
    downloadBlob(new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' }), `dramaconnect-${tableName}-${new Date().toISOString().slice(0, 10)}.csv`);
    return rows.length;
  }

  window.DataPortability = Object.freeze({
    FORMAT,
    FORMAT_VERSION,
    SCHEMA_VERSION,
    PAGE_SIZE,
    MAX_ARCHIVE_BYTES: MAX_LOCAL_ARCHIVE_BYTES,
    TABLES,
    stableStringify,
    assertArchiveSize,
    sha256Text,
    buildArchive,
    verifyArchive,
    serializeArchive,
    archiveFileName,
    archiveMetadata,
    downloadLocal,
    parseArchiveFile,
    restoreVerifiedArchive,
    restoreFile,
    uploadVault,
    listVault,
    downloadVault,
    restoreVault,
    deleteVault,
    downloadTableCsv,
    rowsToCsv
  });
})();
