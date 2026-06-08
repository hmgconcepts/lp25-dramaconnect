-- ============================================================================
-- DramaConnect — FIX: "registered user not appearing in profiles table"
-- ----------------------------------------------------------------------------
-- WHAT THIS DOES (safe to run, and safe to re-run):
--   1. Makes sure the `profiles` table exists.
--   2. (Re)creates a hardened auto-profile trigger for FUTURE signups.
--   3. BACKFILLS profiles for users who ALREADY signed up (your case).
--   4. Promotes your account to admin.
--
-- HOW TO RUN:
--   Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this -> Run.
-- ============================================================================

-- 0. Make sure the table exists (no-op if it already does) --------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name   TEXT,
  email       TEXT,
  phone       TEXT,
  parish      TEXT,
  role        TEXT DEFAULT 'member',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 1. Hardened trigger function for FUTURE signups -----------------------------
--    - SECURITY DEFINER  : runs as owner, bypasses RLS so the insert succeeds.
--    - SET search_path    : avoids "relation profiles does not exist" inside
--                           the auth schema context (a common silent failure).
--    - ON CONFLICT        : never errors if a row already exists.
--    - EXCEPTION handler  : a profile-insert problem must NEVER block signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    'member'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log a warning but allow the auth signup to complete.
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- 2. (Re)attach the trigger to auth.users -------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. BACKFILL: create profiles for any EXISTING auth users that are missing ----
--    This is what fixes the user you ALREADY registered.
INSERT INTO public.profiles (id, full_name, email, role)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', ''),
  u.email,
  'member'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 4. PROMOTE your account to admin --------------------------------------------
--    >>> EDIT the email below to YOUR signup email, then run. <<<
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'CHANGE_ME@example.com';

-- ============================================================================
-- 5. VERIFY (read-only) — these SELECTs show you the result.
-- ============================================================================
-- How many auth users vs profiles? (should match)
SELECT
  (SELECT COUNT(*) FROM auth.users)      AS auth_users,
  (SELECT COUNT(*) FROM public.profiles) AS profiles;

-- See every profile and its role:
SELECT id, email, full_name, role, created_at
FROM public.profiles
ORDER BY created_at;
