// Public monitor entry point. Deploy with --no-verify-jwt, then set PING_SECRET.
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff'
};

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...jsonHeaders, allow: 'GET, HEAD' }
    });
  }

  const expected = Deno.env.get('PING_SECRET') || '';
  const supplied = new URL(request.url).searchParams.get('token') || request.headers.get('x-ping-secret') || '';
  if (!expected) return new Response(JSON.stringify({ ok: false, error: 'ping_secret_not_configured' }), { status: 503, headers: jsonHeaders });
  if (supplied !== expected) return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: jsonHeaders });

  const requestedSource = new URL(request.url).searchParams.get('source') || 'edge-ping';
  const source = requestedSource === 'cron-job-org' ? 'cron-job-org' : 'edge-ping';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !anonKey) return new Response(JSON.stringify({ ok: false, error: 'supabase_environment_not_configured' }), { status: 503, headers: jsonHeaders });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(`${supabaseUrl}/rest/v1/rpc/dc_keep_alive`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'content-type': 'application/json',
        'user-agent': 'DramaConnect-Edge-Ping/13.2'
      },
      body: JSON.stringify({ p_source: source }),
      signal: controller.signal
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || payload?.ok !== true) {
      return new Response(JSON.stringify({ ok: false, error: 'heartbeat_rejected', upstreamStatus: upstream.status }), { status: 502, headers: jsonHeaders });
    }
    const body = request.method === 'HEAD' ? null : JSON.stringify({ ok: true, status: payload.status, source: payload.source, at: payload.at });
    return new Response(body, { status: 200, headers: jsonHeaders });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return new Response(JSON.stringify({ ok: false, error: timedOut ? 'heartbeat_timeout' : 'heartbeat_unreachable' }), { status: timedOut ? 504 : 502, headers: jsonHeaders });
  } finally {
    clearTimeout(timeout);
  }
});
