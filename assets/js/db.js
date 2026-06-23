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
        const { data, error } = await sb.from('profiles').select('*').order('full_name');
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
        const { data, error } = await sb.from('profiles').select('*')
            .eq('birth_month', now.getMonth() + 1).eq('birth_day', now.getDate());
        if (error) throw error;
        return data || [];
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
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await sb.storage.from('gallery').upload(path, file, { cacheControl: '3600' });
        if (upErr) throw upErr;
        const { data } = sb.storage.from('gallery').getPublicUrl(path);
        const { error } = await sb.from('gallery').insert([{ title, caption, album: album || 'General', image_url: data.publicUrl, uploaded_by }]);
        if (error) throw error;
    },
    async deleteGalleryPhoto(id) {
        const { error } = await sb.from('gallery').delete().eq('id', id);
        if (error) throw error;
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
        // Removes the profile row. (The auth.users record can be removed by an
        // admin from the Supabase dashboard, or via an Edge Function with the
        // service_role key — never exposed to the browser.)
        const { error } = await sb.from('profiles').delete().eq('id', userId);
        if (error) throw error;
    },

    /**
     * Admin creates a full login account for a member who has NOT signed up.
     * This calls the secure `admin-create-member` Edge Function (which uses the
     * service_role key SERVER-SIDE — never in the browser). Returns the created
     * account info incl. the password to hand to the member.
     * If the function is not deployed, falls back to a "roster-only" profile
     * (no login) and tells the admin to deploy the function for full accounts.
     */
    async adminCreateMember({ full_name, email, password, phone, parish, role, makeAdmin }) {
        const { data: { session } } = await sb.auth.getSession();
        const token = session ? session.access_token : null;
        const fnUrl = CONFIG.SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') + '/admin-create-member';
        const resp = await fetch(fnUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || CONFIG.SUPABASE_KEY) },
            body: JSON.stringify({ full_name, email, password, phone, parish, role: (makeAdmin ? 'admin' : (role || 'member')) })
        });
        if (!resp.ok) {
            let msg = 'admin-create-member function error';
            try { const j = await resp.json(); msg = (j && (j.error || j.message)) || msg; } catch (e) {}
            const err = new Error(msg); err.status = resp.status; throw err;
        }
        return await resp.json();
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
        const { data, error } = await sb.from('cast_list')
            .select('*, profiles(full_name)').eq('production_id', prodId);
        if (error) throw error;
        return data || [];
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
        const { data, error } = await sb.from('rehearsals')
            .select('*, attendance(member_id, status)')
            .order('rehearsal_date', { ascending: false });
        if (error) throw error;
        return data || [];
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
    /** Member self check-in using the code. Returns true on success. */
    async selfCheckIn(rehearsalId, memberId, code) {
        // Verify the code & that check-in is open (RLS lets members read rehearsals).
        const { data: reh, error: e1 } = await sb.from('rehearsals')
            .select('checkin_code, checkin_open').eq('id', rehearsalId).maybeSingle();
        if (e1) throw e1;
        if (!reh || !reh.checkin_open) throw new Error('Check-in is closed for this rehearsal.');
        if (!reh.checkin_code || String(reh.checkin_code).trim() !== String(code).trim())
            throw new Error('Incorrect check-in code.');
        const { error } = await sb.from('attendance').upsert(
            { rehearsal_id: rehearsalId, member_id: memberId, status: 'present' },
            { onConflict: 'rehearsal_id,member_id' }
        );
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
        const { data, error } = await sb.from('attendance')
            .select('*, profiles(full_name), rehearsals(rehearsal_date)');
        if (error) throw error;
        return data || [];
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
        return (data || []).filter(m => !m.read_at && m.sender_id !== user.id).length;
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
        const { error } = await sb.from('tasks').update({ status }).eq('id', id);
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
        const { data, error } = await sb.from('polls')
            .select('*, poll_votes(id, option_index, voter_id)')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
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
    async castVote(pollId, optionIndex, voterId) {
        const { error } = await sb.from('poll_votes').upsert(
            { poll_id: pollId, option_index: optionIndex, voter_id: voterId },
            { onConflict: 'poll_id,voter_id' }
        );
        if (error) throw error;
    },

    /* ========================= NOTIFICATIONS ====================== */
    /** Lightweight unified feed for the bell: unread inbox + open tasks. */
    async getNotifications(user) {
        const out = [];
        try {
            const inbox = await this.getMyInbox(user);
            inbox.filter(m => !m.read_at && m.sender_id !== user.id).slice(0, 10).forEach(m => out.push({
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

    /** Export the entire department dataset (for backup). Read-only. */
    async exportAll() {
        const tables = ['profiles', 'productions', 'cast_list', 'finances', 'budgets',
                        'rehearsals', 'attendance', 'announcements', 'events',
                        'messages', 'inbox', 'tasks', 'reminders',
                        'resources', 'polls', 'poll_votes', 'event_rsvps', 'gallery', 'suggestions'];
        const out = { exported_at: new Date().toISOString(), data: {} };
        for (const t of tables) {
            const { data, error } = await sb.from(t).select('*');
            if (error) throw error;
            out.data[t] = data || [];
        }
        return out;
    }
};
window.DB = DB;
