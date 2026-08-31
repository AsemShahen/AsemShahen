'use strict';
const Database = require('better-sqlite3');
const { companyDbPath } = require('./master-db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS fiscal_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open | closing | closed
  closed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,             -- asset | liability | equity | revenue | expense
  category TEXT NOT NULL,         -- e.g. current_asset, fixed_asset, ...
  parent_code TEXT,
  is_header INTEGER NOT NULL DEFAULT 0,
  normal_side TEXT NOT NULL DEFAULT 'debit',  -- debit | credit
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  opening_balance REAL NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT 'manual',
  ref_id INTEGER,
  fiscal_year_id INTEGER NOT NULL,
  is_closing INTEGER NOT NULL DEFAULT 0,
  is_opening INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  vat_type TEXT DEFAULT '',
  detail TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,            -- customer | supplier
  name TEXT NOT NULL,
  tax_id TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL,
  kind TEXT NOT NULL,            -- sale | purchase
  party_id INTEGER,
  date TEXT NOT NULL,
  sub_total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 15,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'paid',   -- paid | partial | unpaid
  paid_amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER NOT NULL,
  invoice_uuid TEXT DEFAULT '',
  issue_datetime TEXT DEFAULT '',
  invoice_type TEXT DEFAULT '',          -- simplified | standard
  qr_data TEXT DEFAULT '',
  xml_data TEXT DEFAULT '',
  zatca_hash TEXT DEFAULT '',
  zatca_status TEXT DEFAULT '',          -- not_configured | submitting | submitted | cleared | failed
  zatca_response TEXT DEFAULT '',
  zatca_submitted_at TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_methods (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS hospital_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  specialty TEXT DEFAULT '',
  department_id INTEGER,
  qualification TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  consultation_fee REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  national_id TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  birth_date TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  blood_type TEXT DEFAULT '',
  insurance_company TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER,
  department_id INTEGER,
  date TEXT NOT NULL,
  time TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | checked_in | completed | cancelled | no_show
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_medical_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER,
  appointment_id INTEGER,
  date TEXT NOT NULL,
  symptoms TEXT DEFAULT '',
  diagnosis TEXT DEFAULT '',
  treatment TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  account_code TEXT DEFAULT '',
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  sub_total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 15,
  payer TEXT NOT NULL DEFAULT 'patient',  -- patient | insurance
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'paid',    -- paid | partial | unpaid
  paid_amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_bill_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  service_id INTEGER,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  barcode TEXT DEFAULT '',
  category TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  purchase_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  sale_account TEXT DEFAULT '4101',
  purchase_account TEXT DEFAULT '5101',
  cogs_account TEXT DEFAULT '5104',
  inventory_account TEXT DEFAULT '1301',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_stock (
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  type TEXT NOT NULL,             -- initial | purchase | sale | adjustment | count
  qty REAL NOT NULL,
  ref_type TEXT DEFAULT '',
  ref_id INTEGER,
  date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_no TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | completed | cancelled
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  system_qty REAL NOT NULL DEFAULT 0,
  count_qty REAL NOT NULL DEFAULT 0,
  diff REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS hr_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id INTEGER,
  manager_employee_id INTEGER,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  national_id TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  birth_date TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  department_id INTEGER,
  job_title TEXT DEFAULT '',
  hire_date TEXT NOT NULL,
  basic_salary REAL NOT NULL DEFAULT 0,
  allowances REAL NOT NULL DEFAULT 0,
  bank_account TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',   -- active | terminated
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  days_per_year REAL NOT NULL DEFAULT 0,
  is_paid INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_no TEXT NOT NULL,
  employee_id INTEGER NOT NULL,
  leave_type_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | cancelled
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  month TEXT NOT NULL,                     -- YYYY-MM
  working_days REAL NOT NULL DEFAULT 0,
  present_days REAL NOT NULL DEFAULT 0,
  absent_days REAL NOT NULL DEFAULT 0,
  late_days REAL NOT NULL DEFAULT 0,
  overtime_hours REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS hr_payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,                     -- YYYY-MM
  employee_id INTEGER NOT NULL,
  basic_salary REAL NOT NULL DEFAULT 0,
  allowances REAL NOT NULL DEFAULT 0,
  overtime REAL NOT NULL DEFAULT 0,
  absences REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  net_salary REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',    -- draft | posted
  fiscal_year_id INTEGER NOT NULL,
  journal_entry_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (month, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_je_fy ON journal_entries(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_inv_kind ON invoices(kind);
CREATE INDEX IF NOT EXISTS idx_hb_patient ON hospital_bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_ha_date ON hospital_appointments(date);
CREATE INDEX IF NOT EXISTS idx_hr_patient ON hospital_medical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_sm_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_sm_warehouse ON stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_scl_count ON stock_count_lines(count_id);
CREATE INDEX IF NOT EXISTS idx_prod_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_hr_emp_dept ON hr_employees(department_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_emp ON hr_leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_pay_month ON hr_payroll(month);
CREATE INDEX IF NOT EXISTS idx_hr_att_month ON hr_attendance(month);
`;

const DEFAULT_PAYMENT_METHODS = [
  ['cash', 'نقداً', '💵'],
  ['mada', 'مدى', '💳'],
  ['credit_card', 'بطاقة ائتمانية', '💳'],
  ['bank_transfer', 'تحويل بنكي', '🏦'],
  ['sadad', 'سداد', '🏧'],
  ['apple_pay', 'Apple Pay', '📱'],
  ['stc_pay', 'STC Pay', '📱'],
  ['check', 'شيك', '📄'],
  ['credit', 'آجل / على الحساب', '📋'],
  ['other', 'أخرى', '🧾']
];

const ZATCA_COLUMNS = {
  invoice_uuid: "TEXT DEFAULT ''",
  issue_datetime: "TEXT DEFAULT ''",
  invoice_type: "TEXT DEFAULT ''",
  qr_data: "TEXT DEFAULT ''",
  xml_data: "TEXT DEFAULT ''",
  zatca_hash: "TEXT DEFAULT ''",
  zatca_status: "TEXT DEFAULT ''",
  zatca_response: "TEXT DEFAULT ''",
  zatca_submitted_at: "TEXT DEFAULT ''"
};

const INVOICE_LINE_EXTRA = {
  product_id: 'INTEGER',
  warehouse_id: 'INTEGER',
  cost: 'REAL NOT NULL DEFAULT 0'
};

// حسابات إضافية لدعم المخزون والجرد (تُضاف بشكل آمن لجميع الشركات)
function ensureInventoryExtras(db) {
  const has = (code) => !!db.prepare('SELECT id FROM accounts WHERE code = ?').get(code);
  const insert = db.prepare(`INSERT INTO accounts (code, name, type, category, parent_code, is_header, normal_side, vat_applicable, opening_balance, is_system, sort_order)
    VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 1, 0) ON CONFLICT(code) DO NOTHING`);
  if (!has('5120')) insert.run('5120', 'فرق الجرد (نقص / عجز)', 'expense', 'admin', '5', 'debit');
  if (!has('4121')) insert.run('4121', 'إيرادات فروق الجرد (زيادة)', 'revenue', 'other_income', '4', 'credit');
}

// مستودع افتراضي تلقائياً عند فتح قاعدة بيانات الشركة
function ensureDefaultWarehouse(db) {
  const any = db.prepare('SELECT id FROM warehouses LIMIT 1').get();
  if (!any) {
    db.prepare(`INSERT INTO warehouses (code, name, location, notes, is_default, is_active, created_at)
      VALUES ('WH-001', 'المستودع الرئيسي', '', '', 1, 1, ?)`)
      .run(new Date().toISOString());
  }
}

function openCompanyDb(id) {
  const db = new Database(companyDbPath(id));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  const cols = new Set(db.prepare(`PRAGMA table_info(invoices)`).all().map(c => c.name));
  for (const [name, def] of Object.entries(ZATCA_COLUMNS)) {
    if (!cols.has(name)) db.exec(`ALTER TABLE invoices ADD COLUMN ${name} ${def}`);
  }
  const ilCols = new Set(db.prepare(`PRAGMA table_info(invoice_lines)`).all().map(c => c.name));
  for (const [name, def] of Object.entries(INVOICE_LINE_EXTRA)) {
    if (!ilCols.has(name)) db.exec(`ALTER TABLE invoice_lines ADD COLUMN ${name} ${def}`);
  }
  const pCols = new Set(db.prepare(`PRAGMA table_info(products)`).all().map(c => c.name));
  if (!pCols.has('image')) db.exec(`ALTER TABLE products ADD COLUMN image TEXT DEFAULT ''`);
  const insertPm = db.prepare('INSERT OR IGNORE INTO payment_methods (code, name, icon) VALUES (?, ?, ?)');
  for (const pm of DEFAULT_PAYMENT_METHODS) insertPm.run(...pm);
  ensureInventoryExtras(db);
  ensureDefaultWarehouse(db);
  return db;
}

module.exports = { openCompanyDb, DEFAULT_PAYMENT_METHODS };
