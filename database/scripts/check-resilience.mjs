#!/usr/bin/env node
const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_ANON_KEY || '';
if (!/^https:\/\/[^/]+\.supabase\.co$/.test(url) || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  process.exit(2);
}
const allowedSources = new Set(['external', 'cron-job-org', 'edge-ping']);
const requestedSource = String(process.env.HEARTBEAT_SOURCE || 'external').trim().toLowerCase();
const source = allowedSources.has(requestedSource) ? requestedSource : 'external';
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);
try {
  const response = await fetch(`${url}/rest/v1/rpc/dc_keep_alive`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_source: source }),
    signal: controller.signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) throw new Error(`Heartbeat rejected (HTTP ${response.status}).`);
  console.log(`OK ${payload.source} ${payload.status} ${payload.at}`);
} catch (error) {
  console.error(`FAILED ${error.message}`);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
