-- ============================================================================
-- DramaConnect — ALL-IN-ONE REPAIR + UPGRADE (run this once)
-- ----------------------------------------------------------------------------
-- This single script:
--   1. Ensures the profiles table + a NEW `status` column (approval workflow).
--   2. Installs a hardened auto-profile trigger (future signups -> 'pending').
--   3. BACKFILLS profiles for users who already signed up.
--   4. Removes ALL old/recursive RLS policies and installs clean ones
--      (fixes "infinite recursion detected in policy for relation profiles").
--   5. Promotes + approves YOUR account as admin.
--
-- HOW TO RUN: Supabase -> SQL Editor -> New query -> paste ALL -> edit the
-- email near the bottom -> Run. Safe to re-run.
-- ============================================================================

-- 1. Table + columns ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name   TEXT,
  email       TEXT,
  phone       TEXT,
  parish      TEXT,
  role        TEXT DEFAULT 'member',
  status      TEXT DEFAULT 'pending',          -- 'pending' | 'approved'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add status column if the table already existed without it.
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

-- Any existing profile with no status becomes 'approved'.
UPDATE public.profiles SET status = 'approved' WHERE status IS NULL;

-- 4. RLS: enable, drop ALL existing policies, recreate clean (non-recursive) --
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events','activity_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
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
    EXECUTE format('CREATE POLICY "dc_read" ON public.%I FOR SELECT USING (auth.role() = ''authenticated'');', t);
  END LOOP;
END $$;

-- WRITES on profiles (split per command; never on SELECT).
CREATE POLICY "dc_profiles_insert_admin" ON public.profiles FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "dc_profiles_update_admin" ON public.profiles FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "dc_profiles_delete_admin" ON public.profiles FOR DELETE USING (public.is_admin());
CREATE POLICY "dc_profiles_self_update" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- WRITES on other tables: admins only.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events']
  LOOP
    EXECUTE format('CREATE POLICY "dc_admin_write" ON public.%I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());', t);
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
