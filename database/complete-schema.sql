-- ============================================================================
-- DramaConnect v14.0 — CANONICAL COMPLETE DATABASE SCHEMA
-- ============================================================================
-- Paste this entire file into Supabase SQL Editor and run it once. It contains
-- the complete production schema, repair logic, RLS, RPCs, resilience/backup,
-- control-plane settings, storage governance, roles/status, site licensing,
-- verifiable ID cards, public programme registration, duty roster and member care.
-- No other production SQL file is required after this succeeds.
--
-- SAFE TO RERUN: every object is created/replaced/upserted idempotently. Existing
-- application rows are preserved. Missing auth profiles are backfilled as
-- PENDING; this installer never silently approves users or embeds an admin email.
--
-- FIRST ADMIN: sign up through the app, then deliberately approve that exact
-- profile using the clearly marked optional statement in component 01. Keep that
-- one-off owner action private; never put a real privileged email in source.
--
-- Individual database/*.sql files are maintained migration components for source
-- review and upgrades. This generated file is the deployment authority.
--
-- COMPONENT MANIFEST (the builder verifies these source digests):
-- 01 database/repair_and_upgrade.sql  sha256:ff81eda256cc670de00d24f93b059676a457a0e25559b256b59c6796620e3be0
-- 02 database/security_hardening.sql  sha256:8dbd18438c93351a2ad07d625c83026539bf107db974ff382bd89d8cb9174d60
-- 03 database/resilience_and_backup.sql  sha256:1ef7b4c528f4adab47bbaf5494fb5b5e56e0602ed4669e2c1115ea0740dc1e18
-- 04 database/platform_management.sql  sha256:497696497ab594ba3337b22ac5b45caabb6e3654276d1d88bcec04d71ce9ff29
-- 05 database/identity_and_programs.sql  sha256:52290735763425e2be73ebf0286113618077b6550478a78c1d548ee16a18c273
-- 06 database/post_install_selfheal.sql  sha256:dc0f41e0bfc17332db078952142345b3c65a18fcd646f6c834ec819894432f53
-- ============================================================================

-- ============================================================================
-- COMPONENT 01: Base schema, repair and safe account bootstrap
-- Source: database/repair_and_upgrade.sql
-- ============================================================================
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
--   5. Includes an explicit, no-op-by-default first-admin bootstrap statement.
--
-- It only touches tables that actually exist, so it works whether your database
-- is brand new or partially set up. New/backfilled accounts remain pending until
-- an owner deliberately approves them; this script never silently grants access.
--
-- HOW TO RUN: prefer database/complete-schema.sql. This legacy component remains
-- safe to re-run for upgrades and is assembled into the canonical installer.
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

CREATE TABLE IF NOT EXISTS public.messages (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel       TEXT,                 -- 'whatsapp' | 'email'
  audience      TEXT,                 -- 'individual' | 'all' | 'admins' | 'members'
  recipients    TEXT,                 -- summary (e.g. "12 members")
  subject       TEXT,
  body          TEXT,
  sent_by       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- IN-PLATFORM MESSAGING (internal inbox). recipient_id NULL = broadcast to all.
-- to_admins = TRUE means addressed to all admins (member -> leadership).
CREATE TABLE IF NOT EXISTS public.inbox (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name   TEXT,
  recipient_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_admins     BOOLEAN DEFAULT FALSE,
  subject       TEXT,
  body          TEXT,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- TASKS / ASSIGNMENTS (admin assigns; assignee updates status).
CREATE TABLE IF NOT EXISTS public.tasks (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  detail        TEXT,
  assignee_id   UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by   TEXT,
  due_date      DATE,
  priority      TEXT DEFAULT 'normal',  -- 'low' | 'normal' | 'high'
  status        TEXT DEFAULT 'open',    -- 'open' | 'in_progress' | 'done'
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- SCHEDULED REMINDERS (recurring broadcast templates).
CREATE TABLE IF NOT EXISTS public.reminders (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT,
  audience      TEXT DEFAULT 'all',     -- 'all' | 'members' | 'admins'
  frequency     TEXT DEFAULT 'weekly',  -- 'once' | 'daily' | 'weekly' | 'monthly'
  next_run      TIMESTAMPTZ,
  active        BOOLEAN DEFAULT TRUE,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RESOURCE LIBRARY (links to free cloud-stored scripts, docs, audio, video).
CREATE TABLE IF NOT EXISTS public.resources (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  category      TEXT DEFAULT 'document', -- 'script' | 'document' | 'audio' | 'video' | 'image' | 'link'
  url           TEXT NOT NULL,
  description   TEXT,
  added_by      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- POLLS / VOTING.
CREATE TABLE IF NOT EXISTS public.polls (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  question      TEXT NOT NULL,
  options       JSONB NOT NULL,          -- array of option strings
  is_open       BOOLEAN DEFAULT TRUE,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.poll_votes (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  poll_id       UUID REFERENCES public.polls(id) ON DELETE CASCADE,
  voter_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  option_index  INT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(poll_id, voter_id)
);

-- EVENT RSVPs (member responses to events).
CREATE TABLE IF NOT EXISTS public.event_rsvps (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    UUID REFERENCES public.events(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  response    TEXT DEFAULT 'going',   -- 'going' | 'maybe' | 'no'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, member_id)
);

-- ORG-WIDE PHOTO GALLERY (productions, events, group photos).
CREATE TABLE IF NOT EXISTS public.gallery (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT,
  caption     TEXT,
  image_url   TEXT NOT NULL,
  album       TEXT DEFAULT 'General',  -- e.g. a production/event name
  uploaded_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- SUGGESTION BOX (members submit ideas/feedback; admins review).
CREATE TABLE IF NOT EXISTS public.suggestions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT,
  anonymous   BOOLEAN DEFAULT FALSE,
  author_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name TEXT,
  status      TEXT DEFAULT 'new',      -- 'new' | 'reviewed' | 'actioned' | 'closed'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 1. Ensure the approval column exists on older profiles tables ---------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- Extended member profile fields (added v11). All optional; members complete
-- them later. birth_month + birth_day store only month/day for birthday
-- celebration (no year required, for privacy).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_month  INT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_day    INT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS occupation   TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address      TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender       TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS unit         TEXT;   -- drama unit/group
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS facebook     TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS instagram    TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tiktok       TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS twitter      TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp     TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bday_last_sent TEXT;  -- 'YYYY-MM-DD' guard so the bot sends once/day

-- Profile photo (for the digital ID) + emergency / next-of-kin contact (v12).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url     TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_relation TEXT;

-- Unit-leader permissions (v13): a member can be made leader of a unit. Unit
-- leaders get elevated rights scoped to members of their own unit.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_unit_leader BOOLEAN DEFAULT FALSE;

-- Self check-in support on rehearsals (member marks own attendance via a code).
ALTER TABLE public.rehearsals ADD COLUMN IF NOT EXISTS checkin_code TEXT;
ALTER TABLE public.rehearsals ADD COLUMN IF NOT EXISTS checkin_open BOOLEAN DEFAULT FALSE;

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
                           'rehearsals','attendance','announcements','events','activity_log','messages','inbox','tasks','reminders','resources','polls','poll_votes','event_rsvps','gallery','suggestions']
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
                        'rehearsals','attendance','announcements','events','activity_log','messages','inbox','tasks','reminders','resources','polls','poll_votes','event_rsvps','gallery','suggestions')
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
                           'rehearsals','attendance','announcements','events','activity_log','messages','inbox','tasks','reminders','resources','polls','poll_votes','event_rsvps','gallery','suggestions']
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
                           'rehearsals','attendance','announcements','events','messages']
  LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY "dc_admin_write" ON public.%I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());', t);
    END IF;
  END LOOP;
END $$;

-- Activity log: any authenticated user inserts; admins manage.
CREATE POLICY "dc_log_insert" ON public.activity_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "dc_log_admin"  ON public.activity_log FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- IN-PLATFORM INBOX: replace the generic dc_read with privacy-aware rules.
DROP POLICY IF EXISTS "dc_read" ON public.inbox;
-- You can read a message if: you sent it, it's addressed to you, it's a broadcast
-- (recipient_id IS NULL and not to_admins), or it's to_admins and you are an admin.
CREATE POLICY "inbox_read" ON public.inbox FOR SELECT USING (
  sender_id = auth.uid()
  OR recipient_id = auth.uid()
  OR (recipient_id IS NULL AND to_admins = FALSE)
  OR (to_admins = TRUE AND public.is_admin())
);
-- Any authenticated user may send a message (member -> admin, admin -> member).
CREATE POLICY "inbox_insert" ON public.inbox FOR INSERT WITH CHECK (auth.role() = 'authenticated');
-- Recipient (or admin) may update read_at; admins may manage.
CREATE POLICY "inbox_update" ON public.inbox FOR UPDATE USING (
  recipient_id = auth.uid() OR public.is_admin()
  OR (to_admins = TRUE AND public.is_admin())
);
CREATE POLICY "inbox_delete" ON public.inbox FOR DELETE USING (
  sender_id = auth.uid() OR recipient_id = auth.uid() OR public.is_admin()
);

-- ---- TASKS: admins manage; assignee can update their own task status.
CREATE POLICY "tasks_admin" ON public.tasks FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "tasks_assignee_update" ON public.tasks FOR UPDATE
  USING (assignee_id = auth.uid()) WITH CHECK (assignee_id = auth.uid());

-- ---- REMINDERS: admins only (besides the read policy already granted).
CREATE POLICY "reminders_admin" ON public.reminders FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- RESOURCES & POLLS: admins manage (everyone can read via dc_read).
CREATE POLICY "resources_admin" ON public.resources FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "polls_admin" ON public.polls FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- POLL VOTES: any authenticated user may cast/update/remove THEIR OWN vote.
CREATE POLICY "votes_insert" ON public.poll_votes FOR INSERT WITH CHECK (voter_id = auth.uid());
CREATE POLICY "votes_update" ON public.poll_votes FOR UPDATE USING (voter_id = auth.uid()) WITH CHECK (voter_id = auth.uid());
CREATE POLICY "votes_delete" ON public.poll_votes FOR DELETE USING (voter_id = auth.uid() OR public.is_admin());

-- ---- SELF CHECK-IN: members may insert/update THEIR OWN attendance row.
--      (Admins already have full access via dc_admin_write.)
CREATE POLICY "attendance_self_insert" ON public.attendance
  FOR INSERT WITH CHECK (member_id = auth.uid());
CREATE POLICY "attendance_self_update" ON public.attendance
  FOR UPDATE USING (member_id = auth.uid()) WITH CHECK (member_id = auth.uid());

-- ---- EVENT RSVPs: anyone reads (dc_read); members manage their OWN response.
CREATE POLICY "rsvp_self_insert" ON public.event_rsvps
  FOR INSERT WITH CHECK (member_id = auth.uid());
CREATE POLICY "rsvp_self_update" ON public.event_rsvps
  FOR UPDATE USING (member_id = auth.uid()) WITH CHECK (member_id = auth.uid());
CREATE POLICY "rsvp_self_delete" ON public.event_rsvps
  FOR DELETE USING (member_id = auth.uid() OR public.is_admin());

-- ---- UNIT-LEADER helper: true if the current user is a unit leader whose
--      unit matches the given unit. SECURITY DEFINER avoids RLS recursion.
CREATE OR REPLACE FUNCTION public.is_unit_leader_of(target_unit TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_unit_leader = TRUE
      AND unit IS NOT NULL AND unit = target_unit
  );
$$;

-- A unit leader may UPDATE the profiles of members in their own unit (e.g. fix
-- details, set unit). They cannot change roles to admin (admin-only action).
CREATE POLICY "profiles_unit_leader_update" ON public.profiles
  FOR UPDATE USING (public.is_unit_leader_of(unit))
  WITH CHECK (public.is_unit_leader_of(unit));

-- ---- GALLERY: everyone reads (dc_read); admins + unit leaders may add;
--      uploader or admin may delete.
CREATE POLICY "gallery_insert" ON public.gallery
  FOR INSERT WITH CHECK (
    public.is_admin() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_unit_leader = TRUE)
  );
CREATE POLICY "gallery_admin" ON public.gallery
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- SUGGESTIONS: any authenticated member may submit; admins manage.
CREATE POLICY "suggestions_insert" ON public.suggestions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "suggestions_admin" ON public.suggestions
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- STORAGE: public "avatars" bucket for profile photos (digital ID) ------
-- Creates a public-read bucket and policies so each user manages their OWN
-- photo. Files are stored as avatars/<user-id>/<filename>.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_user_insert" ON storage.objects;
CREATE POLICY "avatars_user_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "avatars_user_update" ON storage.objects;
CREATE POLICY "avatars_user_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "avatars_user_delete" ON storage.objects;
CREATE POLICY "avatars_user_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---- STORAGE: public "gallery" bucket for org photos -----------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('gallery', 'gallery', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "gallery_public_read" ON storage.objects;
CREATE POLICY "gallery_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'gallery');

-- Any authenticated user may upload to gallery (the app limits the button to
-- admins + unit leaders); uploader or admin may remove.
DROP POLICY IF EXISTS "gallery_auth_insert" ON storage.objects;
CREATE POLICY "gallery_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'gallery' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "gallery_owner_delete" ON storage.objects;
CREATE POLICY "gallery_owner_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'gallery' AND auth.role() = 'authenticated');

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

-- ============================================================================
-- Enterprise Upgrade: Inventory & Props Management
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT 'Prop', -- Prop, Costume, Equipment, Other
  quantity    INTEGER DEFAULT 1,
  condition   TEXT DEFAULT 'Good',
  location    TEXT,
  notes       TEXT,
  added_by    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inventory_read" ON public.inventory;
CREATE POLICY "inventory_read" ON public.inventory FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "inventory_write" ON public.inventory;
CREATE POLICY "inventory_write" ON public.inventory FOR ALL USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_unit_leader = TRUE)) WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_unit_leader = TRUE));


-- ============================================================================
-- Enterprise Upgrade: Costume Measurements for Profiles
-- ============================================================================
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS height TEXT,
ADD COLUMN IF NOT EXISTS shoe_size TEXT,
ADD COLUMN IF NOT EXISTS chest TEXT,
ADD COLUMN IF NOT EXISTS waist TEXT;


-- ============================================================================
-- Enterprise Upgrade V4: True SaaS / Multi-tenant Global Settings 
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tenant_settings (
  id          INT PRIMARY KEY DEFAULT 1,
  app_name    TEXT DEFAULT 'DramaConnect Enterprise',
  org_name    TEXT DEFAULT 'RCCG LP 25',
  logo_url    TEXT DEFAULT '../assets/img/rccg_logo.png',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults so we never error on reading
INSERT INTO public.tenant_settings (id, app_name, org_name) 
VALUES (1, 'DramaConnect Enterprise', 'RCCG LP 25') 
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_settings_read" ON public.tenant_settings;
CREATE POLICY "tenant_settings_read" ON public.tenant_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "tenant_settings_write" ON public.tenant_settings;
CREATE POLICY "tenant_settings_write" ON public.tenant_settings FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============================================================================
-- Enterprise Upgrade V4: Fullstack Backend Audit Triggers
-- Automates security logs in the database directly, bypassing frontend reliance.
-- ============================================================================
CREATE OR REPLACE FUNCTION log_critical_admin_actions() 
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
      IF NEW.role <> OLD.role THEN
          INSERT INTO public.activity_log (action, details, user_id) 
          VALUES ('role_change', 'Changed role from ' || COALESCE(OLD.role, 'member') || ' to ' || COALESCE(NEW.role, 'member') || ' for ' || NEW.id, NEW.id);
      END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_critical_admin_actions ON public.profiles;
CREATE TRIGGER trg_critical_admin_actions 
AFTER UPDATE ON public.profiles 
FOR EACH ROW EXECUTE FUNCTION log_critical_admin_actions();


-- ============================================================================
-- COMPONENT 02: RLS and server-authoritative security
-- Source: database/security_hardening.sql
-- ============================================================================
-- ============================================================================
-- DramaConnect security hardening and missing backend objects
-- Prefer database/complete-schema.sql for installation. When this migration is
-- run on a legacy database by itself, it now bootstraps tenant_settings before
-- altering it, fixing SQLSTATE 42P01. Other application tables remain expected
-- from the base schema. Idempotent: policies, views, functions and triggers are
-- replaced safely.
-- ============================================================================

BEGIN;

-- Standalone dependency guard for the setting relation this migration extends.
CREATE TABLE IF NOT EXISTS public.tenant_settings (
  id INT PRIMARY KEY DEFAULT 1,
  app_name TEXT DEFAULT 'DramaConnect Enterprise',
  org_name TEXT DEFAULT 'RCCG LP 25',
  logo_url TEXT DEFAULT '../assets/img/rccg_logo.png',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.tenant_settings (id, app_name, org_name)
VALUES (1, 'DramaConnect Enterprise', 'RCCG LP 25')
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------------
-- 1. Missing columns and data-integrity checks
--
-- Every statement in this section is guarded with to_regclass() and column
-- existence checks. This component runs inside an explicit transaction: if a
-- single unguarded ALTER hit a table or column that is absent on a particular
-- project, PostgreSQL would abort and roll the ENTIRE component back. The base
-- tables created in component 01 would survive, but the views and aggregate
-- RPCs declared further down this same component would silently vanish, and the
-- UI would start reporting:
--     Could not find the table 'public.member_directory' in the schema cache
--     Could not find the table 'public.rehearsal_schedule' in the schema cache
--     Could not find the function public.poll_results without parameters
--     Could not find the function public.event_rsvp_results without parameters
-- Guarding each statement keeps the transaction atomic for what matters and
-- makes this migration safe on new, partial and legacy databases alike.
-- --------------------------------------------------------------------------
DO $dc_guard$
BEGIN
  IF to_regclass('public.gallery') IS NOT NULL
     AND to_regclass('public.profiles') IS NOT NULL THEN
    ALTER TABLE public.gallery
      ADD COLUMN IF NOT EXISTS uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.tenant_settings') IS NOT NULL THEN
    ALTER TABLE public.tenant_settings
      ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#003399';
  END IF;
END $dc_guard$;

-- Each constraint is applied only when both the table and every column it
-- references are present. NOT VALID keeps re-runs cheap and never rejects rows
-- that already existed before the constraint was introduced.
DO $dc_guard$
DECLARE
  c       RECORD;
  col     TEXT;
  missing BOOLEAN;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('profiles', 'profiles_role_valid', ARRAY['role'],
       'role IN (''member'', ''admin'')'),
      ('profiles', 'profiles_status_valid', ARRAY['status'],
       'status IN (''pending'', ''approved'', ''rejected'')'),
      ('profiles', 'profiles_birth_month_valid', ARRAY['birth_month'],
       'birth_month IS NULL OR birth_month BETWEEN 1 AND 12'),
      ('profiles', 'profiles_birth_day_valid', ARRAY['birth_day'],
       'birth_day IS NULL OR birth_day BETWEEN 1 AND 31'),
      ('profiles', 'profiles_unit_length', ARRAY['unit'],
       'unit IS NULL OR char_length(unit) <= 80'),
      ('attendance', 'attendance_status_valid', ARRAY['status'],
       'status IN (''present'', ''absent'', ''excused'', ''late'')'),
      ('event_rsvps', 'event_rsvps_response_valid', ARRAY['response'],
       'response IN (''going'', ''maybe'', ''no'')'),
      ('tasks', 'tasks_status_valid', ARRAY['status'],
       'status IN (''open'', ''in_progress'', ''done'')'),
      ('tasks', 'tasks_priority_valid', ARRAY['priority'],
       'priority IN (''low'', ''normal'', ''high'')'),
      ('gallery', 'gallery_image_url_safe', ARRAY['image_url'],
       'image_url IS NULL OR image_url ~* ''^https?://'''),
      ('resources', 'resources_url_safe', ARRAY['url'],
       'url IS NULL OR url ~* ''^https?://'''),
      ('productions', 'productions_script_url_safe', ARRAY['script_url'],
       'script_url IS NULL OR script_url ~* ''^https?://'''),
      ('tenant_settings', 'tenant_primary_color_valid', ARRAY['primary_color'],
       'primary_color IS NULL OR primary_color = '''' OR primary_color ~ ''^#[0-9A-Fa-f]{6}$'''),
      ('tenant_settings', 'tenant_logo_url_safe', ARRAY['logo_url'],
       'logo_url IS NULL OR logo_url = '''' OR logo_url ~* ''^https?://'' OR logo_url ~ ''^(\.{0,2}/|/)(?!/)''')
    ) AS v(tbl, con, cols, expr)
  LOOP
    IF to_regclass('public.' || c.tbl) IS NULL THEN
      CONTINUE;
    END IF;

    missing := false;
    FOREACH col IN ARRAY c.cols
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = col
      ) THEN
        missing := true;
      END IF;
    END LOOP;

    IF missing THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', c.tbl, c.con);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
                   c.tbl, c.con, c.expr);
  END LOOP;
END $dc_guard$;

-- Indexes are guarded for the same reason: a missing table must not abort the
-- transaction that also carries the views and the aggregate RPCs.
DO $dc_guard$
DECLARE
  i RECORD;
BEGIN
  FOR i IN
    SELECT * FROM (VALUES
      ('gallery_uploaded_by_id_idx',  'gallery', 'uploaded_by_id'),
      ('inbox_recipient_created_idx', 'inbox',   'recipient_id, created_at DESC'),
      ('tasks_assignee_due_idx',      'tasks',   'assignee_id, due_date')
    ) AS v(idx, tbl, cols)
  LOOP
    IF to_regclass('public.' || i.tbl) IS NOT NULL THEN
      BEGIN
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)', i.idx, i.tbl, i.cols);
      EXCEPTION WHEN undefined_column OR undefined_table THEN
        NULL; -- column not present on this project; skip quietly
      END;
    END IF;
  END LOOP;
END $dc_guard$;

-- --------------------------------------------------------------------------
-- 2. Recursion-safe authorization helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_member()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_gallery_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'approved'
      AND (role = 'admin' OR is_unit_leader IS TRUE)
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_approved_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_gallery_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_gallery_manager() TO authenticated;

-- --------------------------------------------------------------------------
-- 3. Safe member/schedule projections (sensitive fields and codes omitted)
-- Views intentionally execute with the owner's privileges, but expose only the
-- explicit columns below and only approved profiles.
-- --------------------------------------------------------------------------
DROP VIEW IF EXISTS public.member_directory;
CREATE VIEW public.member_directory
WITH (security_barrier = true)
AS
SELECT
  id, full_name, email, phone, parish, role, status, unit, occupation,
  avatar_url, whatsapp, facebook, instagram, tiktok, twitter,
  birth_month, birth_day, is_unit_leader, created_at
FROM public.profiles
WHERE status = 'approved'
  AND public.is_approved_member();

DROP VIEW IF EXISTS public.rehearsal_schedule;
CREATE VIEW public.rehearsal_schedule
WITH (security_barrier = true)
AS
SELECT id, rehearsal_date, notes, checkin_open, created_at
FROM public.rehearsals
WHERE public.is_approved_member();

REVOKE ALL ON public.member_directory FROM PUBLIC, anon;
REVOKE ALL ON public.rehearsal_schedule FROM PUBLIC, anon;
GRANT SELECT ON public.member_directory TO authenticated;
GRANT SELECT ON public.rehearsal_schedule TO authenticated;

-- --------------------------------------------------------------------------
-- 4. Guard profile updates at column level. RLS identifies eligible rows; this
-- trigger prevents self-promotion, approval bypass, unit reassignment and email
-- desynchronization even if a malicious client sends extra columns.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  auth_email TEXT;
BEGIN
  -- SQL Editor, trusted database jobs and the service role remain available for
  -- recovery/automation. Browser requests always have auth.uid().
  IF caller IS NULL OR jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF caller <> OLD.id THEN
    RAISE EXCEPTION 'Only an administrator may update another member profile'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.is_unit_leader IS DISTINCT FROM OLD.is_unit_leader
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.bday_last_sent IS DISTINCT FROM OLD.bday_last_sent THEN
    RAISE EXCEPTION 'Role, approval, unit and leadership fields are administrator-managed'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    SELECT u.email INTO auth_email FROM auth.users u WHERE u.id = OLD.id;
    IF NEW.email IS DISTINCT FROM auth_email THEN
      RAISE EXCEPTION 'Profile email must match the authenticated account email'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_update ON public.profiles;
CREATE TRIGGER trg_guard_profile_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- Keep profiles.email synchronized with Supabase Auth. Email changes must be
-- initiated with sb.auth.updateUser(), never by writing profiles directly.
CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
AFTER UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- Correct the legacy trigger, which referenced nonexistent details/user_id.
CREATE OR REPLACE FUNCTION public.log_critical_admin_actions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO public.activity_log (actor_name, action, detail)
    VALUES (
      'Database', 'role_change',
      'Changed role from ' || COALESCE(OLD.role, 'member') || ' to ' ||
      COALESCE(NEW.role, 'member') || ' for ' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_critical_admin_actions ON public.profiles;
CREATE TRIGGER trg_critical_admin_actions
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_critical_admin_actions();

-- --------------------------------------------------------------------------
-- 5. Server-authoritative operations
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.self_check_in(
  p_rehearsal_id UUID,
  p_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.rehearsals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.rehearsals
  WHERE id = p_rehearsal_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Rehearsal not found'; END IF;
  IF r.checkin_open IS NOT TRUE THEN RAISE EXCEPTION 'Self check-in is closed'; END IF;

  -- rehearsal_date is a plain DATE with no timezone, while CURRENT_DATE is the
  -- server date (UTC on Supabase). A rehearsal held in the evening in a
  -- timezone ahead of UTC, or one running past midnight, was rejected as "not
  -- the rehearsal date" even though it was the correct local day. A one-day
  -- window either side covers every real timezone offset while still refusing
  -- check-in for a rehearsal weeks away. The code itself remains secret and the
  -- window remains under explicit admin control through checkin_open.
  IF r.rehearsal_date NOT BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'Self check-in is only available on the rehearsal date';
  END IF;

  -- A code must simply exist and not be trivially short. The previous rule
  -- demanded char_length(code) = 6 exactly, which silently rejected every code
  -- of any other length -- including the "DRAMA25" example shown in the admin
  -- UI (seven characters) and ordinary codes such as "SEP12" (five characters)
  -- -- and reported "Invalid check-in code" no matter what the member typed.
  IF r.checkin_code IS NULL OR char_length(btrim(r.checkin_code)) < 3 THEN
    RAISE EXCEPTION 'No self check-in code is set for this rehearsal' USING ERRCODE = '22023';
  END IF;

  -- Compare case-insensitively with whitespace removed on BOTH sides, so a
  -- member who types "sep12" or pastes "SEP12 " against an announced "SEP12"
  -- is checked in rather than rejected.
  IF upper(btrim(COALESCE(p_code, ''))) <> upper(btrim(r.checkin_code)) THEN
    RAISE EXCEPTION 'Invalid check-in code' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.attendance (rehearsal_id, member_id, status, marked_at)
  VALUES (p_rehearsal_id, auth.uid(), 'present', NOW())
  ON CONFLICT (rehearsal_id, member_id)
  DO UPDATE SET status = 'present', marked_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_poll_vote(
  p_poll_id UUID,
  p_option_index INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p public.polls%ROWTYPE;
  option_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO p FROM public.polls WHERE id = p_poll_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Poll not found'; END IF;
  IF p.is_open IS NOT TRUE THEN RAISE EXCEPTION 'This poll is closed'; END IF;
  IF jsonb_typeof(p.options) <> 'array' THEN RAISE EXCEPTION 'Poll options are invalid'; END IF;
  option_count := jsonb_array_length(p.options);
  IF option_count < 2 OR option_count > 20
     OR p_option_index < 0 OR p_option_index >= option_count THEN
    RAISE EXCEPTION 'Invalid poll option' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.poll_votes (poll_id, voter_id, option_index)
  VALUES (p_poll_id, auth.uid(), p_option_index)
  ON CONFLICT (poll_id, voter_id)
  DO UPDATE SET option_index = EXCLUDED.option_index, created_at = NOW();
END;
$$;

-- Aggregated results preserve voter privacy while still telling the caller which
-- option they selected.
CREATE OR REPLACE FUNCTION public.poll_results()
RETURNS TABLE (
  poll_id UUID,
  option_index INTEGER,
  vote_count BIGINT,
  is_mine BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT v.poll_id, v.option_index, COUNT(*)::BIGINT,
           BOOL_OR(v.voter_id = auth.uid())
    FROM public.poll_votes v
    GROUP BY v.poll_id, v.option_index;
END;
$$;

-- RSVP totals are department-visible, while individual response identities stay
-- private to the respondent and administrators.
CREATE OR REPLACE FUNCTION public.event_rsvp_results()
RETURNS TABLE (
  event_id UUID,
  response TEXT,
  response_count BIGINT,
  is_mine BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.event_id, r.response, COUNT(*)::BIGINT,
           BOOL_OR(r.member_id = auth.uid())
    FROM public.event_rsvps r
    GROUP BY r.event_id, r.response;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_task_status(
  p_task_id UUID,
  p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('open', 'in_progress', 'done') THEN
    RAISE EXCEPTION 'Invalid task status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tasks
  SET status = p_status
  WHERE id = p_task_id
    AND (assignee_id = auth.uid() OR public.is_admin());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found or access denied' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.self_check_in(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cast_poll_vote(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.poll_results() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_rsvp_results() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_task_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.self_check_in(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cast_poll_vote(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.poll_results() TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_rsvp_results() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_task_status(UUID, TEXT) TO authenticated;

-- Normalize identity-bearing rows and reject field tampering.
CREATE OR REPLACE FUNCTION public.guard_inbox_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  caller_name TEXT;
BEGIN
  IF caller IS NULL OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(full_name, email, 'Member') INTO caller_name
    FROM public.profiles WHERE id = caller;
    NEW.sender_id := caller;
    NEW.sender_name := caller_name;
    NEW.read_at := NULL;
    IF NEW.recipient_id IS NOT NULL AND NEW.to_admins IS TRUE THEN
      RAISE EXCEPTION 'Choose either a direct recipient or the admin group';
    END IF;
    IF NOT public.is_admin() AND NEW.recipient_id IS NULL AND NEW.to_admins IS NOT TRUE THEN
      RAISE EXCEPTION 'Only administrators may broadcast to all members'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT public.is_admin() THEN
    IF OLD.recipient_id IS DISTINCT FROM caller
       OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
       OR NEW.sender_name IS DISTINCT FROM OLD.sender_name
       OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
       OR NEW.to_admins IS DISTINCT FROM OLD.to_admins
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Recipients may only update read status'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_inbox_write ON public.inbox;
CREATE TRIGGER trg_guard_inbox_write
BEFORE INSERT OR UPDATE ON public.inbox
FOR EACH ROW EXECUTE FUNCTION public.guard_inbox_write();

CREATE OR REPLACE FUNCTION public.normalize_activity_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(full_name, email, 'Member') INTO NEW.actor_name
    FROM public.profiles WHERE id = auth.uid();
  END IF;
  NEW.action := left(COALESCE(NEW.action, 'unknown'), 100);
  NEW.detail := left(COALESCE(NEW.detail, ''), 1000);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_normalize_activity_log ON public.activity_log;
CREATE TRIGGER trg_normalize_activity_log
BEFORE INSERT ON public.activity_log
FOR EACH ROW EXECUTE FUNCTION public.normalize_activity_log();

CREATE OR REPLACE FUNCTION public.normalize_suggestion_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  NEW.status := 'new';
  IF NEW.anonymous IS TRUE THEN
    NEW.author_id := NULL;
    NEW.author_name := NULL;
  ELSE
    NEW.author_id := auth.uid();
    SELECT COALESCE(full_name, email, 'Member') INTO NEW.author_name
    FROM public.profiles WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_normalize_suggestion_author ON public.suggestions;
CREATE TRIGGER trg_normalize_suggestion_author
BEFORE INSERT ON public.suggestions
FOR EACH ROW EXECUTE FUNCTION public.normalize_suggestion_author();

CREATE OR REPLACE FUNCTION public.normalize_gallery_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.uploaded_by_id := auth.uid();
    SELECT COALESCE(full_name, email, 'Member') INTO NEW.uploaded_by
    FROM public.profiles WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_normalize_gallery_owner ON public.gallery;
CREATE TRIGGER trg_normalize_gallery_owner
BEFORE INSERT ON public.gallery
FOR EACH ROW EXECUTE FUNCTION public.normalize_gallery_owner();

-- --------------------------------------------------------------------------
-- 6. Replace permissive RLS with least-privilege policies
-- --------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles','productions','cast_list','finances','budgets','rehearsals',
        'attendance','announcements','events','activity_log','messages','inbox',
        'tasks','reminders','resources','polls','poll_votes','event_rsvps',
        'gallery','suggestions','inventory','tenant_settings'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_self_admin ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin());
CREATE POLICY profiles_insert_admin ON public.profiles FOR INSERT
  WITH CHECK (public.is_admin());
CREATE POLICY profiles_update_self_admin ON public.profiles FOR UPDATE
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());
-- No browser DELETE policy: the approved-admin Edge Function deletes auth.users
-- first so the cascading profile removal can never leave an orphaned login.

-- Department-wide readable operational data; administrators own writes.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'productions','cast_list','finances','budgets','announcements','events',
    'attendance','resources','polls','gallery','inventory'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_approved_member())', t || '_read', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin())', t || '_admin', t);
    END IF;
  END LOOP;
END $$;

-- Rehearsal secrets are available only to administrators. Members use the view.
ALTER TABLE public.rehearsals ENABLE ROW LEVEL SECURITY;
CREATE POLICY rehearsals_admin ON public.rehearsals FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Direct member attendance writes are denied; self_check_in() is authoritative.
-- The admin policy above is the only write path outside that RPC.

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_select_admin ON public.activity_log FOR SELECT USING (public.is_admin());
CREATE POLICY activity_insert_authenticated ON public.activity_log FOR INSERT
  WITH CHECK (public.is_approved_member());
CREATE POLICY activity_manage_admin ON public.activity_log FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_admin ON public.messages FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_select_visible ON public.inbox FOR SELECT USING (
  public.is_approved_member()
  AND (
    sender_id = auth.uid()
    OR recipient_id = auth.uid()
    OR (recipient_id IS NULL AND to_admins IS FALSE)
    OR (to_admins IS TRUE AND public.is_admin())
  )
);
CREATE POLICY inbox_insert_approved ON public.inbox FOR INSERT
  WITH CHECK (public.is_approved_member());
CREATE POLICY inbox_update_recipient_admin ON public.inbox FOR UPDATE
  USING (public.is_approved_member() AND (recipient_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.is_approved_member() AND (recipient_id = auth.uid() OR public.is_admin()));
CREATE POLICY inbox_delete_participant_admin ON public.inbox FOR DELETE
  USING (public.is_approved_member() AND (sender_id = auth.uid() OR recipient_id = auth.uid() OR public.is_admin()));

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_select_assignee_admin ON public.tasks FOR SELECT
  USING (public.is_approved_member() AND (assignee_id = auth.uid() OR public.is_admin()));
CREATE POLICY tasks_admin ON public.tasks FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Assignees change status only through set_task_status().

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY reminders_admin ON public.reminders FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY poll_votes_select_self_admin ON public.poll_votes FOR SELECT
  USING (public.is_approved_member() AND (voter_id = auth.uid() OR public.is_admin()));
CREATE POLICY poll_votes_admin ON public.poll_votes FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Members vote only through cast_poll_vote().

-- Members can see/manage only their own RSVP identity; administrators can see
-- every identity. Everyone else gets counts only from event_rsvp_results().
CREATE POLICY event_rsvps_select_self_admin ON public.event_rsvps FOR SELECT
  USING (public.is_approved_member() AND (member_id = auth.uid() OR public.is_admin()));
CREATE POLICY event_rsvps_insert_self ON public.event_rsvps FOR INSERT
  WITH CHECK (member_id = auth.uid() AND public.is_approved_member());
CREATE POLICY event_rsvps_update_self ON public.event_rsvps FOR UPDATE
  USING (member_id = auth.uid() AND public.is_approved_member())
  WITH CHECK (member_id = auth.uid() AND public.is_approved_member());
CREATE POLICY event_rsvps_delete_self ON public.event_rsvps FOR DELETE
  USING (member_id = auth.uid() AND public.is_approved_member());

-- Managers may add gallery rows; unit leaders may delete only their own rows.
CREATE POLICY gallery_insert_manager ON public.gallery FOR INSERT
  WITH CHECK (public.is_gallery_manager() AND uploaded_by_id = auth.uid());
CREATE POLICY gallery_delete_owner_manager ON public.gallery FOR DELETE
  USING (public.is_admin() OR (public.is_gallery_manager() AND uploaded_by_id = auth.uid()));

ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY suggestions_read_approved ON public.suggestions FOR SELECT
  USING (public.is_approved_member());
CREATE POLICY suggestions_insert_approved ON public.suggestions FOR INSERT
  WITH CHECK (public.is_approved_member());
CREATE POLICY suggestions_admin ON public.suggestions FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_read ON public.tenant_settings FOR SELECT USING (true);
CREATE POLICY tenant_settings_admin ON public.tenant_settings FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- --------------------------------------------------------------------------
-- 7. Storage ownership and manager checks
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS avatars_public_read ON storage.objects;
DROP POLICY IF EXISTS avatars_user_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_user_update ON storage.objects;
DROP POLICY IF EXISTS avatars_user_delete ON storage.objects;
DROP POLICY IF EXISTS gallery_public_read ON storage.objects;
DROP POLICY IF EXISTS gallery_auth_insert ON storage.objects;
DROP POLICY IF EXISTS gallery_owner_delete ON storage.objects;
DROP POLICY IF EXISTS gallery_manager_insert ON storage.objects;
DROP POLICY IF EXISTS gallery_manager_update ON storage.objects;
DROP POLICY IF EXISTS gallery_manager_delete ON storage.objects;

CREATE POLICY avatars_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
CREATE POLICY avatars_user_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_approved_member()
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND lower(name) ~ '\.(jpg|jpeg|png|webp|gif)$'
  );
CREATE POLICY avatars_user_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND public.is_approved_member()
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_approved_member()
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND lower(name) ~ '\.(jpg|jpeg|png|webp|gif)$'
  );
CREATE POLICY avatars_user_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND public.is_approved_member()
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY gallery_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'gallery');
CREATE POLICY gallery_manager_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'gallery'
    AND public.is_gallery_manager()
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND lower(name) ~ '\.(jpg|jpeg|png|webp|gif)$'
  );
CREATE POLICY gallery_manager_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'gallery'
    AND public.is_gallery_manager()
    AND (public.is_admin() OR auth.uid()::text = (storage.foldername(name))[1])
  )
  WITH CHECK (
    bucket_id = 'gallery'
    AND public.is_gallery_manager()
    AND (public.is_admin() OR auth.uid()::text = (storage.foldername(name))[1])
    AND lower(name) ~ '\.(jpg|jpeg|png|webp|gif)$'
  );
CREATE POLICY gallery_manager_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'gallery'
    AND public.is_gallery_manager()
    AND (public.is_admin() OR auth.uid()::text = (storage.foldername(name))[1])
  );

COMMIT;


-- PostgREST caches the database catalog on startup and reports PGRST205
-- ("Could not find the table/function ... in the schema cache") for objects
-- that exist perfectly well until it is told to re-read the catalog. Reload it
-- explicitly so newly created views and RPCs are immediately callable.
NOTIFY pgrst, 'reload schema';

-- Optional checks after running:
-- SELECT policyname, tablename, cmd FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;
-- SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='gallery';


-- ============================================================================
-- COMPONENT 03: Resilience, backup coordination and private vault
-- Source: database/resilience_and_backup.sql
-- ============================================================================
-- DramaConnect v14.0 — resilience, keep-alive, backup coordination and archive vault
-- Apply after database/repair_and_upgrade.sql and database/security_hardening.sql.
-- Safe to re-run. No production secret is stored in this migration.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Missing public.is_admin(). Apply database/security_hardening.sql first.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Throttled, source-aware heartbeat (public execution; no public table read)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_heartbeat_sources (
  source text PRIMARY KEY,
  last_ping_at timestamptz NOT NULL DEFAULT now(),
  ping_count bigint NOT NULL DEFAULT 1 CHECK (ping_count > 0),
  last_actor uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dc_heartbeat_source_format CHECK (source ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);

ALTER TABLE public.dc_heartbeat_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dc_heartbeat_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dc_heartbeat_sources TO authenticated;

DROP POLICY IF EXISTS "Approved admins can read resilience heartbeats" ON public.dc_heartbeat_sources;
CREATE POLICY "Approved admins can read resilience heartbeats"
  ON public.dc_heartbeat_sources FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.dc_keep_alive(p_source text DEFAULT 'external')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text;
  v_row public.dc_heartbeat_sources%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  -- A fixed allow-list prevents an unauthenticated caller from creating
  -- unbounded source rows. Unknown values collapse into one external bucket.
  v_source := lower(trim(coalesce(p_source, 'external')));
  IF v_source NOT IN (
    'site-visit', 'github-actions', 'edge-ping', 'pg-cron',
    'manual-button', 'vercel-cron', 'apps-script', 'cron-job-org',
    'auto-restore', 'database-backup', 'external'
  ) THEN
    v_source := 'external';
  END IF;

  INSERT INTO public.dc_heartbeat_sources (
    source, last_ping_at, ping_count, last_actor, created_at, updated_at
  )
  VALUES (v_source, v_now, 1, auth.uid(), v_now, v_now)
  ON CONFLICT (source) DO UPDATE
    SET last_ping_at = EXCLUDED.last_ping_at,
        ping_count = public.dc_heartbeat_sources.ping_count + 1,
        last_actor = EXCLUDED.last_actor,
        updated_at = EXCLUDED.updated_at
    WHERE public.dc_heartbeat_sources.last_ping_at <= v_now - interval '5 minutes'
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'written',
      'source', v_source,
      'at', v_row.last_ping_at
    );
  END IF;

  SELECT * INTO v_row
  FROM public.dc_heartbeat_sources
  WHERE source = v_source;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', 'throttled',
    'source', v_source,
    'at', v_row.last_ping_at,
    'retryAfterSeconds', greatest(
      1,
      ceil(extract(epoch FROM ((v_row.last_ping_at + interval '5 minutes') - v_now)))::integer
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dc_keep_alive(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dc_keep_alive(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Shared administrator configuration and immutable-ish run history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_backup_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  google_client_id text NULL,
  drive_folder_name text NOT NULL DEFAULT 'DramaConnect Backups',
  schedule_enabled boolean NOT NULL DEFAULT false,
  interval_days integer NOT NULL DEFAULT 7 CHECK (interval_days BETWEEN 1 AND 30),
  retention_count integer NOT NULL DEFAULT 12 CHECK (retention_count BETWEEN 1 AND 50),
  overdue_grace_hours integer NOT NULL DEFAULT 24 CHECK (overdue_grace_hours BETWEEN 0 AND 168),
  last_success_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_failure_message text NULL,
  last_archive_sha256 text NULL,
  last_archive_size bigint NULL CHECK (last_archive_size IS NULL OR last_archive_size >= 0),
  last_archive_rows bigint NULL CHECK (last_archive_rows IS NULL OR last_archive_rows >= 0),
  last_drive_file_id text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

INSERT INTO public.dc_backup_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dc_backup_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dc_backup_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dc_backup_settings TO authenticated;

DROP POLICY IF EXISTS "Approved admins can read backup settings" ON public.dc_backup_settings;
DROP POLICY IF EXISTS "Approved admins can create backup settings" ON public.dc_backup_settings;
DROP POLICY IF EXISTS "Approved admins can update backup settings" ON public.dc_backup_settings;

CREATE POLICY "Approved admins can read backup settings"
  ON public.dc_backup_settings FOR SELECT TO authenticated
  USING (public.is_admin());

-- Browser callers cannot directly falsify last-success/failure metadata. This
-- narrow RPC changes only administrator-configurable scheduling fields and
-- normalizes the audit identity/time on the server.
CREATE OR REPLACE FUNCTION public.dc_update_backup_settings(
  p_google_client_id text,
  p_drive_folder_name text,
  p_schedule_enabled boolean,
  p_interval_days integer,
  p_retention_count integer,
  p_overdue_grace_hours integer
)
RETURNS public.dc_backup_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_client_id text := nullif(trim(coalesce(p_google_client_id, '')), '');
  v_folder text := trim(coalesce(p_drive_folder_name, ''));
  v_result public.dc_backup_settings%ROWTYPE;
BEGIN
  IF v_user IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator approval required' USING ERRCODE = '42501';
  END IF;
  IF v_client_id IS NOT NULL AND v_client_id !~ '^[0-9]+-[A-Za-z0-9_-]+[.]apps[.]googleusercontent[.]com$' THEN
    RAISE EXCEPTION 'Invalid Google OAuth Web Client ID' USING ERRCODE = '22023';
  END IF;
  IF length(v_folder) NOT BETWEEN 1 AND 120 OR v_folder ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid Drive folder name' USING ERRCODE = '22023';
  END IF;
  IF p_interval_days NOT BETWEEN 1 AND 30
     OR p_retention_count NOT BETWEEN 1 AND 50
     OR p_overdue_grace_hours NOT BETWEEN 0 AND 168 THEN
    RAISE EXCEPTION 'Backup schedule value out of range' USING ERRCODE = '22023';
  END IF;

  UPDATE public.dc_backup_settings
  SET google_client_id = v_client_id,
      drive_folder_name = v_folder,
      schedule_enabled = coalesce(p_schedule_enabled, false),
      interval_days = p_interval_days,
      retention_count = p_retention_count,
      overdue_grace_hours = p_overdue_grace_hours,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = v_user
  WHERE id = 1
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE INSERT, UPDATE ON TABLE public.dc_backup_settings FROM authenticated;
REVOKE ALL ON FUNCTION public.dc_update_backup_settings(text, text, boolean, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dc_update_backup_settings(text, text, boolean, integer, integer, integer) TO authenticated;

CREATE TABLE IF NOT EXISTS public.dc_backup_leases (
  destination text PRIMARY KEY,
  lease_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  acquired_by uuid NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT dc_backup_lease_destination CHECK (
    destination IN ('local', 'drive', 'vault', 'local-restore', 'drive-restore', 'vault-restore')
  ),
  CONSTRAINT dc_backup_lease_expiry CHECK (expires_at > acquired_at)
);

CREATE TABLE IF NOT EXISTS public.dc_backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination text NOT NULL,
  trigger_source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  requested_by uuid NOT NULL,
  lease_token uuid NOT NULL,
  archive_sha256 text NULL,
  archive_size bigint NULL CHECK (archive_size IS NULL OR archive_size >= 0),
  archive_rows bigint NULL CHECK (archive_rows IS NULL OR archive_rows >= 0),
  remote_file_id text NULL,
  error_code text NULL,
  error_message text NULL,
  CONSTRAINT dc_backup_run_destination CHECK (
    destination IN ('local', 'drive', 'vault', 'local-restore', 'drive-restore', 'vault-restore')
  ),
  CONSTRAINT dc_backup_run_trigger CHECK (
    trigger_source IN ('manual', 'scheduled', 'overdue-recovery', 'import')
  ),
  CONSTRAINT dc_backup_run_status CHECK (
    status IN ('running', 'succeeded', 'failed', 'skipped')
  )
);

CREATE INDEX IF NOT EXISTS dc_backup_runs_started_idx
  ON public.dc_backup_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS dc_backup_runs_destination_idx
  ON public.dc_backup_runs (destination, started_at DESC);

ALTER TABLE public.dc_backup_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_backup_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dc_backup_leases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dc_backup_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dc_backup_runs TO authenticated;

DROP POLICY IF EXISTS "Approved admins can read backup runs" ON public.dc_backup_runs;
CREATE POLICY "Approved admins can read backup runs"
  ON public.dc_backup_runs FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.dc_begin_backup_run(
  p_destination text,
  p_trigger_source text DEFAULT 'manual',
  p_ttl_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_destination text := lower(trim(coalesce(p_destination, '')));
  v_trigger text := lower(trim(coalesce(p_trigger_source, 'manual')));
  v_ttl integer := least(greatest(coalesce(p_ttl_seconds, 900), 60), 3600);
  v_token uuid := gen_random_uuid();
  v_user uuid := auth.uid();
  v_lease public.dc_backup_leases%ROWTYPE;
  v_run public.dc_backup_runs%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator approval required' USING ERRCODE = '42501';
  END IF;
  IF v_destination NOT IN ('local', 'drive', 'vault', 'local-restore', 'drive-restore', 'vault-restore') THEN
    RAISE EXCEPTION 'Unsupported backup destination' USING ERRCODE = '22023';
  END IF;
  IF v_trigger NOT IN ('manual', 'scheduled', 'overdue-recovery', 'import') THEN
    v_trigger := 'manual';
  END IF;

  -- Serialize acquisition even for different destinations. This prevents a
  -- restore from racing a backup and prevents two full-table exports from
  -- competing for browser/database resources. A crashed operation expires.
  PERFORM pg_catalog.pg_advisory_xact_lock(1320132001);
  DELETE FROM public.dc_backup_leases WHERE expires_at <= v_now;
  SELECT * INTO v_lease
  FROM public.dc_backup_leases
  WHERE expires_at > v_now
  ORDER BY acquired_at
  LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'busy',
      'destination', v_lease.destination,
      'expiresAt', v_lease.expires_at
    );
  END IF;

  INSERT INTO public.dc_backup_leases (
    destination, lease_token, acquired_by, acquired_at, expires_at
  ) VALUES (
    v_destination, v_token, v_user, v_now, v_now + pg_catalog.make_interval(secs => v_ttl)
  )
  RETURNING * INTO v_lease;

  INSERT INTO public.dc_backup_runs (
    destination, trigger_source, status, started_at, requested_by, lease_token
  ) VALUES (
    v_destination, v_trigger, 'running', v_now, v_user, v_token
  ) RETURNING * INTO v_run;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', 'started',
    'runId', v_run.id,
    'leaseToken', v_token,
    'expiresAt', v_lease.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_finish_backup_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_status text,
  p_archive_sha256 text DEFAULT NULL,
  p_archive_size bigint DEFAULT NULL,
  p_archive_rows bigint DEFAULT NULL,
  p_remote_file_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status, 'failed')));
  v_run public.dc_backup_runs%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator approval required' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('succeeded', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'Invalid terminal backup status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM public.dc_backup_runs
  WHERE id = p_run_id
    AND lease_token = p_lease_token
    AND requested_by = v_user
    AND status = 'running'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup run not found, already finished, or owned by another administrator'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.dc_backup_runs
  SET status = v_status,
      completed_at = v_now,
      archive_sha256 = CASE WHEN p_archive_sha256 ~ '^[0-9a-fA-F]{64}$' THEN lower(p_archive_sha256) ELSE NULL END,
      archive_size = CASE WHEN p_archive_size >= 0 THEN p_archive_size ELSE NULL END,
      archive_rows = CASE WHEN p_archive_rows >= 0 THEN p_archive_rows ELSE NULL END,
      remote_file_id = nullif(left(coalesce(p_remote_file_id, ''), 255), ''),
      error_code = nullif(left(coalesce(p_error_code, ''), 80), ''),
      error_message = nullif(left(coalesce(p_error_message, ''), 500), '')
  WHERE id = p_run_id;

  DELETE FROM public.dc_backup_leases
  WHERE destination = v_run.destination
    AND lease_token = p_lease_token;

  IF v_run.destination = 'drive' THEN
    IF v_status = 'succeeded' THEN
      UPDATE public.dc_backup_settings
      SET last_success_at = v_now,
          last_failure_message = NULL,
          last_archive_sha256 = CASE WHEN p_archive_sha256 ~ '^[0-9a-fA-F]{64}$' THEN lower(p_archive_sha256) ELSE NULL END,
          last_archive_size = CASE WHEN p_archive_size >= 0 THEN p_archive_size ELSE NULL END,
          last_archive_rows = CASE WHEN p_archive_rows >= 0 THEN p_archive_rows ELSE NULL END,
          last_drive_file_id = nullif(left(coalesce(p_remote_file_id, ''), 255), ''),
          updated_at = v_now,
          updated_by = v_user
      WHERE id = 1;
    ELSIF v_status = 'failed' THEN
      UPDATE public.dc_backup_settings
      SET last_failure_at = v_now,
          last_failure_message = nullif(left(coalesce(p_error_message, 'Backup failed'), 500), ''),
          updated_at = v_now,
          updated_by = v_user
      WHERE id = 1;
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', v_status,
    'runId', p_run_id,
    'completedAt', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dc_begin_backup_run(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_finish_backup_run(uuid, uuid, text, text, bigint, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dc_begin_backup_run(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_finish_backup_run(uuid, uuid, text, text, bigint, bigint, text, text, text) TO authenticated;

-- Administrators need an explicit path to restore RSVP records. Member access
-- remains self-only through the existing policy in security_hardening.sql.
DROP POLICY IF EXISTS "Approved admins can manage event RSVPs" ON public.event_rsvps;
CREATE POLICY "Approved admins can manage event RSVPs"
  ON public.event_rsvps FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Private, administrator-only Supabase Storage archive vault
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dramaconnect-backups',
  'dramaconnect-backups',
  false,
  52428800,
  ARRAY['application/json', 'application/octet-stream']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Approved admins can read backup vault objects" ON storage.objects;
DROP POLICY IF EXISTS "Approved admins can create backup vault objects" ON storage.objects;
DROP POLICY IF EXISTS "Approved admins can update backup vault objects" ON storage.objects;
DROP POLICY IF EXISTS "Approved admins can delete backup vault objects" ON storage.objects;

CREATE POLICY "Approved admins can read backup vault objects"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dramaconnect-backups' AND public.is_admin());
CREATE POLICY "Approved admins can create backup vault objects"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dramaconnect-backups' AND public.is_admin());
CREATE POLICY "Approved admins can update backup vault objects"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'dramaconnect-backups' AND public.is_admin())
  WITH CHECK (bucket_id = 'dramaconnect-backups' AND public.is_admin());
CREATE POLICY "Approved admins can delete backup vault objects"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'dramaconnect-backups' AND public.is_admin());

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. Optional internal pg_cron layer (best-effort and safe when unavailable)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  -- Enable pg_cron when the platform offers it (Supabase does). Earlier
  -- releases only scheduled the job if someone had ALREADY enabled the
  -- extension by hand, so on most projects this layer silently never ran.
  -- SchoolConnect/GOSA create the extension here; DramaConnect now does too.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
      RAISE NOTICE 'pg_cron extension enabled for the internal heartbeat layer.';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron could not be enabled automatically (%). Enable it under Database -> Extensions, then re-run this file.', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR v_job_id IN
      SELECT jobid FROM cron.job WHERE jobname = 'dramaconnect-internal-heartbeat'
    LOOP
      PERFORM cron.unschedule(v_job_id);
    END LOOP;

    PERFORM cron.schedule(
      'dramaconnect-internal-heartbeat',
      '17 3 * * *',
      $job$SELECT public.dc_keep_alive('pg-cron');$job$
    );
    RAISE NOTICE 'Scheduled dramaconnect-internal-heartbeat via pg_cron.';
  ELSE
    RAISE NOTICE 'pg_cron is not enabled. External heartbeat layers remain available.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END;
$$;

-- ============================================================================
-- LAYER 11 — Heartbeat quorum and dead-scheduler detection.
--
-- Why this exists. A single "last heartbeat" timestamp is dangerously
-- reassuring. If UptimeRobot keeps pinging while your GitHub Actions
-- scheduler dies silently (the 60-day inactivity freeze), the platform still
-- reports "healthy" — yet you have quietly fallen from four independent
-- schedulers to one. One bad week later that single scheduler fails too and
-- the project pauses with no warning.
--
-- DramaConnect records each heartbeat SOURCE separately, so the database can
-- tell the difference between "the database is alive" and "all my safety
-- nets are alive". This function reports both, and names the sources that
-- have gone quiet so you can repair them before you need them.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dc_heartbeat_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Supabase pauses a free-tier project after this much inactivity.
  c_pause_after_hours constant numeric := 168;      -- 7 days
  -- A scheduler is "fresh" if it has run within this window. Slack is
  -- generous: a weekly cron is not stale after eight days.
  c_source_stale_hours constant numeric := 192;     -- 8 days
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_newest timestamptz;
  v_hours numeric;
  v_remaining numeric;
  v_sources jsonb;
  v_fresh int := 0;
  v_total int := 0;
  v_status text;
BEGIN
  SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'source',      s.source,
             'lastPingAt',  s.last_ping_at,
             'ageHours',    round((extract(epoch FROM (v_now - s.last_ping_at)) / 3600.0)::numeric, 1),
             'pingCount',   s.ping_count,
             'fresh',       (s.last_ping_at >= v_now - make_interval(hours => c_source_stale_hours::int))
           )
           ORDER BY s.last_ping_at DESC
         )
  INTO v_sources
  FROM public.dc_heartbeat_sources s;

  IF v_sources IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'no-heartbeat',
      'message', 'No heartbeat has been recorded yet. Run one heartbeat layer before relying on this report.',
      'pauseAfterHours', c_pause_after_hours,
      'hoursUntilPause', null,
      'sources', '[]'::jsonb
    );
  END IF;

  SELECT count(*) INTO v_total FROM pg_catalog.jsonb_array_elements(v_sources) AS e
   WHERE (e.value ->> 'source') IS NOT NULL;

  SELECT count(*) INTO v_fresh FROM pg_catalog.jsonb_array_elements(v_sources) AS e
   WHERE (e.value ->> 'fresh') = 'true';

  SELECT max((e.value ->> 'lastPingAt')::timestamptz) INTO v_newest
  FROM pg_catalog.jsonb_array_elements(v_sources) AS e;

  v_hours := round((extract(epoch FROM (v_now - v_newest)) / 3600.0)::numeric, 1);
  v_remaining := round(c_pause_after_hours - v_hours, 1);

  v_status := CASE
    WHEN v_hours <= 72    THEN 'healthy'
    WHEN v_hours <= 120   THEN 'warning'
    WHEN v_hours <  c_pause_after_hours THEN 'critical'
    ELSE 'paused'
  END;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', v_status,
    'lastHeartbeatAt', v_newest,
    'hoursSinceHeartbeat', v_hours,
    'pauseAfterHours', c_pause_after_hours,
    'hoursUntilPause', greatest(v_remaining, 0),
    'daysUntilPause', round(greatest(v_remaining, 0) / 24.0, 1),
    'sourcesTotal', v_total,
    'sourcesFresh', v_fresh,
    -- The number that matters most: how many INDEPENDENT safety nets are
    -- actually running. Two or more means a single failure cannot pause you.
    'quorum', (v_fresh >= 2),
    'singlePointOfFailure', (v_fresh = 1),
    -- Human-driven sources (site visits, the manual button, ad-hoc external
    -- calls) stop during holidays. Only UNATTENDED schedulers protect an idle
    -- project, so they are counted separately. A live audit found a project
    -- reporting quorum from human traffic while every scheduler was failing.
    'automatedSourcesFresh', (
      SELECT count(*) FROM pg_catalog.jsonb_array_elements(v_sources) AS e
       WHERE (e.value ->> 'fresh') = 'true'
         AND (e.value ->> 'source') NOT IN ('site-visit', 'manual-button', 'external')),
    'automatedQuorum', ((
      SELECT count(*) FROM pg_catalog.jsonb_array_elements(v_sources) AS e
       WHERE (e.value ->> 'fresh') = 'true'
         AND (e.value ->> 'source') NOT IN ('site-visit', 'manual-button', 'external')) >= 2),
    'neverReported', (
      SELECT COALESCE(pg_catalog.jsonb_agg(x ORDER BY x), '[]'::jsonb)
      FROM pg_catalog.unnest(ARRAY['github-actions','vercel-cron','pg-cron','auto-restore','edge-ping','cron-job-org','apps-script']) AS x
      WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_sources) AS e WHERE (e.value ->> 'source') = x)),
    'silentSources', COALESCE((
      SELECT pg_catalog.jsonb_agg(e.value ->> 'source' ORDER BY e.value ->> 'source')
      FROM pg_catalog.jsonb_array_elements(v_sources) AS e
      WHERE (e.value ->> 'fresh') = 'false'
    ), '[]'::jsonb),
    'sources', v_sources
  );
END;
$$;

COMMENT ON FUNCTION public.dc_heartbeat_health() IS
  'Layer 11: reports per-source heartbeat freshness, pause countdown and scheduler quorum. Detects a silently dead keep-alive scheduler even while other layers keep the database warm.';

GRANT EXECUTE ON FUNCTION public.dc_heartbeat_health() TO authenticated;


-- ============================================================================
-- COMPONENT 04: Control plane, storage governance, access and licensing
-- Source: database/platform_management.sql
-- ============================================================================
-- ============================================================================
-- DramaConnect v14 — control plane, storage governance, access and licensing
-- Run after security_hardening.sql and resilience_and_backup.sql.
-- Safe to rerun. The canonical installer is database/complete-schema.sql.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Profile access metadata and singleton control-plane settings
-- --------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS access_version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.dc_platform_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lockdown_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  lockdown_message TEXT NOT NULL DEFAULT 'DramaConnect is temporarily in maintenance mode.',
  idle_timeout_minutes INTEGER NOT NULL DEFAULT 30 CHECK (idle_timeout_minutes BETWEEN 10 AND 720),
  login_audit_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (login_audit_retention_days BETWEEN 7 AND 730),
  schema_version TEXT NOT NULL DEFAULT '14.0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.dc_platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dc_retention_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  database_quota_mb INTEGER NOT NULL DEFAULT 500 CHECK (database_quota_mb BETWEEN 50 AND 102400),
  storage_quota_mb INTEGER NOT NULL DEFAULT 1024 CHECK (storage_quota_mb BETWEEN 50 AND 1048576),
  warning_percent INTEGER NOT NULL DEFAULT 70 CHECK (warning_percent BETWEEN 20 AND 95),
  critical_percent INTEGER NOT NULL DEFAULT 90 CHECK (critical_percent BETWEEN 40 AND 99),
  activity_log_days INTEGER NOT NULL DEFAULT 365 CHECK (activity_log_days BETWEEN 30 AND 3650),
  backup_run_days INTEGER NOT NULL DEFAULT 180 CHECK (backup_run_days BETWEEN 30 AND 3650),
  heartbeat_days INTEGER NOT NULL DEFAULT 90 CHECK (heartbeat_days BETWEEN 14 AND 730),
  login_audit_days INTEGER NOT NULL DEFAULT 90 CHECK (login_audit_days BETWEEN 7 AND 730),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK (warning_percent < critical_percent)
);

INSERT INTO public.dc_retention_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dc_site_license (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  license_model TEXT NOT NULL DEFAULT 'lifetime' CHECK (license_model IN ('lifetime', 'subscription')),
  plan_name TEXT NOT NULL DEFAULT 'DramaConnect Lifetime',
  license_status TEXT NOT NULL DEFAULT 'active' CHECK (license_status IN ('active', 'past_due', 'suspended', 'expired')),
  licensed_to TEXT NOT NULL DEFAULT 'RCCG LP 25 Drama Department',
  starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_on DATE,
  grace_days INTEGER NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 0 AND 90),
  renewal_url TEXT,
  support_email TEXT,
  public_message TEXT,
  registry_url TEXT,
  last_validated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK (license_model = 'lifetime' OR expires_on IS NOT NULL),
  CHECK (renewal_url IS NULL OR renewal_url ~* '^https://'),
  CHECK (registry_url IS NULL OR registry_url ~* '^https://')
);

INSERT INTO public.dc_site_license (
  id, license_model, plan_name, license_status, licensed_to, starts_on,
  expires_on, grace_days, public_message
)
VALUES (
  1, 'lifetime', 'DramaConnect Lifetime', 'active',
  'RCCG LP 25 Drama Department', CURRENT_DATE, NULL, 14,
  'Lifetime ownership is active for this DramaConnect deployment.'
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dc_login_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'sign_in', 'sign_out', 'idle_timeout', 'lockdown_denied',
    'license_denied', 'access_changed', 'security_changed'
  )),
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dc_license_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  previous_state JSONB,
  next_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profiles_access_idx ON public.profiles(status, role, created_at DESC);
CREATE INDEX IF NOT EXISTS dc_login_audit_created_idx ON public.dc_login_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS dc_login_audit_user_idx ON public.dc_login_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dc_license_events_created_idx ON public.dc_license_events(created_at DESC);

-- --------------------------------------------------------------------------
-- 2. RLS: visibility is narrow; all mutations go through checked RPCs
-- --------------------------------------------------------------------------
ALTER TABLE public.dc_platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_retention_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_site_license ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_login_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_license_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dc_platform_settings_admin_read ON public.dc_platform_settings;
CREATE POLICY dc_platform_settings_admin_read ON public.dc_platform_settings
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS dc_retention_settings_admin_read ON public.dc_retention_settings;
CREATE POLICY dc_retention_settings_admin_read ON public.dc_retention_settings
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS dc_site_license_member_read ON public.dc_site_license;
CREATE POLICY dc_site_license_member_read ON public.dc_site_license
  FOR SELECT USING (public.is_approved_member());

DROP POLICY IF EXISTS dc_login_audit_admin_read ON public.dc_login_audit;
CREATE POLICY dc_login_audit_admin_read ON public.dc_login_audit
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS dc_license_events_admin_read ON public.dc_license_events;
CREATE POLICY dc_license_events_admin_read ON public.dc_license_events
  FOR SELECT USING (public.is_admin());

-- --------------------------------------------------------------------------
-- 3. Session access state and browser audit events
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_access_state()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_platform public.dc_platform_settings%ROWTYPE;
  v_license public.dc_site_license%ROWTYPE;
  v_license_allowed BOOLEAN := FALSE;
  v_license_effective TEXT := 'expired';
  v_allowed BOOLEAN := FALSE;
  v_reason TEXT := 'profile_unavailable';
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'authentication_required');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO v_platform FROM public.dc_platform_settings WHERE id = 1;
  SELECT * INTO v_license FROM public.dc_site_license WHERE id = 1;

  IF NOT FOUND OR v_profile.id IS NULL THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'profile_unavailable');
  END IF;

  IF v_profile.status <> 'approved' THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'account_' || COALESCE(v_profile.status, 'pending'));
  END IF;

  IF v_license.license_model = 'lifetime' THEN
    v_license_allowed := v_license.license_status = 'active';
    v_license_effective := v_license.license_status;
  ELSE
    v_license_allowed := v_license.license_status IN ('active', 'past_due')
      AND CURRENT_DATE <= (v_license.expires_on + v_license.grace_days);
    v_license_effective := CASE
      WHEN v_license.license_status IN ('suspended', 'expired') THEN v_license.license_status
      WHEN CURRENT_DATE <= v_license.expires_on THEN 'active'
      WHEN CURRENT_DATE <= (v_license.expires_on + v_license.grace_days) THEN 'grace'
      ELSE 'expired'
    END;
  END IF;

  IF v_profile.role = 'admin' THEN
    v_allowed := TRUE;
    v_reason := CASE
      WHEN v_platform.lockdown_enabled THEN 'admin_lockdown_bypass'
      WHEN NOT v_license_allowed THEN 'admin_license_bypass'
      ELSE 'ok'
    END;
  ELSIF v_platform.lockdown_enabled THEN
    v_reason := 'lockdown';
  ELSIF NOT v_license_allowed THEN
    v_reason := 'license_' || v_license_effective;
  ELSE
    v_allowed := TRUE;
    v_reason := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'isAdmin', v_profile.role = 'admin',
    'lockdownEnabled', v_platform.lockdown_enabled,
    'lockdownMessage', v_platform.lockdown_message,
    'idleTimeoutMinutes', v_platform.idle_timeout_minutes,
    'schemaVersion', v_platform.schema_version,
    'license', jsonb_build_object(
      'model', v_license.license_model,
      'status', v_license_effective,
      'planName', v_license.plan_name,
      'licensedTo', v_license.licensed_to,
      'startsOn', v_license.starts_on,
      'expiresOn', v_license.expires_on,
      'graceDays', v_license.grace_days,
      'renewalUrl', v_license.renewal_url,
      'supportEmail', v_license.support_email,
      'message', v_license.public_message
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_record_login_event(
  p_event_type TEXT,
  p_user_agent TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_event_type NOT IN ('sign_in','sign_out','idle_timeout','lockdown_denied','license_denied') THEN
    RAISE EXCEPTION 'Unsupported login event';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.dc_login_audit (user_id, email, event_type, user_agent, metadata)
  VALUES (
    auth.uid(), v_email, p_event_type,
    left(COALESCE(p_user_agent, ''), 500),
    COALESCE(p_metadata, '{}'::jsonb)
  );
  RETURN jsonb_build_object('ok', TRUE, 'recordedAt', NOW());
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Administrator settings, member access and license lifecycle
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_update_platform_settings(
  p_lockdown_enabled BOOLEAN,
  p_lockdown_message TEXT,
  p_idle_timeout_minutes INTEGER,
  p_login_audit_retention_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.dc_platform_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_idle_timeout_minutes NOT BETWEEN 10 AND 720 THEN RAISE EXCEPTION 'Idle timeout must be between 10 and 720 minutes'; END IF;
  -- NULL means "keep the current value": retention is owned by the Storage Manager, so
  -- Platform Health saves security state without supplying it.
  IF p_login_audit_retention_days IS NOT NULL AND p_login_audit_retention_days NOT BETWEEN 7 AND 730 THEN RAISE EXCEPTION 'Login audit retention must be between 7 and 730 days'; END IF;

  UPDATE public.dc_platform_settings SET
    lockdown_enabled = COALESCE(p_lockdown_enabled, FALSE),
    lockdown_message = left(COALESCE(NULLIF(btrim(p_lockdown_message), ''), 'DramaConnect is temporarily in maintenance mode.'), 500),
    idle_timeout_minutes = p_idle_timeout_minutes,
    login_audit_retention_days = COALESCE(p_login_audit_retention_days, login_audit_retention_days),
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1 RETURNING * INTO v_row;

  -- Retention has ONE owner: public.dc_retention_settings (edited on the Storage Manager
  -- page). dc_retention_preview()/dc_apply_retention() read login_audit_days from there,
  -- so a value written only to dc_platform_settings would silently do nothing. Mirror it
  -- to keep the two tables consistent for any caller that still supplies this argument.
  UPDATE public.dc_retention_settings SET
    login_audit_days = greatest(7, least(730, p_login_audit_retention_days)),
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1 AND p_login_audit_retention_days IS NOT NULL;

  INSERT INTO public.dc_login_audit (user_id, email, event_type, metadata)
  SELECT auth.uid(), p.email, 'security_changed',
    jsonb_build_object('lockdownEnabled', v_row.lockdown_enabled, 'idleTimeoutMinutes', v_row.idle_timeout_minutes)
  FROM public.profiles p WHERE p.id = auth.uid();
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_update_retention_settings(
  p_database_quota_mb INTEGER,
  p_storage_quota_mb INTEGER,
  p_warning_percent INTEGER,
  p_critical_percent INTEGER,
  p_activity_log_days INTEGER,
  p_backup_run_days INTEGER,
  p_heartbeat_days INTEGER,
  p_login_audit_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.dc_retention_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_warning_percent NOT BETWEEN 20 AND 95 OR p_critical_percent NOT BETWEEN 40 AND 99 OR p_warning_percent >= p_critical_percent THEN
    RAISE EXCEPTION 'Usage thresholds are invalid';
  END IF;
  UPDATE public.dc_retention_settings SET
    database_quota_mb = greatest(50, least(102400, p_database_quota_mb)),
    storage_quota_mb = greatest(50, least(1048576, p_storage_quota_mb)),
    warning_percent = p_warning_percent, critical_percent = p_critical_percent,
    activity_log_days = greatest(30, least(3650, p_activity_log_days)),
    backup_run_days = greatest(30, least(3650, p_backup_run_days)),
    heartbeat_days = greatest(14, least(730, p_heartbeat_days)),
    login_audit_days = greatest(7, least(730, p_login_audit_days)),
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1 RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_list_member_access()
RETURNS TABLE (
  id UUID, full_name TEXT, email TEXT, phone TEXT, unit TEXT,
  role TEXT, status TEXT, is_unit_leader BOOLEAN,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, access_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT p.id, p.full_name, p.email, p.phone, p.unit,
    p.role, p.status, COALESCE(p.is_unit_leader, FALSE),
    p.created_at, p.updated_at, p.access_version
  FROM public.profiles p
  ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, lower(COALESCE(p.full_name, p.email, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_update_member_access(
  p_member_id UUID,
  p_role TEXT,
  p_status TEXT,
  p_unit TEXT,
  p_is_unit_leader BOOLEAN,
  p_expected_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.profiles%ROWTYPE;
  v_new public.profiles%ROWTYPE;
  v_other_admins INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_role NOT IN ('member','admin') THEN RAISE EXCEPTION 'Unsupported role'; END IF;
  IF p_status NOT IN ('pending','approved','rejected') THEN RAISE EXCEPTION 'Unsupported account status'; END IF;
  IF p_role = 'admin' AND p_status <> 'approved' THEN RAISE EXCEPTION 'Administrators must be approved'; END IF;
  IF char_length(COALESCE(p_unit, '')) > 80 THEN RAISE EXCEPTION 'Unit name is too long'; END IF;

  SELECT * INTO v_old FROM public.profiles WHERE profiles.id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF v_old.access_version <> p_expected_version THEN RAISE EXCEPTION 'This member changed in another session. Refresh and retry' USING ERRCODE = '40001'; END IF;

  IF v_old.role = 'admin' AND v_old.status = 'approved' AND (p_role <> 'admin' OR p_status <> 'approved') THEN
    SELECT count(*) INTO v_other_admins FROM public.profiles
    WHERE id <> p_member_id AND role = 'admin' AND status = 'approved';
    IF v_other_admins = 0 THEN RAISE EXCEPTION 'The last approved administrator cannot be demoted or blocked'; END IF;
  END IF;

  UPDATE public.profiles SET
    role = p_role,
    status = p_status,
    unit = NULLIF(btrim(p_unit), ''),
    is_unit_leader = CASE WHEN p_role = 'admin' THEN FALSE ELSE COALESCE(p_is_unit_leader, FALSE) END,
    updated_at = NOW(), access_version = access_version + 1
  WHERE profiles.id = p_member_id
  RETURNING * INTO v_new;

  INSERT INTO public.dc_login_audit (user_id, email, event_type, metadata)
  SELECT auth.uid(), p.email, 'access_changed', jsonb_build_object(
    'memberId', p_member_id, 'previousRole', v_old.role, 'nextRole', v_new.role,
    'previousStatus', v_old.status, 'nextStatus', v_new.status,
    'unitLeader', v_new.is_unit_leader
  ) FROM public.profiles p WHERE p.id = auth.uid();

  RETURN jsonb_build_object(
    'id', v_new.id, 'role', v_new.role, 'status', v_new.status,
    'unit', v_new.unit, 'isUnitLeader', v_new.is_unit_leader,
    'accessVersion', v_new.access_version, 'updatedAt', v_new.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_update_site_license(
  p_license_model TEXT,
  p_plan_name TEXT,
  p_license_status TEXT,
  p_licensed_to TEXT,
  p_starts_on DATE,
  p_expires_on DATE,
  p_grace_days INTEGER,
  p_renewal_url TEXT,
  p_support_email TEXT,
  p_public_message TEXT,
  p_registry_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old JSONB;
  v_new public.dc_site_license%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_license_model NOT IN ('lifetime','subscription') THEN RAISE EXCEPTION 'Unsupported license model'; END IF;
  IF p_license_status NOT IN ('active','past_due','suspended','expired') THEN RAISE EXCEPTION 'Unsupported license status'; END IF;
  IF p_license_model = 'subscription' AND p_expires_on IS NULL THEN RAISE EXCEPTION 'Subscription expiry is required'; END IF;
  IF p_grace_days NOT BETWEEN 0 AND 90 THEN RAISE EXCEPTION 'Grace period must be between 0 and 90 days'; END IF;
  IF p_renewal_url IS NOT NULL AND p_renewal_url !~* '^https://' THEN RAISE EXCEPTION 'Renewal URL must use HTTPS'; END IF;
  IF p_registry_url IS NOT NULL AND p_registry_url !~* '^https://' THEN RAISE EXCEPTION 'Registry URL must use HTTPS'; END IF;

  SELECT to_jsonb(l) INTO v_old FROM public.dc_site_license l WHERE id = 1;
  UPDATE public.dc_site_license SET
    license_model = p_license_model,
    plan_name = left(COALESCE(NULLIF(btrim(p_plan_name), ''), 'DramaConnect'), 120),
    license_status = p_license_status,
    licensed_to = left(COALESCE(NULLIF(btrim(p_licensed_to), ''), 'Organization'), 160),
    starts_on = COALESCE(p_starts_on, CURRENT_DATE),
    expires_on = CASE WHEN p_license_model = 'lifetime' THEN NULL ELSE p_expires_on END,
    grace_days = p_grace_days,
    renewal_url = NULLIF(btrim(p_renewal_url), ''),
    support_email = NULLIF(btrim(p_support_email), ''),
    public_message = left(COALESCE(p_public_message, ''), 500),
    registry_url = NULLIF(btrim(p_registry_url), ''),
    updated_at = NOW(), updated_by = auth.uid()
  WHERE id = 1 RETURNING * INTO v_new;

  INSERT INTO public.dc_license_events (actor_id, event_type, previous_state, next_state)
  VALUES (auth.uid(), 'license_updated', v_old, to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Storage/quota visibility and guarded retention
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_storage_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
STABLE
AS $$
DECLARE
  v_database_bytes BIGINT := 0;
  v_storage_bytes BIGINT := 0;
  v_storage_objects BIGINT := 0;
  v_buckets JSONB := '[]'::jsonb;
  v_settings public.dc_retention_settings%ROWTYPE;
  v_db_percent NUMERIC := 0;
  v_storage_percent NUMERIC := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.dc_retention_settings WHERE id = 1;
  SELECT pg_database_size(current_database()) INTO v_database_bytes;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT COALESCE(sum(bucket_bytes), 0), COALESCE(sum(object_count), 0),
        COALESCE(jsonb_agg(jsonb_build_object(
          'bucket', bucket_id, 'objects', object_count, 'bytes', bucket_bytes
        ) ORDER BY bucket_id), '[]'::jsonb)
      FROM (
        SELECT bucket_id, count(*) AS object_count,
          COALESCE(sum(CASE WHEN COALESCE(metadata->>'size', '') ~ '^[0-9]+$' THEN (metadata->>'size')::bigint ELSE 0 END), 0) AS bucket_bytes
        FROM storage.objects GROUP BY bucket_id
      ) bucket_totals
    $sql$ INTO v_storage_bytes, v_storage_objects, v_buckets;
  END IF;

  v_db_percent := round((v_database_bytes::numeric / (v_settings.database_quota_mb * 1024 * 1024)) * 100, 2);
  v_storage_percent := round((v_storage_bytes::numeric / (v_settings.storage_quota_mb * 1024 * 1024)) * 100, 2);

  RETURN jsonb_build_object(
    'databaseBytes', v_database_bytes,
    'databaseQuotaBytes', v_settings.database_quota_mb::bigint * 1024 * 1024,
    'databasePercent', v_db_percent,
    'storageBytes', v_storage_bytes,
    'storageQuotaBytes', v_settings.storage_quota_mb::bigint * 1024 * 1024,
    'storagePercent', v_storage_percent,
    'storageObjects', v_storage_objects,
    'buckets', v_buckets,
    'warningPercent', v_settings.warning_percent,
    'criticalPercent', v_settings.critical_percent,
    'measuredAt', NOW()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_retention_preview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v public.dc_retention_settings%ROWTYPE;
  a BIGINT; b BIGINT; h BIGINT; l BIGINT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.dc_retention_settings WHERE id = 1;
  SELECT count(*) INTO a FROM public.activity_log WHERE created_at < NOW() - make_interval(days => v.activity_log_days);
  SELECT count(*) INTO b FROM public.dc_backup_runs WHERE started_at < NOW() - make_interval(days => v.backup_run_days) AND status <> 'running';
  SELECT count(*) INTO h FROM public.dc_heartbeat_sources WHERE updated_at < NOW() - make_interval(days => v.heartbeat_days);
  SELECT count(*) INTO l FROM public.dc_login_audit WHERE created_at < NOW() - make_interval(days => v.login_audit_days);
  RETURN jsonb_build_object(
    'activity_log', jsonb_build_object('rows', a, 'before', NOW() - make_interval(days => v.activity_log_days)),
    'dc_backup_runs', jsonb_build_object('rows', b, 'before', NOW() - make_interval(days => v.backup_run_days)),
    'dc_heartbeat_sources', jsonb_build_object('rows', h, 'before', NOW() - make_interval(days => v.heartbeat_days)),
    'dc_login_audit', jsonb_build_object('rows', l, 'before', NOW() - make_interval(days => v.login_audit_days))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_apply_retention(
  p_table_name TEXT,
  p_before TIMESTAMPTZ,
  p_confirmation TEXT,
  p_verified_backup_sha256 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted BIGINT := 0;
  v_backup_ok BOOLEAN := FALSE;
  v_column TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_table_name NOT IN ('activity_log','dc_backup_runs','dc_heartbeat_sources','dc_login_audit') THEN RAISE EXCEPTION 'Unsupported retention target'; END IF;
  IF p_confirmation <> 'PURGE ' || p_table_name THEN RAISE EXCEPTION 'Typed confirmation does not match'; END IF;
  IF p_before IS NULL OR p_before > NOW() - INTERVAL '24 hours' THEN RAISE EXCEPTION 'Retention cutoff must be at least 24 hours old'; END IF;
  IF p_verified_backup_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'A lowercase SHA-256 from a verified backup is required'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.dc_backup_runs
    WHERE status = 'succeeded' AND archive_sha256 = p_verified_backup_sha256
      AND completed_at > NOW() - INTERVAL '30 days'
  ) INTO v_backup_ok;
  IF NOT v_backup_ok THEN RAISE EXCEPTION 'No matching successful verified backup was recorded in the last 30 days'; END IF;

  v_column := CASE p_table_name WHEN 'dc_backup_runs' THEN 'started_at' WHEN 'dc_heartbeat_sources' THEN 'updated_at' ELSE 'created_at' END;
  EXECUTE format('DELETE FROM public.%I WHERE %I < $1', p_table_name, v_column) USING p_before;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.activity_log (actor_name, action, detail)
  SELECT COALESCE(full_name, email, 'Administrator'), 'retention_purge',
    format('Purged %s row(s) from %s before %s after verified backup %s', v_deleted, p_table_name, p_before, p_verified_backup_sha256)
  FROM public.profiles WHERE id = auth.uid();

  RETURN jsonb_build_object('ok', TRUE, 'table', p_table_name, 'deletedRows', v_deleted, 'cutoff', p_before);
END;
$$;

-- --------------------------------------------------------------------------
-- 6. Consolidated platform health snapshot
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_platform_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_profiles BIGINT := 0;
  v_pending BIGINT := 0;
  v_admins BIGINT := 0;
  v_last_backup public.dc_backup_runs%ROWTYPE;
  v_last_heartbeat TIMESTAMPTZ;
  v_platform public.dc_platform_settings%ROWTYPE;
  v_license public.dc_site_license%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT count(*), count(*) FILTER (WHERE status = 'pending'), count(*) FILTER (WHERE role = 'admin' AND status = 'approved')
    INTO v_profiles, v_pending, v_admins FROM public.profiles;
  SELECT * INTO v_last_backup FROM public.dc_backup_runs ORDER BY started_at DESC LIMIT 1;
  SELECT max(last_ping_at) INTO v_last_heartbeat FROM public.dc_heartbeat_sources;
  SELECT * INTO v_platform FROM public.dc_platform_settings WHERE id = 1;
  SELECT * INTO v_license FROM public.dc_site_license WHERE id = 1;

  RETURN jsonb_build_object(
    'ok', TRUE, 'schemaVersion', v_platform.schema_version, 'checkedAt', NOW(),
    'database', jsonb_build_object('reachable', TRUE),
    'members', jsonb_build_object('total', v_profiles, 'pending', v_pending, 'approvedAdmins', v_admins),
    'security', jsonb_build_object('lockdownEnabled', v_platform.lockdown_enabled, 'idleTimeoutMinutes', v_platform.idle_timeout_minutes),
    'license', jsonb_build_object('model', v_license.license_model, 'status', v_license.license_status, 'expiresOn', v_license.expires_on),
    'heartbeat', jsonb_build_object('lastPingAt', v_last_heartbeat),
    'backup', CASE WHEN v_last_backup.id IS NULL THEN jsonb_build_object('status', 'never') ELSE jsonb_build_object(
      'status', v_last_backup.status, 'destination', v_last_backup.destination,
      'startedAt', v_last_backup.started_at, 'completedAt', v_last_backup.completed_at,
      'sha256', v_last_backup.archive_sha256
    ) END
  );
END;
$$;

-- Storage operators: approved administrators can manage application buckets.
DROP POLICY IF EXISTS avatars_admin_manage ON storage.objects;
CREATE POLICY avatars_admin_manage ON storage.objects FOR ALL
  USING (bucket_id = 'avatars' AND public.is_admin())
  WITH CHECK (bucket_id = 'avatars' AND public.is_admin());
DROP POLICY IF EXISTS gallery_admin_manage ON storage.objects;
CREATE POLICY gallery_admin_manage ON storage.objects FOR ALL
  USING (bucket_id = 'gallery' AND public.is_admin())
  WITH CHECK (bucket_id = 'gallery' AND public.is_admin());

-- --------------------------------------------------------------------------
-- 7. Function privileges (deny anonymous/public execution explicitly)
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dc_access_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_record_login_event(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_update_platform_settings(BOOLEAN, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_update_retention_settings(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_list_member_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_update_member_access(UUID, TEXT, TEXT, TEXT, BOOLEAN, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_update_site_license(TEXT, TEXT, TEXT, TEXT, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_storage_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_retention_preview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_apply_retention(TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dc_platform_health() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dc_access_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_record_login_event(TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_update_platform_settings(BOOLEAN, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_update_retention_settings(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_list_member_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_update_member_access(UUID, TEXT, TEXT, TEXT, BOOLEAN, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_update_site_license(TEXT, TEXT, TEXT, TEXT, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_storage_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_retention_preview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_apply_retention(TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_platform_health() TO authenticated;

COMMIT;


-- ============================================================================
-- COMPONENT 05: Verifiable ID cards, public programmes, duty roster and member care
-- Source: database/identity_and_programs.sql
-- ============================================================================
-- ============================================================================
-- DramaConnect v14.1 — COMPONENT 05: Identity cards, public programmes,
-- duty roster and member care
-- ============================================================================
-- Safe to rerun. Every table, index, policy and function is created with
-- IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS semantics. No existing
-- application row is modified.
--
-- WHAT THIS COMPONENT ADDS
--   1. Verifiable membership cards
--        dc_card_settings        one-row card design + validity policy
--        dc_member_cards         one card per member: human member number,
--                                unguessable verification token, expiry,
--                                revocation and re-issue history counters
--        dc_my_card()            member: fetch (and lazily issue) own card
--        dc_verify_card(token)   PUBLIC: what a phone camera lands on
--        dc_lookup_card(code)    admin/leader: resolve any scanned code
--        dc_admin_card_action()  admin: issue / reissue / revoke / restore / extend
--        dc_admin_list_cards()   admin: every approved member's card (bulk print)
--
--   2. Public programmes with shareable registration links
--        dc_programs                  programme definition (slug = share link)
--        dc_program_registrations     registrations, tickets, check-in, feedback
--        dc_public_program(slug)      PUBLIC: programme page data
--        dc_register_for_program()    PUBLIC: validated, throttled registration
--        dc_program_ticket(token)     PUBLIC: ticket lookup
--        dc_submit_program_feedback() PUBLIC: post-programme rating/comment
--        dc_program_checkin()         admin/leader: scan ticket / member card
--        dc_program_undo_checkin()    admin/leader
--        dc_program_walkin()          admin/leader: door walk-in, registered + checked in
--        dc_program_insights()        admin/leader: analytics as one JSON document
--
--   3. Duty roster (who ministers at which service, in which role)
--        dc_duty_roster, dc_respond_duty()
--
--   4. Member care & follow-up (absentee detection + pastoral case log)
--        dc_care_cases, dc_care_add_note(), dc_absentee_candidates()
--
-- SECURITY MODEL
--   * RLS is enabled on every new table. Nothing is readable by anon directly.
--   * The only anon entry points are the five PUBLIC functions above. They
--     return an explicit allow-list of fields: a verification never returns a
--     phone number or e-mail address; a programme page never returns another
--     registrant's details.
--   * Card tokens and ticket tokens are 128-bit random values (gen_random_uuid
--     is core PostgreSQL, so no extension is required). The printed member
--     number is human-readable but is NOT accepted by the public verifier, so
--     sequential numbers cannot be enumerated from outside.
--   * Free-tier protection: public registration is throttled per programme and
--     globally, capped per programme, size-limited, and honeypot-guarded.
--     Public verification updates a counter instead of inserting a row, so a
--     flood of scans cannot grow the database.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. Shared helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_is_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'approved'
      AND (role = 'admin' OR is_unit_leader IS TRUE)
  );
$$;

CREATE OR REPLACE FUNCTION public.dc_my_unit()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT nullif(trim(unit), '') FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.dc_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_new_token()
RETURNS TEXT
LANGUAGE sql
SET search_path = public, pg_temp
VOLATILE
AS $$
  SELECT replace(gen_random_uuid()::text, '-', '');
$$;

-- Extract a 32-hex token from a raw token, a verify/ticket URL or any text that
-- contains "c=<token>" / "t=<token>".
CREATE OR REPLACE FUNCTION public.dc_extract_token(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
SET search_path = public, pg_temp
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_code IS NULL THEN NULL
    WHEN lower(trim(p_code)) ~ '^[a-f0-9]{32}$' THEN lower(trim(p_code))
    WHEN lower(p_code) ~ '[?&#](c|t)=[a-f0-9]{32}' THEN substring(lower(p_code) FROM '[?&#][ct]=([a-f0-9]{32})')
    ELSE NULL
  END;
$$;

-- --------------------------------------------------------------------------
-- 1. Membership cards
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_card_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  member_no_prefix TEXT NOT NULL DEFAULT 'DC' CHECK (member_no_prefix ~ '^[A-Z0-9]{1,6}$'),
  validity_months  INTEGER NOT NULL DEFAULT 24 CHECK (validity_months BETWEEN 1 AND 120),
  template         TEXT NOT NULL DEFAULT 'classic' CHECK (template IN ('classic','royal','stage','minimal')),
  signatory_name   TEXT CHECK (signatory_name IS NULL OR char_length(signatory_name) <= 80),
  signatory_title  TEXT CHECK (signatory_title IS NULL OR char_length(signatory_title) <= 80),
  signature_url    TEXT CHECK (signature_url IS NULL OR char_length(signature_url) <= 500),
  contact_line     TEXT CHECK (contact_line IS NULL OR char_length(contact_line) <= 160),
  back_note        TEXT CHECK (back_note IS NULL OR char_length(back_note) <= 300),
  show_phone       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.dc_card_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS public.dc_member_no_seq START 1;

CREATE TABLE IF NOT EXISTS public.dc_member_cards (
  member_id        UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_no        TEXT NOT NULL UNIQUE CHECK (member_no ~ '^[A-Z0-9]{1,6}-[0-9]{4,10}$'),
  card_token       TEXT NOT NULL UNIQUE CHECK (card_token ~ '^[a-f0-9]{32}$'),
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  revoked_at       TIMESTAMPTZ,
  revoke_reason    TEXT CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 200),
  reissue_count    INTEGER NOT NULL DEFAULT 0 CHECK (reissue_count >= 0),
  verify_count     INTEGER NOT NULL DEFAULT 0 CHECK (verify_count >= 0),
  last_verified_at TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dc_member_cards_expiry_idx ON public.dc_member_cards(expires_at);

-- Keep the serial ahead of any restored member number (safe on every rerun).
DO $dc_seq$
DECLARE v_max BIGINT;
BEGIN
  SELECT max(substring(member_no FROM '-([0-9]+)$')::BIGINT) INTO v_max FROM public.dc_member_cards;
  IF v_max IS NOT NULL THEN PERFORM setval('public.dc_member_no_seq', v_max, true); END IF;
END $dc_seq$;

DROP TRIGGER IF EXISTS trg_dc_card_settings_touch ON public.dc_card_settings;
CREATE TRIGGER trg_dc_card_settings_touch BEFORE UPDATE ON public.dc_card_settings
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();
DROP TRIGGER IF EXISTS trg_dc_member_cards_touch ON public.dc_member_cards;
CREATE TRIGGER trg_dc_member_cards_touch BEFORE UPDATE ON public.dc_member_cards
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();

ALTER TABLE public.dc_card_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_member_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dc_card_settings_read ON public.dc_card_settings;
CREATE POLICY dc_card_settings_read ON public.dc_card_settings
  FOR SELECT TO authenticated USING (public.is_approved_member());
DROP POLICY IF EXISTS dc_card_settings_admin_write ON public.dc_card_settings;
CREATE POLICY dc_card_settings_admin_write ON public.dc_card_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS dc_member_cards_read ON public.dc_member_cards;
CREATE POLICY dc_member_cards_read ON public.dc_member_cards
  FOR SELECT TO authenticated USING (member_id = auth.uid() OR public.is_admin());
-- No INSERT/UPDATE/DELETE policy: cards change only through the RPCs below.

-- Internal: issue a card for one member if none exists. Returns the row.
CREATE OR REPLACE FUNCTION public.dc_issue_card_internal(p_member_id UUID)
RETURNS public.dc_member_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.dc_member_cards;
  v_set  public.dc_card_settings;
  v_no   TEXT;
BEGIN
  SELECT * INTO v_card FROM public.dc_member_cards WHERE member_id = p_member_id;
  IF FOUND THEN RETURN v_card; END IF;
  SELECT * INTO v_set FROM public.dc_card_settings WHERE id = 1;
  LOOP
    v_no := coalesce(v_set.member_no_prefix, 'DC') || '-' || lpad(nextval('public.dc_member_no_seq')::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.dc_member_cards WHERE member_no = v_no);
  END LOOP;
  INSERT INTO public.dc_member_cards (member_id, member_no, card_token, expires_at)
  VALUES (p_member_id, v_no, public.dc_new_token(),
          NOW() + make_interval(months => coalesce(v_set.validity_months, 24)))
  ON CONFLICT (member_id) DO NOTHING
  RETURNING * INTO v_card;
  IF v_card.member_id IS NULL THEN
    SELECT * INTO v_card FROM public.dc_member_cards WHERE member_id = p_member_id;
  END IF;
  RETURN v_card;
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_card_state(p_card public.dc_member_cards, p_profile_status TEXT)
RETURNS TEXT
LANGUAGE sql
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT CASE
    WHEN p_card.member_id IS NULL THEN 'not_found'
    WHEN p_card.revoked_at IS NOT NULL THEN 'revoked'
    WHEN coalesce(p_profile_status, '') <> 'approved' THEN 'suspended'
    WHEN p_card.expires_at < NOW() THEN 'expired'
    ELSE 'valid'
  END;
$$;

CREATE OR REPLACE FUNCTION public.dc_card_json(p_card public.dc_member_cards, p_private BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  p public.profiles;
  s public.dc_card_settings;
  t public.tenant_settings;
  v JSONB;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = p_card.member_id;
  SELECT * INTO s FROM public.dc_card_settings WHERE id = 1;
  SELECT * INTO t FROM public.tenant_settings WHERE id = 1;
  v := jsonb_build_object(
    'status',        public.dc_card_state(p_card, p.status),
    'member_no',     p_card.member_no,
    'full_name',     p.full_name,
    'role',          CASE WHEN p.role = 'admin' THEN 'Administrator'
                          WHEN p.is_unit_leader IS TRUE THEN 'Unit Leader'
                          ELSE 'Member' END,
    'unit',          p.unit,
    'avatar_url',    p.avatar_url,
    'issued_at',     p_card.issued_at,
    'expires_at',    p_card.expires_at,
    'org_name',      t.org_name,
    'app_name',      t.app_name,
    'logo_url',      t.logo_url,
    'checked_at',    NOW()
  );
  IF p_private THEN
    v := v || jsonb_build_object(
      'member_id',      p_card.member_id,
      'card_token',     p_card.card_token,
      'revoked_at',     p_card.revoked_at,
      'revoke_reason',  p_card.revoke_reason,
      'reissue_count',  p_card.reissue_count,
      'verify_count',   p_card.verify_count,
      'last_verified_at', p_card.last_verified_at,
      'phone',          CASE WHEN s.show_phone THEN p.phone ELSE NULL END,
      'parish',         p.parish,
      'occupation',     p.occupation,
      'gender',         p.gender,
      'profile_status', p.status,
      'settings',       to_jsonb(s) - 'id'
    );
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_my_card()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_card public.dc_member_cards;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  v_card := public.dc_issue_card_internal(auth.uid());
  RETURN public.dc_card_json(v_card, TRUE);
END;
$$;

-- PUBLIC. Only a 128-bit token is accepted; never a member number or uuid.
CREATE OR REPLACE FUNCTION public.dc_verify_card(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token TEXT := public.dc_extract_token(p_token);
  v_card  public.dc_member_cards;
BEGIN
  IF v_token IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid', 'checked_at', NOW());
  END IF;
  SELECT * INTO v_card FROM public.dc_member_cards WHERE card_token = v_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'checked_at', NOW());
  END IF;
  UPDATE public.dc_member_cards
     SET verify_count = verify_count + 1, last_verified_at = NOW()
   WHERE member_id = v_card.member_id;
  RETURN public.dc_card_json(v_card, FALSE);
END;
$$;

-- Admin / unit leader: resolve anything a scanner can read.
--   * verify URL or bare 32-hex token      (current QR code)
--   * member number e.g. DC-000123           (Code 128 barcode / typed)
--   * dramaconnect:verify:<uuid> or a uuid   (cards printed before v14.1)
CREATE OR REPLACE FUNCTION public.dc_lookup_card(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw   TEXT := trim(coalesce(p_code, ''));
  v_token TEXT := public.dc_extract_token(v_raw);
  v_uuid  UUID;
  v_card  public.dc_member_cards;
  v_kind  TEXT;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can scan cards' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_raw) = 0 OR char_length(v_raw) > 300 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_token IS NOT NULL THEN
    SELECT * INTO v_card FROM public.dc_member_cards WHERE card_token = v_token;
    v_kind := 'qr';
  ELSIF upper(v_raw) ~ '^[A-Z0-9]{1,6}-[0-9]{4,10}$' THEN
    SELECT * INTO v_card FROM public.dc_member_cards WHERE member_no = upper(v_raw);
    v_kind := 'barcode';
  ELSE
    BEGIN
      v_uuid := regexp_replace(v_raw, '^dramaconnect:verify:', '', 'i')::UUID;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'invalid');
    END;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uuid) THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_card := public.dc_issue_card_internal(v_uuid);
    v_kind := 'legacy';
  END IF;

  IF v_card.member_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  RETURN public.dc_card_json(v_card, FALSE)
      || jsonb_build_object('member_id', v_card.member_id, 'source', v_kind);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_admin_card_action(p_member_id UUID, p_action TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.dc_member_cards;
  v_set  public.dc_card_settings;
  v_reason TEXT := nullif(left(trim(coalesce(p_reason, '')), 200), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('issue','reissue','revoke','restore','extend') THEN
    RAISE EXCEPTION 'Unsupported card action: %', p_action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_member_id) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  SELECT * INTO v_set FROM public.dc_card_settings WHERE id = 1;
  v_card := public.dc_issue_card_internal(p_member_id);

  IF p_action = 'reissue' THEN
    UPDATE public.dc_member_cards
       SET card_token = public.dc_new_token(), issued_at = NOW(),
           expires_at = NOW() + make_interval(months => v_set.validity_months),
           revoked_at = NULL, revoke_reason = NULL, reissue_count = reissue_count + 1
     WHERE member_id = p_member_id RETURNING * INTO v_card;
  ELSIF p_action = 'revoke' THEN
    IF v_reason IS NULL THEN RAISE EXCEPTION 'A reason is required to revoke a card'; END IF;
    UPDATE public.dc_member_cards SET revoked_at = NOW(), revoke_reason = v_reason
     WHERE member_id = p_member_id RETURNING * INTO v_card;
  ELSIF p_action = 'restore' THEN
    UPDATE public.dc_member_cards SET revoked_at = NULL, revoke_reason = NULL
     WHERE member_id = p_member_id RETURNING * INTO v_card;
  ELSIF p_action = 'extend' THEN
    UPDATE public.dc_member_cards
       SET expires_at = greatest(expires_at, NOW()) + make_interval(months => v_set.validity_months)
     WHERE member_id = p_member_id RETURNING * INTO v_card;
  END IF;

  INSERT INTO public.activity_log (actor_name, action, detail)
  SELECT coalesce((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Administrator'),
         'ID card ' || p_action,
         v_card.member_no || coalesce(' — ' || v_reason, '');
  RETURN public.dc_card_json(v_card, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_admin_list_cards()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r RECORD; v_out JSONB := '[]'::JSONB; v_card public.dc_member_cards;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT id FROM public.profiles WHERE status = 'approved' ORDER BY unit NULLS LAST, full_name LOOP
    v_card := public.dc_issue_card_internal(r.id);
    v_out := v_out || jsonb_build_array(public.dc_card_json(v_card, TRUE));
  END LOOP;
  RETURN v_out;
END;
$$;

-- Rehearsal door scanning. Administrators AND unit leaders can scan a member
-- card (QR, Code 128 barcode, typed member number or a pre-v14.1 card) and the
-- member is marked present atomically on the server. Attendance table RLS
-- stays admin-only for direct writes; this reviewed RPC is the only other path.
CREATE OR REPLACE FUNCTION public.dc_scan_attendance(p_rehearsal_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card   JSONB;
  v_member UUID;
  v_prev   TEXT;
  v_actor  TEXT;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can scan attendance' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rehearsals WHERE id = p_rehearsal_id) THEN
    RAISE EXCEPTION 'Rehearsal not found';
  END IF;
  v_card := public.dc_lookup_card(p_code);
  IF NOT (v_card ? 'member_id') THEN
    RETURN jsonb_build_object('result', coalesce(v_card->>'status', 'invalid'));
  END IF;
  IF v_card->>'status' NOT IN ('valid', 'expired') THEN
    RETURN jsonb_build_object('result', 'card_' || (v_card->>'status'),
      'full_name', v_card->>'full_name', 'member_no', v_card->>'member_no');
  END IF;
  v_member := (v_card->>'member_id')::UUID;
  SELECT status INTO v_prev FROM public.attendance
   WHERE rehearsal_id = p_rehearsal_id AND member_id = v_member;
  IF v_prev = 'present' THEN
    RETURN v_card || jsonb_build_object('result', 'already');
  END IF;
  INSERT INTO public.attendance (rehearsal_id, member_id, status, marked_at)
  VALUES (p_rehearsal_id, v_member, 'present', NOW())
  ON CONFLICT (rehearsal_id, member_id) DO UPDATE SET status = 'present', marked_at = NOW();
  SELECT full_name INTO v_actor FROM public.profiles WHERE id = auth.uid();
  BEGIN
    INSERT INTO public.activity_log (actor_name, action, detail)
    VALUES (coalesce(v_actor, 'Scanner'), 'Attendance scan',
            (v_card->>'full_name') || ' marked present by card scan (' || coalesce(v_card->>'source', 'card') || ')');
  EXCEPTION WHEN others THEN NULL;  -- the log must never block a check-in
  END;
  RETURN v_card || jsonb_build_object('result', 'checked_in', 'previous', v_prev,
    'expired_warning', (v_card->>'status') = 'expired');
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Programmes and public registration
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_programs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$'),
  title                   TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 140),
  subtitle                TEXT CHECK (subtitle IS NULL OR char_length(subtitle) <= 200),
  description             TEXT CHECK (description IS NULL OR char_length(description) <= 4000),
  category                TEXT NOT NULL DEFAULT 'special'
                          CHECK (category IN ('special','production','workshop','audition','outreach','conference','other')),
  venue                   TEXT CHECK (venue IS NULL OR char_length(venue) <= 200),
  starts_at               TIMESTAMPTZ NOT NULL,
  ends_at                 TIMESTAMPTZ,
  registration_opens_at   TIMESTAMPTZ,
  registration_closes_at  TIMESTAMPTZ,
  capacity                INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 100000),
  allow_waitlist          BOOLEAN NOT NULL DEFAULT TRUE,
  max_party_size          INTEGER NOT NULL DEFAULT 1 CHECK (max_party_size BETWEEN 1 AND 10),
  phone_mode              TEXT NOT NULL DEFAULT 'required' CHECK (phone_mode IN ('required','optional','hidden')),
  email_mode              TEXT NOT NULL DEFAULT 'optional' CHECK (email_mode IN ('required','optional','hidden')),
  custom_questions        JSONB NOT NULL DEFAULT '[]'::JSONB
                          CHECK (jsonb_typeof(custom_questions) = 'array' AND jsonb_array_length(custom_questions) <= 10),
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','archived')),
  cover_url               TEXT CHECK (cover_url IS NULL OR char_length(cover_url) <= 500),
  contact_phone           TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 40),
  feedback_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS dc_programs_starts_idx ON public.dc_programs(starts_at DESC);

CREATE TABLE IF NOT EXISTS public.dc_program_registrations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       UUID NOT NULL REFERENCES public.dc_programs(id) ON DELETE CASCADE,
  member_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name        TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  phone            TEXT CHECK (phone IS NULL OR char_length(phone) <= 24),
  email            TEXT CHECK (email IS NULL OR char_length(email) <= 160),
  gender           TEXT CHECK (gender IS NULL OR gender IN ('male','female','other')),
  age_group        TEXT CHECK (age_group IS NULL OR age_group IN ('under-13','13-17','18-25','26-35','36-50','51+')),
  organisation     TEXT CHECK (organisation IS NULL OR char_length(organisation) <= 160),
  is_first_timer   BOOLEAN NOT NULL DEFAULT FALSE,
  how_heard        TEXT CHECK (how_heard IS NULL OR char_length(how_heard) <= 60),
  source           TEXT NOT NULL DEFAULT 'direct' CHECK (source ~ '^[a-z0-9-]{1,24}$'),
  party_size       INTEGER NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 10),
  answers          JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(answers) = 'object'),
  status           TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','waitlisted','cancelled')),
  ticket_code      TEXT NOT NULL UNIQUE CHECK (ticket_code ~ '^[A-F0-9]{8}$'),
  ticket_token     TEXT NOT NULL UNIQUE CHECK (ticket_token ~ '^[a-f0-9]{32}$'),
  checked_in_at    TIMESTAMPTZ,
  checked_in_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  feedback_rating  INTEGER CHECK (feedback_rating IS NULL OR feedback_rating BETWEEN 1 AND 5),
  feedback_comment TEXT CHECK (feedback_comment IS NULL OR char_length(feedback_comment) <= 1000),
  feedback_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dc_program_regs_program_idx ON public.dc_program_registrations(program_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS dc_program_regs_phone_uq
  ON public.dc_program_registrations(program_id, phone) WHERE phone IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS dc_program_regs_member_uq
  ON public.dc_program_registrations(program_id, member_id) WHERE member_id IS NOT NULL AND status <> 'cancelled';

DROP TRIGGER IF EXISTS trg_dc_programs_touch ON public.dc_programs;
CREATE TRIGGER trg_dc_programs_touch BEFORE UPDATE ON public.dc_programs
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();

ALTER TABLE public.dc_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_program_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dc_programs_read ON public.dc_programs;
CREATE POLICY dc_programs_read ON public.dc_programs
  FOR SELECT TO authenticated USING (public.is_admin() OR (public.is_approved_member() AND status <> 'draft'));
DROP POLICY IF EXISTS dc_programs_admin_insert ON public.dc_programs;
CREATE POLICY dc_programs_admin_insert ON public.dc_programs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_programs_admin_update ON public.dc_programs;
CREATE POLICY dc_programs_admin_update ON public.dc_programs
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_programs_admin_delete ON public.dc_programs;
CREATE POLICY dc_programs_admin_delete ON public.dc_programs
  FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS dc_program_regs_manager_read ON public.dc_program_registrations;
CREATE POLICY dc_program_regs_manager_read ON public.dc_program_registrations
  FOR SELECT TO authenticated USING (public.dc_is_manager() OR member_id = auth.uid());
DROP POLICY IF EXISTS dc_program_regs_admin_update ON public.dc_program_registrations;
CREATE POLICY dc_program_regs_admin_update ON public.dc_program_registrations
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_program_regs_admin_delete ON public.dc_program_registrations;
CREATE POLICY dc_program_regs_admin_delete ON public.dc_program_registrations
  FOR DELETE TO authenticated USING (public.is_admin());
-- No INSERT policy: registration happens only through dc_register_for_program().

CREATE OR REPLACE FUNCTION public.dc_program_seats(p_program_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT coalesce(sum(party_size), 0)::INTEGER
  FROM public.dc_program_registrations
  WHERE program_id = p_program_id AND status = 'registered';
$$;

CREATE OR REPLACE FUNCTION public.dc_program_phase(p public.dc_programs)
RETURNS TEXT
LANGUAGE sql
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT CASE
    WHEN p.status IN ('draft') THEN 'draft'
    WHEN p.status = 'archived' OR coalesce(p.ends_at, p.starts_at + interval '6 hours') < NOW() THEN 'ended'
    WHEN p.status = 'closed' THEN 'closed'
    WHEN p.registration_opens_at IS NOT NULL AND p.registration_opens_at > NOW() THEN 'not_yet_open'
    WHEN p.registration_closes_at IS NOT NULL AND p.registration_closes_at < NOW() THEN 'closed'
    ELSE 'open'
  END;
$$;

CREATE OR REPLACE FUNCTION public.dc_public_program(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  p public.dc_programs;
  t public.tenant_settings;
  v_seats INTEGER;
BEGIN
  SELECT * INTO p FROM public.dc_programs WHERE slug = lower(trim(coalesce(p_slug, '')));
  IF NOT FOUND OR (p.status = 'draft' AND NOT public.is_admin()) THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  SELECT * INTO t FROM public.tenant_settings WHERE id = 1;
  v_seats := public.dc_program_seats(p.id);
  RETURN jsonb_build_object(
    'found', TRUE,
    'slug', p.slug, 'title', p.title, 'subtitle', p.subtitle, 'description', p.description,
    'category', p.category, 'venue', p.venue, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
    'registration_opens_at', p.registration_opens_at, 'registration_closes_at', p.registration_closes_at,
    'capacity', p.capacity, 'seats_taken', v_seats,
    'seats_left', CASE WHEN p.capacity IS NULL THEN NULL ELSE greatest(p.capacity - v_seats, 0) END,
    'allow_waitlist', p.allow_waitlist, 'max_party_size', p.max_party_size,
    'phone_mode', p.phone_mode, 'email_mode', p.email_mode,
    'custom_questions', p.custom_questions, 'cover_url', p.cover_url,
    'contact_phone', p.contact_phone, 'feedback_enabled', p.feedback_enabled,
    'phase', public.dc_program_phase(p), 'is_draft_preview', p.status = 'draft',
    'org_name', t.org_name, 'app_name', t.app_name, 'logo_url', t.logo_url
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_new_ticket_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_temp
VOLATILE
AS $$
DECLARE v TEXT;
BEGIN
  LOOP
    v := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.dc_program_registrations WHERE ticket_code = v);
  END LOOP;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_register_for_program(p_slug TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p        public.dc_programs;
  j        JSONB := coalesce(p_payload, '{}'::JSONB);
  v_name   TEXT := regexp_replace(trim(coalesce(j->>'full_name', '')), '\s+', ' ', 'g');
  v_phone  TEXT := nullif(regexp_replace(coalesce(j->>'phone', ''), '[^0-9+]', '', 'g'), '');
  v_email  TEXT := nullif(lower(trim(coalesce(j->>'email', ''))), '');
  v_gender TEXT := nullif(lower(trim(coalesce(j->>'gender', ''))), '');
  v_age    TEXT := nullif(trim(coalesce(j->>'age_group', '')), '');
  v_org    TEXT := nullif(left(trim(coalesce(j->>'organisation', '')), 160), '');
  v_heard  TEXT := nullif(left(trim(coalesce(j->>'how_heard', '')), 60), '');
  v_src    TEXT := lower(left(regexp_replace(coalesce(j->>'source', ''), '[^a-zA-Z0-9-]', '', 'g'), 24));
  v_party  INTEGER;
  v_first  BOOLEAN := lower(coalesce(j->>'is_first_timer', '')) IN ('true','1','yes','on');
  v_answers JSONB := '{}'::JSONB;
  v_raw_answers JSONB := CASE WHEN jsonb_typeof(j->'answers') = 'object' THEN j->'answers' ELSE '{}'::JSONB END;
  q        JSONB;
  v_qid    TEXT;
  v_val    TEXT;
  v_seats  INTEGER;
  v_status TEXT := 'registered';
  v_phase  TEXT;
  v_existing public.dc_program_registrations;
  v_row    public.dc_program_registrations;
BEGIN
  IF pg_column_size(j) > 8000 THEN RAISE EXCEPTION 'The form is too large'; END IF;
  -- Honeypot: humans never see this field.
  IF coalesce(j->>'website', '') <> '' THEN RAISE EXCEPTION 'Registration could not be accepted'; END IF;
  IF lower(coalesce(j->>'consent', '')) NOT IN ('true','1','yes','on') THEN
    RAISE EXCEPTION 'Please accept the privacy notice to register';
  END IF;

  SELECT * INTO p FROM public.dc_programs WHERE slug = lower(trim(coalesce(p_slug, ''))) FOR UPDATE;
  IF NOT FOUND OR p.status = 'draft' THEN RAISE EXCEPTION 'This programme was not found'; END IF;
  v_phase := public.dc_program_phase(p);
  IF v_phase = 'not_yet_open' THEN RAISE EXCEPTION 'Registration has not opened yet'; END IF;
  IF v_phase <> 'open' THEN RAISE EXCEPTION 'Registration for this programme is closed'; END IF;

  -- Free-tier flood protection.
  IF (SELECT count(*) FROM public.dc_program_registrations
       WHERE program_id = p.id AND created_at > NOW() - interval '1 minute') >= 40
     OR (SELECT count(*) FROM public.dc_program_registrations
       WHERE created_at > NOW() - interval '1 minute') >= 120 THEN
    RAISE EXCEPTION 'Registration is very busy right now. Please try again in a minute.';
  END IF;
  IF (SELECT count(*) FROM public.dc_program_registrations WHERE program_id = p.id) >= 20000 THEN
    RAISE EXCEPTION 'This programme has reached its registration limit';
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 120 OR v_name !~ '[[:alpha:]]' THEN
    RAISE EXCEPTION 'Please enter your full name';
  END IF;
  IF p.phone_mode = 'hidden' THEN v_phone := NULL; END IF;
  IF p.email_mode = 'hidden' THEN v_email := NULL; END IF;
  IF p.phone_mode = 'required' AND v_phone IS NULL THEN RAISE EXCEPTION 'Please enter your phone number'; END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'Please enter a valid phone number'; END IF;
  IF p.email_mode = 'required' AND v_email IS NULL THEN RAISE EXCEPTION 'Please enter your e-mail address'; END IF;
  IF v_email IS NOT NULL AND (char_length(v_email) > 160 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'Please enter a valid e-mail address';
  END IF;
  IF v_gender IS NOT NULL AND v_gender NOT IN ('male','female','other') THEN v_gender := NULL; END IF;
  IF v_age IS NOT NULL AND v_age NOT IN ('under-13','13-17','18-25','26-35','36-50','51+') THEN v_age := NULL; END IF;
  IF v_src = '' THEN v_src := 'direct'; END IF;
  BEGIN v_party := coalesce((j->>'party_size')::INTEGER, 1);
  EXCEPTION WHEN others THEN v_party := 1; END;
  v_party := greatest(1, least(v_party, p.max_party_size));

  -- Custom questions: keep only known answers; enforce required + select options.
  FOR q IN SELECT * FROM jsonb_array_elements(p.custom_questions) LOOP
    v_qid := q->>'id';
    CONTINUE WHEN v_qid IS NULL;
    v_val := left(trim(coalesce(v_raw_answers->>v_qid, '')), 500);
    IF lower(coalesce(q->>'required', '')) IN ('true','1','yes') AND v_val = '' THEN
      RAISE EXCEPTION 'Please answer: %', coalesce(q->>'label', 'a required question');
    END IF;
    IF v_val <> '' AND q->>'type' = 'select'
       AND NOT (coalesce(q->'options', '[]'::JSONB) ? v_val) THEN
      RAISE EXCEPTION 'Please choose a valid option for: %', coalesce(q->>'label', 'a question');
    END IF;
    IF v_val <> '' AND q->>'type' = 'yesno' AND v_val NOT IN ('yes','no') THEN
      RAISE EXCEPTION 'Please answer yes or no for: %', coalesce(q->>'label', 'a question');
    END IF;
    IF v_val <> '' THEN v_answers := v_answers || jsonb_build_object(v_qid, v_val); END IF;
  END LOOP;

  -- Duplicate protection: the same phone cannot hold two live registrations.
  IF v_phone IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.dc_program_registrations
     WHERE program_id = p.id AND phone = v_phone AND status <> 'cancelled';
    IF FOUND THEN
      IF lower(v_existing.full_name) = lower(v_name) THEN
        RETURN jsonb_build_object('result', 'duplicate', 'status', v_existing.status,
          'ticket_code', v_existing.ticket_code, 'ticket_token', v_existing.ticket_token,
          'full_name', v_existing.full_name, 'title', p.title, 'starts_at', p.starts_at, 'venue', p.venue);
      END IF;
      RAISE EXCEPTION 'This phone number is already registered for this programme';
    END IF;
  END IF;

  v_seats := public.dc_program_seats(p.id);
  IF p.capacity IS NOT NULL AND v_seats + v_party > p.capacity THEN
    IF p.allow_waitlist THEN v_status := 'waitlisted';
    ELSE RAISE EXCEPTION 'Sorry, this programme is fully booked';
    END IF;
  END IF;

  INSERT INTO public.dc_program_registrations
    (program_id, full_name, phone, email, gender, age_group, organisation, is_first_timer,
     how_heard, source, party_size, answers, status, ticket_code, ticket_token)
  VALUES
    (p.id, v_name, v_phone, v_email, v_gender, v_age, v_org, v_first,
     v_heard, v_src, v_party, v_answers, v_status, public.dc_new_ticket_code(), public.dc_new_token())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('result', 'created', 'status', v_row.status,
    'ticket_code', v_row.ticket_code, 'ticket_token', v_row.ticket_token,
    'full_name', v_row.full_name, 'party_size', v_row.party_size,
    'title', p.title, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'venue', p.venue);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_program_ticket(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_token TEXT := public.dc_extract_token(p_token);
  r public.dc_program_registrations;
  p public.dc_programs;
BEGIN
  IF v_token IS NULL THEN RETURN jsonb_build_object('found', FALSE); END IF;
  SELECT * INTO r FROM public.dc_program_registrations WHERE ticket_token = v_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', FALSE); END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = r.program_id;
  RETURN jsonb_build_object('found', TRUE,
    'full_name', r.full_name, 'status', r.status, 'party_size', r.party_size,
    'ticket_code', r.ticket_code, 'ticket_token', r.ticket_token,
    'checked_in', r.checked_in_at IS NOT NULL, 'checked_in_at', r.checked_in_at,
    'feedback_rating', r.feedback_rating, 'feedback_at', r.feedback_at,
    'slug', p.slug, 'title', p.title, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
    'venue', p.venue, 'feedback_enabled', p.feedback_enabled,
    'feedback_open', p.feedback_enabled AND p.starts_at <= NOW() AND r.status <> 'cancelled',
    'phase', public.dc_program_phase(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_submit_program_feedback(p_token TEXT, p_rating INTEGER, p_comment TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token TEXT := public.dc_extract_token(p_token);
  r public.dc_program_registrations;
  p public.dc_programs;
BEGIN
  IF v_token IS NULL THEN RAISE EXCEPTION 'This ticket link is not valid'; END IF;
  SELECT * INTO r FROM public.dc_program_registrations WHERE ticket_token = v_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'This ticket link is not valid'; END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = r.program_id;
  IF NOT p.feedback_enabled THEN RAISE EXCEPTION 'Feedback is not being collected for this programme'; END IF;
  IF p.starts_at > NOW() THEN RAISE EXCEPTION 'Feedback opens when the programme starts'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Please choose a rating from 1 to 5'; END IF;
  UPDATE public.dc_program_registrations
     SET feedback_rating = p_rating,
         feedback_comment = nullif(left(trim(coalesce(p_comment, '')), 1000), ''),
         feedback_at = NOW()
   WHERE id = r.id;
  RETURN jsonb_build_object('ok', TRUE, 'rating', p_rating);
END;
$$;

-- Check-in desk. Accepts a ticket QR/URL, an 8-character ticket code, or a
-- member ID card (QR token, member number or legacy code). A member card that
-- has no registration is admitted as a walk-in registration automatically.
CREATE OR REPLACE FUNCTION public.dc_program_checkin(p_program_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw   TEXT := trim(coalesce(p_code, ''));
  v_token TEXT := public.dc_extract_token(v_raw);
  r       public.dc_program_registrations;
  p       public.dc_programs;
  v_card  JSONB;
  v_prof  public.profiles;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can check people in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = p_program_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme not found'; END IF;
  IF v_raw = '' THEN RETURN jsonb_build_object('result', 'invalid'); END IF;

  IF v_token IS NOT NULL THEN
    SELECT * INTO r FROM public.dc_program_registrations WHERE ticket_token = v_token;
  ELSIF upper(v_raw) ~ '^[A-F0-9]{8}$' THEN
    SELECT * INTO r FROM public.dc_program_registrations WHERE ticket_code = upper(v_raw);
  END IF;

  IF r.id IS NULL THEN
    -- Not a ticket: try a member card.
    BEGIN
      v_card := public.dc_lookup_card(v_raw);
    EXCEPTION WHEN others THEN
      v_card := jsonb_build_object('status', 'invalid');
    END;
    IF v_card ? 'member_id' THEN
      IF v_card->>'status' NOT IN ('valid','expired') THEN
        RETURN jsonb_build_object('result', 'card_' || (v_card->>'status'), 'full_name', v_card->>'full_name');
      END IF;
      SELECT * INTO r FROM public.dc_program_registrations
       WHERE program_id = p.id AND member_id = (v_card->>'member_id')::UUID AND status <> 'cancelled';
      IF r.id IS NULL THEN
        SELECT * INTO v_prof FROM public.profiles WHERE id = (v_card->>'member_id')::UUID;
        INSERT INTO public.dc_program_registrations
          (program_id, member_id, full_name, phone, email, gender, source, status,
           ticket_code, ticket_token, checked_in_at, checked_in_by)
        VALUES
          (p.id, v_prof.id, coalesce(nullif(trim(v_prof.full_name), ''), 'Member'),
           nullif(regexp_replace(coalesce(v_prof.phone, ''), '[^0-9+]', '', 'g'), ''),
           v_prof.email,
           CASE WHEN lower(v_prof.gender) IN ('male','female','other') THEN lower(v_prof.gender) END,
           'member-card', 'registered', public.dc_new_ticket_code(), public.dc_new_token(), NOW(), auth.uid())
        ON CONFLICT DO NOTHING
        RETURNING * INTO r;
        IF r.id IS NULL THEN
          RETURN jsonb_build_object('result', 'duplicate_phone', 'full_name', v_prof.full_name);
        END IF;
        RETURN jsonb_build_object('result', 'checked_in', 'walk_in', TRUE, 'full_name', r.full_name,
          'party_size', r.party_size, 'registration_id', r.id, 'checked_in_at', r.checked_in_at);
      END IF;
    ELSE
      RETURN jsonb_build_object('result', 'not_found');
    END IF;
  END IF;

  IF r.program_id <> p.id THEN
    RETURN jsonb_build_object('result', 'wrong_program', 'full_name', r.full_name,
      'program', (SELECT title FROM public.dc_programs WHERE id = r.program_id));
  END IF;
  IF r.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled', 'full_name', r.full_name);
  END IF;
  IF r.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already', 'full_name', r.full_name,
      'party_size', r.party_size, 'registration_id', r.id, 'checked_in_at', r.checked_in_at);
  END IF;
  UPDATE public.dc_program_registrations
     SET checked_in_at = NOW(), checked_in_by = auth.uid(),
         status = CASE WHEN status = 'waitlisted' THEN 'registered' ELSE status END
   WHERE id = r.id RETURNING * INTO r;
  RETURN jsonb_build_object('result', 'checked_in', 'walk_in', FALSE, 'full_name', r.full_name,
    'party_size', r.party_size, 'registration_id', r.id, 'checked_in_at', r.checked_in_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_program_undo_checkin(p_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can change check-ins' USING ERRCODE = '42501';
  END IF;
  UPDATE public.dc_program_registrations SET checked_in_at = NULL, checked_in_by = NULL
   WHERE id = p_registration_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

-- Door walk-in (no ticket, no member card). Registers and checks in at once.
-- If the phone already holds a registration for this programme, that person is
-- checked in instead of creating a duplicate. Capacity is NOT enforced at the
-- door: the person is physically present and the desk decides.
CREATE OR REPLACE FUNCTION public.dc_program_walkin(p_program_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p        public.dc_programs;
  j        JSONB := coalesce(p_payload, '{}'::JSONB);
  v_name   TEXT := regexp_replace(trim(coalesce(j->>'full_name', '')), '\s+', ' ', 'g');
  v_phone  TEXT := nullif(regexp_replace(coalesce(j->>'phone', ''), '[^0-9+]', '', 'g'), '');
  v_email  TEXT := nullif(lower(trim(coalesce(j->>'email', ''))), '');
  v_gender TEXT := nullif(lower(trim(coalesce(j->>'gender', ''))), '');
  v_age    TEXT := nullif(trim(coalesce(j->>'age_group', '')), '');
  v_heard  TEXT := nullif(left(trim(coalesce(j->>'how_heard', '')), 60), '');
  v_first  BOOLEAN := lower(coalesce(j->>'is_first_timer', '')) IN ('true','1','yes','on');
  v_party  INTEGER;
  r        public.dc_program_registrations;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can admit walk-ins' USING ERRCODE = '42501';
  END IF;
  IF pg_column_size(j) > 8000 THEN RAISE EXCEPTION 'The form is too large'; END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = p_program_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme not found'; END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 OR v_name !~ '[[:alpha:]]' THEN
    RAISE EXCEPTION 'Please enter the guest''s full name';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'Please enter a valid phone number'; END IF;
  IF v_email IS NOT NULL AND (char_length(v_email) > 160 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'Please enter a valid e-mail address';
  END IF;
  IF v_gender IS NOT NULL AND v_gender NOT IN ('male','female','other') THEN v_gender := NULL; END IF;
  IF v_age IS NOT NULL AND v_age NOT IN ('under-13','13-17','18-25','26-35','36-50','51+') THEN v_age := NULL; END IF;
  BEGIN v_party := coalesce((j->>'party_size')::INTEGER, 1);
  EXCEPTION WHEN others THEN v_party := 1; END;
  v_party := greatest(1, least(v_party, 10));

  IF v_phone IS NOT NULL THEN
    SELECT * INTO r FROM public.dc_program_registrations
     WHERE program_id = p.id AND phone = v_phone AND status <> 'cancelled';
    IF FOUND THEN
      IF r.checked_in_at IS NOT NULL THEN
        RETURN jsonb_build_object('result', 'already', 'walk_in', FALSE, 'full_name', r.full_name,
          'party_size', r.party_size, 'registration_id', r.id, 'checked_in_at', r.checked_in_at);
      END IF;
      UPDATE public.dc_program_registrations
         SET checked_in_at = NOW(), checked_in_by = auth.uid(),
             status = CASE WHEN status = 'waitlisted' THEN 'registered' ELSE status END
       WHERE id = r.id RETURNING * INTO r;
      RETURN jsonb_build_object('result', 'checked_in', 'walk_in', FALSE, 'matched', 'phone',
        'full_name', r.full_name, 'party_size', r.party_size, 'registration_id', r.id,
        'ticket_code', r.ticket_code, 'checked_in_at', r.checked_in_at);
    END IF;
  END IF;

  INSERT INTO public.dc_program_registrations
    (program_id, full_name, phone, email, gender, age_group, is_first_timer, how_heard,
     source, party_size, status, ticket_code, ticket_token, checked_in_at, checked_in_by)
  VALUES
    (p.id, v_name, v_phone, v_email, v_gender, v_age, v_first, v_heard,
     'walk-in', v_party, 'registered', public.dc_new_ticket_code(), public.dc_new_token(), NOW(), auth.uid())
  RETURNING * INTO r;
  RETURN jsonb_build_object('result', 'checked_in', 'walk_in', TRUE, 'full_name', r.full_name,
    'party_size', r.party_size, 'registration_id', r.id, 'ticket_code', r.ticket_code,
    'ticket_token', r.ticket_token, 'checked_in_at', r.checked_in_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.dc_program_insights(p_program_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  p public.dc_programs;
  v JSONB;
  q JSONB;
  v_questions JSONB := '[]'::JSONB;
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can view programme insights' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.dc_programs WHERE id = p_program_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme not found'; END IF;

  WITH r AS (SELECT * FROM public.dc_program_registrations WHERE program_id = p.id),
       live AS (SELECT * FROM r WHERE status <> 'cancelled')
  SELECT jsonb_build_object(
    'program', jsonb_build_object('id', p.id, 'title', p.title, 'starts_at', p.starts_at,
                                  'capacity', p.capacity, 'phase', public.dc_program_phase(p)),
    'totals', jsonb_build_object(
      'registrations', (SELECT count(*) FROM live),
      'seats',         (SELECT coalesce(sum(party_size), 0) FROM live WHERE status = 'registered'),
      'waitlisted',    (SELECT count(*) FROM live WHERE status = 'waitlisted'),
      'cancelled',     (SELECT count(*) FROM r WHERE status = 'cancelled'),
      'checked_in',    (SELECT count(*) FROM live WHERE checked_in_at IS NOT NULL),
      'checked_in_people', (SELECT coalesce(sum(party_size), 0) FROM live WHERE checked_in_at IS NOT NULL),
      'walk_ins',      (SELECT count(*) FROM live WHERE source IN ('walk-in','member-card')),
      'first_timers',  (SELECT count(*) FROM live WHERE is_first_timer),
      'members',       (SELECT count(*) FROM live WHERE member_id IS NOT NULL),
      'no_shows',      CASE WHEN p.starts_at < NOW()
                            THEN (SELECT count(*) FROM live WHERE checked_in_at IS NULL AND status = 'registered')
                            ELSE 0 END,
      'feedback_count', (SELECT count(*) FROM live WHERE feedback_rating IS NOT NULL),
      'feedback_avg',   (SELECT round(avg(feedback_rating)::NUMERIC, 2) FROM live WHERE feedback_rating IS NOT NULL)
    ),
    'by_source',    (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (SELECT source k, count(*) n FROM live GROUP BY 1) s),
    'by_gender',    (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (SELECT coalesce(gender, 'unspecified') k, count(*) n FROM live GROUP BY 1) s),
    'by_age_group', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (SELECT coalesce(age_group, 'unspecified') k, count(*) n FROM live GROUP BY 1) s),
    'by_how_heard', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (SELECT coalesce(how_heard, 'unspecified') k, count(*) n FROM live GROUP BY 1) s),
    'by_day',       (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d, 'count', n) ORDER BY d), '[]'::JSONB)
                       FROM (SELECT (created_at AT TIME ZONE 'UTC')::DATE d, count(*) n FROM live GROUP BY 1) s),
    'checkin_by_hour', (SELECT coalesce(jsonb_agg(jsonb_build_object('hour', h, 'count', n) ORDER BY h), '[]'::JSONB)
                       FROM (SELECT date_trunc('hour', checked_in_at) h, count(*) n FROM live WHERE checked_in_at IS NOT NULL GROUP BY 1) s),
    'rating_distribution', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB)
                       FROM (SELECT feedback_rating::TEXT k, count(*) n FROM live WHERE feedback_rating IS NOT NULL GROUP BY 1) s)
  ) INTO v;

  FOR q IN SELECT * FROM jsonb_array_elements(p.custom_questions) LOOP
    CONTINUE WHEN q->>'type' NOT IN ('select','yesno') OR q->>'id' IS NULL;
    v_questions := v_questions || jsonb_build_array(jsonb_build_object(
      'id', q->>'id', 'label', q->>'label',
      'counts', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::JSONB) FROM (
                  SELECT answers->>(q->>'id') k, count(*) n
                  FROM public.dc_program_registrations
                  WHERE program_id = p.id AND status <> 'cancelled' AND answers ? (q->>'id')
                  GROUP BY 1) s)));
  END LOOP;
  RETURN v || jsonb_build_object('questions', v_questions, 'generated_at', NOW());
END;
$$;

-- --------------------------------------------------------------------------
-- 3. Duty roster
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_duty_roster (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_date     DATE NOT NULL,
  service_label TEXT NOT NULL DEFAULT 'Sunday Service' CHECK (char_length(service_label) BETWEEN 2 AND 80),
  duty_role     TEXT NOT NULL CHECK (char_length(duty_role) BETWEEN 2 AND 60),
  member_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notes         TEXT CHECK (notes IS NULL OR char_length(notes) <= 300),
  status        TEXT NOT NULL DEFAULT 'assigned'
                CHECK (status IN ('assigned','confirmed','declined','swap_requested','done','missed')),
  response_note TEXT CHECK (response_note IS NULL OR char_length(response_note) <= 300),
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (duty_date, service_label, duty_role, member_id)
);
CREATE INDEX IF NOT EXISTS dc_duty_roster_date_idx ON public.dc_duty_roster(duty_date);
CREATE INDEX IF NOT EXISTS dc_duty_roster_member_idx ON public.dc_duty_roster(member_id, duty_date);

DROP TRIGGER IF EXISTS trg_dc_duty_roster_touch ON public.dc_duty_roster;
CREATE TRIGGER trg_dc_duty_roster_touch BEFORE UPDATE ON public.dc_duty_roster
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();

ALTER TABLE public.dc_duty_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dc_duty_roster_read ON public.dc_duty_roster;
CREATE POLICY dc_duty_roster_read ON public.dc_duty_roster
  FOR SELECT TO authenticated USING (public.is_approved_member());
DROP POLICY IF EXISTS dc_duty_roster_manage_insert ON public.dc_duty_roster;
CREATE POLICY dc_duty_roster_manage_insert ON public.dc_duty_roster
  FOR INSERT TO authenticated WITH CHECK (public.dc_is_manager());
DROP POLICY IF EXISTS dc_duty_roster_manage_update ON public.dc_duty_roster;
CREATE POLICY dc_duty_roster_manage_update ON public.dc_duty_roster
  FOR UPDATE TO authenticated USING (public.dc_is_manager()) WITH CHECK (public.dc_is_manager());
DROP POLICY IF EXISTS dc_duty_roster_manage_delete ON public.dc_duty_roster;
CREATE POLICY dc_duty_roster_manage_delete ON public.dc_duty_roster
  FOR DELETE TO authenticated USING (public.dc_is_manager());

CREATE OR REPLACE FUNCTION public.dc_respond_duty(p_duty_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE d public.dc_duty_roster;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('confirmed','declined','swap_requested') THEN
    RAISE EXCEPTION 'Choose confirm, decline or request a swap';
  END IF;
  SELECT * INTO d FROM public.dc_duty_roster WHERE id = p_duty_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duty not found'; END IF;
  IF d.member_id <> auth.uid() THEN RAISE EXCEPTION 'You can only respond to your own duties' USING ERRCODE = '42501'; END IF;
  IF d.duty_date < CURRENT_DATE THEN RAISE EXCEPTION 'This duty date has passed'; END IF;
  IF p_status IN ('declined','swap_requested') AND char_length(trim(coalesce(p_note, ''))) < 3 THEN
    RAISE EXCEPTION 'Please add a short reason so your leader can plan a replacement';
  END IF;
  UPDATE public.dc_duty_roster
     SET status = p_status, response_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   WHERE id = d.id RETURNING * INTO d;
  RETURN to_jsonb(d);
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Member care & follow-up
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dc_care_cases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL DEFAULT 'absence'
               CHECK (reason IN ('absence','welfare','illness','bereavement','celebration','new_member','other')),
  summary      TEXT NOT NULL CHECK (char_length(summary) BETWEEN 3 AND 300),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','contacted','visited','resolved')),
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  assigned_to  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  opened_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  followup_log JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(followup_log) = 'array'),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dc_care_cases_member_idx ON public.dc_care_cases(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dc_care_cases_status_idx ON public.dc_care_cases(status);

DROP TRIGGER IF EXISTS trg_dc_care_cases_touch ON public.dc_care_cases;
CREATE TRIGGER trg_dc_care_cases_touch BEFORE UPDATE ON public.dc_care_cases
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();

-- Admins see every case; unit leaders see cases for their own unit or assigned to them.
CREATE OR REPLACE FUNCTION public.dc_can_see_care(p_member_id UUID, p_assigned_to UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT public.is_admin()
      OR (public.dc_is_manager() AND (
            p_assigned_to = auth.uid()
         OR EXISTS (SELECT 1 FROM public.profiles m
                     WHERE m.id = p_member_id AND public.dc_my_unit() IS NOT NULL
                       AND nullif(trim(m.unit), '') = public.dc_my_unit())));
$$;

ALTER TABLE public.dc_care_cases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dc_care_cases_read ON public.dc_care_cases;
CREATE POLICY dc_care_cases_read ON public.dc_care_cases
  FOR SELECT TO authenticated USING (public.dc_can_see_care(member_id, assigned_to));
DROP POLICY IF EXISTS dc_care_cases_insert ON public.dc_care_cases;
CREATE POLICY dc_care_cases_insert ON public.dc_care_cases
  FOR INSERT TO authenticated WITH CHECK (public.dc_can_see_care(member_id, assigned_to));
DROP POLICY IF EXISTS dc_care_cases_update ON public.dc_care_cases;
CREATE POLICY dc_care_cases_update ON public.dc_care_cases
  FOR UPDATE TO authenticated USING (public.dc_can_see_care(member_id, assigned_to))
  WITH CHECK (public.dc_can_see_care(member_id, assigned_to));
DROP POLICY IF EXISTS dc_care_cases_admin_delete ON public.dc_care_cases;
CREATE POLICY dc_care_cases_admin_delete ON public.dc_care_cases
  FOR DELETE TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.dc_care_add_note(p_case_id UUID, p_note TEXT, p_status TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE c public.dc_care_cases; v_note TEXT := left(trim(coalesce(p_note, '')), 500);
BEGIN
  SELECT * INTO c FROM public.dc_care_cases WHERE id = p_case_id;
  IF NOT FOUND OR NOT public.dc_can_see_care(c.member_id, c.assigned_to) THEN
    RAISE EXCEPTION 'Care case not found' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open','contacted','visited','resolved') THEN
    RAISE EXCEPTION 'Unsupported status';
  END IF;
  IF char_length(v_note) < 2 AND p_status IS NULL THEN RAISE EXCEPTION 'Write a short follow-up note'; END IF;
  IF jsonb_array_length(c.followup_log) >= 200 THEN RAISE EXCEPTION 'This case log is full; resolve it and open a new case'; END IF;
  UPDATE public.dc_care_cases
     SET followup_log = followup_log || jsonb_build_array(jsonb_build_object(
           'at', NOW(), 'by', coalesce((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Leader'),
           'note', nullif(v_note, ''), 'status', p_status)),
         status = coalesce(p_status, status),
         resolved_at = CASE WHEN p_status = 'resolved' THEN NOW()
                            WHEN p_status IS NOT NULL THEN NULL ELSE resolved_at END
   WHERE id = c.id RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

-- Members whose most recent rehearsals were missed in a row.
-- A rehearsal counts only once any attendance has been recorded for it (so an
-- unmarked session never makes the whole department look absent).
CREATE OR REPLACE FUNCTION public.dc_absentee_candidates(p_min_missed INTEGER DEFAULT 3)
RETURNS TABLE (
  member_id UUID, full_name TEXT, unit TEXT, phone TEXT, avatar_url TEXT,
  missed_in_a_row INTEGER, last_present DATE, open_case BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
#variable_conflict use_column
DECLARE v_min INTEGER := greatest(1, least(coalesce(p_min_missed, 3), 20));
BEGIN
  IF NOT public.dc_is_manager() THEN
    RAISE EXCEPTION 'Only administrators and unit leaders can view follow-up lists' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH sessions AS (
    SELECT r.id, r.rehearsal_date, row_number() OVER (ORDER BY r.rehearsal_date DESC, r.id) AS rn
    FROM public.rehearsals r
    WHERE r.rehearsal_date <= CURRENT_DATE
      AND EXISTS (SELECT 1 FROM public.attendance a WHERE a.rehearsal_id = r.id)
  ),
  recent AS (SELECT * FROM sessions WHERE rn <= 20),
  roster AS (
    SELECT m.id, m.full_name, m.unit, m.phone, m.avatar_url, coalesce(m.created_at, '-infinity'::TIMESTAMPTZ) AS joined
    FROM public.profiles m
    WHERE m.status = 'approved'
      AND (public.is_admin() OR (public.dc_my_unit() IS NOT NULL AND nullif(trim(m.unit), '') = public.dc_my_unit()))
  ),
  marks AS (
    -- Only sessions held on/after the member joined count against them.
    SELECT ro.id AS mid, s.rehearsal_date,
           row_number() OVER (PARTITION BY ro.id ORDER BY s.rehearsal_date DESC, s.id) AS mrn,
           EXISTS (SELECT 1 FROM public.attendance a
                    WHERE a.rehearsal_id = s.id AND a.member_id = ro.id
                      AND a.status IN ('present','late','excused')) AS came
    FROM roster ro JOIN recent s ON s.rehearsal_date >= (ro.joined AT TIME ZONE 'UTC')::DATE OR ro.joined = '-infinity'::TIMESTAMPTZ
  ),
  streak AS (
    SELECT mk.mid,
           coalesce(min(mk.mrn) FILTER (WHERE mk.came), count(*) + 1) - 1 AS missed,
           max(mk.rehearsal_date) FILTER (WHERE mk.came) AS last_came
    FROM marks mk GROUP BY mk.mid
  )
  SELECT ro.id, ro.full_name, ro.unit, ro.phone, ro.avatar_url,
         st.missed::INTEGER, st.last_came,
         EXISTS (SELECT 1 FROM public.dc_care_cases c WHERE c.member_id = ro.id AND c.status <> 'resolved')
  FROM roster ro JOIN streak st ON st.mid = ro.id
  WHERE st.missed >= v_min
  ORDER BY st.missed DESC, ro.full_name;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Privileges (least privilege; explicit grants only)
-- --------------------------------------------------------------------------
REVOKE ALL ON public.dc_card_settings, public.dc_member_cards, public.dc_programs,
              public.dc_program_registrations, public.dc_duty_roster, public.dc_care_cases FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.dc_card_settings TO authenticated;
GRANT SELECT ON public.dc_member_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dc_programs TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.dc_program_registrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dc_duty_roster TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dc_care_cases TO authenticated;
REVOKE ALL ON SEQUENCE public.dc_member_no_seq FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.dc_is_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_my_unit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_new_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_extract_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_issue_card_internal(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_card_state(public.dc_member_cards, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_card_json(public.dc_member_cards, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_my_card() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_verify_card(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_lookup_card(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_admin_card_action(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_admin_list_cards() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_scan_attendance(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_seats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_phase(public.dc_programs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_public_program(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_new_ticket_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_register_for_program(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_ticket(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_submit_program_feedback(TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_checkin(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_undo_checkin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_walkin(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_program_insights(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_respond_duty(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_can_see_care(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_care_add_note(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dc_absentee_candidates(INTEGER) FROM PUBLIC;

-- Restore support (v14.1): the in-browser archive restore upserts rows as the
-- signed-in administrator, so admins (only) may insert/update these tables
-- directly. Everyday writes still go through the RPCs above.
DROP POLICY IF EXISTS dc_card_settings_admin_insert ON public.dc_card_settings;
CREATE POLICY dc_card_settings_admin_insert ON public.dc_card_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_member_cards_admin_restore_insert ON public.dc_member_cards;
CREATE POLICY dc_member_cards_admin_restore_insert ON public.dc_member_cards
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_member_cards_admin_restore_update ON public.dc_member_cards;
CREATE POLICY dc_member_cards_admin_restore_update ON public.dc_member_cards
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS dc_program_regs_admin_insert ON public.dc_program_registrations;
CREATE POLICY dc_program_regs_admin_insert ON public.dc_program_registrations
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
GRANT INSERT ON public.dc_card_settings TO authenticated;
GRANT INSERT, UPDATE ON public.dc_member_cards TO authenticated;
GRANT INSERT ON public.dc_program_registrations TO authenticated;

-- Public (anon) entry points: an explicit, reviewed allow-list.
GRANT EXECUTE ON FUNCTION public.dc_verify_card(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dc_public_program(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dc_register_for_program(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_ticket(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dc_submit_program_feedback(TEXT, INTEGER, TEXT) TO anon, authenticated;

-- Signed-in entry points (each function re-checks role internally).
GRANT EXECUTE ON FUNCTION public.dc_is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_my_unit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_can_see_care(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_my_card() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_lookup_card(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_admin_card_action(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_admin_list_cards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_scan_attendance(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_checkin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_undo_checkin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_walkin(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_program_insights(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_respond_duty(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_care_add_note(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dc_absentee_candidates(INTEGER) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- COMPONENT 06: Post-install self-heal, API cache reload and verification
-- Source: database/post_install_selfheal.sql
-- ============================================================================
-- ============================================================================
-- DramaConnect — COMPONENT 05: POST-INSTALL SELF-HEAL AND API RELOAD
-- Source: database/post_install_selfheal.sql
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
-- Components 02-04 run inside explicit transactions. If any single statement in
-- one of them errors on a particular project, PostgreSQL aborts and rolls back
-- that whole component. When that happened to component 02 the database kept
-- working, but four objects silently disappeared while every base table stayed
-- in place, producing exactly these runtime errors:
--
--     Could not find the function public.poll_results without parameters
--     Could not find the function public.event_rsvp_results without parameters
--     Could not find the table 'public.member_directory' in the schema cache
--     Could not find the table 'public.rehearsal_schedule' in the schema cache
--
-- A second, independent cause of the identical message is a stale PostgREST
-- schema cache: PostgREST caches the catalog on startup and reports PGRST205
-- ("not found in the schema cache") for objects that exist perfectly well in
-- the database until it is told to reload.
--
-- WHAT THIS COMPONENT DOES
--   1. Re-creates the safe projections, the aggregate RPCs and the
--      authorisation helpers unconditionally, so they can never be missing.
--   2. Re-applies every grant those objects need.
--   3. Tells PostgREST to rebuild its schema cache.
--   4. Emits a verification row that must be all-true.
--
-- It is fully idempotent, depends only on base tables created in component 01,
-- and runs in its own transaction so it is independent of the others.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Authorization helpers (recursion-safe, independent of any policy)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_member()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_gallery_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'approved'
      AND (role = 'admin' OR is_unit_leader IS TRUE)
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Safe projections
-- The directory view exposes only the columns a member is entitled to see and
-- omits addresses, emergency contacts and costume measurements. The schedule
-- view omits the secret six-digit check-in code entirely. Both filter on
-- is_approved_member() so an unapproved or signed-out caller gets zero rows
-- rather than an error.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.member_directory;
CREATE VIEW public.member_directory
WITH (security_barrier = true)
AS
SELECT
  id, full_name, email, phone, parish, role, status, unit, occupation,
  avatar_url, whatsapp, facebook, instagram, tiktok, twitter,
  birth_month, birth_day, is_unit_leader, created_at
FROM public.profiles
WHERE status = 'approved'
  AND public.is_approved_member();

DROP VIEW IF EXISTS public.rehearsal_schedule;
CREATE VIEW public.rehearsal_schedule
WITH (security_barrier = true)
AS
SELECT id, rehearsal_date, notes, checkin_open, created_at
FROM public.rehearsals
WHERE public.is_approved_member();

-- ---------------------------------------------------------------------------
-- 3. Aggregate RPCs
-- These are SECURITY DEFINER so members can read vote/RSVP totals without ever
-- being granted row-level access to another member's individual ballot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poll_results()
RETURNS TABLE (
  poll_id UUID,
  option_index INTEGER,
  vote_count BIGINT,
  is_mine BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT v.poll_id, v.option_index, COUNT(*)::BIGINT,
           BOOL_OR(v.voter_id = auth.uid())
    FROM public.poll_votes v
    GROUP BY v.poll_id, v.option_index;
END;
$$;

CREATE OR REPLACE FUNCTION public.event_rsvp_results()
RETURNS TABLE (
  event_id UUID,
  response TEXT,
  response_count BIGINT,
  is_mine BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'An approved account is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.event_id, r.response, COUNT(*)::BIGINT,
           BOOL_OR(r.member_id = auth.uid())
    FROM public.event_rsvps r
    GROUP BY r.event_id, r.response;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- Revoked from PUBLIC and anon first so a previously leaked grant cannot
-- survive a re-run; then granted to authenticated only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.member_directory FROM PUBLIC, anon;
REVOKE ALL ON public.rehearsal_schedule FROM PUBLIC, anon;
GRANT SELECT ON public.member_directory TO authenticated;
GRANT SELECT ON public.rehearsal_schedule TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_approved_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_gallery_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.poll_results() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_rsvp_results() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_gallery_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.poll_results() TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_rsvp_results() TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- 5. Force PostgREST to rebuild its schema cache.
-- Without this, a project can keep answering PGRST205 for objects that were
-- created successfully, because PostgREST caches the catalog at startup.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6. Verification. Every column must read true.
-- ---------------------------------------------------------------------------
SELECT
  to_regclass('public.member_directory')             IS NOT NULL AS member_directory_ready,
  to_regclass('public.rehearsal_schedule')           IS NOT NULL AS rehearsal_schedule_ready,
  to_regprocedure('public.poll_results()')           IS NOT NULL AS poll_results_ready,
  to_regprocedure('public.event_rsvp_results()')     IS NOT NULL AS event_rsvp_results_ready,
  to_regprocedure('public.is_admin()')               IS NOT NULL AS is_admin_ready,
  to_regprocedure('public.is_approved_member()')     IS NOT NULL AS is_approved_member_ready,
  to_regclass('public.profiles')                     IS NOT NULL AS profiles_ready,
  to_regclass('public.rehearsals')                   IS NOT NULL AS rehearsals_ready,
  to_regclass('public.tenant_settings')              IS NOT NULL AS tenant_settings_ready;

-- ============================================================================
-- INSTALLATION VERIFICATION (read-only)
-- ============================================================================
SELECT
  (SELECT count(*) FROM public.dc_platform_settings WHERE id = 1) = 1 AS platform_settings_ready,
  (SELECT count(*) FROM public.dc_backup_settings WHERE id = 1) = 1 AS backup_settings_ready,
  (SELECT count(*) FROM public.dc_retention_settings WHERE id = 1) = 1 AS retention_settings_ready,
  (SELECT count(*) FROM public.dc_site_license WHERE id = 1) = 1 AS site_license_ready,
  to_regprocedure('public.dc_access_state()') IS NOT NULL AS access_rpc_ready,
  to_regprocedure('public.dc_platform_health()') IS NOT NULL AS health_rpc_ready,
  to_regprocedure('public.dc_begin_backup_run(text,text,integer)') IS NOT NULL AS backup_lease_rpc_ready,
  (SELECT count(*) FROM public.dc_card_settings WHERE id = 1) = 1 AS card_settings_ready,
  to_regprocedure('public.dc_verify_card(text)') IS NOT NULL AS card_verify_rpc_ready,
  to_regprocedure('public.dc_register_for_program(text,jsonb)') IS NOT NULL AS program_registration_rpc_ready,
  to_regprocedure('public.dc_absentee_candidates(integer)') IS NOT NULL AS member_care_rpc_ready;
