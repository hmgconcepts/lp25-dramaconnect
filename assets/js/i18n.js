/**
 * ============================================================================
 * i18n.js — lightweight multi-language support (English / Yoruba).
 * Free, no API. Translates any element carrying a data-i18n="key" attribute,
 * and provides I18n.t('key') for use in JS. Choice persists in localStorage.
 * Add more languages by extending DICT.
 * ============================================================================
 */
const I18n = {
    lang: localStorage.getItem('dc-lang') || 'en',
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
        }
    },
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
        this.lang = lang;
        localStorage.setItem('dc-lang', lang);
        this.apply();
        document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
    }
};
window.I18n = I18n;
