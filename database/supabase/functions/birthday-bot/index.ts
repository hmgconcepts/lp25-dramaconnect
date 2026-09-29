// Scheduled birthday greetings. Deploy with --no-verify-jwt only when a strong
// CRON_SECRET is configured; every request must provide it in X-Cron-Secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  if (!cronSecret) return json({ error: "CRON_SECRET is not configured" }, 500);
  if (!constantTimeEqual(req.headers.get("x-cron-secret") || "", cronSecret))
    return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
  if (!url || !serviceKey) return json({ error: "Missing Supabase configuration" }, 500);

  const db = createClient(url, serviceKey);
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const dayKey = `${now.getUTCFullYear()}-${pad(month)}-${pad(day)}`;

  const { data: celebrants, error } = await db.from("profiles")
    .select("id,full_name,email,bday_last_sent")
    .eq("status", "approved")
    .eq("birth_month", month)
    .eq("birth_day", day);
  if (error) return json({ error: "Could not load birthday list" }, 500);
  if (!celebrants?.length) return json({ ok: true, greeted: 0 });

  let greeted = 0;
  const failures: string[] = [];
  for (const member of celebrants) {
    if (member.bday_last_sent === dayKey) continue;

    // Atomically claim this member/date so overlapping cron runs cannot duplicate
    // messages. Restore the prior value if inbox delivery fails.
    const { data: claim, error: claimError } = await db.from("profiles")
      .update({ bday_last_sent: dayKey })
      .eq("id", member.id)
      .or(`bday_last_sent.is.null,bday_last_sent.neq.${dayKey}`)
      .select("id");
    if (claimError || !claim?.length) continue;

    const personal = `Happy Birthday, ${member.full_name || "dear member"}! 🎉🎂 The entire RCCG LP 25 Drama Department celebrates you today. May this new year overflow with God's grace, joy and favour!`;
    const broadcast = `🎂 Today we celebrate ${member.full_name || "a member"}! Please join us in wishing them a Happy Birthday. 🎉`;
    const { error: inboxError } = await db.from("inbox").insert([
      {
        sender_id: null, sender_name: "Birthday Bot", recipient_id: member.id,
        to_admins: false, subject: "🎉 Happy Birthday!", body: personal,
      },
      {
        sender_id: null, sender_name: "Birthday Bot", recipient_id: null,
        to_admins: false, subject: "🎂 Birthday Celebration", body: broadcast,
      },
    ]);
    if (inboxError) {
      await db.from("profiles").update({ bday_last_sent: member.bday_last_sent }).eq("id", member.id);
      failures.push(member.id);
      continue;
    }

    if (resendKey && member.email) {
      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromEmail,
            to: [member.email],
            subject: "🎉 Happy Birthday from RCCG LP 25 Drama!",
            html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;text-align:center">
              <div style="background:#003399;color:#fff;padding:24px;border-radius:12px 12px 0 0">
                <h2 style="margin:0">🎂 Happy Birthday!</h2></div>
              <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 12px 12px">
                <p>${escapeHtml(personal)}</p>
                <p style="color:#64748b;font-size:13px">— RCCG LP 25 Drama Department · DramaConnect</p>
              </div></div>`,
          }),
        });
        if (!emailResponse.ok) console.error("Birthday email rejected for", member.id);
      } catch (emailError) {
        console.error("Birthday email failed for", member.id, emailError);
      }
    }
    greeted++;
  }

  return json({ ok: failures.length === 0, greeted, failed: failures.length }, failures.length ? 207 : 200);
});

function pad(n: number) { return String(n).padStart(2, "0"); }
function constantTimeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
