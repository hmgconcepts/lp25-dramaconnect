/*
 * DramaConnect portable archives.
 * Full, paginated export of all 25 application/configuration tables with a
 * deterministic manifest and SHA-256 integrity seal. Restore is admin-only,
 * merge/upsert based, verified before the first write, and fully reported.
 */
(() => {
  'use strict';

  const FORMAT = 'dramaconnect-portable-archive';
  const FORMAT_VERSION = 2;
  const SCHEMA_VERSION = '14.1';
  // Archives written by these earlier releases still verify and restore: tables
  // that did not exist yet (marked `since`) are simply absent from them.
  const LEGACY_SCHEMA_VERSIONS = Object.freeze(['14.0']);
  const PAGE_SIZE = 500;
  const MAX_LOCAL_ARCHIVE_BYTES = 100 * 1024 * 1024;
  const MAX_VAULT_ARCHIVE_BYTES = 50 * 1024 * 1024;
  const VAULT_BUCKET = 'dramaconnect-backups';

  // Dependency order is also the normal restore order. These are the 25
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
    { name: 'dc_platform_settings', key: 'id' },
    { name: 'dc_retention_settings', key: 'id' },
    { name: 'dc_site_license', key: 'id' },
    { name: 'activity_log', key: 'id' },
    { name: 'budgets', key: 'production_id' },
    { name: 'cast_list', key: 'id', identity: true },
    { name: 'attendance', key: 'id', identity: true },
    { name: 'inbox', key: 'id', identity: true },
    { name: 'tasks', key: 'id', identity: true },
    { name: 'poll_votes', key: 'id', identity: true },
    { name: 'event_rsvps', key: 'id', identity: true },
    { name: 'gallery', key: 'id' },
    { name: 'suggestions', key: 'id' },
    // v14.1 — identity cards, programmes, duty roster, member care.
    { name: 'dc_card_settings', key: 'id', since: '14.1' },
    { name: 'dc_programs', key: 'id', since: '14.1' },
    { name: 'dc_member_cards', key: 'member_id', identity: true, since: '14.1' },
    { name: 'dc_program_registrations', key: 'id', since: '14.1' },
    { name: 'dc_duty_roster', key: 'id', identity: true, since: '14.1' },
    { name: 'dc_care_cases', key: 'id', identity: true, since: '14.1' }
  ]);

  /** Table names an archive of `version` must contain, in archive order. */
  function expectedTablesFor(version) {
    if (version === SCHEMA_VERSION) return TABLES.map(table => table.name);
    return TABLES.filter(table => !table.since).map(table => table.name);
  }

  const TABLE_BY_NAME = new Map(TABLES.map(table => [table.name, table]));
  const IDENTITY_TRIGGER_TABLES = new Set(['activity_log', 'inbox', 'gallery', 'suggestions']);
  const DEGRADED_SKIP_TABLES = new Set([
    'profiles', 'cast_list', 'attendance', 'inbox', 'tasks', 'poll_votes', 'event_rsvps',
    'dc_member_cards', 'dc_duty_roster', 'dc_care_cases'
  ]);

  /* ------------------------------------------------------------------------
   * V15 DISASTER RECOVERY MODE
   *
   * Restoring an archive onto a BRAND-NEW Supabase project is not the same
   * job as restoring onto the project the archive came from. On a fresh
   * project the Supabase Auth users behind `profiles` no longer exist, so
   * every foreign key that points at a member will be rejected — and a single
   * rejected row used to sink the whole batch.
   *
   * The legacy `degraded` mode solved this by DROPPING ENTIRE TABLES. That was
   * a serious data-loss bug: it silently discarded every attendance record,
   * cast assignment, task, inbox message, poll vote and event RSVP — which is
   * precisely the operational history a recovery exists to save.
   *
   * `recovery` mode instead:
   *   1. keeps the rows, and neutralises ONLY the account-reference columns;
   *   2. records every neutralised reference in a RECOVERY LEDGER so the
   *      human link is not lost — it is deferred;
   *   3. offers a RE-LINK PASS: once members re-register on the new project,
   *      the ledger plus an email->new-uuid map restores the original links.
   *
   * Net effect: attendance dates, status, casting, task content, votes and
   * RSVPs all survive. Only the pointer to WHO is temporarily null, and it
   * can be rebuilt in one pass instead of retyped by hand.
   * ---------------------------------------------------------------------- */

  // Tables whose rows cannot exist without a live auth user. Re-created by
  // sign-up and re-approval, never imported.
  // Rows whose NOT NULL member reference cannot survive without the old Auth
  // users are skipped (cards are simply re-issued; rosters/cases re-created).
  const RECOVERY_SKIP_TABLES = new Set(['profiles', 'dc_member_cards', 'dc_duty_roster', 'dc_care_cases']);

  // Column-level neutralisation. Ownership/audit metadata only — never drama
  // data such as names, dates, status, amounts or script assignments.
  const RECOVERY_FK_COLUMNS = Object.freeze({
    attendance: ['member_id'],
    cast_list: ['member_id'],
    dc_platform_settings: ['updated_by'],
    dc_retention_settings: ['updated_by'],
    dc_site_license: ['updated_by'],
    event_rsvps: ['member_id'],
    inbox: ['recipient_id', 'sender_id'],
    poll_votes: ['voter_id'],
    suggestions: ['author_id'],
    tasks: ['assignee_id'],
    dc_programs: ['created_by'],
    dc_program_registrations: ['member_id', 'checked_in_by']
  });

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
    return document.querySelector('meta[name="app-version"]')?.content || '14.1';
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
        included: '25 public application/configuration tables visible to an approved administrator',
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
    const archiveVersion = isPlainRecord(archive.application) ? archive.application.schemaVersion : undefined;
    if (archiveVersion !== SCHEMA_VERSION && !LEGACY_SCHEMA_VERSIONS.includes(archiveVersion)) {
      errors.push(`Unsupported schema version: ${archive.application?.schemaVersion ?? 'missing'}.`);
    }
    if (!isPlainRecord(archive.manifest) || !isPlainRecord(archive.data)) errors.push('Archive manifest or data section is missing.');
    if (!isPlainRecord(archive.seal) || archive.seal.algorithm !== 'SHA-256' || archive.seal.canonicalization !== 'stable-json-v1') {
      errors.push('A supported SHA-256 archive seal is missing.');
    } else if (!/^[a-f0-9]{64}$/.test(String(archive.seal.digest || '').toLowerCase())) {
      errors.push('Archive seal digest is malformed.');
    }
    if (errors.length) return { ok: false, errors, warnings };

    const expectedNames = expectedTablesFor(archiveVersion);
    if (archiveVersion !== SCHEMA_VERSION) {
      warnings.push(`This archive was written by schema ${archiveVersion}; tables added later (${TABLES.filter(t => t.since).map(t => t.name).join(', ')}) are not in it and will be left untouched.`);
    }
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
      if (!Array.isArray(rows) || !expectedNames.includes(definition.name)) continue;
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
    if (!Number.isSafeInteger(archive.manifest.tableCount) || archive.manifest.tableCount !== expectedNames.length) {
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
      tableCount: expectedNames.length,
      schemaVersion: archiveVersion,
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

  /**
   * Prepare rows for a restore in the requested mode.
   *
   * 'merge'    - verbatim upsert. Correct when restoring onto the SAME project.
   * 'degraded' - legacy behaviour, preserved for older callers. NOTE: this mode
   *              drops whole tables and is retained only so existing scripts
   *              keep working; use 'recovery' for a fresh database.
   * 'recovery' - fresh-database restore. Keeps every row, neutralises only the
   *              account-reference columns, and records the severed links in a
   *              ledger so they can be re-attached later instead of lost.
   *
   * `ledger` is an optional array that, when supplied, receives one entry per
   * neutralised reference: { table, rowId, column, previousUserId }.
   */
  function prepareRows(table, rows, mode, ledger) {
    if (mode === 'degraded') {
      if (DEGRADED_SKIP_TABLES.has(table)) return [];
      if (table === 'suggestions') return rows.map(row => ({ ...row, author_id: null }));
      if (table === 'gallery') return rows.map(row => ({ ...row, uploaded_by_id: null }));
      if (table === 'dc_programs') return rows.map(row => ({ ...row, created_by: null }));
      if (table === 'dc_program_registrations') return rows.map(row => ({ ...row, member_id: null, checked_in_by: null }));
      return rows;
    }

    if (mode !== 'recovery') return rows;

    if (RECOVERY_SKIP_TABLES.has(table)) return [];

    const columns = RECOVERY_FK_COLUMNS[table];
    if (!columns) return rows;

    const definition = TABLE_BY_NAME.get(table);
    return rows.map(row => {
      const next = { ...row };
      for (const column of columns) {
        if (next[column] == null) continue;
        if (ledger) {
          ledger.push({
            table,
            rowId: row[definition ? definition.key : 'id'] ?? null,
            column,
            previousUserId: next[column]
          });
        }
        next[column] = null;
      }
      return next;
    });
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

    // Bisect until the offending row is isolated. This is the row-level retry:
    // it costs O(log n) requests instead of one request per row, and it still
    // guarantees that a single bad row cannot sink the other 199.
    if (rows.length > 1) {
      const midpoint = Math.ceil(rows.length / 2);
      await upsertBatch(definition, rows.slice(0, midpoint), report);
      await upsertBatch(definition, rows.slice(midpoint), report);
      return;
    }

    // Binary splitting has already reduced the batch to a single row, so this
    // is the exact row that is genuinely bad. Record it and let the caller
    // continue: one malformed row must never cost the rest of the table.
    report.failedRows += 1;
    if (report.errors.length < 25) {
      report.errors.push({ key: String(rows[0]?.[definition.key] ?? ''), message: String(error.message || error).slice(0, 300) });
    }
  }

  async function restoreVerifiedArchive(archive, mode = 'merge', options = {}) {
    if (!['merge', 'degraded', 'recovery'].includes(mode)) throw new Error('Unsupported restore mode.');
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
      totals: { restored: 0, failed: 0, skipped: 0 },
      recovery: mode === 'recovery'
        ? { ledger: [], severedReferences: 0, affectedTables: [] }
        : null
    };

    try {
      for (const definition of TABLES) {
        const sourceRows = archive.data[definition.name] || [];
        const rows = prepareRows(
          definition.name,
          sourceRows,
          mode,
          report.recovery ? report.recovery.ledger : null
        );
        const tableReport = {
          recoveryMode: mode === 'recovery',
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
        report.warnings.push('Identity-linked records were skipped because Supabase Auth users must be recreated separately. Use recovery mode to keep these rows.');
      }

      if (report.recovery) {
        const ledger = report.recovery.ledger;
        report.recovery.severedReferences = ledger.length;
        report.recovery.affectedTables = [...new Set(ledger.map(entry => entry.table))].sort();
        report.recovery.hint = ledger.length
          ? `${ledger.length} member link(s) were deferred, not deleted. Download the re-link manifest, then run the re-link pass after members re-register.`
          : 'No member links needed deferring.';
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

  /* ======================================================================
   * RE-LINK PASS — the step that makes recovery better than "restore".
   *
   * A conventional recovery nulls account references and the human link is
   * gone forever: you know someone attended on 4 March, but not who. The
   * re-link pass closes that gap automatically.
   *
   * After members re-register on the fresh project, each person has a NEW
   * Supabase Auth UUID but the SAME email address. Email is therefore a
   * stable bridge between the old identity and the new one. This pass:
   *   1. reads the ledger produced by recovery mode;
   *   2. resolves each severed old UUID to an email using the archive;
   *   3. resolves each email to the new UUID using live profiles;
   *   4. rewrites the neutralised columns in place.
   *
   * Nothing is guessed. Rows whose email has no match are reported as
   * unmatched so the administrator can see exactly what still needs a human.
   * ==================================================================== */

  function buildRecoveryManifest(report, archive) {
    const ledger = report?.recovery?.ledger || [];
    const emailById = new Map();
    for (const profile of (archive?.data?.profiles || [])) {
      if (profile?.id && profile?.email) emailById.set(profile.id, String(profile.email).toLowerCase());
    }
    const entries = ledger.map(entry => ({
      ...entry,
      email: emailById.get(entry.previousUserId) || null
    }));
    return {
      format: 'dramaconnect-recovery-manifest',
      version: 1,
      createdAt: report?.completedAt || new Date().toISOString(),
      archiveDigest: report?.archiveDigest || null,
      severedReferences: entries.length,
      entries
    };
  }

  function downloadRecoveryManifest(report, archive) {
    const manifest = buildRecoveryManifest(report, archive);
    downloadBlob(
      new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
      `dramaconnect-relink-${new Date().toISOString().slice(0, 10)}.json`
    );
    return manifest;
  }

  /**
   * Re-attach severed member links by matching email addresses.
   * Returns { matched, unmatched, updated, tables } so the UI can report
   * precisely instead of claiming blanket success.
   */
  async function relinkRecoveryManifest(manifest, options = {}) {
    assertDependencies();
    const entries = manifest?.entries || [];
    if (!entries.length) throw new Error('The re-link manifest contains no deferred references.');

    const { data: profiles, error } = await db().from('profiles').select('id,email');
    if (error) throw new Error(`Cannot read the new member list: ${error.message}`);

    const newIdByEmail = new Map();
    for (const profile of profiles || []) {
      if (profile?.id && profile?.email) newIdByEmail.set(String(profile.email).toLowerCase(), profile.id);
    }

    const updates = new Map();
    let matched = 0;
    let unmatched = 0;

    for (const entry of entries) {
      const email = entry.email ? String(entry.email).toLowerCase() : null;
      const newId = email ? newIdByEmail.get(email) : null;
      if (!newId) { unmatched += 1; continue; }
      matched += 1;
      if (!updates.has(entry.table)) updates.set(entry.table, []);
      updates.get(entry.table).push({ rowId: entry.rowId, column: entry.column, value: newId });
    }

    const tables = [];
    let updated = 0;
    for (const [table, changes] of updates) {
      const definition = TABLE_BY_NAME.get(table);
      if (!definition) { tables.push({ table, applied: 0, error: 'Table is not in the portable allow-list.' }); continue; }
      let applied = 0;
      const errors = [];
      for (const change of changes) {
        if (change.rowId == null) { errors.push('Row identifier missing.'); continue; }
        const { error: updateError } = await db().from(table)
          .update({ [change.column]: change.value })
          .eq(definition.key, change.rowId);
        if (updateError) errors.push(String(updateError.message).slice(0, 200));
        else applied += 1;
      }
      updated += applied;
      tables.push({ table, applied, failed: changes.length - applied, errors: errors.slice(0, 5) });
      options.onProgress?.({ phase: 'relink', table, applied });
    }

    return { matched, unmatched, updated, tables };
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
    rowsToCsv,
    buildRecoveryManifest,
    downloadRecoveryManifest,
    relinkRecoveryManifest
  });
})();
