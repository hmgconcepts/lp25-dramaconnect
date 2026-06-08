// ============================================================================
// Supabase Edge Function — admin-create-member
// ----------------------------------------------------------------------------
// Lets an ADMIN create a full login account for a member who has NOT signed up,
// and returns the credentials so the admin can hand them over.
//
// SECURITY: uses the service_role key SERVER-SIDE only (never in the browser).
// It first verifies the CALLER is an authenticated admin before doing anything.
//
// DEPLOY (full steps in docs/ADMIN_CREATE_MEMBER.md):
//   supabase functions deploy admin-create-member --no-verify-jwt
//   supabase secrets set PROJECT_URL=https://<ref>.supabase.co \
//                        SERVICE_ROLE_KEY=<your service_role key>
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

  const url = Deno.env.get("PROJECT_URL")!;
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY")!;
  if (!url || !serviceKey) return json({ error: "Function not configured (missing secrets)." }, 500);

  // --- 1. Verify the caller is an authenticated ADMIN ---------------------
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ error: "Missing authorization token." }, 401);

  const admin = createClient(url, serviceKey);
  const { data: userData, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !userData?.user) return json({ error: "Invalid session." }, 401);

  const { data: profile } = await admin
    .from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (!profile || profile.role !== "admin")
    return json({ error: "Admin privileges required." }, 403);

  // --- 2. Parse + validate input -----------------------------------------
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
  const { full_name, email, phone, parish, role } = body;
  let password = body.password;
  if (!email) return json({ error: "Email is required." }, 400);
  if (!password || String(password).length < 6) {
    password = generatePassword();
  }

  // --- 3. Create the auth user (auto-confirmed) --------------------------
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name || "" },
  });
  if (cErr) return json({ error: cErr.message }, 400);

  const newId = created.user!.id;

  // --- 4. Upsert their profile as APPROVED -------------------------------
  const { error: pErr } = await admin.from("profiles").upsert({
    id: newId,
    full_name: full_name || "",
    email,
    phone: phone || null,
    parish: parish || null,
    role: role === "admin" ? "admin" : "member",
    status: "approved",
  }, { onConflict: "id" });
  if (pErr) return json({ error: "User created but profile failed: " + pErr.message }, 500);

  // --- 5. Return the credentials to the admin ----------------------------
  return json({
    ok: true,
    user_id: newId,
    email,
    password, // hand this to the member; they can change it after first login
    role: role === "admin" ? "admin" : "member",
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
