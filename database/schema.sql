-- ============================================================================
-- DramaConnect Enterprise v5 — Complete Database Schema (Supabase / PostgreSQL)
-- ----------------------------------------------------------------------------
-- HOW TO USE:
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this ENTIRE file and click "Run".
--   3. It is safe to re-run: it uses IF NOT EXISTS / CREATE OR REPLACE / DROP.
-- ============================================================================

-- ------------------------------------------------------------------ 1. PROFILES
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name   TEXT,
  email       TEXT,
  phone       TEXT,
  parish      TEXT,
  role        TEXT DEFAULT 'member',          -- 'member' | 'admin'
  status      TEXT DEFAULT 'pending',         -- 'pending' | 'approved'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- --------------------------------------------------------------- 2. PRODUCTIONS
CREATE TABLE IF NOT EXISTS productions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title             TEXT NOT NULL,
  performance_date  DATE,
  director          TEXT,
  script_url        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------- 3. CAST LIST
CREATE TABLE IF NOT EXISTS cast_list (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  production_id   UUID REFERENCES productions(id) ON DELETE CASCADE,
  member_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  character_role  TEXT,
  notes           TEXT,
  UNIQUE(production_id, member_id)
);

-- ------------------------------------------------------------------- 4. FINANCES
CREATE TABLE IF NOT EXISTS finances (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date        DATE DEFAULT CURRENT_DATE,
  description TEXT,
  type        TEXT CHECK (type IN ('income', 'expense')),
  amount      DECIMAL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------------- 5. BUDGETS
CREATE TABLE IF NOT EXISTS budgets (
  production_id     UUID REFERENCES productions(id) ON DELETE CASCADE PRIMARY KEY,
  allocated_amount  DECIMAL DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------- 6. REHEARSALS
CREATE TABLE IF NOT EXISTS rehearsals (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rehearsal_date  DATE NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------- 7. ATTENDANCE
CREATE TABLE IF NOT EXISTS attendance (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rehearsal_id  UUID REFERENCES rehearsals(id) ON DELETE CASCADE,
  member_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT DEFAULT 'present',        -- 'present' | 'absent' | 'excused'
  marked_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rehearsal_id, member_id)
);

-- -------------------------------------------------------------- 8. ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS announcements (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT,
  author_name  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- --------------------------------------------------------------------- 9. EVENTS
CREATE TABLE IF NOT EXISTS events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT NOT NULL,
  event_date  TIMESTAMPTZ NOT NULL,
  location    TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------- 10. ACTIVITY LOG
CREATE TABLE IF NOT EXISTS activity_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_name  TEXT,
  action      TEXT,
  detail      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- AUTO-CREATE A PROFILE WHEN A NEW USER SIGNS UP
-- Without this, signed-up users have no profile row and the dashboard cannot
-- show their name/role.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE productions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cast_list     ENABLE ROW LEVEL SECURITY;
ALTER TABLE finances      ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rehearsals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance    ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log  ENABLE ROW LEVEL SECURITY;

-- Admin check helper. SECURITY DEFINER bypasses RLS so a policy ON profiles can
-- safely call it WITHOUT causing "infinite recursion detected in policy".
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

-- IMPORTANT: drop EVERY existing policy on these tables first (whatever it is
-- named). This removes any old recursive policies from earlier setups that
-- cause "infinite recursion detected in policy for relation profiles".
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

-- ---- READ: any authenticated user can read every table ----
-- (Plain check — the profiles SELECT policy does NOT call is_admin(), so when
--  is_admin() reads profiles it can never re-trigger an admin policy.)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events','activity_log']
  LOOP
    EXECUTE format('CREATE POLICY "dc_read" ON public.%I FOR SELECT USING (auth.role() = ''authenticated'');', t);
  END LOOP;
END $$;

-- ---- WRITES on profiles: admins (split per command, never on SELECT) ----
CREATE POLICY "dc_profiles_insert_admin" ON public.profiles
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "dc_profiles_update_admin" ON public.profiles
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "dc_profiles_delete_admin" ON public.profiles
  FOR DELETE USING (public.is_admin());
-- A user may update their OWN profile.
CREATE POLICY "dc_profiles_self_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ---- WRITES on the other tables: admins only ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['productions','cast_list','finances','budgets',
                           'rehearsals','attendance','announcements','events']
  LOOP
    EXECUTE format('CREATE POLICY "dc_admin_write" ON public.%I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());', t);
  END LOOP;
END $$;

-- Allow any authenticated user to write to the activity log (app logs actions).
CREATE POLICY "dc_log_insert" ON public.activity_log
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "dc_log_admin" ON public.activity_log
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============================================================================
-- DONE. Next: sign up in the app, then promote yourself to admin:
--   UPDATE profiles SET role = 'admin' WHERE email = 'you@example.com';
-- ============================================================================
