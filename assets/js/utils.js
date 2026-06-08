/**
 * Utility & Export Engine
 */
const Utils = {
    exportToExcel(data, filename = 'report.xlsx') {
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
        XLSX.writeFile(workbook, filename);
    },

    async exportToPDF(tableId, filename = 'report.pdf') {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(18);
        doc.text(`RCCG LP 25 Drama Dept - ${filename.replace('.pdf', '')}`, 14, 15);
        
        doc.autoTable({ 
            html: `#${tableId}`,
            startY: 25,
            theme: 'grid',
            headStyles: { fillColor: [0, 51, 153] }
        });
        
        doc.save(filename);
    },

    formatCurrency(amount) {
        return '₦' + Number(amount).toLocaleString();
    },

    formatDate(dateStr) {
        return new Date(dateStr).toLocaleDateString('en-GB', { 
            day: 'numeric', month: 'short', year: 'numeric' 
        });
    }
};
