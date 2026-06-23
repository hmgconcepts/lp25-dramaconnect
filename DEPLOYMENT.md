# Deployment Guide (Detailed & Unambiguous)

Welcome to DramaConnect Enterprise! Follow these steps closely to set up the system using free tools. No paid AI APIs are needed.

## Phase 1: Supabase Backend Setup (Free Tier)
1. Go to [Supabase](https://supabase.com) and create an account or sign in.
2. Click **New Project**, choose an organization, and give it a name (e.g. `DramaConnect`). Set a strong database password. Choose the region closest to your users. Click **Create new project**.
3. **Wait** a few minutes for the project to be provisioned.
4. **Get your API Keys:**
   * Go to **Project Settings** (the gear icon at the bottom left).
   * Click on **API** in the sidebar.
   * Copy the **Project URL** and the **anon/public** key.
   * Open `assets/js/config.js` in your source code and paste these values into `SUPABASE_URL` and `SUPABASE_KEY`.

## Phase 2: Database Initialization
1. In Supabase, go to the **SQL Editor** on the left menu.
2. Click **New query**.
3. Open `database/schema.sql` from your source code, copy everything inside, and paste it into the SQL Editor.
4. Click **Run**. This will create all your tables and base security policies.
5. Click **New query** again, copy the contents of `database/repair_and_upgrade.sql`, and **Run** it. This will apply all enterprise upgrades including Inventory management and fixes.
6. Check **Table Editor** to ensure tables like `profiles`, `inventory`, `gallery`, etc., exist.

## Phase 3: Authentication & Bypassing the Rate Limit
Supabase's free tier has a limit of 30 emails per hour for Auth emails. To avoid the "Rate Exceeded" error when multiple users sign up:
1. Go to **Authentication** -> **Providers** -> **Email**.
2. Toggle OFF **Confirm email** and toggle OFF **Secure email change**.
3. Click **Save**. Now users can sign up instantly without waiting for an email, bypassing the rate limit completely.
4. Go to **Authentication** -> **URL Configuration**. Add `http://localhost:5500` and your live URL (e.g., `https://my-drama-app.vercel.app`) to the **Site URL** and **Redirect URLs**.

## Phase 4: Deploying to the Web (Vercel)
We recommend Vercel for free, fast, and secure frontend hosting.
1. Create a free account at [GitHub](https://github.com) if you don't have one, and upload this entire `dramaconnect` folder to a new repository.
2. Go to [Vercel](https://vercel.com) and sign up with GitHub.
3. Click **Add New...** -> **Project**.
4. Import your GitHub repository.
5. Leave all build settings as default (Framework Preset: Other).
6. Click **Deploy**. Vercel will give you a live URL.

## Phase 5: Becoming the First Admin
1. Open your live app URL and sign up for a new account.
2. Go back to your Supabase Dashboard -> **Table Editor** -> **profiles**.
3. Find your row, click on the `role` cell, and change it from `member` to `admin`.
4. Refresh your live app page. You will now see all Administration tabs and have full control.

## System Features Included (Enterprise V2)
*   **Member Directory & Full Control:** View full member profiles by clicking "View Profile". Change roles, unit leaders, and track attendance.
*   **Strict Media Linking (Saves Database Storage):** Direct file uploads for Profile Pictures and Gallery media are fully disabled. Admins and users can *only* use Google Drive public image links or YouTube video links. This eliminates database bloat and ensures the 500MB free database storage is used exclusively for fast text-based records.
*   **Costume & Measurement Tracking:** Added essential fields for members such as Height, Shoe Size, Chest/Bust, and Waist sizes directly into the Member profile. These populate in the Full Profile view for the admins.
*   **Enhanced Verification ID Cards:** Upgraded the personal ID Card feature to auto-generate scannable QR Codes representing the member's account.
*   **Inventory Management:** Track Props, Costumes, and Equipment quantities and locations.
*   **Export Data:** Export features to MS Excel (`.xlsx`) on Inventory, Members, and Reports pages.
