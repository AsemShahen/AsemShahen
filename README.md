# نظام المحاسب (Al-Muhasib) — Arabic Accounting & Business Management System

> **📖 Available in:** [English](#) | [العربية](README.ar.md)

An integrated Arabic (RTL) accounting and business management system operating in Saudi Riyals (SAR). It supports **multiple companies**, each with its own independent SQLite database that can be closed and carried forward into a new fiscal year.

## Features

- **Multi-Company**: Each company has its own database file (`company_<id>.db`), and each account belongs to exactly one company. The platform admin (created at install) provisions companies and audits them, while every company is administered independently by its own company admin.
- **Multi-Branch**: Companies can define multiple **branches** (code, name, manager, phone, address, notes) with an optional default branch. Warehouses, users, invoices and journal entries can be linked to a branch, and every report and dashboard can be filtered by branch. Branch management is available to the company admin only, and existing records are automatically assigned to the default branch.
- **Activity-Based Chart of Accounts**: Pre-configured charts for corporate, supermarket, factory, medical lab, hospital, restaurant/cafe, and hotel/serviced-apartment businesses.
- **Saudi VAT (15%)**: VAT reports by period, with accounts 1401 (input VAT) and 2103 (output VAT).
- **ZATCA E-Invoicing**: Generates compliant e-invoices for the Saudi ZATCA (TLV QR code + UBL 2.1 XML with SHA-256 hashing and ECDSA P-256 signing), with automatic submission (Report / Clearance) on every sale invoice.
- **Common Payment Methods**: Cash, Mada, Credit Card, Bank Transfer, SADAD, Apple Pay, STC Pay, Check, Credit, and more.
- **Core Accounting**: Journal entries, general ledger, trial balance, income statement, balance sheet, and VAT reports.
- **Invoicing**: Sales & purchase invoices with automatic journal posting, partial payments, and credit collection for customers and suppliers.
- **Fiscal Year Closing**: Automatic closing entry + opening entry, carrying balances into the new fiscal year.
- **Inventory & Warehouses**: Products with barcodes, multi-warehouse stock, stock movements, stock counts with automatic shortage/surplus entries, and a **Point of Sale (POS)** screen with barcode scanning. For restaurants/cafes the POS lists only manufactured meals (products with a recipe).
- **Human Resources (HR)**: Departments, employees, attendance, leave management (approve/reject), and monthly payroll generation with automatic journal posting (debit 5201 / credit 2104).
- **Hospital Module** (for hospitals): Patients, doctors & departments, appointments, medical records, and patient billing.
- **Restaurants & Cafes — Recipes & Costing** (for restaurants/cafes): define a **recipe (BOM)** for each meal linking the finished product to its raw ingredients with quantities and wastage, get an automatic portion/batch cost and profit margin, and issue **production orders** that consume ingredients from the warehouse, add the finished meal, and update its cost (the basis for cost of goods sold). Meals with insufficient finished stock are **produced automatically at the moment of sale**.
- **Hotel & Serviced-Apartment Module** (for hotels/serviced apartments): define **unit types** (single, double, suite, serviced apartment) with rates and capacity, manage **rooms/units** and their statuses (available, occupied, cleaning, maintenance, out of service), keep a **guest register**, create **bookings** with same-unit overlap prevention, **check guests in and out**, and maintain a **guest folio** with room nights, extra services (laundry, room service, breakfast, transport...), payments, and deposits — posting accommodation revenue, VAT, and guest receivables to the journal automatically at check-out.
- **Manufacturing Module** (for factories/industrial companies): define **bills of materials (BOM)** linking each finished product to its raw materials with quantities, wastage and yield, create **manufacturing orders** (planned quantity, dates, warehouse), **issue materials** from stock, record **direct and indirect manufacturing expenses** (labor, utilities, rent, depreciation, maintenance...), and **complete production** — which automatically posts the cost flows (raw materials → work in progress `1312` → finished goods `1313`), adds the finished quantity to inventory, and updates the product cost. Orders can be **cancelled** with a full reversal of stock movements and journal entries, and dedicated **dashboards and reports** show WIP, cost breakdown, expense analysis by item, and monthly production.
- **Company-Scoped Roles & Permissions**: Three roles — `platform` (provisions companies and audits them read-only), `admin` (full control inside its own company only), and `user` (per-window permissions inside its own company). Permission windows are limited to the company's activity type (e.g. hospital windows only for hospitals, hotel windows only for hotels/serviced apartments, manufacturing windows only for factories, inventory/POS for goods activities, and recipes/production only for restaurants/cafes). No account can ever reach another company's data.
- **Database Management**: From Settings → Databases you can create backups, download and restore them (from the list or by uploading a file), compress (`VACUUM`), and repair the company database (integrity check + rebuild), with an automatic safety backup before any restore.
- **WhatsApp Integration**: Send sales/purchase invoices, POS receipts, and account statements to your customers and suppliers via WhatsApp — with per-company settings and templates. Works out of the box with a `wa.me` link or, when you add your WhatsApp Business Cloud API credentials, sends automatically.
- **Internal Chat**: Instant company-wide communication through a **general channel**, per-department channels and direct private conversations (text messages, voice recordings, images, PDF/Word/Excel and any files, plus live voice and video calls). The full history is permanent and preserved for the whole company; employees cannot delete anything — deleting a message (or purging a channel) is restricted to the company admin only, with every action recorded in the audit log.
- **User Activity Log**: A comprehensive audit trail of every operation users perform — add, edit, delete, search, print, import, and export, plus sign-in and sign-out. Each entry records the date and time, the user and role, the company, the operation type, a readable summary, the IP address, the device/browser name, and the outcome (success/failure). A dedicated screen lets you browse and filter by period, user, operation type, module, and free-text search, with CSV export and print preview. Records are stored centrally in the platform database, so company admins see their company's operations and the platform admin can review all companies. The **IP address and computer name** are shown masked like a password (`••••••••`) and can only be revealed by the company admin or the platform admin via a show/hide toggle.
- **Bilingual UI**: Arabic (RTL) / English with an in-app language switcher.
- **Fully Responsive**: Mobile-first responsive layout — collapsible sidebar drawer with a hamburger menu, stacked cards/forms, horizontally scrollable tables, bottom-sheet modals, and a dedicated two-pane chat experience on phones.

## Getting Started

```
npm install
node seed.js
node server.js
```

Then open `http://localhost:3001`.

Opening the app shows the **public company registry**: a data grid of all companies (name, activity, CR, tax number, fiscal-year start/end, creation date) with action buttons. No sign-in is needed to view the list:

- **Create new company**, **Edit** and **Delete** each open a platform-admin sign-in dialog first; after authentication the corresponding window opens. Creating a company also creates its first admin account; additional admins can be added later from **Users & Permissions** inside the company. Deletion removes the company and its database files permanently.
- **Open** opens a company sign-in dialog; the company's admin or any of its users signs in and enters that company only.

Default accounts:

- Platform admin account (no company): **admin / admin123** — creates companies, assigns their admins, edits company data, and deletes companies.
- Demo company admin (per company): **admin / admin123** — use the **Open** button on the company row, then sign in to manage it.
- Demo cashier (supermarket company only): **cashier / cashier123** — use **Open** on the supermarket row, then sign in.

## Usage

> The **platform admin** manages the company registry (steps 1-2) from the company registry page. Each **company admin** then signs in to its own company to run its business (steps 3-7). A company admin cannot see or manage any other company.

1. Create a company (name, activity type, CR number, VAT number, tax rate, fiscal year start/end dates) and appoint its first admin.
2. Review the auto-generated chart of accounts for the selected activity.
3. Record journal entries, invoices, customers, and suppliers.
4. Review reports (trial balance, income statement, balance sheet, VAT report).
5. Manage warehouses, products, stock counts, and sell through the POS. For restaurants/cafes, define recipes and produce meals; their POS lists only manufactured meals. For factories, define manufacturing BOMs and orders, issue materials, record direct/indirect expenses, and complete production. For hotels/serviced apartments, define unit types and rooms, and register bookings and guests.
6. Manage HR: employees, attendance, leaves, and monthly payroll.
7. At year end: close the fiscal year and start a new one automatically.

## ZATCA (E-Invoicing) Setup

1. Register your organization on the ZATCA portal and obtain your credentials (CSID) — start in **Sandbox** mode for testing.
2. From **Settings → ZATCA E-Invoicing**: enable submission, choose mode (Sandbox/Production), and paste your CSID, private key (PEM), and certificate.
3. On every saved sale invoice, the system automatically generates:
   - A **TLV QR code** (seller name, tax number, timestamp, total, VAT + hash and signature when enabled).
   - An **UBL 2.1 XML** file (simplified B2C or standard B2B invoice).
   - Automatic submission to the ZATCA system (Report for simplified, Clearance for standard invoices above 1,000 SAR).
4. From the sales invoices list you can view e-invoice details (QR + XML + status) and resubmit.

Each invoice stores its submission status (`zatca_status`): `not_configured` / `submitting` / `submitted` / `cleared` / `failed`.

## Project Structure

| File | Description |
|------|-------------|
| `server.js` | Express server (port 3001) + static files |
| `lib/master-db.js` | Company registry `data/app.db` |
| `lib/company-db.js` | Company DB schema + default payment methods |
| `lib/charts.js` | Activity-based chart of accounts |
| `lib/accounting.js` | Accounting operations + fiscal year closing |
| `lib/invoices.js` | Invoicing, collection, auto posting + e-invoice generation |
| `lib/parties.js` | Customers & suppliers |
| `lib/inventory.js` | Warehouses, products, stock, counts, POS |
| `lib/hr.js` | HR: departments, employees, attendance, leaves, payroll |
| `lib/chat.js` | Internal chat: channels, members, messages, files, calls + audit log |
| `public/js/views-chat.js` | Internal chat UI (conversation list, threads, voice recorder, calls) |
| `lib/hospital.js` | Hospital module |
| `lib/restaurant.js` | Restaurant/cafe recipes (BOM), costing, and production orders |
| `public/js/views-restaurant.js` | Restaurant/cafe UI (recipes & production) |
| `lib/hotel.js` | Hotel/serviced-apartment module: unit types, rooms, guests, bookings, guest folio |
| `public/js/views-hotel.js` | Hotel UI (rooms, guests, bookings, services, billing) |
| `lib/manufacturing.js` | Factory manufacturing: bills of materials, orders, direct/indirect expenses, costing & reports |
| `public/js/views-manufacturing.js` | Factory manufacturing UI (dashboard, BOMs, orders, expenses, reports) |
| `lib/db-tools.js` | DB backup / restore / compress / repair |
| `lib/activity.js` | User activity log: capture/classify operations + query records |
| `public/js/views-activity.js` | User activity log UI (filters, export, print preview) |
| `lib/zatca/` | ZATCA e-invoicing (QR + XML + signing + submission) |
| `seed.js` | Demo data for 5 companies |
| `public/` | Web UI (Vue 3 SPA, no build step) |

## UI Overview

All screens support Arabic/English: Dashboard, Chart of Accounts, Journal, Ledger, Trial Balance, Income Statement, Balance Sheet, VAT Report, Sales & Purchase Invoices, Customers & Suppliers, Inventory & Stock, POS, Recipes & Costing, Production, Manufacturing (Dashboard, BOMs, Orders, Expenses, Reports), Employees & Departments, Leaves, Payroll, Hotel (Rooms & Units, Guest Register, Bookings, Services, Guest Accounts & Billing), Hospital, Internal Chat, Branches, Fiscal Year Closing, Settings, Users & Permissions, and the User Activity Log.

## Internal Chat

- **Automatic channels**: a general channel for all employees plus one channel per HR department, created automatically.
- **Direct messaging**: any employee can talk privately to any other employee in the company, with live presence and unread counters.
- **Rich content**: text messages, instant voice recordings, images, and documents (PDF / Word / Excel / any file up to 30 MB) rendered inline in the conversation.
- **Direct calls**: peer-to-peer voice and video calls between employees via WebRTC (no media server; signaling goes through the app). The connection automatically retries with an ICE restart and buffers ICE candidates, and the server exposes a configurable TURN relay for stricter networks (`RTC_TURN_URL`, `RTC_TURN_USERNAME`, `RTC_TURN_CREDENTIAL` or a full list via `RTC_ICE_JSON`).
- **Permanent history**: every message is stored in the company database and is included in backup/restore; employees cannot erase anything.
- **Platform participation**: the platform admin can open any company's chat from the Platform Dashboard and take part in its channels and direct conversations (destructive actions remain restricted to the company admin).
- **Admin oversight**: deleting a single message or purging an entire channel is available only to the company admin, and every deletion is written to the audit log inside the company database.
- **Member management** (admin): assign each employee's department and edit their display name and job title from the conversation list.

## Settings Tabs

- **Company Data**: company name, VAT rate, CR number, tax number, currency, fiscal year start/end dates, address, phone and email.
- **ZATCA E-Invoicing**: enable automatic submission, choose Sandbox/Production mode, and store CSID credentials, private key (PEM), certificate and OTP.
- **Databases** (admin only): create a backup now, download / restore backups (from the list or by uploading a `.db` file), compress the database, and repair it. An automatic safety backup is created before every restore.
- **WhatsApp**: enable WhatsApp sending, set the business number and optional WhatsApp Business Cloud API credentials (Phone Number ID + Access Token), and edit the message templates for sales invoices, purchase invoices, POS receipts and account statements.

---
<img width="1366" height="668" alt="1" src="https://github.com/user-attachments/assets/9e69f47b-b37a-4059-851f-329c5e605a2b" />
<img width="1366" height="668" alt="2" src="https://github.com/user-attachments/assets/115f06c7-96e1-45dc-9b41-5302f2ac2eb5" />

# Hi there, I'm Asem Shahen 👋

An active Software Developer passionate about building useful open-source tools, automation scripts, and solving problems using C# and Python.
🛠️ My Tech Stack & Skills

    Languages: C#, Python, SQL
    Specialties: Automation, Scripting, Desktop Applications, Easy Setup Tools

🌟 Support My Open-Source Work

Since official GitHub Sponsors is restricted in my region, you can back my projects and support my journey through these alternative methods:
🪙 Crypto Support (USDT / Crypto Wallets)

If you find my tools helpful, you can send a tip via Crypto:

    **USDT (Network: TRON): TG22CyzuFEXZiLm8opU9af1Tnxaomsfgbv
    **Bitcoin : 13GNUENaevez1q2nWfoJQzHRH6juWsE7zP

✉️ Contact & Freelancing

Looking for a developer for remote work, custom scripts, or automation tools? Let's connect!

    Email: asemshahen5@gmail.com - asem6600@hotmail.com

Thank you for supporting independent developers worldwide! ✨
