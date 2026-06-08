// ============================================================================
// Supabase Edge Function — birthday-bot (fully automatic birthday greetings)
// ----------------------------------------------------------------------------
// Runs daily on a schedule (Supabase Cron, free). For every member whose
// birth_month/birth_day is TODAY and who hasn't already been greeted today:
//   1. Posts a celebratory message to that member's in-platform Inbox.
//   2. Posts a department-wide broadcast so everyone can celebrate them.
//   3. (Optional) Emails the member via Resend, if RESEND_API_KEY is set.
//   4. Marks bday_last_sent = today's date so it never double-sends.
//
// NOTE: WhatsApp cannot be auto-sent for free (Meta requires a paid Business
// API). So automatic delivery uses the in-platform Inbox + optional email,
// while admins can still one-tap WhatsApp greetings from the Birthdays page.
//
// DEPLOY (full steps in docs/BIRTHDAY_BOT.md):
//   supabase functions deploy birthday-bot --no-verify-jwt
//   supabase secrets set PROJECT_URL=https://<ref>.supabase.co \
//        SERVICE_ROLE_KEY=<service_role key>  [RESEND_API_KEY=re_xxx FROM_EMAIL=you@x]
//   Then schedule daily (e.g. 06:00) with pg_cron + pg_net.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
  if (!url || !serviceKey) return json({ error: "Missing secrets" }, 500);

  const db = createClient(url, serviceKey);
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const dayKey = `${now.getFullYear()}-${pad(month)}-${pad(day)}`;

  const { data: celebrants, error } = await db.from("profiles")
    .select("*").eq("birth_month", month).eq("birth_day", day);
  if (error) return json({ error: error.message }, 500);
  if (!celebrants || !celebrants.length) return json({ ok: true, greeted: 0 });

  let greeted = 0;
  for (const m of celebrants) {
    if (m.bday_last_sent === dayKey) continue; // already done today

    const personal = `Happy Birthday, ${m.full_name || "dear member"}! 🎉🎂 The entire RCCG LP 25 Drama Department celebrates you today. May this new year overflow with God's grace, joy and favour!`;
    const broadcast = `🎂 Today we celebrate ${m.full_name || "a member"}! Please join us in wishing them a Happy Birthday. 🎉`;

    // 1) Personal inbox message
    await db.from("inbox").insert([{
      sender_id: null, sender_name: "Birthday Bot", recipient_id: m.id,
      to_admins: false, subject: "🎉 Happy Birthday!", body: personal,
    }]);
    // 2) Department broadcast
    await db.from("inbox").insert([{
      sender_id: null, sender_name: "Birthday Bot", recipient_id: null,
      to_admins: false, subject: "🎂 Birthday Celebration", body: broadcast,
    }]);
    // 3) Optional email
    if (RESEND_API_KEY && m.email) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM_EMAIL, to: [m.email],
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
      } catch (_e) { /* email failure must not stop the bot */ }
    }
    // 4) Mark done
    await db.from("profiles").update({ bday_last_sent: dayKey }).eq("id", m.id);
    greeted++;
  }

  return json({ ok: true, greeted });
});

function pad(n: number) { return String(n).padStart(2, "0"); }
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
