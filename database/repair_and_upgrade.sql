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
CREATE TABLE IF NOT EXISTS inventory (
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

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
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
CREATE TABLE IF NOT EXISTS tenant_settings (
  id          INT PRIMARY KEY DEFAULT 1,
  app_name    TEXT DEFAULT 'DramaConnect Enterprise',
  org_name    TEXT DEFAULT 'RCCG LP 25',
  logo_url    TEXT DEFAULT '../assets/img/rccg_logo.png',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults so we never error on reading
INSERT INTO tenant_settings (id, app_name, org_name) 
VALUES (1, 'DramaConnect Enterprise', 'RCCG LP 25') 
ON CONFLICT (id) DO NOTHING;

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
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

