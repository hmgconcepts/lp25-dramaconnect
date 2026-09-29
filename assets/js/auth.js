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
        // Two-step verification (Settings → Security). If this account has a
        // verified authenticator, the session is only aal1 until a 6-digit code
        // is verified. Cancelling signs the user straight back out.
        const mfa = await this.ensureMfa();
        if (mfa === 'cancelled') {
            try { await sb.auth.signOut(); } catch (_) { /* ignore */ }
            throw new Error('Two-step verification was cancelled. Sign in again and enter the code from your authenticator app.');
        }
        if (window.PlatformManagement) {
            await PlatformManagement.recordLoginEvent('sign_in', { method: mfa === 'verified' ? 'password+totp' : 'password' });
        }
        return data;
    },

    /* ------------------------------------------------------------------
     * Two-step verification (Supabase Auth TOTP — free on every plan).
     * Returns 'none' (no factor / SDK without MFA), 'ok' (already aal2),
     * 'verified' (code accepted now) or 'cancelled'.
     * ------------------------------------------------------------------ */
    mfaSupported() {
        return !!(window.sb && sb.auth && sb.auth.mfa && typeof sb.auth.mfa.getAuthenticatorAssuranceLevel === 'function');
    },

    async ensureMfa() {
        if (!this.mfaSupported()) return 'none';
        try {
            const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
            if (error || !data) return 'none';
            if (data.nextLevel !== 'aal2') return 'none';
            if (data.currentLevel === 'aal2') return 'ok';
            const { data: factors } = await sb.auth.mfa.listFactors();
            const factor = (factors && (factors.totp || []).find(f => f.status === 'verified'));
            if (!factor) return 'none';
            return (await this.mfaChallenge(factor.id)) ? 'verified' : 'cancelled';
        } catch (e) {
            console.warn('[DramaConnect] MFA check skipped:', e && e.message);
            return 'none';
        }
    },

    /** Modal 6-digit prompt; resolves true once the code verifies. */
    mfaChallenge(factorId) {
        return new Promise(resolve => {
            const wrap = document.createElement('div');
            wrap.setAttribute('role', 'dialog');
            wrap.setAttribute('aria-modal', 'true');
            wrap.setAttribute('aria-labelledby', 'dc-mfa-title');
            wrap.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:1rem';
            wrap.innerHTML = `
                <form style="background:#fff;color:#0f172a;border-radius:1.25rem;padding:1.5rem;max-width:360px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,.35);font-family:inherit">
                    <h2 id="dc-mfa-title" style="font-size:1.15rem;font-weight:800;margin:0 0 .35rem">🔐 Two-step verification</h2>
                    <p style="font-size:.85rem;color:#475569;margin:0 0 1rem">Open your authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 2FAS…) and enter the 6-digit code for DramaConnect.</p>
                    <input id="dc-mfa-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required
                        style="width:100%;font-size:1.6rem;letter-spacing:.5em;text-align:center;padding:.6rem;border:2px solid #cbd5e1;border-radius:.8rem;box-sizing:border-box" aria-label="6-digit code">
                    <p id="dc-mfa-err" role="alert" style="color:#b91c1c;font-size:.8rem;min-height:1.2em;margin:.5rem 0 0"></p>
                    <div style="display:flex;gap:.5rem;margin-top:.75rem">
                        <button type="button" id="dc-mfa-cancel" style="flex:1;padding:.65rem;border-radius:.8rem;border:1px solid #cbd5e1;background:#fff;font-weight:700;cursor:pointer">Cancel</button>
                        <button type="submit" id="dc-mfa-ok" style="flex:1;padding:.65rem;border-radius:.8rem;border:0;background:#1e40af;color:#fff;font-weight:700;cursor:pointer">Verify</button>
                    </div>
                </form>`;
            document.body.appendChild(wrap);
            const input = wrap.querySelector('#dc-mfa-code');
            const err = wrap.querySelector('#dc-mfa-err');
            const okBtn = wrap.querySelector('#dc-mfa-ok');
            const done = value => { wrap.remove(); resolve(value); };
            setTimeout(() => input.focus(), 50);
            wrap.querySelector('#dc-mfa-cancel').onclick = () => done(false);
            wrap.querySelector('form').onsubmit = async ev => {
                ev.preventDefault();
                const code = input.value.replace(/\D/g, '');
                if (code.length !== 6) { err.textContent = 'Enter all 6 digits.'; return; }
                okBtn.disabled = true; okBtn.textContent = 'Checking…'; err.textContent = '';
                try {
                    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
                    if (error) throw error;
                    done(true);
                } catch (e) {
                    err.textContent = /invalid|expired|mismatch/i.test(e && e.message || '')
                        ? 'That code is wrong or expired. Check your phone clock is automatic, then try the newest code.'
                        : (e && e.message) || 'Verification failed.';
                    okBtn.disabled = false; okBtn.textContent = 'Verify'; input.select();
                }
            };
        });
    },

    async mfaListFactors() {
        if (!this.mfaSupported()) return [];
        const { data, error } = await sb.auth.mfa.listFactors();
        if (error) throw error;
        return (data && data.all) || (data && data.totp) || [];
    },
    async mfaEnroll(friendlyName) {
        const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: friendlyName || `DramaConnect ${new Date().toISOString().slice(0, 10)}` });
        if (error) throw error;
        return data; // { id, totp: { qr_code, secret, uri } }
    },
    async mfaVerifyEnrollment(factorId, code) {
        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: String(code || '').replace(/\D/g, '') });
        if (error) throw error;
        if (window.PlatformManagement) await PlatformManagement.recordLoginEvent('sign_in', { method: 'totp-enrolled' });
        return true;
    },
    async mfaUnenroll(factorId) {
        const { error } = await sb.auth.mfa.unenroll({ factorId });
        if (error) throw error;
        return true;
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
        if (window.PlatformManagement) {
            await PlatformManagement.recordLoginEvent('sign_out', { reason: 'user_requested' });
        }
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

    /** Guards a page; redirects when unauthenticated, unapproved or restricted. */
    async checkSession(options = {}) {
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
        // A restored aal1 session for an account with 2-step verification must
        // present a code before any page renders.
        const mfa = await this.ensureMfa();
        if (mfa === 'cancelled') {
            try { await sb.auth.signOut(); } catch (_) { /* ignore */ }
            window.location.href = Auth.indexUrl();
            return null;
        }
        user.mfa = mfa;
        if (window.PlatformManagement) {
            const access = await PlatformManagement.enforceAccess({ allowRestricted: Boolean(options.allowRestricted) });
            if (!access) return null;
            user.platformAccess = access;
            this._nudgeAdminMfa(user, mfa);
        }
        return user;
    },

    /** Advisory: org requires admin 2FA and this admin has none. Once per session. */
    async _nudgeAdminMfa(user, mfa) {
        try {
            if (!this.isAdmin(user) || mfa === 'ok' || mfa === 'verified') return;
            if (sessionStorage.getItem('dc-mfa-nudged')) return;
            const org = PlatformManagement.orgSettings ? await PlatformManagement.orgSettings() : null;
            if (!org || !org.require_admin_mfa) return;
            sessionStorage.setItem('dc-mfa-nudged', '1');
            if (window.UI && UI.toast) UI.toast('Your organisation asks administrators to turn on two-step verification: Settings → Security.', 'warning', 9000);
        } catch (_) { /* advisory only */ }
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
