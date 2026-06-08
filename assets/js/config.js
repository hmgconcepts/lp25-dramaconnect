/**
 * ============================================================================
 * DramaConnect Enterprise v5 — Global Configuration
 * ============================================================================
 * RCCG LP 25 Drama Department Management System.
 *
 * IMPORTANT (load order): the Supabase JS library MUST be loaded BEFORE this
 * file, e.g.:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 * The CDN build registers a global object named `supabase` (the library
 * namespace) which exposes `createClient`. We use that to build OUR client and
 * store it in the global `sb`.
 *
 * SECURITY NOTE: The anon/publishable key below is SAFE to expose in the
 * browser — it only grants the access allowed by your Row Level Security (RLS)
 * policies. NEVER place the service_role key here.
 * ============================================================================
 */
const CONFIG = {
    SUPABASE_URL: 'https://fnhvilfamgadolnrwbpz.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuaHZpbGZhbWdhZG9sbnJ3YnB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTQ3NDcsImV4cCI6MjA5NjQ5MDc0N30.ucTG6EB4FURv4iCTSWPf0bA2g_thXeNXhIP39xABVqs',

    APP_NAME: 'DramaConnect Enterprise',
    APP_VERSION: 'v5.0',
    PROVINCE: 'LP 25',
    CURRENCY: '₦',

    // Feature flags — toggle modules on/off without deleting code.
    FEATURES: {
        announcements: true,
        events: true,
        casting: true,
        budgets: true,
        activityLog: true,
        pwa: true,
        darkMode: true
    },

    DEVELOPER: {
        name: 'Adewale Samson Adeagbo',
        brand: 'HMG Concepts',
        portfolio: 'https://cssadewale.pages.dev',
        agency: 'https://hmgconcepts.pages.dev'
    }
};

/**
 * Initialize the Supabase Client into the global `sb`.
 *
 * The original (buggy) code used `const supabase = supabase.createClient(...)`,
 * which redeclares `supabase`, shadows the library, and references it before
 * initialization → "supabase is not defined". We avoid that entirely by reading
 * `createClient` off `window.supabase` and storing the client as `sb`.
 */
var sb = null;

(function initSupabase() {
    if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
        console.error(
            '[DramaConnect] Supabase library not found. Ensure ' +
            '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> ' +
            'is loaded BEFORE config.js.'
        );
        document.addEventListener('DOMContentLoaded', function () {
            if (window.UI && UI.toast) {
                UI.toast('Connection library failed to load. Check your internet and refresh.', 'error', 8000);
            }
        });
        return;
    }
    sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
    });
    window.sb = sb;
    window.CONFIG = CONFIG;
})();
