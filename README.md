# 🎭 DramaConnect Enterprise v4 - RCCG LP 25 Drama System

DramaConnect v4 is the apex version of the LP 25 Drama Department Management System. It is no longer just a tool—it is a **Institutional Operational Hub**. This version introduces professional-grade casting, budget tracking, and a conversion-driven brand engine designed to showcase the capabilities of AI-augmented development.

---

## 🌟 Enterprise Feature Set

### 1. The Command Center (Enhanced Dashboard)
The dashboard is now a high-level executive summary:
*   **Personnel KPIs:** Real-time headcounts and role distribution.
*   **Treasury Health:** Net balance with an integrated `Chart.js` financial distribution map.
*   **Commitment Metrics:** Average attendance rates across all rehearsal sessions.
*   **System Alerts:** Dynamic notification area for administrative updates.

### 2. Advanced Production & Casting (New!)
Moving beyond just scripts, v4 manages the "Who" and "How":
*   **Cast List Management:** Admins can now assign specific roles to members for each production (e.g., "Member A" as "The Prodigal Son").
*   **Script Repository:** Direct links to cloud-stored scripts.
*   **Production Timeline:** Automatic tracking of the next performance date.

### 3. Financial Engineering & Budgeting (New!)
Enterprise finance involves planning, not just recording:
*   **Budget Allocation:** Admins can set a "Planned Budget" for a specific play and track "Actual Spend" against it.
*   **Ledger Audit:** A full, immutable list of all income and expenditure.
*   **Real-time Balance:** Immediate calculation of current treasury funds.

### 4. Rehearsal & Attendance Intelligence
*   **Session Logging:** Log rehearsal dates and specific goals (e.g., "Act 1 Blocking").
*   **Attendance Checklists:** Fast, checkbox-based marking of members.
*   **Persistence Tracking:** Data is saved per session, allowing for long-term attendance analysis.

### 5. Professional Reporting Center
*   **One-Click Exports:** Generate professional PDFs (via `jsPDF`) or Excel Sheets (via `SheetJS`) for any dataset.
*   **Official Formatting:** Reports are formatted for printing and submission to provincial leadership.
*   **Live Previews:** View the report in the browser before exporting.

### 6. Brand Engine & Lead Generation (The "FaithTech" Layer)
This platform is a living portfolio for **Adewale Samson Adeagbo** and **HMG Concepts**:
*   **Portfolio Integration:** A dedicated "Developer Bio" page within the app that showcases services.
*   **Conversion CTAs:** Strategic "Consult with Me" buttons and links to HMG Concepts throughout the app.
*   **Professional Attribution:** The landing page and footer drive traffic directly to the developer's portfolio.

---

## 🛠️ Technical Architecture

| Component | Technology | Reason |
| :--- | :--- | :--- |
| **Frontend** | HTML5, Tailwind CSS, JS | Zero-cost, high performance, mobile-first. |
| **Backend** | Supabase (Free Tier) | PostgreSQL DB, Auth, and RLS security. |
| **Hosting** | Vercel / GitHub Pages | Free, global CDN, automated deployment. |
| **Reports** | jsPDF / SheetJS | Client-side processing (Zero server cost). |
| **Analysis** | Chart.js | Light-weight, professional data visualization. |

---

## 📋 User Roles & Permissions

| Feature | Member | Admin |
| :--- | :---: | :---: |
| View Dashboard | ✅ | ✅ |
| View Members/Plays | ✅ | ✅ |
| Add/Edit Members | ❌ | ✅ |
| Log Finance | ❌ | ✅ |
| Mark Attendance | ❌ | ✅ |
| Set Budgets | ❌ | ✅ |
| Export Official Reports| ❌ | ✅ |
| Manage Casting | ❌ | ✅ |
