# نظام المحاسب (Al-Muhasib) — Arabic Accounting & Business Management System

> **📖 Available in:** [English](#) | [العربية](README.ar.md)

An integrated Arabic (RTL) accounting and business management system operating in Saudi Riyals (SAR). It supports **multiple companies**, each with its own independent SQLite database that can be closed and carried forward into a new fiscal year.

## Features

- **Multi-Company**: Each company has its own database file (`company_<id>.db`).
- **Activity-Based Chart of Accounts**: Pre-configured charts for corporate, supermarket, factory, medical lab, and hospital businesses.
- **Saudi VAT (15%)**: VAT reports by period, with accounts 1401 (input VAT) and 2103 (output VAT).
- **ZATCA E-Invoicing**: Generates compliant e-invoices for the Saudi ZATCA (TLV QR code + UBL 2.1 XML with SHA-256 hashing and ECDSA P-256 signing), with automatic submission (Report / Clearance) on every sale invoice.
- **Common Payment Methods**: Cash, Mada, Credit Card, Bank Transfer, SADAD, Apple Pay, STC Pay, Check, Credit, and more.
- **Core Accounting**: Journal entries, general ledger, trial balance, income statement, balance sheet, and VAT reports.
- **Invoicing**: Sales & purchase invoices with automatic journal posting, partial payments, and credit collection for customers and suppliers.
- **Fiscal Year Closing**: Automatic closing entry + opening entry, carrying balances into the new fiscal year.
- **Inventory & Warehouses**: Products with barcodes, multi-warehouse stock, stock movements, stock counts with automatic shortage/surplus entries, and a **Point of Sale (POS)** screen with barcode scanning.
- **Human Resources (HR)**: Departments, employees, attendance, leave management (approve/reject), and monthly payroll generation with automatic journal posting (debit 5201 / credit 2104).
- **Hospital Module** (for hospitals): Patients, doctors & departments, appointments, medical records, and patient billing.
- **Per-Company User Permissions**: Users can be granted permissions scoped to specific companies and windows.
- **Bilingual UI**: Arabic (RTL) / English with an in-app language switcher.

## Getting Started

```
npm install
node seed.js
node server.js
```

Then open `http://localhost:3001`.

- Default admin account: **admin / admin123**
- Demo cashier (supermarket only): **cashier / cashier123**

## Usage

1. Create a company (name, activity type, CR number, VAT number, tax rate, fiscal year start month).
2. Review the auto-generated chart of accounts for the selected activity.
3. Record journal entries, invoices, customers, and suppliers.
4. Review reports (trial balance, income statement, balance sheet, VAT report).
5. Manage warehouses, products, stock counts, and sell through the POS.
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
| `lib/hospital.js` | Hospital module |
| `lib/zatca/` | ZATCA e-invoicing (QR + XML + signing + submission) |
| `seed.js` | Demo data for 5 companies |
| `public/` | Web UI (Vue 3 SPA, no build step) |

## UI Overview

All screens support Arabic/English: Dashboard, Chart of Accounts, Journal, Ledger, Trial Balance, Income Statement, Balance Sheet, VAT Report, Sales & Purchase Invoices, Customers & Suppliers, Inventory & Stock, POS, Employees & Departments, Leaves, Payroll, Fiscal Year Closing, Settings, and Users & Permissions.

---

# Hi there, I'm Asem Shahen 👋

An active Software Developer passionate about building useful open-source tools, automation scripts, and solving problems using C# and Python.
🛠️ My Tech Stack & Skills

    Languages: C#, Python, SQL
    Specialties: Automation, Scripting, Desktop Applications, Easy Setup Tools

🌟 Support My Open-Source Work

Since official GitHub Sponsors is restricted in my region, you can back my projects and support my journey through these alternative methods:
🪙 Crypto Support (USDT / Crypto Wallets)

If you find my tools helpful, you can send a tip via Crypto:

    **USDT (Network: TRON): TU68gmFAkWzMuqfPeEw3GWWurPa8CcWjG9
    **Bitcoin : bc1qg2wkx9t6yakskwplds9n8n24mca5ulnaeslznr

✉️ Contact & Freelancing

Looking for a developer for remote work, custom scripts, or automation tools? Let's connect!

    Email: asemshahen5@gmail.com - asem6600@hotmail.com

Thank you for supporting independent developers worldwide! ✨
