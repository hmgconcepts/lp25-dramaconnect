# 🖼️ Profile Photo Uploads (Free, via Supabase Storage)

Members can upload a photo that appears on their **digital ID card**, the
**Member Directory**, and the **Members** list. Photos are stored free in
**Supabase Storage** (free tier includes generous storage + bandwidth).

> ✅ The setup is **automatic** — running `database/repair_and_upgrade.sql`
> already creates the `avatars` storage bucket and the security policies. There is
> usually **nothing extra to do**. This doc explains it and gives a manual
> fallback just in case.

---

## What the SQL set up for you
Running `repair_and_upgrade.sql` created:
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
3. Supabase → **SQL Editor**, run just the storage section again (it's near the
   end of `repair_and_upgrade.sql`, the block that starts with
   `INSERT INTO storage.buckets ... 'avatars' ...` and the `CREATE POLICY
   "avatars_*"` lines).

### Option B — Re-run the whole repair script
Simply paste all of `database/repair_and_upgrade.sql` again and Run. It is safe
to re-run.

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
| "Photo storage not set up yet" | Create the `avatars` public bucket (Option A) or re-run the SQL. |
| Upload says "row-level security" | The avatar policies didn't apply — re-run the storage section of the SQL. |
| Photo doesn't show | Confirm the bucket is **Public**; hard-refresh the page. |
| Image too large | Keep it under ~2 MB; resize before uploading. |
