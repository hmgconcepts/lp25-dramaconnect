-- ============================================================================
-- DramaConnect — FIX: "infinite recursion detected in policy for profiles"
-- ----------------------------------------------------------------------------
-- ROOT CAUSE: old RLS policies (from an earlier setup) that query `profiles`
-- from INSIDE a policy ON `profiles` cause infinite recursion. This script:
--   1. Drops ALL existing policies on every app table (regardless of name).
--   2. Recreates a clean, NON-recursive policy set.
--   3. Re-creates a recursion-safe is_admin() helper.
--
-- The key trick: the SELECT policy on `profiles` does NOT call is_admin();
-- it only checks `authenticated`. So when is_admin() reads `profiles`, it can
-- never re-trigger an admin policy -> no recursion. Admin rights are enforced
-- only on writes (INSERT/UPDATE/DELETE).
--
-- HOW TO RUN: Supabase -> SQL Editor -> New query -> paste ALL -> Run.
-- Safe to re-run.
-- ============================================================================

-- 1. Make sure RLS is enabled on every table ---------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events','activity_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- 2. DROP every existing policy on these tables (whatever they are named) -----
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','productions','cast_list','finances','budgets',
                        'rehearsals','attendance','announcements','events','activity_log')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 3. Recursion-safe admin check ----------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 4. READ: any authenticated user can read every table -----------------------
--    (Plain check — does NOT call is_admin(), so reading profiles never recurses.)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events','activity_log']
  LOOP
    EXECUTE format(
      'CREATE POLICY "dc_read" ON public.%I FOR SELECT USING (auth.role() = ''authenticated'');', t);
  END LOOP;
END $$;

-- 5. WRITES on PROFILES (separated from SELECT to avoid recursion) ------------
CREATE POLICY "dc_profiles_insert_admin" ON public.profiles
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "dc_profiles_update_admin" ON public.profiles
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "dc_profiles_delete_admin" ON public.profiles
  FOR DELETE USING (public.is_admin());
-- A user may update their OWN profile (name/phone/parish).
CREATE POLICY "dc_profiles_self_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 6. WRITES on the OTHER tables: admins only ---------------------------------
--    FOR ALL is safe here because is_admin() reads `profiles`, whose SELECT
--    policy (dc_read) is non-recursive.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events']
  LOOP
    EXECUTE format(
      'CREATE POLICY "dc_admin_write" ON public.%I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());', t);
  END LOOP;
END $$;

-- 7. ACTIVITY LOG: any authenticated user may INSERT; admins manage ----------
CREATE POLICY "dc_log_insert" ON public.activity_log
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "dc_log_admin" ON public.activity_log
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============================================================================
-- 8. VERIFY (read-only): list the policies now in place.
-- ============================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
