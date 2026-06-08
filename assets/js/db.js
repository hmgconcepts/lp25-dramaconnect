/**
 * Data Access Layer (DAL) - Enterprise v4
 */
const DB = {
    // --- Personnel ---
    async getMembers() {
        const { data, error } = await supabase.from('profiles').select('*').order('full_name');
        if (error) throw error;
        return data;
    },

    async addMember(memberData) {
        const { data, error } = await supabase.from('profiles').insert([memberData]);
        if (error) throw error;
        return data;
    },

    async updateMember(userId, updates) {
        const { data, error } = await supabase.from('profiles').update(updates).eq('id', userId);
        if (error) throw error;
        return data;
    },

    // --- Production & Casting ---
    async getProductions() {
        const { data, error } = await supabase.from('productions').select('*').order('performance_date');
        if (error) throw error;
        return data;
    },

    async addProduction(prodData) {
        const { data, error } = await supabase.from('productions').insert([prodData]);
        if (error) throw error;
        return data;
    },

    async getCast(prodId) {
        const { data, error } = await supabase.from('cast_list').select('*, profiles(full_name)').eq('production_id', prodId);
        if (error) throw error;
        return data;
    },

    async addCastMember(castData) {
        const { error } = await supabase.from('cast_list').upsert(castData);
        if (error) throw error;
    },

    // --- Rehearsals & Attendance ---
    async getRehearsals() {
        const { data, error } = await supabase.from('rehearsals').select('*, attendance(member_id)').order('rehearsal_date', { ascending: false });
        if (error) throw error;
        return data;
    },

    async createRehearsal(date, note) {
        const { data, error } = await supabase.from('rehearsals').insert([{ rehearsal_date: date, notes: note }]);
        if (error) throw error;
        return data;
    },

    async markAttendance(rehearsalId, memberId, status) {
        const { error } = await supabase.from('attendance').upsert({ 
            rehearsal_id: rehearsalId, 
            member_id: memberId, 
            status: status 
        });
        if (error) throw error;
    },

    // --- Financials & Budgeting ---
    async getTransactions() {
        const { data, error } = await supabase.from('finances').select('*').order('date', { ascending: false });
        if (error) throw error;
        return data;
    },

    async addTransaction(transData) {
        const { data, error } = await supabase.from('finances').insert([transData]);
        if (error) throw error;
        return data;
    },

    async getBudgets() {
        const { data, error } = await supabase.from('budgets').select('*');
        if (error) throw error;
        return data;
    },

    async setBudget(prodId, amount) {
        const { error } = await supabase.from('budgets').upsert({ production_id: prodId, allocated_amount: amount });
        if (error) throw error;
    },

    // --- Reports ---
    async getAttendanceReport() {
        const { data, error } = await supabase.from('attendance').select('*, profiles(full_name), rehearsals(rehearsal_date)');
        if (error) throw error;
        return data;
    }
};
