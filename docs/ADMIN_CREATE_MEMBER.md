# 👤 Admin: Create Member Logins — FULL, DETAILED GUIDE

This explains, step by step, how to let an **admin create login accounts** for
members (and hand them their email + password) — and answers the big question:

> **"Where does the service_role key go? Does it go into my GitHub repo?"**

---

## 🔑 The most important thing to understand first

You have **TWO** Supabase keys. They are NOT the same:

| Key | Goes in GitHub / `config.js`? | Power |
| :-- | :-- | :-- |
| **anon (publishable) key** | ✅ YES — it's safe in the browser | Limited by your security rules |
| **service_role key** | ❌ **NO — NEVER. Not in GitHub, not in `config.js`, not in any file you upload** | **Master key — bypasses ALL security** |

### So where DOES the service_role key go?

It goes into **Supabase's own private "Secrets" vault** — a secure storage that
**only Supabase's servers can read**. Your website never sees it. Your GitHub
repo never contains it.

### But wait — there's a file in my repo called `admin-create-member/index.ts`...

Yes, and that file is **100% safe to have on GitHub**, because it contains only
**CODE**, not the key. The code simply says *"go and read the key from the secure
vault at runtime"*:

```ts
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");  // reads from the vault
```

The word `SUPABASE_SERVICE_ROLE_KEY` is just a **label/name**. The actual secret
value lives in the vault, separately, and is injected only when the function runs
**on Supabase's servers**.

### Picture it like this

```
   GitHub repo            Supabase servers (private)        Member's browser
 ┌───────────────┐      ┌───────────────────────────┐    ┌────────────────┐
 │ function CODE │ ───► │  Edge Function runs here   │    │  your website  │
 │ (safe, no key)│      │  + reads key from VAULT 🔒 │    │  (anon key only)│
 └───────────────┘      └───────────────────────────┘    └────────────────┘
                                  ▲
                          service_role key lives ONLY here
```

### ✨ Even better news

Supabase **automatically** puts the service_role key into every Edge Function
under the name `SUPABASE_SERVICE_ROLE_KEY`. The included function already reads
that name. **This means, in the easy method below, you do not have to handle or
paste the service_role key at all.** 🎉

---

## ✅ METHOD A — No terminal needed (Supabase Dashboard, recommended)

This is the easiest way. Everything happens in your web browser.

### Step 1 — Open the Edge Functions area
1. Go to **https://supabase.com** and open your project.
2. In the left sidebar, click **Edge Functions** (look for the `</>` / "Functions"
   icon).

### Step 2 — Create the function
1. Click **"Create a function"** (or **"Deploy a new function"** /
   **"Via Editor"** — wording varies slightly).
2. **Name it EXACTLY:** `admin-create-member`
   (the name must match — the app calls this exact name).
3. You'll see a code editor.

### Step 3 — Paste the code
1. Open the file `supabase/functions/admin-create-member/index.ts` from this
   project (open it in Notepad / VS Code / GitHub — anywhere you can read it).
2. **Select all, copy.**
3. **Delete** the sample code in the Supabase editor and **paste** ours in.
4. Click **Deploy** (top-right).

That's it. Because Supabase auto-provides `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` to the function, **you do not need to set any
secrets**. You never touched the service_role key.

### Step 4 — Use it in the app
1. Sign in to your site as an **admin** → open the **Members** page.
2. In **"Add Member & Create Login"**, type the member's **name + email**
   (leave password blank to auto‑generate a strong one). Tick *Make admin* if
   needed.
3. Click **Create Account**. A popup shows the **email + password** with
   **Copy / WhatsApp / Email** buttons — send those to the member.
4. The member signs in and can change their password under **My Profile**, and
   complete the rest of their details.

### Permanent account removal
The same function also handles **Remove** from the Members page. It verifies an
approved administrator JWT, prevents self-deletion, deletes the Supabase Auth
user with `auth.admin.deleteUser()`, lets foreign-key cascades remove the profile
and dependent rows, and attempts a server-side `member_remove` audit entry.
There is deliberately no browser `profiles` DELETE policy, so a failed Auth
deletion cannot leave an orphaned login.

✅ Done. The service_role key never left Supabase, never went to GitHub.

---

## 🛠️ METHOD B — Using the Supabase CLI (for the technical)

Only use this if you prefer the command line.

```bash
# 1. Install & sign in (one time)
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF      # find ref in Settings → General

# 2. Deploy the function (uploads the CODE only)
supabase functions deploy admin-create-member
```

You're done — no secrets to set, because Supabase auto-provides the
service_role key to the function. (If you ever needed to override it manually,
you'd run `supabase secrets set ...` — but for this you do **not**.)

---

## ❓ Frequently asked questions

**Q: Do I paste the service_role key into `config.js`?**
A: **Never.** `config.js` only ever holds the **anon** key.

**Q: Will the service_role key end up on GitHub if I push my repo?**
A: **No.** The repo only contains the function's CODE, which reads the key by
name from Supabase's vault at runtime. The key value is never in any file.

**Q: Where do I even find the service_role key?**
A: Supabase → **Project Settings → API → `service_role`**. With Method A/B above
you **don't need to copy it at all** — Supabase injects it automatically. Just
keep it secret; treat it like a master password.

**Q: Is it safe that `admin-create-member/index.ts` is public on GitHub?**
A: Yes. It's just logic. It also **double‑checks the caller is a signed‑in
admin** before doing anything, so even the function endpoint can't be abused by
non‑admins.

**Q: The app says "function is not deployed". What now?**
A: You haven't completed Method A or B yet. The rest of the app still works;
members can self‑register and be approved in the meantime.

---

## 🔒 Security summary
- **anon key** → browser/GitHub = fine (limited by RLS).
- **service_role key** → Supabase vault ONLY = never in browser, never in GitHub.
- Keep the default Supabase JWT verification enabled. The function additionally
  resolves the bearer token and requires an **approved administrator** profile.
- The function supports create and permanent delete operations, blocks
  self-deletion, rolls back a newly created Auth user if profile creation fails,
  and returns sanitized errors while logging detailed server errors.
- Auto-generated passwords are random; members should change them after first login.
