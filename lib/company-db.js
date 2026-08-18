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

CREATE INDEX IF NOT EXISTS idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_je_fy ON journal_entries(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_inv_kind ON invoices(kind);
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

function openCompanyDb(id) {
  const db = new Database(companyDbPath(id));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  const cols = new Set(db.prepare(`PRAGMA table_info(invoices)`).all().map(c => c.name));
  for (const [name, def] of Object.entries(ZATCA_COLUMNS)) {
    if (!cols.has(name)) db.exec(`ALTER TABLE invoices ADD COLUMN ${name} ${def}`);
  }
  const insertPm = db.prepare('INSERT OR IGNORE INTO payment_methods (code, name, icon) VALUES (?, ?, ?)');
  for (const pm of DEFAULT_PAYMENT_METHODS) insertPm.run(...pm);
  return db;
}

module.exports = { openCompanyDb, DEFAULT_PAYMENT_METHODS };
