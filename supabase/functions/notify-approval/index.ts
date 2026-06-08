// ============================================================================
// OPTIONAL Supabase Edge Function — automated "account approved" email.
// ----------------------------------------------------------------------------
// This is 100% OPTIONAL. The app already lets admins notify members for free via
// WhatsApp/email when approving. Deploy this only if you want approval emails to
// be sent AUTOMATICALLY by the server.
//
// FREE EMAIL PROVIDER: this example uses Resend (https://resend.com) which has a
// free tier (no credit card). You could swap in any SMTP/email API.
//
// DEPLOY (see docs/EMAIL_NOTIFICATIONS.md for full steps):
//   1. Create a free Resend account, verify a sender, copy your API key.
//   2. supabase functions deploy notify-approval --no-verify-jwt
//   3. supabase secrets set RESEND_API_KEY=your_key FROM_EMAIL=you@domain
//   4. Add a database webhook (or call this from your app) on profile approval.
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    const { email, full_name, app_url } = await req.json();
    if (!email) {
      return json({ error: "email is required" }, 400);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
    if (!RESEND_API_KEY) {
      return json({ error: "RESEND_API_KEY not configured" }, 500);
    }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
        <div style="background:#003399;color:#fff;padding:24px;text-align:center;border-radius:12px 12px 0 0">
          <h2 style="margin:0">DramaConnect</h2>
          <p style="margin:4px 0 0;opacity:.9">RCCG LP 25 Drama Department</p>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 12px 12px">
          <p>Dear ${escapeHtml(full_name || "Member")},</p>
          <p>Your DramaConnect account has been <strong>approved</strong>. You can now sign in and access the platform.</p>
          <p style="text-align:center;margin:28px 0">
            <a href="${escapeHtml(app_url || "#")}" style="background:#003399;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">Open DramaConnect</a>
          </p>
          <p style="color:#64748b;font-size:13px">God bless you.</p>
        </div>
      </div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: "Your DramaConnect account is approved",
        html,
      }),
    });

    const data = await r.json();
    if (!r.ok) return json({ error: data }, 502);
    return json({ ok: true, id: data.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
