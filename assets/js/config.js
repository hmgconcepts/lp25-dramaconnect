/**
 * Global Configuration
 */
const CONFIG = {
    SUPABASE_URL: 'https://fnhvilfamgadolnrwbpz.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuaHZpbGZhbWdhZG9sbnJ3YnB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTQ3NDcsImV4cCI6MjA5NjQ5MDc0N30.ucTG6EB4FURv4iCTSWPf0bA2g_thXeNXhIP39xABVqs',
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
