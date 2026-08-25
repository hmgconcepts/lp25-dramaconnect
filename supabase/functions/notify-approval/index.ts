// Optional approval-email function. Authorization is mandatory even when the
// function is deployed with --no-verify-jwt: callers must be an approved admin
// or provide X-Webhook-Secret matching NOTIFY_WEBHOOK_SECRET.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!await isAuthorized(req)) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const webhookRecord = body?.record && typeof body.record === "object" ? body.record : null;
    if (webhookRecord) {
      const priorStatus = body?.old_record?.status;
      if (webhookRecord.status !== "approved" || priorStatus === "approved")
        return json({ ok: true, ignored: true });
    }
    const input = webhookRecord || body;
    const email = String(input.email || "").trim().toLowerCase();
    const fullName = String(input.full_name || "Member").trim().slice(0, 120);
    const configuredUrl = Deno.env.get("APP_URL") || "";
    const appUrl = safeHttpUrl(configuredUrl || String(input.app_url || body.app_url || ""));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      return json({ error: "A valid email is required" }, 400);
    if (!appUrl) return json({ error: "APP_URL or a valid app_url is required" }, 400);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
    if (!resendKey) return json({ error: "RESEND_API_KEY not configured" }, 500);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
        <div style="background:#003399;color:#fff;padding:24px;text-align:center;border-radius:12px 12px 0 0">
          <h2 style="margin:0">DramaConnect</h2>
          <p style="margin:4px 0 0;opacity:.9">RCCG LP 25 Drama Department</p>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 12px 12px">
          <p>Dear ${escapeHtml(fullName || "Member")},</p>
          <p>Your DramaConnect account has been <strong>approved</strong>. You can now sign in and access the platform.</p>
          <p style="text-align:center;margin:28px 0">
            <a href="${escapeHtml(appUrl)}" style="background:#003399;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">Open DramaConnect</a>
          </p>
          <p style="color:#64748b;font-size:13px">God bless you.</p>
        </div>
      </div>`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "Your DramaConnect account is approved",
        html,
      }),
    });
    const data = await response.json();
    if (!response.ok) return json({ error: "Email provider rejected the request" }, 502);
    return json({ ok: true, id: data.id });
  } catch (error) {
    console.error("notify-approval failed", error);
    return json({ error: "Request failed" }, 500);
  }
});

async function isAuthorized(req: Request): Promise<boolean> {
  const expectedSecret = Deno.env.get("NOTIFY_WEBHOOK_SECRET") || "";
  const suppliedSecret = req.headers.get("x-webhook-secret") || "";
  if (expectedSecret && constantTimeEqual(suppliedSecret, expectedSecret)) return true;

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!token || !url || !serviceKey) return false;
  const admin = createClient(url, serviceKey);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("role,status").eq("id", data.user.id).maybeSingle();
  return !profileError && profile?.role === "admin" && profile?.status === "approved";
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch { return ""; }
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
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
