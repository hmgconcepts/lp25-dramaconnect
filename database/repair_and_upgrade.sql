-- ============================================================================
-- DramaConnect — ALL-IN-ONE SETUP + REPAIR + UPGRADE (run this once)
-- ----------------------------------------------------------------------------
-- This single, self-contained script:
--   0. CREATES every table (safe if they already exist).
--   1. Adds the `status` column (approval workflow) to profiles.
--   2. Installs a hardened auto-profile trigger (future signups -> 'pending').
--   3. BACKFILLS profiles for users who already signed up.
--   4. Removes ALL old/recursive RLS policies and installs clean ones
--      (fixes "infinite recursion detected in policy for relation profiles").
--   5. Promotes + approves YOUR account as admin.
--
-- It only touches tables that actually exist, so it works whether your database
-- is brand new or partially set up.
--
-- HOW TO RUN: Supabase -> SQL Editor -> New query -> paste ALL -> edit the
-- email near the bottom -> Run. Safe to re-run.
-- ============================================================================

-- 0. CREATE ALL TABLES (no-op if they already exist) -------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name   TEXT,
  email       TEXT,
  phone       TEXT,
  parish      TEXT,
  role        TEXT DEFAULT 'member',
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.productions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title             TEXT NOT NULL,
  performance_date  DATE,
  director          TEXT,
  script_url        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cast_list (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  production_id   UUID REFERENCES public.productions(id) ON DELETE CASCADE,
  member_id       UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  character_role  TEXT,
  notes           TEXT,
  UNIQUE(production_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.finances (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date        DATE DEFAULT CURRENT_DATE,
  description TEXT,
  type        TEXT CHECK (type IN ('income', 'expense')),
  amount      DECIMAL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.budgets (
  production_id     UUID REFERENCES public.productions(id) ON DELETE CASCADE PRIMARY KEY,
  allocated_amount  DECIMAL DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.rehearsals (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rehearsal_date  DATE NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.attendance (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rehearsal_id  UUID REFERENCES public.rehearsals(id) ON DELETE CASCADE,
  member_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status        TEXT DEFAULT 'present',
  marked_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rehearsal_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT,
  author_name  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT NOT NULL,
  event_date  TIMESTAMPTZ NOT NULL,
  location    TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.activity_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_name  TEXT,
  action      TEXT,
  detail      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 1. Ensure the approval column exists on older profiles tables ---------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- 2. Hardened auto-profile trigger (new users start as 'pending') ------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    'member',
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. BACKFILL existing users. They registered before approval existed, so we
--    mark them 'approved' to avoid locking anyone out.
INSERT INTO public.profiles (id, full_name, email, role, status)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name',''), u.email, 'member', 'approved'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles SET status = 'approved' WHERE status IS NULL;

-- 4. RLS: enable + drop ALL existing policies + recreate clean (non-recursive)
--    Every loop checks the table EXISTS first (via to_regclass), so a missing
--    table can never abort the script.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events','activity_log']
  LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','productions','cast_list','finances','budgets',
                        'rehearsals','attendance','announcements','events','activity_log')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Recursion-safe admin check.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- READ: any authenticated user (profiles SELECT never calls is_admin -> no recursion).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events','activity_log']
  LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY "dc_read" ON public.%I FOR SELECT USING (auth.role() = ''authenticated'');', t);
    END IF;
  END LOOP;
END $$;

-- WRITES on profiles (split per command; never on SELECT).
CREATE POLICY "dc_profiles_insert_admin" ON public.profiles FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "dc_profiles_update_admin" ON public.profiles FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "dc_profiles_delete_admin" ON public.profiles FOR DELETE USING (public.is_admin());
CREATE POLICY "dc_profiles_self_update" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- WRITES on other tables: admins only (only if the table exists).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events']
  LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY "dc_admin_write" ON public.%I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());', t);
    END IF;
  END LOOP;
END $$;

-- Activity log: any authenticated user inserts; admins manage.
CREATE POLICY "dc_log_insert" ON public.activity_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "dc_log_admin"  ON public.activity_log FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 5. PROMOTE + APPROVE your admin account ------------------------------------
--    >>> EDIT the email below to YOUR signup email, then run. <<<
UPDATE public.profiles
SET role = 'admin', status = 'approved'
WHERE email = 'CHANGE_ME@example.com';

-- ============================================================================
-- VERIFY (read-only)
-- ============================================================================
SELECT id, email, full_name, role, status, created_at
FROM public.profiles
ORDER BY created_at;
