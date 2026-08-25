import crypto from 'node:crypto';

function sameSecret(value, expected) {
  const left = Buffer.from(String(value || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.authorization || '';
  if (!cronSecret || !sameSecret(authorization, `Bearer ${cronSecret}`)) {
    return response.status(cronSecret ? 401 : 503).json({
      ok: false,
      error: cronSecret ? 'unauthorized' : 'cron_secret_not_configured'
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  let base;
  try { base = new URL(supabaseUrl); } catch (_) { base = null; }
  if (!base || base.protocol !== 'https:' || !base.hostname.endsWith('.supabase.co') || !anonKey) {
    return response.status(503).json({ ok: false, error: 'supabase_environment_not_configured' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(`${base.origin}/rest/v1/rpc/dc_keep_alive`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DramaConnect-Vercel-Cron/13.2'
      },
      body: JSON.stringify({ p_source: 'vercel-cron' }),
      cache: 'no-store',
      signal: controller.signal
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || payload?.ok !== true) {
      return response.status(502).json({ ok: false, error: 'heartbeat_rejected', upstreamStatus: upstream.status });
    }
    return response.status(200).json({ ok: true, status: payload.status, source: payload.source, at: payload.at });
  } catch (error) {
    return response.status(error?.name === 'AbortError' ? 504 : 502).json({
      ok: false,
      error: error?.name === 'AbortError' ? 'heartbeat_timeout' : 'heartbeat_unreachable'
    });
  } finally {
    clearTimeout(timeout);
  }
}
