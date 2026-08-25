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
        if (error) {
            if (error.message.toLowerCase().includes('rate limit')) {
                throw new Error("Registration rate limit exceeded. Admin: Please disable 'Confirm Email' in Supabase Auth Settings or wait an hour.");
            }
            throw error;
        }
        return data;
    },

    async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    async resetPassword(email) {
        // Recovery page is under /pages; resolve from either `/` or `/index.html`.
        const redirectTo = new URL('pages/reset.html', window.location.origin + '/').href;
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
            console.error('[DramaConnect] Could not verify profile:', error.message);
            throw new Error('Your account profile could not be verified. Please try again.');
        }
        if (!profile) throw new Error('No DramaConnect profile is linked to this account. Contact an administrator.');
        this._cachedUser = { ...user, ...profile };
        return this._cachedUser;
    },

    /** Guards a page; redirects to login if not signed in OR not approved. */
    async checkSession() {
        let user;
        try { user = await this.getCurrentUser(); }
        catch (error) {
            UI.toast(error.message || 'Unable to verify your account.', 'error', 7000);
            window.location.href = Auth.indexUrl();
            return null;
        }
        if (!user) {
            window.location.href = Auth.indexUrl();
            return null;
        }
        // Approval is required for every account, including administrators.
        if (user.status !== 'approved') {
            try { sessionStorage.setItem('dc-pending', '1'); } catch (e) {}
            await sb.auth.signOut();
            window.location.href = Auth.indexUrl();
            return null;
        }
        return user;
    },

    /** Returns true if the account is allowed onto the platform. */
    isApproved(user) {
        return !!(user && user.status === 'approved');
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
        return !!(user && user.status === 'approved' && user.role === 'admin');
    },

    /** True for approved unit leaders (and approved admins, who outrank leaders). */
    isUnitLeader(user) {
        return !!(user && user.status === 'approved' && (user.role === 'admin' || user.is_unit_leader === true));
    },

    /** Elevated = admin OR unit leader (can do some management). */
    canManage(user) {
        return this.isAdmin(user) || this.isUnitLeader(user);
    },

    /** Path to index.html that works at root or inside /pages/. */
    indexUrl() {
        return window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
    }
};
window.Auth = Auth;
