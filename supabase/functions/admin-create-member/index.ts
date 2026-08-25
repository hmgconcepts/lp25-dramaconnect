// ============================================================================
// Supabase Edge Function — admin-create-member
// ----------------------------------------------------------------------------
// Lets an approved ADMIN create a full login account for a member who has not
// signed up and delete a member's Auth account plus cascading profile safely.
//
// SECURITY: uses the service_role key SERVER-SIDE only (never in the browser).
// It first verifies the CALLER is an authenticated admin before doing anything.
//
// DEPLOY (full steps in docs/ADMIN_CREATE_MEMBER.md):
//   supabase functions deploy admin-create-member
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Supabase auto-injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY into every
  // Edge Function — so you normally DON'T need to set any secrets yourself.
  // (Manual PROJECT_URL / SERVICE_ROLE_KEY are accepted as a fallback.)
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
  if (!url || !serviceKey) return json({ error: "Function not configured (missing secrets)." }, 500);

  // --- 1. Verify the caller is an authenticated ADMIN ---------------------
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization token." }, 401);

  const admin = createClient(url, serviceKey);
  const { data: userData, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !userData?.user) return json({ error: "Invalid session." }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles").select("role,status,full_name,email").eq("id", userData.user.id).maybeSingle();
  if (profileError || !profile || profile.role !== "admin" || profile.status !== "approved")
    return json({ error: "Approved admin privileges required." }, 403);

  // --- 2. Parse + validate input -----------------------------------------
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON." }, 400); }

  // The same approved-admin endpoint performs account deletion so the browser
  // never deletes only the profile and leaves an orphaned Auth login behind.
  if (body.action === "delete") {
    const targetId = String(body.user_id ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId))
      return json({ error: "A valid member id is required." }, 400);
    if (targetId === userData.user.id)
      return json({ error: "Administrators cannot delete their own account here." }, 400);
    const { data: target } = await admin.from("profiles")
      .select("full_name,email").eq("id", targetId).maybeSingle();
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
    if (deleteError) {
      console.error("admin deleteUser failed", deleteError);
      return json({ error: "Member account could not be deleted." }, 500);
    }
    await admin.from("activity_log").insert({
      actor_name: profile.full_name || profile.email || "Administrator",
      action: "member_remove",
      detail: `Deleted ${target?.full_name || target?.email || targetId}`.slice(0, 1000),
    });
    return json({ ok: true, action: "deleted", user_id: targetId });
  }

  const full_name = String(body.full_name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const parish = String(body.parish ?? "").trim();
  const role = body.role === "admin" ? "admin" : "member";
  let password = String(body.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return json({ error: "A valid email is required." }, 400);
  if (!full_name || full_name.length > 120)
    return json({ error: "Full name is required and must be 120 characters or fewer." }, 400);
  if (phone.length > 40 || parish.length > 120)
    return json({ error: "Phone or parish is too long." }, 400);
  if (!password || password.length < 8) password = generatePassword();
  if (password.length > 128) return json({ error: "Password is too long." }, 400);

  // --- 3. Create the auth user (auto-confirmed) --------------------------
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name || "" },
  });
  if (cErr || !created.user) {
    console.error("admin createUser failed", cErr);
    return json({ error: "Account could not be created. Check whether the email already has an account." }, 400);
  }

  const newId = created.user.id;

  // --- 4. Upsert their profile as APPROVED -------------------------------
  const { error: pErr } = await admin.from("profiles").upsert({
    id: newId,
    full_name,
    email,
    phone: phone || null,
    parish: parish || null,
    role,
    status: "approved",
  }, { onConflict: "id" });
  if (pErr) {
    // Do not leave an orphaned login when the corresponding profile fails.
    console.error("profile upsert failed; rolling back auth account", pErr);
    await admin.auth.admin.deleteUser(newId).catch(() => undefined);
    return json({ error: "Account creation was rolled back because the member profile could not be saved." }, 500);
  }

  // --- 5. Return the credentials to the admin ----------------------------
  return json({
    ok: true,
    user_id: newId,
    email,
    password, // hand this to the member; they can change it after first login
    role,
  });
});

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let p = "";
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 10; i++) p += chars[arr[i] % chars.length];
  return p;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
