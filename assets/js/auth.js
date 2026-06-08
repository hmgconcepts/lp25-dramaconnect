/**
 * ============================================================================
 * Authentication & Session Management
 * Uses the `sb` Supabase client created in config.js.
 * ============================================================================
 */
const Auth = {
    _cachedUser: null,

    async signUp(email, password, name) {
        const { data, error } = await sb.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } }
        });
        if (error) throw error;
        return data;
    },

    async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    async resetPassword(email) {
        const redirectTo = window.location.origin +
            window.location.pathname.replace(/[^/]*$/, '') + 'reset.html';
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
    },

    async updatePassword(newPassword) {
        const { error } = await sb.auth.updateUser({ password: newPassword });
        if (error) throw error;
    },

    async signOut() {
        try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
        this._cachedUser = null;
        window.location.href = Auth.indexUrl();
    },

    /** Returns the merged auth-user + profile, or null. */
    async getCurrentUser() {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return null;

        const { data: profile, error } = await sb
            .from('profiles').select('*').eq('id', user.id).maybeSingle();

        if (error) {
            console.warn('[DramaConnect] Could not load profile:', error.message);
            this._cachedUser = user;
            return user;
        }
        this._cachedUser = { ...user, ...(profile || {}) };
        return this._cachedUser;
    },

    /** Guards a page; redirects to login if not signed in OR not approved. */
    async checkSession() {
        const user = await this.getCurrentUser();
        if (!user) {
            window.location.href = Auth.indexUrl();
            return null;
        }
        // Approval gate: admins are always allowed; everyone else must be approved.
        if (user.role !== 'admin' && user.status && user.status !== 'approved') {
            try { sessionStorage.setItem('dc-pending', '1'); } catch (e) {}
            await sb.auth.signOut();
            window.location.href = Auth.indexUrl();
            return null;
        }
        return user;
    },

    /** Returns true if the account is allowed onto the platform. */
    isApproved(user) {
        return !!(user && (user.role === 'admin' || user.status === 'approved' || !user.status));
    },

    /** Guards admin-only pages. */
    async requireAdmin() {
        const user = await this.checkSession();
        if (!user) return null;
        if (user.role !== 'admin') {
            UI.toast('Admin access required for that page.', 'warning');
            window.location.href = 'dashboard.html';
            return null;
        }
        return user;
    },

    isAdmin(user) {
        return !!(user && user.role === 'admin');
    },

    /** Path to index.html that works at root or inside /pages/. */
    indexUrl() {
        return window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
    }
};
window.Auth = Auth;
