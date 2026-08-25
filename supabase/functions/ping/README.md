# DramaConnect ping Edge Function

Deploy this public monitor endpoint without JWT verification, but protect it with a high-entropy `PING_SECRET`:

```bash
supabase secrets set PING_SECRET="$(openssl rand -hex 32)"
supabase functions deploy ping --no-verify-jwt
```

Monitor `https://PROJECT_REF.supabase.co/functions/v1/ping?token=PING_SECRET` with UptimeRobot, Better Stack, or another HTTPS monitor. For a separate cron-job.org health row use `&source=cron-job-org`. Require HTTP 200 and the keyword `"ok":true`. The source query value is allow-listed; arbitrary rows cannot be created. The token may appear in monitor/server logs, so use a secret dedicated only to this throttled endpoint and rotate it if exposed.
