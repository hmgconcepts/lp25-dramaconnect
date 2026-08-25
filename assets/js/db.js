/**
 * ============================================================================
 * Data Access Layer (DAL) — Enterprise v5
 * Every method throws on error so callers can show a toast.
 * Uses the `sb` Supabase client created in config.js.
 * ============================================================================
 */
const DB = {
    /* =========================== PERSONNEL =========================== */
    async getMembers() {
        // Full profile rows contain addresses, emergency contacts and costume
        // measurements. Only admins query that table; approved members and unit
        // leaders use the deliberately limited directory view.
        const me = Auth._cachedUser;
        const source = me && Auth.isAdmin(me) ? 'profiles' : 'member_directory';
        const { data, error } = await sb.from(source).select('*').order('full_name');
        if (error) throw error;
        return data || [];
    },
    async getMember(id) {
        const { data, error } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
    },
    /** Members whose birthday is today (by month/day). */
    async getTodaysBirthdays() {
        const now = new Date();
        const members = await this.getMembers();
        return members.filter(m => m.birth_month === now.getMonth() + 1 && m.birth_day === now.getDate());
    },
    /** Mark that today's birthday greeting was handled for a member (dedupe). */
    async markBirthdaySent(memberId, dayKey) {
        const { error } = await sb.from('profiles').update({ bday_last_sent: dayKey }).eq('id', memberId);
        if (error) throw error;
    },
    /**
     * Upload a profile photo to the public "avatars" bucket and save its URL on
     * the profile. Path is avatars/<user-id>/avatar.<ext> (RLS scopes by folder).
     * Returns the public URL.
     */
    async uploadAvatar(userId, file) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${userId}/avatar_${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage.from('avatars')
            .upload(path, file, { upsert: true, cacheControl: '3600' });
        if (upErr) throw upErr;
        const { data } = sb.storage.from('avatars').getPublicUrl(path);
        const url = data.publicUrl;
        const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', userId);
        if (error) throw error;
        return url;
    },
    async removeAvatar(userId) {
        const { error } = await sb.from('profiles').update({ avatar_url: null }).eq('id', userId);
        if (error) throw error;
    },
    async updateMember(userId, updates) {
        const { data, error } = await sb.from('profiles').update(updates).eq('id', userId).select();
        if (error) throw error;
        return data;
    },
    async setMemberRole(userId, role) {
        const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
        if (error) throw error;
    },
    /** Admin assigns or clears a member's drama unit. */
    async setMemberUnit(userId, unit) {
        const normalized = String(unit || '').trim();
        if (normalized.length > 80) throw new Error('Unit names must be 80 characters or fewer.');
        const { error } = await sb.from('profiles').update({ unit: normalized || null }).eq('id', userId);
        if (error) throw error;
    },
    /** Admin toggles unit-leader status for a member. */
    async setUnitLeader(userId, isLeader) {
        const { error } = await sb.from('profiles').update({ is_unit_leader: isLeader }).eq('id', userId);
        if (error) throw error;
    },

    /* ======================== GALLERY ============================ */
    async getGallery() {
        const { data, error } = await sb.from('gallery').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },
    /** Upload an image to the public "gallery" bucket and create a row. */
    async addGalleryPhoto(file, { title, caption, album, uploaded_by }) {
        if (!file || !/^image\/(?:jpeg|png|webp|gif)$/i.test(file.type || ''))
            throw new Error('Choose a JPG, PNG, WEBP or GIF image.');
        if (file.size > 10 * 1024 * 1024) throw new Error('Images must be 10 MB or smaller.');
        const me = Auth._cachedUser;
        if (!me || !me.id) throw new Error('Your session has expired. Please sign in again.');
        const allowedExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
        const ext = allowedExt[String(file.type).toLowerCase()];
        const path = `${me.id}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
        const { error: upErr } = await sb.storage.from('gallery').upload(path, file, {
            cacheControl: '3600', contentType: file.type, upsert: false
        });
        if (upErr) throw upErr;
        const { data } = sb.storage.from('gallery').getPublicUrl(path);
        const { error } = await sb.from('gallery').insert([{
            title, caption, album: album || 'General', image_url: data.publicUrl,
            uploaded_by, uploaded_by_id: me.id
        }]);
        if (error) {
            await sb.storage.from('gallery').remove([path]).catch(() => {});
            throw error;
        }
    },
    async deleteGalleryPhoto(id) {
        const { data: row, error: readError } = await sb.from('gallery')
            .select('id,image_url').eq('id', id).maybeSingle();
        if (readError) throw readError;
        const { error } = await sb.from('gallery').delete().eq('id', id);
        if (error) throw error;
        // Best-effort object cleanup; external YouTube/media links have no bucket path.
        const marker = '/storage/v1/object/public/gallery/';
        const url = row && String(row.image_url || '');
        const at = url.indexOf(marker);
        if (at >= 0) {
            const path = decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
            if (path) await sb.storage.from('gallery').remove([path]);
        }
    },

    /* ======================= SUGGESTIONS ========================= */
    async getSuggestions() {
        const { data, error } = await sb.from('suggestions').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },
    async addSuggestion(payload) {
        const { error } = await sb.from('suggestions').insert([payload]);
        if (error) throw error;
    },
    async setSuggestionStatus(id, status) {
        const { error } = await sb.from('suggestions').update({ status }).eq('id', id);
        if (error) throw error;
    },
    async deleteSuggestion(id) {
        const { error } = await sb.from('suggestions').delete().eq('id', id);
        if (error) throw error;
    },
    async setMemberStatus(userId, status) {
        const { error } = await sb.from('profiles').update({ status }).eq('id', userId);
        if (error) throw error;
    },
    async deleteMember(userId) {
        // Delete the Auth account server-side; its foreign-key cascade removes
        // the profile. Never delete just the profile, which would orphan login.
        const { data, error } = await sb.functions.invoke('admin-create-member', {
            body: { action: 'delete', user_id: userId }
        });
        if (error) {
            let message = error.message || 'Secure member-deletion function error';
            try {
                if (error.context && typeof error.context.clone === 'function') {
                    const payload = await error.context.clone().json();
                    message = payload.error || payload.message || message;
                }
            } catch (_e) { /* preserve SDK error */ }
            throw new Error(message);
        }
        if (!data || data.ok !== true) throw new Error((data && data.error) || 'Member deletion failed.');
    },

    /**
     * Admin creates a full login account for a member who has NOT signed up.
     * This calls the secure `admin-create-member` Edge Function (which uses the
     * service_role key SERVER-SIDE — never in the browser). Returns the created
     * account info incl. the password to hand to the member. There is no
     * profile-only fallback because every profile must map to an Auth account.
     */
    async adminCreateMember({ full_name, email, password, phone, parish, role, makeAdmin }) {
        const body = {
            full_name, email, password, phone, parish,
            role: makeAdmin ? 'admin' : (role || 'member')
        };
        const { data, error } = await sb.functions.invoke('admin-create-member', { body });
        if (error) {
            let message = error.message || 'admin-create-member function error';
            const status = error.context && error.context.status;
            try {
                if (error.context && typeof error.context.clone === 'function') {
                    const payload = await error.context.clone().json();
                    message = payload.error || payload.message || message;
                }
            } catch (_e) { /* preserve the SDK error */ }
            const wrapped = new Error(message);
            if (status) wrapped.status = status;
            throw wrapped;
        }
        if (!data || data.ok !== true) throw new Error((data && data.error) || 'Member creation failed.');
        return data;
    },

    /* ====================== PRODUCTIONS & CASTING ==================== */
    async getProductions() {
        const { data, error } = await sb.from('productions').select('*').order('performance_date', { ascending: true });
        if (error) throw error;
        return data || [];
    },
    async addProduction(prodData) {
        const { data, error } = await sb.from('productions').insert([prodData]).select();
        if (error) throw error;
        return data;
    },
    async updateProduction(id, updates) {
        const { error } = await sb.from('productions').update(updates).eq('id', id);
        if (error) throw error;
    },
    async deleteProduction(id) {
        const { error } = await sb.from('productions').delete().eq('id', id);
        if (error) throw error;
    },
    async getCast(prodId) {
        const me = Auth._cachedUser;
        if (Auth.isAdmin(me)) {
            const { data, error } = await sb.from('cast_list')
                .select('*, profiles(full_name)').eq('production_id', prodId);
            if (error) throw error;
            return data || [];
        }
        const [{ data, error }, { data: members, error: memberError }] = await Promise.all([
            sb.from('cast_list').select('*').eq('production_id', prodId),
            sb.from('member_directory').select('id,full_name')
        ]);
        if (error) throw error;
        if (memberError) throw memberError;
        const names = Object.fromEntries((members || []).map(m => [m.id, m.full_name]));
        return (data || []).map(row => ({ ...row, profiles: { full_name: names[row.member_id] || 'Member' } }));
    },
    async addCastMember(castData) {
        const { error } = await sb.from('cast_list').upsert(castData, { onConflict: 'production_id,member_id' });
        if (error) throw error;
    },
    async removeCastMember(id) {
        const { error } = await sb.from('cast_list').delete().eq('id', id);
        if (error) throw error;
    },

    /* ===================== REHEARSALS & ATTENDANCE ================== */
    async getRehearsals() {
        // The public schedule view deliberately omits the secret check-in code.
        const source = Auth.isAdmin(Auth._cachedUser) ? 'rehearsals' : 'rehearsal_schedule';
        const [{ data, error }, { data: attendance, error: attendanceError }] = await Promise.all([
            sb.from(source).select('*').order('rehearsal_date', { ascending: false }),
            sb.from('attendance').select('rehearsal_id,member_id,status')
        ]);
        if (error) throw error;
        if (attendanceError) throw attendanceError;
        const byRehearsal = {};
        (attendance || []).forEach(a => (byRehearsal[a.rehearsal_id] ||= []).push(a));
        return (data || []).map(r => ({ ...r, attendance: byRehearsal[r.id] || [] }));
    },
    async createRehearsal(date, note) {
        const { data, error } = await sb.from('rehearsals')
            .insert([{ rehearsal_date: date, notes: note }]).select();
        if (error) throw error;
        return data;
    },
    /** Admin sets/updates the self check-in code + open window for a rehearsal. */
    async setCheckinCode(rehearsalId, code, open) {
        const { error } = await sb.from('rehearsals')
            .update({ checkin_code: code, checkin_open: open }).eq('id', rehearsalId);
        if (error) throw error;
    },
    /** Member self check-in. The SECURITY DEFINER RPC validates the caller, window and code. */
    async selfCheckIn(rehearsalId, _memberId, code) {
        const { error } = await sb.rpc('self_check_in', {
            p_rehearsal_id: rehearsalId,
            p_code: String(code || '').trim()
        });
        if (error) throw error;
        return true;
    },
    async deleteRehearsal(id) {
        const { error } = await sb.from('rehearsals').delete().eq('id', id);
        if (error) throw error;
    },
    async getAttendance(rehearsalId) {
        const { data, error } = await sb.from('attendance')
            .select('*').eq('rehearsal_id', rehearsalId);
        if (error) throw error;
        return data || [];
    },
    async markAttendance(rehearsalId, memberId, status) {
        const { error } = await sb.from('attendance').upsert(
            { rehearsal_id: rehearsalId, member_id: memberId, status },
            { onConflict: 'rehearsal_id,member_id' }
        );
        if (error) throw error;
    },

    /* ======================= FINANCE & BUDGETS ===================== */
    async getTransactions() {
        const { data, error } = await sb.from('finances').select('*').order('date', { ascending: false });
        if (error) throw error;
        return data || [];
    },
    async addTransaction(transData) {
        const { data, error } = await sb.from('finances').insert([transData]).select();
        if (error) throw error;
        return data;
    },
    async deleteTransaction(id) {
        const { error } = await sb.from('finances').delete().eq('id', id);
        if (error) throw error;
    },
    async getBudgets() {
        const { data, error } = await sb.from('budgets').select('*, productions(title)');
        if (error) throw error;
        return data || [];
    },
    async setBudget(prodId, amount) {
        const { error } = await sb.from('budgets').upsert(
            { production_id: prodId, allocated_amount: amount, updated_at: new Date().toISOString() },
            { onConflict: 'production_id' }
        );
        if (error) throw error;
    },

    /* ========================= ANNOUNCEMENTS ====================== */
    async getAnnouncements() {
        const { data, error } = await sb.from('announcements')
            .select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },
    async addAnnouncement(payload) {
        const { error } = await sb.from('announcements').insert([payload]);
        if (error) throw error;
    },
    async deleteAnnouncement(id) {
        const { error } = await sb.from('announcements').delete().eq('id', id);
        if (error) throw error;
    },

    /* ============================ EVENTS ========================== */
    async getEvents() {
        const { data, error } = await sb.from('events')
            .select('*').order('event_date', { ascending: true });
        if (error) throw error;
        return data || [];
    },
    async addEvent(payload) {
        const { error } = await sb.from('events').insert([payload]);
        if (error) throw error;
    },
    async deleteEvent(id) {
        const { error } = await sb.from('events').delete().eq('id', id);
        if (error) throw error;
    },
    /** Aggregate RSVP counts plus only the caller's own choice. */
    async getRsvpResults() {
        const { data, error } = await sb.rpc('event_rsvp_results');
        if (error) throw error;
        return data || [];
    },
    /** Individual identities are returned only to administrators by RLS. */
    async getRsvps(eventId) {
        const { data, error } = await sb.from('event_rsvps')
            .select('*, profiles(full_name)').eq('event_id', eventId);
        if (error) throw error;
        return data || [];
    },
    /** Member RSVPs to an event: 'going' | 'maybe' | 'no'. */
    async setRsvp(eventId, memberId, response) {
        const { error } = await sb.from('event_rsvps').upsert(
            { event_id: eventId, member_id: memberId, response },
            { onConflict: 'event_id,member_id' }
        );
        if (error) throw error;
    },
    async getMyRsvps(memberId) {
        const { data, error } = await sb.from('event_rsvps')
            .select('*').eq('member_id', memberId);
        if (error) throw error;
        return data || [];
    },

    /* ======================== ACTIVITY LOG ======================= */
    async logActivity(action, detail) {
        try {
            const user = Auth._cachedUser;
            await sb.from('activity_log').insert([{
                actor_name: user ? (user.full_name || user.email) : 'system',
                action, detail
            }]);
        } catch (e) { /* logging must never break the app */ }
    },
    async getActivityLog(limit = 100) {
        const { data, error } = await sb.from('activity_log')
            .select('*').order('created_at', { ascending: false }).limit(limit);
        if (error) throw error;
        return data || [];
    },

    /* ============================ REPORTS ========================= */
    async getAttendanceReport() {
        if (Auth.isAdmin(Auth._cachedUser)) {
            const { data, error } = await sb.from('attendance')
                .select('*, profiles(full_name), rehearsals(rehearsal_date)');
            if (error) throw error;
            return data || [];
        }
        const [{ data, error }, { data: members, error: memberError }, { data: rehearsals, error: rehearsalError }] = await Promise.all([
            sb.from('attendance').select('*'),
            sb.from('member_directory').select('id,full_name'),
            sb.from('rehearsal_schedule').select('id,rehearsal_date')
        ]);
        if (error) throw error;
        if (memberError) throw memberError;
        if (rehearsalError) throw rehearsalError;
        const names = Object.fromEntries((members || []).map(m => [m.id, m.full_name]));
        const dates = Object.fromEntries((rehearsals || []).map(r => [r.id, r.rehearsal_date]));
        return (data || []).map(row => ({
            ...row,
            profiles: { full_name: names[row.member_id] || 'Member' },
            rehearsals: { rehearsal_date: dates[row.rehearsal_id] || null }
        }));
    },

    /* ============== EXTERNAL BROADCAST LOG (WhatsApp/Email) ======= */
    /** Log an outgoing external broadcast (for the broadcast history). */
    async logMessage(payload) {
        const { error } = await sb.from('messages').insert([payload]);
        if (error) throw error;
    },
    async getMessages(limit = 100) {
        const { data, error } = await sb.from('messages')
            .select('*').order('created_at', { ascending: false }).limit(limit);
        if (error) throw error;
        return data || [];
    },
    async deleteMessage(id) {
        const { error } = await sb.from('messages').delete().eq('id', id);
        if (error) throw error;
    },

    /* ============== IN-PLATFORM MESSAGING (internal inbox) ======== */
    /**
     * Send an internal message. `recipient_id` = a member's id, or NULL for a
     * broadcast to everyone. `to_admins` = true means "to all admins" (member
     * contacting leadership).
     */
    async sendInternalMessage(payload) {
        const { error } = await sb.from('inbox').insert([payload]);
        if (error) throw error;
    },
    /** Messages addressed TO me: direct, broadcasts, and (if admin) to_admins. */
    async getMyInbox(user) {
        let query = sb.from('inbox').select('*').order('created_at', { ascending: false });
        // RLS enforces visibility; we still order/return everything visible to me.
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    },
    /** Messages I have sent. */
    async getSentMessages(userId) {
        const { data, error } = await sb.from('inbox').select('*')
            .eq('sender_id', userId).order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },
    async markRead(messageId) {
        const { error } = await sb.from('inbox').update({ read_at: new Date().toISOString() }).eq('id', messageId);
        if (error) throw error;
    },
    async deleteInbox(id) {
        const { error } = await sb.from('inbox').delete().eq('id', id);
        if (error) throw error;
    },
    async getUnreadCount(user) {
        const { data, error } = await sb.from('inbox').select('id, read_at, recipient_id, sender_id');
        if (error) return 0;
        return (data || []).filter(m => m.recipient_id === user.id && !m.read_at && m.sender_id !== user.id).length;
    },

    /* ===================== TASKS / ASSIGNMENTS ==================== */
    async getTasks() {
        const { data, error } = await sb.from('tasks')
            .select('*, profiles!tasks_assignee_id_fkey(full_name)')
            .order('due_date', { ascending: true });
        if (error) throw error;
        return data || [];
    },
    async getMyTasks(userId) {
        const { data, error } = await sb.from('tasks').select('*')
            .eq('assignee_id', userId).order('due_date', { ascending: true });
        if (error) throw error;
        return data || [];
    },
    async addTask(payload) {
        const { error } = await sb.from('tasks').insert([payload]);
        if (error) throw error;
    },
    async updateTaskStatus(id, status) {
        const { error } = await sb.rpc('set_task_status', { p_task_id: id, p_status: status });
        if (error) throw error;
    },
    async deleteTask(id) {
        const { error } = await sb.from('tasks').delete().eq('id', id);
        if (error) throw error;
    },

    /* ===================== SCHEDULED REMINDERS =================== */
    async getReminders() {
        const { data, error } = await sb.from('reminders')
            .select('*').order('next_run', { ascending: true });
        if (error) throw error;
        return data || [];
    },
    async addReminder(payload) {
        const { error } = await sb.from('reminders').insert([payload]);
        if (error) throw error;
    },
    async updateReminder(id, updates) {
        const { error } = await sb.from('reminders').update(updates).eq('id', id);
        if (error) throw error;
    },
    async deleteReminder(id) {
        const { error } = await sb.from('reminders').delete().eq('id', id);
        if (error) throw error;
    },

    /* ===================== RESOURCE LIBRARY ====================== */
    async getResources() {
        const { data, error } = await sb.from('resources')
            .select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },
    async addResource(payload) {
        const { error } = await sb.from('resources').insert([payload]);
        if (error) throw error;
    },
    async deleteResource(id) {
        const { error } = await sb.from('resources').delete().eq('id', id);
        if (error) throw error;
    },

    /* ========================= POLLS / VOTING ===================== */
    async getPolls() {
        const [{ data: polls, error }, { data: summary, error: summaryError }] = await Promise.all([
            sb.from('polls').select('*').order('created_at', { ascending: false }),
            sb.rpc('poll_results')
        ]);
        if (error) throw error;
        if (summaryError) throw summaryError;
        const byPoll = {};
        (summary || []).forEach(row => (byPoll[row.poll_id] ||= []).push(row));
        return (polls || []).map(p => ({ ...p, vote_summary: byPoll[p.id] || [] }));
    },
    async addPoll(payload) {
        const { error } = await sb.from('polls').insert([payload]);
        if (error) throw error;
    },
    async closePoll(id, open) {
        const { error } = await sb.from('polls').update({ is_open: open }).eq('id', id);
        if (error) throw error;
    },
    async deletePoll(id) {
        const { error } = await sb.from('polls').delete().eq('id', id);
        if (error) throw error;
    },
    async castVote(pollId, optionIndex, _voterId) {
        const { error } = await sb.rpc('cast_poll_vote', {
            p_poll_id: pollId,
            p_option_index: Number(optionIndex)
        });
        if (error) throw error;
    },

    /* ========================= NOTIFICATIONS ====================== */
    /** Lightweight unified feed for the bell: unread inbox + open tasks. */
    async getNotifications(user) {
        const out = [];
        try {
            const inbox = await this.getMyInbox(user);
            inbox.filter(m => m.recipient_id === user.id && !m.read_at && m.sender_id !== user.id).slice(0, 10).forEach(m => out.push({
                type: 'message', icon: 'fa-envelope', color: '#2563eb',
                text: (m.sender_name || 'Someone') + ': ' + (m.subject || (m.body || '').slice(0, 40)),
                time: m.created_at, href: 'inbox.html'
            }));
        } catch (e) {}
        try {
            const tasks = await this.getMyTasks(user.id);
            tasks.filter(t => t.status !== 'done').slice(0, 10).forEach(t => out.push({
                type: 'task', icon: 'fa-list-check', color: '#16a34a',
                text: 'Task: ' + t.title + (t.due_date ? ' (due ' + t.due_date + ')' : ''),
                time: t.created_at, href: 'tasks.html'
            }));
        } catch (e) {}
        out.sort((a, b) => new Date(b.time) - new Date(a.time));
        return out;
    },

    /* ===================== BULK / BACKUP (admin) =================== */
    /** Bulk-insert productions/events/finances from an array of rows. */
    async bulkInsert(table, rows) {
        if (!rows || !rows.length) return;
        const { error } = await sb.from(table).insert(rows);
        if (error) throw error;
    },

    /* ======================= INVENTORY ========================= */
    async getInventory() {
        const { data, error } = await sb.from('inventory').select('*').order('name', { ascending: true });
        if (error && !error.message.includes('relation "public.inventory" does not exist')) throw error;
        return data || [];
    },
    async addInventory(payload) {
        const { error } = await sb.from('inventory').insert([payload]);
        if (error) throw error;
    },
    async updateInventory(id, payload) {
        const { error } = await sb.from('inventory').update(payload).eq('id', id);
        if (error) throw error;
    },
    async deleteInventory(id) {
        const { error } = await sb.from('inventory').delete().eq('id', id);
        if (error) throw error;
    },

    /**
     * Export the entire department dataset using the shared portable-archive
     * engine: all 22 tables, stable pagination, completeness manifest and
     * SHA-256 integrity seal. Kept here as a compatibility entry point.
     */
    async exportAll(options = {}) {
        if (!window.DataPortability) throw new Error('The portable archive module is unavailable.');
        return window.DataPortability.buildArchive(options);
    },

    /** Verify and safely merge a portable archive (approved administrators only). */
    async restoreArchive(archive, mode = 'merge', options = {}) {
        if (!window.DataPortability) throw new Error('The portable archive module is unavailable.');
        return window.DataPortability.restoreVerifiedArchive(archive, mode, options);
    },

    /* ======================= SAAS / TENANT SETTINGS ========================= */
    async getTenantSettings() {
        const { data, error } = await sb.from('tenant_settings').select('*').eq('id', 1).maybeSingle();
        if (error && !error.message.includes('relation')) throw error; // Graceful fail if V4 SQL not yet run
        return data;
    },
    async updateTenantSettings(payload) {
        payload.updated_at = new Date().toISOString();
        const { error } = await sb.from('tenant_settings').update(payload).eq('id', 1);
        if (error) throw error;
    }
};
window.DB = DB;
