/**
 * Authentication & Session Management
 */
const Auth = {
    async signUp(email, password, name) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } }
        });
        if (error) throw error;
        return data;
    },

    async signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (error) throw error;
        return data;
    },

    async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        window.location.href = '/index.html';
    },

    async getCurrentUser() {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        
        const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        if (error) throw error;
        
        return { ...user, ...profile };
    },

    async checkSession() {
        const user = await this.getCurrentUser();
        if (!user) {
            window.location.href = '/index.html';
            return null;
        }
        return user;
    }
};
