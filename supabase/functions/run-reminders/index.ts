// ============================================================================
// OPTIONAL Supabase Edge Function — fully-automatic reminder sender.
// ----------------------------------------------------------------------------
// Runs on a schedule (Supabase Cron, free tier). For every ACTIVE reminder
// whose next_run is due, it:
//   1. Posts the reminder to everyone's in-platform Inbox (a broadcast row).
//   2. Advances next_run by the frequency (or deactivates a 'once' reminder).
//
// This makes the Reminders feature fully hands-off. The in-app "Send now"
// button still works without this function — deploy this only if you want
// automation.
//
// DEPLOY (full steps in docs/SCHEDULED_REMINDERS.md):
//   supabase functions deploy run-reminders --no-verify-jwt
//   supabase secrets set SERVICE_ROLE_KEY=<your service_role key> \
//                        PROJECT_URL=https://<ref>.supabase.co
//   Then add a cron schedule (e.g. every 15 minutes) via the Dashboard or:
//   select cron.schedule('run-reminders','*/15 * * * *',
//     $$ select net.http_post(
//          url:='https://<ref>.functions.supabase.co/run-reminders',
//          headers:='{"Content-Type":"application/json"}'::jsonb) $$);
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const url = Deno.env.get("PROJECT_URL")!;
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  const nowIso = new Date().toISOString();

  // Find due, active reminders.
  const { data: due, error } = await admin
    .from("reminders")
    .select("*")
    .eq("active", true)
    .lte("next_run", nowIso);

  if (error) return json({ error: error.message }, 500);
  if (!due || !due.length) return json({ ok: true, processed: 0 });

  let processed = 0;
  for (const r of due) {
    // 1) Post to in-platform inbox as a broadcast.
    const toAdmins = r.audience === "admins";
    await admin.from("inbox").insert([{
      sender_id: null,
      sender_name: "Scheduled Reminder",
      recipient_id: null,
      to_admins: toAdmins,
      subject: "🔔 " + r.title,
      body: r.body || r.title,
    }]);

    // 2) Advance schedule.
    const next = computeNext(r.next_run, r.frequency);
    if (next) {
      await admin.from("reminders").update({ next_run: next }).eq("id", r.id);
    } else {
      await admin.from("reminders").update({ active: false }).eq("id", r.id);
    }
    processed++;
  }

  return json({ ok: true, processed });
});

function computeNext(current: string, freq: string): string | null {
  const d = new Date(current);
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
  else return null; // 'once'
  return d.toISOString();
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
