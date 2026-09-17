# 🖼️ Profile Photo Uploads (Free, via Supabase Storage)

Members can upload a photo that appears on their **digital ID card**, the
**Member Directory**, and the **Members** list. Photos are stored in
**Supabase Storage**. Available storage and bandwidth depend on the current
project plan and should be checked in the dashboard.

> ✅ Setup is automatic after running all of the canonical
> `database/complete-schema.sql`. Its storage hardening replaces legacy policies
> and requires the owner to be approved.

---

## What the SQL sets up for you
Running the cumulative schema creates:
1. A **public** storage bucket named **`avatars`** (public = photos are viewable
   on ID cards/directory).
2. Security policies so that **each member can upload/replace/delete only their
   OWN photo** (files live under `avatars/<their-user-id>/…`), while everyone can
   *view* photos.
3. New profile columns: `avatar_url` (plus emergency contact fields).

That's it — go to **My Profile → Upload Photo** and it works.

---

## Manual fallback (only if uploads fail)
If you ever see "Photo storage not set up yet", create the bucket by hand:

### Option A — Dashboard (no code)
1. Supabase → **Storage** → **New bucket**.
2. Name: **`avatars`**, toggle **Public bucket = ON**, **Save**.
3. Supabase → **SQL Editor**, rerun all of `database/complete-schema.sql`. Do not
   extract only a storage subsection, because the final ownership policies depend
   on the cumulative helper functions and profile hardening.

### Option B — Re-run the cumulative installer
Run all of `database/complete-schema.sql`. It is safe to rerun.

---

## How members use it
- **My Profile → Upload Photo** (JPG/PNG, ~2 MB max). Replace or remove anytime.
- The photo then shows automatically on **My ID Card**, the **Directory**, and
  the **Members** table.

## Notes
- **No AI / paid API** — this is plain file storage on Supabase's free tier.
- Photos are public-read by design (so they render on shareable ID cards). Don't
  upload anything you wouldn't want visible to the department.
- File path pattern: `avatars/<user-id>/avatar_<timestamp>.<ext>`.

## Troubleshooting
| Problem | Fix |
| :-- | :-- |
| "Photo storage not set up yet" | Create the bucket or rerun `database/complete-schema.sql`. |
| Upload says "row-level security" | Confirm the account is approved, the path begins with its Auth user ID, and rerun the cumulative schema. |
| Photo doesn't show | Confirm the bucket is **Public**; hard-refresh the page. |
| Image too large | Keep it under ~2 MB; resize before uploading. |
