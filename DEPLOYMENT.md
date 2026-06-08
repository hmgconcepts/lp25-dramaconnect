# 🚀 Deployment Guide - DramaConnect Enterprise v4

This guide provides clear, unambiguous steps to take the system from the workspace to a live, professional URL.

## 🛠️ Prerequisites
1.  A **GitHub Account** (Free).
2.  A **Supabase Account** (Free).
3.  A **Vercel Account** (Free - linked to GitHub).

---

## Step 1: Provisioning the Backend (Supabase)
1.  Log in to [supabase.com](https://supabase.com/).
2.  Create a new project named `DramaConnect-v4`.
3.  Navigate to the **SQL Editor** (Sidebar $\rightarrow$ SQL Editor).
4.  Create a new query and paste the following schema:

```sql
-- 1. Profiles (Personnel & Roles)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  parish TEXT,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Productions
CREATE TABLE productions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  performance_date DATE,
  director TEXT,
  script_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Cast List (The Casting Module)
CREATE TABLE cast_list (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  production_id UUID REFERENCES productions(id) ON DELETE CASCADE,
  member_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  character_role TEXT,
  notes TEXT,
  UNIQUE(production_id, member_id)
);

-- 4. Finance Ledger
CREATE TABLE finances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE DEFAULT CURRENT_DATE,
  description TEXT,
  type TEXT CHECK (type IN ('income', 'expense')),
  amount DECIMAL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Budgeting
CREATE TABLE budgets (
  production_id UUID REFERENCES productions(id) ON DELETE CASCADE PRIMARY KEY,
  allocated_amount DECIMAL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Rehearsals
CREATE TABLE rehearsals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rehearsal_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Attendance
CREATE TABLE attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rehearsal_id UUID REFERENCES rehearsals(id) ON DELETE CASCADE,
  member_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'present',
  marked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(rehearsal_id, member_id)
);

-- SECURITY: Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE productions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cast_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE finances ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rehearsals ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- POLICY: All Authenticated Users can READ
CREATE POLICY "Allow read for all auth" ON profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow read for all auth" ON productions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow read for all auth" ON cast_list FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow read for all auth" ON finances FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow read for all auth" ON budgets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow read for all auth" ON rehearsals FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow read for all auth" ON attendance FOR SELECT USING (auth.role() = 'authenticated');

-- POLICY: Only ADMINS can WRITE
CREATE POLICY "Admin Full Access" ON profiles FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admin Full Access" ON productions FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admin Full Access" ON cast_list FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admin Full Access" ON finances FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admin Full Access" ON budgets FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admin Full Access" ON rehearsals FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admin Full Access" ON attendance FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
```

---

## Step 2: Linking the Application
1.  In Supabase, go to **Project Settings** $\rightarrow$ **API**.
2.  Copy the **Project URL** and the **anon public key**.
3.  Open `v4/assets/js/config.js`.
4.  Paste the URL into `SUPABASE_URL` and the key into `SUPABASE_KEY`.

---

## Step 3: Hosting on Vercel
1.  Create a new repository on GitHub called `rccg-drama-enterprise`.
2.  Upload all files within the `v4` folder to this repository.
3.  Log in to [vercel.com](https://vercel.com/).
4.  Click **"Add New"** $\rightarrow$ **"Project"** and import your GitHub repository.
5.  Click **"Deploy"**. 
6.  Vercel will provide a live URL (e.g., `rccg-drama-enterprise.vercel.app`).

---

## Step 4: Initializing the First Administrator
The system is secure by default; you must manually promote the first user:
1.  Visit your live URL and **Sign Up** for an account.
2.  Go to your **Supabase Dashboard** $\rightarrow$ **Table Editor** $\rightarrow$ **profiles**.
3.  Locate your record and change the `role` column from `member` to `admin`.
4.  Refresh the application. The Admin panel and Management tools are now unlocked.
