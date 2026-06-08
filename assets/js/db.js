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
    async updateMember(userId, updates) {
        const { data, error } = await sb.from('profiles').update(updates).eq('id', userId).select();
        if (error) throw error;
        return data;
    },
    async setMemberRole(userId, role) {
        const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
        if (error) throw error;
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
    }
};
window.DB = DB;
