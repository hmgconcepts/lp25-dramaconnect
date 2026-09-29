/**
 * ============================================================================
 * i18n.js — lightweight multi-language support (English, Yorùbá, Igbo,
 * Hausa, Nigerian Pidgin and French).
 * Free, no API. Translates any element carrying a data-i18n="key" attribute,
 * and provides I18n.t('key') for use in JS. Choice persists in localStorage.
 * Add more languages by extending DICT.
 * ============================================================================
 */
/**
 * Reading localStorage throws outright when site data is blocked (Safari private
 * browsing, a restricted iframe, or cookies disabled in Chrome). This value is read
 * while the module is still evaluating, so an unguarded throw here would abort
 * i18n.js before I18n exists — and because i18n.js loads before ui.js, auth.js,
 * db.js and utils.js, it would take the entire page down with it.
 */
function readStoredLang() {
    try { return localStorage.getItem('dc-lang'); } catch (_) { return null; }
}

function readOrgDefaultLang() {
    try {
        const cached = JSON.parse(localStorage.getItem('dc-org-settings') || 'null');
        return cached && cached.data && cached.data.default_language || null;
    } catch (_) { return null; }
}

const I18n = {
    // Device choice first; otherwise the organisation default cached by
    // PlatformManagement.orgSettings(); otherwise English.
    lang: readStoredLang() || readOrgDefaultLang() || 'en',
    DICT: {
        en: {
            dashboard: 'Dashboard', my_dashboard: 'My Dashboard', members: 'Members',
            directory: 'Directory', attendance: 'Attendance', events: 'Events',
            finance: 'Finance', inbox: 'Inbox', tasks: 'Tasks', gallery: 'Photo Gallery',
            polls: 'Polls', resources: 'Resources', reports: 'Reports', profile: 'My Profile',
            settings: 'Settings', help: 'Help & FAQ', sign_out: 'Sign Out', sign_in: 'Sign In',
            welcome: 'Welcome', save: 'Save', cancel: 'Cancel', search: 'Search',
            language: 'Language', birthdays: 'Birthdays', suggestions: 'Suggestion Box',
            announcements: 'Announcements', upcoming: 'Upcoming', greeting_morning: 'Good morning',
            greeting_afternoon: 'Good afternoon', greeting_evening: 'Good evening'
        },
        yo: {
            dashboard: 'Pátákó Ìdarí', my_dashboard: 'Pátákó Mi', members: 'Àwọn Ọmọ ẹgbẹ́',
            directory: 'Ìwé Àkọsílẹ̀', attendance: 'Ìwáṣíwá', events: 'Àwọn Ìṣẹ̀lẹ̀',
            finance: 'Ìnáwó', inbox: 'Àpótí Ìfìránṣẹ́', tasks: 'Àwọn Iṣẹ́', gallery: 'Àkójọ Àwòrán',
            polls: 'Ìbò', resources: 'Àwọn Ohun Èlò', reports: 'Àwọn Ìròyìn', profile: 'Àkọsílẹ̀ Mi',
            settings: 'Ètò', help: 'Ìrànlọ́wọ́', sign_out: 'Jáde', sign_in: 'Wọlé',
            welcome: 'Káàbọ̀', save: 'Fipamọ́', cancel: 'Fagilé', search: 'Wá',
            language: 'Èdè', birthdays: 'Ọjọ́ìbí', suggestions: 'Àpótí Àbá',
            announcements: 'Ìkéde', upcoming: 'Tó ń bọ̀', greeting_morning: 'Ẹ káàárọ̀',
            greeting_afternoon: 'Ẹ káàsán', greeting_evening: 'Ẹ kúalẹ́'
        },
        ig: {
            dashboard: 'Dashbọọdụ', my_dashboard: 'Dashbọọdụ M', members: 'Ndị Otu',
            directory: 'Ndepụta Aha', attendance: 'Ọbịbịa', events: 'Mmemme',
            finance: 'Ego', inbox: 'Igbe Ozi', tasks: 'Ọrụ', gallery: 'Foto',
            polls: 'Ntuli Aka', resources: 'Akụrụngwa', reports: 'Akụkọ', profile: 'Profaịlụ M',
            settings: 'Ntọala', help: 'Enyemaka', sign_out: 'Pụọ', sign_in: 'Banye',
            welcome: 'Nnọọ', save: 'Chekwaa', cancel: 'Kagbuo', search: 'Chọọ',
            language: 'Asụsụ', birthdays: 'Ụbọchị Ọmụmụ', suggestions: 'Igbe Aro',
            announcements: 'Ọkwa', upcoming: 'Na-abịa', greeting_morning: 'Ụtụtụ ọma',
            greeting_afternoon: 'Ehihie ọma', greeting_evening: 'Mgbede ọma'
        },
        ha: {
            dashboard: 'Allon Sarrafawa', my_dashboard: 'Allona', members: 'Mambobi',
            directory: 'Jerin Suna', attendance: 'Halarta', events: 'Taruka',
            finance: 'Kuɗi', inbox: 'Akwatin Saƙo', tasks: 'Ayyuka', gallery: 'Hotuna',
            polls: 'Zaɓe', resources: 'Kayan Aiki', reports: 'Rahotanni', profile: 'Bayanai Na',
            settings: 'Saituna', help: 'Taimako', sign_out: 'Fita', sign_in: 'Shiga',
            welcome: 'Barka da zuwa', save: 'Ajiye', cancel: 'Soke', search: 'Nema',
            language: 'Harshe', birthdays: 'Ranar Haihuwa', suggestions: 'Akwatin Shawara',
            announcements: 'Sanarwa', upcoming: 'Masu zuwa', greeting_morning: 'Ina kwana',
            greeting_afternoon: 'Barka da rana', greeting_evening: 'Barka da yamma'
        },
        pcm: {
            dashboard: 'Dashboard', my_dashboard: 'My Dashboard', members: 'Members',
            directory: 'Directory', attendance: 'Who Come', events: 'Programs',
            finance: 'Money Matter', inbox: 'Message Box', tasks: 'Work Wey Dey', gallery: 'Foto Dem',
            polls: 'Vote', resources: 'Materials', reports: 'Report Dem', profile: 'My Profile',
            settings: 'Settings', help: 'Help', sign_out: 'Comot', sign_in: 'Enter',
            welcome: 'You don come', save: 'Keep am', cancel: 'Leave am', search: 'Find',
            language: 'Language', birthdays: 'Birthday Dem', suggestions: 'Suggestion Box',
            announcements: 'Announcement', upcoming: 'Wey dey come', greeting_morning: 'Good morning o',
            greeting_afternoon: 'Good afternoon o', greeting_evening: 'Good evening o'
        },
        fr: {
            dashboard: 'Tableau de bord', my_dashboard: 'Mon tableau de bord', members: 'Membres',
            directory: 'Annuaire', attendance: 'Présences', events: 'Événements',
            finance: 'Finances', inbox: 'Boîte de réception', tasks: 'Tâches', gallery: 'Galerie photo',
            polls: 'Sondages', resources: 'Ressources', reports: 'Rapports', profile: 'Mon profil',
            settings: 'Paramètres', help: 'Aide & FAQ', sign_out: 'Déconnexion', sign_in: 'Connexion',
            welcome: 'Bienvenue', save: 'Enregistrer', cancel: 'Annuler', search: 'Rechercher',
            language: 'Langue', birthdays: 'Anniversaires', suggestions: 'Boîte à idées',
            announcements: 'Annonces', upcoming: 'À venir', greeting_morning: 'Bonjour',
            greeting_afternoon: 'Bon après-midi', greeting_evening: 'Bonsoir'
        }
    },
    /** Language list used by the sidebar and Settings (code, native label). */
    LANGS: [['en', 'English'], ['yo', 'Yorùbá'], ['ig', 'Igbo'], ['ha', 'Hausa'], ['pcm', 'Naijá (Pidgin)'], ['fr', 'Français']],
    t(key) {
        const d = this.DICT[this.lang] || this.DICT.en;
        return d[key] || (this.DICT.en[key] || key);
    },
    apply(root = document) {
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const k = el.getAttribute('data-i18n');
            const txt = this.t(k);
            if (txt) el.textContent = txt;
        });
    },
    set(lang) {
        if (!this.DICT[lang]) lang = 'en';
        this.lang = lang;
        try { document.documentElement.lang = lang === 'pcm' ? 'pcm' : lang; } catch (_) { /* no DOM */ }
        try { localStorage.setItem('dc-lang', lang); } catch (_) { /* storage blocked */ }
        this.apply();
        document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
    }
};
window.I18n = I18n;
