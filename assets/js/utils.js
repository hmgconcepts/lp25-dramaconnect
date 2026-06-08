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
    }
};
window.Utils = Utils;
