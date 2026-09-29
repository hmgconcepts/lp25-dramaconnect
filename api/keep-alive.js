// Layer 5 — Vercel Cron keep-alive (self-configuring).
//
// v14.1 live-audit fix: the previous version returned HTTP 503
// "cron_secret_not_configured" unless CRON_SECRET was set in Vercel, so the
// daily Vercel cron never wrote a single heartbeat. Now:
//   • Supabase URL + anon key come from Vercel env vars when present, otherwise
//     from this deployment's own public assets/js/config.js (the same two
//     PUBLIC values every browser already receives). Zero setup.
//   • ?source=<layer> lets ANY free scheduler reuse this endpoint (cron-job.org,
//     UptimeRobot, Apps Script, the HMG Fleet Console) and still be labelled
//     correctly on Platform Health. Unknown values fall back to vercel-cron.
//   • CRON_SECRET is OPTIONAL hardening. When it is set, only callers that send
//     "Authorization: Bearer <CRON_SECRET>" (Vercel Cron does this
//     automatically) may trigger a write. When it is not set, any GET works —
//     which is safe: dc_keep_alive() exposes no data, accepts only allow-listed
//     source names and writes at most once per 5 minutes per source.
import crypto from 'node:crypto';

const URL_RE = /https:\/\/[a-z0-9]{20}\.supabase\.co/;
const KEY_RE = /(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)/;

function sameSecret(value, expected) {
  const left = Buffer.from(String(value || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function clean(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}

async function resolveConnection(request) {
  let url = clean(process.env.SUPABASE_URL);
  let key = clean(process.env.SUPABASE_ANON_KEY);
  let origin = 'environment';
  if (!url || !key) {
    const host = request.headers['x-forwarded-host'] || request.headers.host || process.env.VERCEL_URL;
    if (host) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 6000);
        const r = await fetch(`https://${host}/assets/js/config.js`, { cache: 'no-store', signal: controller.signal });
        clearTimeout(t);
        if (r.ok) {
          const text = await r.text();
          url = url || (text.match(URL_RE) || [])[0] || '';
          key = key || (text.match(KEY_RE) || [])[0] || '';
          origin = 'assets/js/config.js';
        }
      } catch (_) { /* fall through to the not-configured answer */ }
    }
  }
  let base = null;
  try { base = new URL(url); } catch (_) { base = null; }
  if (!base || base.protocol !== 'https:' || !base.hostname.endsWith('.supabase.co') || !key) return null;
  return { origin: base.origin, key, from: origin };
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD, POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  /**
   * Any scheduler can reuse this endpoint — cron-job.org, UptimeRobot, the HMG
   * Fleet Console, Zapier/Make, or a Google Apps Script — by adding
   * ?source=<layer>. The value is mapped onto the same allow-list the database
   * uses, so a wrong or hostile value can never create a bogus layer row.
   */
  const SOURCE_ALIASES = {
    'vercel-cron': 'vercel-cron', 'vercel': 'vercel-cron', 'cron': 'vercel-cron',
    'cron-job-org': 'cron-job-org', 'cronjob': 'cron-job-org',
    'uptimerobot': 'edge-ping', 'uptime-robot': 'edge-ping', 'edge': 'edge-ping',
    'fleet': 'fleet-console', 'fleet-console': 'fleet-console', 'hmg-fleet': 'fleet-console',
    'fleet-actions': 'fleet-actions', 'github-actions': 'github-actions',
    'apps-script': 'apps-script', 'google-apps-script': 'apps-script'
  };

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && !sameSecret(request.headers.authorization || '', `Bearer ${cronSecret}`)) {
    return response.status(401).json({ ok: false, error: 'unauthorized' });
  }

  let requested = '';
  try { requested = String(new URL(request.url, 'https://local').searchParams.get('source') || '').toLowerCase(); } catch (_) { requested = ''; }
  const source = SOURCE_ALIASES[requested] || 'vercel-cron';

  const conn = await resolveConnection(request);
  if (!conn) {
    return response.status(503).json({
      ok: false,
      error: 'supabase_not_configured',
      hint: 'Fill in assets/js/config.js, or add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables.'
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(`${conn.origin}/rest/v1/rpc/dc_keep_alive`, {
      method: 'POST',
      headers: {
        apikey: conn.key,
        Authorization: `Bearer ${conn.key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DramaConnect-Vercel-Cron/14.2'
      },
      body: JSON.stringify({ p_source: source }),
      cache: 'no-store',
      signal: controller.signal
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || payload?.ok !== true) {
      return response.status(502).json({ ok: false, error: 'heartbeat_rejected', upstreamStatus: upstream.status, code: payload?.code || null });
    }
    return response.status(200).json({ ok: true, status: payload.status, source: payload.source, at: payload.at, config: conn.from, requested: requested || null });
  } catch (error) {
    return response.status(error?.name === 'AbortError' ? 504 : 502).json({
      ok: false,
      error: error?.name === 'AbortError' ? 'heartbeat_timeout' : 'heartbeat_unreachable'
    });
  } finally {
    clearTimeout(timeout);
  }
}
