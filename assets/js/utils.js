/**
 * ============================================================================
 * Utility & Export Engine
 * Requires (loaded via CDN where needed):
 *   - SheetJS (XLSX)          → Excel export
 *   - jsPDF (UMD)             → PDF export, exposed as window.jspdf.jsPDF
 *   - jspdf-autotable plugin  → table rendering in PDF
 * ============================================================================
 */
const Utils = {
    exportToExcel(data, filename = 'report.xlsx') {
        if (typeof XLSX === 'undefined') { UI.toast('Excel library (SheetJS) not loaded.', 'error'); return; }
        if (!data || !data.length) { UI.toast('There is no data to export.', 'warning'); return; }
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
        XLSX.writeFile(workbook, filename);
        UI.toast('Excel file downloaded.', 'success');
    },

    exportToCSV(data, filename = 'report.csv') {
        if (!data || !data.length) { UI.toast('There is no data to export.', 'warning'); return; }
        const cols = Object.keys(data[0]);
        const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [cols.join(','), ...data.map(r => cols.map(c => escape(r[c])).join(','))];
        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
        UI.toast('CSV file downloaded.', 'success');
    },

    exportToPDF(tableId, filename = 'report.pdf') {
        if (!window.jspdf || !window.jspdf.jsPDF) { UI.toast('PDF library (jsPDF) not loaded.', 'error'); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(16);
        doc.setTextColor(0, 51, 153);
        doc.text('RCCG LP 25 Drama Department', 14, 15);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(filename.replace('.pdf', '') + '  •  Generated ' + new Date().toLocaleString('en-GB'), 14, 22);
        if (typeof doc.autoTable !== 'function') { UI.toast('PDF table plugin not loaded.', 'error'); return; }
        doc.autoTable({
            html: `#${tableId}`,
            startY: 28,
            theme: 'grid',
            headStyles: { fillColor: [0, 51, 153] },
            styles: { fontSize: 9 }
        });
        doc.save(filename);
        UI.toast('PDF file downloaded.', 'success');
    },

    printPage() { window.print(); },

    formatCurrency(amount) {
        return (CONFIG.CURRENCY || '₦') + Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
    },

    formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    formatDateTime(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },

    /** Days from today (negative = past). */
    daysUntil(dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        return Math.round((d - today) / 86400000);
    },

    relativeTime(dateStr) {
        const days = this.daysUntil(dateStr);
        if (days === null) return '';
        if (days === 0) return 'Today';
        if (days === 1) return 'Tomorrow';
        if (days === -1) return 'Yesterday';
        if (days > 1) return `In ${days} days`;
        return `${Math.abs(days)} days ago`;
    },

    initials(name) {
        if (!name) return '?';
        return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    },

    /**
     * Return a normalised URL only when it uses an explicitly allowed protocol.
     * Relative same-origin paths may be enabled for application-owned assets.
     */
    safeUrl(value, protocols = ['https:', 'http:'], allowRelative = false) {
        if (!value) return '';
        const raw = String(value).trim();
        if (allowRelative && /^(?:\.\.?\/|\/)(?!\/)/.test(raw)) return raw;
        try {
            const parsed = new URL(raw, window.location.origin);
            if (!protocols.includes(parsed.protocol)) return '';
            if (!allowRelative && parsed.origin === window.location.origin && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
            return parsed.href;
        } catch (_e) { return ''; }
    },

    safeImageUrl(value, allowRelative = true) {
        return this.safeUrl(value, ['https:', 'http:'], allowRelative);
    },

    /** Accept only a six-digit CSS hex colour. */
    isHexColor(value) {
        return /^#[0-9a-fA-F]{6}$/.test(String(value || '').trim());
    },

    safeColor(value, fallback = '#003399') {
        const color = String(value || '').trim();
        return this.isHexColor(color) ? color : fallback;
    },

    /** Parse supported YouTube URL forms and return a strict 11-char video id. */
    youtubeVideoId(value) {
        const raw = String(value || '').trim();
        if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
        try {
            const u = new URL(raw);
            const host = u.hostname.toLowerCase().replace(/^www\./, '');
            let id = '';
            if (host === 'youtu.be') id = u.pathname.split('/').filter(Boolean)[0] || '';
            else if (host === 'youtube.com' || host === 'm.youtube.com') {
                if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
                else {
                    const parts = u.pathname.split('/').filter(Boolean);
                    if (['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1] || '';
                }
            }
            return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
        } catch (_e) { return ''; }
    },

    /**
     * Render an avatar: only an HTTP(S)/same-origin photo URL is accepted;
     * otherwise render a coloured initials circle.
     */
    avatar(member, size = 40) {
        const safeSize = Math.max(16, Math.min(256, Number(size) || 40));
        const s = safeSize + 'px';
        const name = member && (member.full_name || member.email) || '';
        const imageUrl = member && this.safeImageUrl(member.avatar_url);
        if (imageUrl) {
            return `<img src="${UI.esc(imageUrl)}" alt="${UI.esc(name)}" style="width:${s};height:${s};border-radius:9999px;object-fit:cover;" loading="lazy" referrerpolicy="no-referrer">`;
        }
        const init = this.initials(name);
        const fs = Math.round(safeSize * 0.4) + 'px';
        return `<div style="width:${s};height:${s};border-radius:9999px;background:var(--rccg-blue,#003399);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${fs};">${UI.esc(init)}</div>`;
    },

    /** Minimal CSV parser → array of objects keyed by the header row. */
    parseCSV(text) {
        const rows = [];
        let row = [], field = '', inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQuotes) {
                if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
                else if (c === '"') inQuotes = false;
                else field += c;
            } else {
                if (c === '"') inQuotes = true;
                else if (c === ',') { row.push(field); field = ''; }
                else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
                else if (c === '\r') { /* ignore */ }
                else field += c;
            }
        }
        if (field.length || row.length) { row.push(field); rows.push(row); }
        if (!rows.length) return [];
        const headers = rows[0].map(h => h.trim());
        return rows.slice(1).filter(r => r.some(v => v && v.trim() !== '')).map(r => {
            const o = {};
            headers.forEach((h, idx) => o[h] = (r[idx] || '').trim());
            return o;
        });
    },

    /** Download any JS object/array as a JSON file (for backups). */
    downloadJSON(obj, filename = 'backup.json') {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    },

    /** Read a File object as text (Promise). */
    readFileText(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsText(file);
        });
    },

    /* ----------------------- MESSAGING HELPERS ----------------------- */
    /**
     * Normalise a phone number to international digits for wa.me.
     * Default country code is Nigeria (234). Handles 0XXXXXXXXXX,
     * +234XXXXXXXXXX, 234XXXXXXXXXX, and bare 10-digit numbers.
     */
    normalizePhone(phone, countryCode = '234') {
        if (!phone) return '';
        let p = String(phone).replace(/[^\d+]/g, '');
        if (p.startsWith('+')) return p.slice(1);          // already international
        if (p.startsWith('00')) return p.slice(2);
        if (p.startsWith('0')) return countryCode + p.slice(1); // local -> intl
        if (p.startsWith(countryCode)) return p;
        if (p.length === 10) return countryCode + p;       // bare 10-digit
        return p;
    },

    /** Build a wa.me WhatsApp deep link with a pre-filled message. */
    whatsappLink(phone, text) {
        const num = this.normalizePhone(phone);
        return 'https://wa.me/' + num + (text ? '?text=' + encodeURIComponent(text) : '');
    },

    /** Build a mailto: link. `emails` may be a string or array (used as BCC for groups). */
    mailtoLink(emails, subject, body, useBcc = false) {
        const list = Array.isArray(emails) ? emails.filter(Boolean).join(',') : (emails || '');
        const params = [];
        if (subject) params.push('subject=' + encodeURIComponent(subject));
        if (body) params.push('body=' + encodeURIComponent(body));
        if (useBcc) {
            params.unshift('bcc=' + encodeURIComponent(list));
            return 'mailto:?' + params.join('&');
        }
        return 'mailto:' + encodeURIComponent(list) + (params.length ? '?' + params.join('&') : '');
    },

    /* ----------------------- BIRTHDAY HELPERS ----------------------- */
    monthName(m) {
        const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        return (m >= 1 && m <= 12) ? names[m - 1] : '';
    },
    /** True if the member's birth_month/birth_day match a given date (defaults today). */
    isBirthday(member, date = new Date()) {
        return member && member.birth_month === (date.getMonth() + 1) && member.birth_day === date.getDate();
    },
    /** Today's date as YYYY-MM-DD (local). */
    todayKey(date = new Date()) {
        const p = n => String(n).padStart(2, '0');
        return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
    },
    /** Default birthday message text. */
    birthdayMessage(member) {
        return `Happy Birthday, ${member.full_name || 'dear member'}! 🎉🎂 The entire RCCG LP 25 Drama Department celebrates you today. May this new year of your life overflow with God's grace, joy and favour. We love and appreciate you!`;
    }
};
window.Utils = Utils;
