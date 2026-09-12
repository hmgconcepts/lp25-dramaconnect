#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parts = [
  ['01', 'Base schema, repair and safe account bootstrap', 'database/repair_and_upgrade.sql'],
  ['02', 'RLS and server-authoritative security', 'database/security_hardening.sql'],
  ['03', 'Resilience, backup coordination and private vault', 'database/resilience_and_backup.sql'],
  ['04', 'Control plane, storage governance, access and licensing', 'database/platform_management.sql'],
  ['05', 'Post-install self-heal, API cache reload and verification', 'database/post_install_selfheal.sql']
];

const chunks = [];
const manifest = [];
for (const [number, title, relative] of parts) {
  const source = (await readFile(join(root, relative), 'utf8')).trim() + '\n';
  const sha256 = createHash('sha256').update(source).digest('hex');
  manifest.push(`-- ${number} ${relative}  sha256:${sha256}`);
  chunks.push([
    '',
    '-- ============================================================================',
    `-- COMPONENT ${number}: ${title}`,
    `-- Source: ${relative}`,
    '-- ============================================================================',
    source
  ].join('\n'));
}

const header = `-- ============================================================================
-- DramaConnect v14.0 — CANONICAL COMPLETE DATABASE SCHEMA
-- ============================================================================
-- Paste this entire file into Supabase SQL Editor and run it once. It contains
-- the complete production schema, repair logic, RLS, RPCs, resilience/backup,
-- control-plane settings, storage governance, roles/status and site licensing.
-- No other production SQL file is required after this succeeds.
--
-- SAFE TO RERUN: every object is created/replaced/upserted idempotently. Existing
-- application rows are preserved. Missing auth profiles are backfilled as
-- PENDING; this installer never silently approves users or embeds an admin email.
--
-- FIRST ADMIN: sign up through the app, then deliberately approve that exact
-- profile using the clearly marked optional statement in component 01. Keep that
-- one-off owner action private; never put a real privileged email in source.
--
-- Individual database/*.sql files are maintained migration components for source
-- review and upgrades. This generated file is the deployment authority.
--
-- COMPONENT MANIFEST (the builder verifies these source digests):
${manifest.join('\n')}
-- ============================================================================
`;

const footer = `
-- ============================================================================
-- INSTALLATION VERIFICATION (read-only)
-- ============================================================================
SELECT
  (SELECT count(*) FROM public.dc_platform_settings WHERE id = 1) = 1 AS platform_settings_ready,
  (SELECT count(*) FROM public.dc_backup_settings WHERE id = 1) = 1 AS backup_settings_ready,
  (SELECT count(*) FROM public.dc_retention_settings WHERE id = 1) = 1 AS retention_settings_ready,
  (SELECT count(*) FROM public.dc_site_license WHERE id = 1) = 1 AS site_license_ready,
  to_regprocedure('public.dc_access_state()') IS NOT NULL AS access_rpc_ready,
  to_regprocedure('public.dc_platform_health()') IS NOT NULL AS health_rpc_ready,
  to_regprocedure('public.dc_begin_backup_run(text,text,integer)') IS NOT NULL AS backup_lease_rpc_ready;
`;

const output = header + chunks.join('\n') + footer;
await writeFile(join(root, 'database/complete-schema.sql'), output, 'utf8');
console.log(`Wrote database/complete-schema.sql (${output.split('\n').length} lines).`);
