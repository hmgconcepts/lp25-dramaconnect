/**
 * Global Configuration
 */
const CONFIG = {
    SUPABASE_URL: 'YOUR_SUPABASE_PROJECT_URL',
    SUPABASE_KEY: 'YOUR_SUPABASE_ANON_KEY',
    APP_NAME: 'DramaConnect Enterprise v4',
    PROVINCE: 'LP 25',
    DEVELOPER: {
        name: 'Adewale Samson Adeagbo',
        brand: 'HMG Concepts',
        portfolio: 'https://cssadewale.pages.dev',
        agency: 'https://hmgconcepts.pages.dev'
    }
};

// Initialize Supabase Client
const supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
