# ✅ DramaConnect — First-Time Setup Checklist

Follow these in order. Tick each box. Total time ≈ 15 minutes. Everything here is
**free** and uses **no paid AI API**.

---

## A. Backend (Supabase) — one time
- [ ] **A1.** Create a free account at https://supabase.com
- [ ] **A2.** Click **New project** → name it `dramaconnect` → set a strong DB
      password → choose the nearest region → **Create**. Wait ~2 minutes.
- [ ] **A3.** Open **SQL Editor → New query**.
- [ ] **A4.** Paste **all** of `database/repair_and_upgrade.sql`.
- [ ] **A5.** Near the bottom, change `CHANGE_ME@example.com` to **your** email.
- [ ] **A6.** Click **Run**. You should see your `profiles` rows listed at the end.
- [ ] **A7.** (Optional, faster internal launch) **Authentication → Providers →
      Email** → turn **Confirm email** OFF.

## B. Connect the app
- [ ] **B1.** In Supabase: **Project Settings → API**. Copy **Project URL** and
      the **anon public** key.
- [ ] **B2.** Open `assets/js/config.js`. Paste them into `SUPABASE_URL` and
      `SUPABASE_KEY`. Save.
- [ ] **B3.** (Never paste the `service_role` key into any front-end file.)

## C. Publish the site (pick ONE — all free)
- [ ] **C1.** **GitHub Pages:** create a repo → upload the **contents** of the
      `enterprise v4` folder (so `index.html` is at the root) → **Settings →
      Pages → Deploy from branch → main → / (root)**.
- [ ] **C1-alt.** Or **Cloudflare Pages** / **Vercel** → import repo / drag the
      folder → Framework: **None** → output dir: `/` → **Deploy**.
- [ ] **C2.** Open the live URL. The RCCG logo and login screen should appear.

## D. Create the first administrator
- [ ] **D1.** On the live site, click **Request Access** → sign up (use the same
      email you set in A5). Confirm via email if confirmation is ON.
- [ ] **D2.** You were already promoted to `admin` + `approved` by A5/A6.
      (If you used a different email, re-run the `UPDATE` line in A4 with it.)
- [ ] **D3.** Sign in. Confirm the sidebar shows **Activity Log**, **Settings &
      Backup**, and **Messaging** (admin-only items).

## E. Daily operations (admins)
- [ ] **E1.** **Approve members:** Members page → *Pending Approvals* → Approve /
      Reject. Optionally notify them (WhatsApp/email popup).
- [ ] **E2.** **Message members:** Messaging Center → choose audience → type →
      send via WhatsApp or Email.
- [ ] **E3.** **Back up data:** Settings & Backup → *Download Full Backup (JSON)*
      regularly.

## F. Optional extras
- [ ] **F1.** **Automated approval emails:** see `docs/EMAIL_NOTIFICATIONS.md`
      (Supabase Edge Function + free Resend). Skip if the in-app notify popup is
      enough.
- [ ] **F2.** **Install as an app:** on phone/tablet, accept the "Install
      DramaConnect" banner (or browser menu → *Add to Home Screen*).

---

### Quick verification
- [ ] New signup appears under **Members → Pending Approvals**.
- [ ] After approval, that user can sign in.
- [ ] Messaging opens WhatsApp/email pre-filled.
- [ ] Reports export Excel/PDF/CSV.
- [ ] Menu (☰) works on your phone/tablet.
