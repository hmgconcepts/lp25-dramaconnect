// Scheduled reminder sender. Deploy with --no-verify-jwt only when CRON_SECRET
// is configured; every scheduler request must send X-Cron-Secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  if (!cronSecret) return json({ error: "CRON_SECRET is not configured" }, 500);
  if (!constantTimeEqual(req.headers.get("x-cron-secret") || "", cronSecret))
    return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ error: "Missing Supabase configuration" }, 500);
  const admin = createClient(url, serviceKey);
  const nowIso = new Date().toISOString();

  const { data: due, error } = await admin.from("reminders")
    .select("*").eq("active", true).lte("next_run", nowIso);
  if (error) return json({ error: "Could not load reminders" }, 500);
  if (!due?.length) return json({ ok: true, processed: 0 });

  let processed = 0;
  let failed = 0;
  for (const reminder of due) {
    const next = computeNext(reminder.next_run, reminder.frequency);
    const claimUpdate = next ? { next_run: next } : { active: false };

    // Move the schedule first and condition it on the timestamp we read. This is
    // an optimistic lock that prevents overlapping cron invocations from sending
    // the same reminder twice.
    const { data: claim, error: claimError } = await admin.from("reminders")
      .update(claimUpdate)
      .eq("id", reminder.id)
      .eq("next_run", reminder.next_run)
      .eq("active", true)
      .select("id");
    if (claimError || !claim?.length) continue;

    const toAdmins = reminder.audience === "admins";
    const { error: inboxError } = await admin.from("inbox").insert([{
      sender_id: null,
      sender_name: "Scheduled Reminder",
      recipient_id: null,
      to_admins: toAdmins,
      subject: "🔔 " + String(reminder.title || "Reminder").slice(0, 200),
      body: String(reminder.body || reminder.title || "Reminder").slice(0, 5000),
    }]);

    if (inboxError) {
      await admin.from("reminders").update({
        next_run: reminder.next_run,
        active: reminder.active,
      }).eq("id", reminder.id);
      failed++;
      continue;
    }
    processed++;
  }

  return json({ ok: failed === 0, processed, failed }, failed ? 207 : 200);
});

function computeNext(current: string, frequency: string): string | null {
  const date = new Date(current);
  if (Number.isNaN(date.getTime())) return null;
  if (frequency === "daily") date.setUTCDate(date.getUTCDate() + 1);
  else if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else return null;
  return date.toISOString();
}

function constantTimeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
