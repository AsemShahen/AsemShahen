'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MASTER_PATH = path.join(DATA_DIR, 'app.db');
const masterDb = new Database(MASTER_PATH);
masterDb.pragma('journal_mode = WAL');
masterDb.pragma('foreign_keys = ON');

masterDb.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  business_type TEXT NOT NULL DEFAULT 'corporate',
  cr_number TEXT DEFAULT '',
  vat_number TEXT DEFAULT '',
  vat_rate REAL NOT NULL DEFAULT 15,
  currency TEXT NOT NULL DEFAULT 'SAR',
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

const BUSINESS_TYPES = ['corporate', 'supermarket', 'factory', 'medical_lab'];

function listCompanies() {
  return masterDb.prepare('SELECT * FROM companies ORDER BY id').all();
}

function getCompany(id) {
  return masterDb.prepare('SELECT * FROM companies WHERE id = ?').get(id);
}

function createCompany(data) {
  const now = new Date().toISOString();

  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم الشركة مطلوب');
  const dup = masterDb.prepare('SELECT id FROM companies WHERE name = ?').get(name);
  if (dup) throw new Error('توجد شركة بهذا الاسم مسبقاً');

  let vatRate = 15;
  if (data.vat_rate !== undefined && data.vat_rate !== '' && data.vat_rate !== null) {
    vatRate = Number(data.vat_rate);
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) throw new Error('نسبة ضريبة القيمة المضافة يجب أن تكون بين 0 و 100');
  }

  let fyStartMonth = 1;
  if (data.fiscal_year_start_month !== undefined && data.fiscal_year_start_month !== '' && data.fiscal_year_start_month !== null) {
    fyStartMonth = Number(data.fiscal_year_start_month);
    if (!Number.isFinite(fyStartMonth) || fyStartMonth < 1 || fyStartMonth > 12) throw new Error('شهر بداية السنة المالية يجب أن يكون بين 1 و 12');
  }

  const company = {
    name,
    business_type: BUSINESS_TYPES.includes(data.business_type) ? data.business_type : 'corporate',
    cr_number: data.cr_number || '',
    vat_number: data.vat_number || '',
    vat_rate: vatRate,
    currency: data.currency || 'SAR',
    fiscal_year_start_month: fyStartMonth,
    address: data.address || '',
    phone: data.phone || '',
    email: data.email || ''
  };
  const info = masterDb.prepare(`
    INSERT INTO companies (name, business_type, cr_number, vat_number, vat_rate, currency,
      fiscal_year_start_month, address, phone, email, created_at, updated_at)
    VALUES (@name, @business_type, @cr_number, @vat_number, @vat_rate, @currency,
      @fiscal_year_start_month, @address, @phone, @email, @created_at, @updated_at)
  `).run({ ...company, created_at: now, updated_at: now });
  return getCompany(info.lastInsertRowid);
}

function updateCompany(id, data) {
  const existing = getCompany(id);
  if (!existing) return null;
  const updates = {
    name: data.name || existing.name,
    business_type: BUSINESS_TYPES.includes(data.business_type) ? data.business_type : existing.business_type,
    cr_number: data.cr_number !== undefined ? data.cr_number : existing.cr_number,
    vat_number: data.vat_number !== undefined ? data.vat_number : existing.vat_number,
    vat_rate: data.vat_rate !== undefined ? Number(data.vat_rate) : existing.vat_rate,
    currency: data.currency || existing.currency,
    fiscal_year_start_month: data.fiscal_year_start_month !== undefined ? Number(data.fiscal_year_start_month) : existing.fiscal_year_start_month,
    address: data.address !== undefined ? data.address : existing.address,
    phone: data.phone !== undefined ? data.phone : existing.phone,
    email: data.email !== undefined ? data.email : existing.email,
    updated_at: new Date().toISOString()
  };
  masterDb.prepare(`
    UPDATE companies SET name=@name, business_type=@business_type, cr_number=@cr_number,
      vat_number=@vat_number, vat_rate=@vat_rate, currency=@currency,
      fiscal_year_start_month=@fiscal_year_start_month, address=@address,
      phone=@phone, email=@email, updated_at=@updated_at WHERE id=@id
  `).run({ ...updates, id });
  return getCompany(id);
}

function companyDbPath(id) {
  return path.join(DATA_DIR, `company_${id}.db`);
}

function deleteCompany(id) {
  masterDb.prepare('DELETE FROM companies WHERE id = ?').run(id);
  const p = companyDbPath(id);
  for (const suffix of ['', '-wal', '-shm']) {
    const f = p + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

module.exports = { masterDb, listCompanies, getCompany, createCompany, updateCompany, deleteCompany, companyDbPath, BUSINESS_TYPES };
