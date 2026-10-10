'use strict';
// إدارة فروع الشركة: تعريف الفروع وربط المستودعات والفواتير والقيود بها
// يدعم كل فرع نظاماً ضريبياً (سعودي / أردني / سوري / مصري) ونسبة ضريبة وعملة مستقلة.
const { defaultBranchId } = require('./company-db');
const taxLib = require('./tax');

function nextBranchCode(db) {
  const row = db.prepare(`SELECT MAX(CAST(substr(code, 4) AS INTEGER)) AS m FROM branches WHERE code LIKE 'BR-%'`).get();
  const next = (row && row.m ? Number(row.m) : 0) + 1;
  return `BR-${String(next).padStart(3, '0')}`;
}

// اشتقاق نظام الضريبة والعملة والعنوان من الفرع
function enrich(branch, db) {
  if (!branch) return branch;
  const tax = taxLib.branchTax(db, branch.id);
  return {
    ...branch,
    tax_country: tax.country,
    tax_label: tax.label,
    tax_authority: tax.authority,
    einvoice: tax.einvoice,
    tax_rate_effective: tax.rate,
    currency: tax.currency,
    currency_symbol: tax.currencySymbol
  };
}

function listBranches(db, { includeInactive = true } = {}) {
  let sql = `SELECT b.*,
      (SELECT COUNT(*) FROM warehouses w WHERE w.branch_id = b.id) AS warehouses_count,
      (SELECT COUNT(*) FROM invoices i WHERE i.branch_id = b.id) AS invoices_count
    FROM branches b`;
  if (!includeInactive) sql += ` WHERE b.is_active = 1`;
  sql += ` ORDER BY b.is_default DESC, b.name`;
  return db.prepare(sql).all().map(b => enrich(b, db));
}

function getBranch(db, id) {
  const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
  return enrich(b, db);
}

// تجهيز قيم الأعمدة الضريبية عند الإنشاء/التحديث
function taxFields(db, data, base) {
  const prev = base || {};
  const country = data.tax_country !== undefined ? taxLib.normalizeCountry(data.tax_country) : taxLib.normalizeCountry(prev.tax_country);
  const meta = taxLib.countryMeta(country);
  let rate = data.tax_rate !== undefined ? data.tax_rate : prev.tax_rate;
  if (rate === '' || rate === null || rate === undefined) rate = null;
  else {
    rate = Number(rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('نسبة الضريبة يجب أن تكون بين 0 و 100');
  }
  let currency = data.currency !== undefined ? data.currency : prev.currency;
  if (!currency) currency = meta.currency;
  let symbol = data.currency_symbol !== undefined ? data.currency_symbol : prev.currency_symbol;
  if (!symbol) symbol = meta.currencySymbol;
  return {
    country,
    rate,
    currency,
    symbol,
    tax_number: data.tax_number !== undefined ? String(data.tax_number || '') : (prev.tax_number || ''),
    jo_activity: data.jofotara_activity_number !== undefined ? String(data.jofotara_activity_number || '') : (prev.jofotara_activity_number || ''),
    jo_seq: data.jofotara_income_source_sequence !== undefined ? String(data.jofotara_income_source_sequence || '') : (prev.jofotara_income_source_sequence || ''),
    eg_activity: data.egypt_activity_code !== undefined ? String(data.egypt_activity_code || '') : (prev.egypt_activity_code || '')
  };
}

function createBranch(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم الفرع مطلوب');
  const code = String(data.code || '').trim() || nextBranchCode(db);
  const dup = db.prepare('SELECT id FROM branches WHERE code = ?').get(code);
  if (dup) throw new Error('رمز الفرع موجود مسبقاً');
  const t = taxFields(db, data, null);
  const info = db.prepare(`
    INSERT INTO branches (code, name, address, phone, manager, notes,
      tax_country, tax_rate, currency, currency_symbol, tax_number,
      jofotara_activity_number, jofotara_income_source_sequence, egypt_activity_code,
      is_default, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, name, data.address || '', data.phone || '', data.manager || '', data.notes || '',
      t.country, t.rate, t.currency, t.symbol, t.tax_number, t.jo_activity, t.jo_seq, t.eg_activity,
      data.is_default ? 1 : 0, data.is_active === false ? 0 : 1, new Date().toISOString());
  if (data.is_default) db.prepare('UPDATE branches SET is_default = 0 WHERE id <> ?').run(info.lastInsertRowid);
  return getBranch(db, info.lastInsertRowid);
}

function updateBranch(db, id, data) {
  const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
  if (!b) return null;
  const name = data.name !== undefined ? String(data.name || '').trim() : b.name;
  if (!name) throw new Error('اسم الفرع مطلوب');
  const code = data.code !== undefined ? String(data.code || '').trim() : b.code;
  if (code && code !== b.code) {
    const dup = db.prepare('SELECT id FROM branches WHERE code = ? AND id <> ?').get(code, id);
    if (dup) throw new Error('رمز الفرع موجود مسبقاً');
  }
  const t = taxFields(db, data, b);
  db.prepare(`UPDATE branches SET code=?, name=?, address=?, phone=?, manager=?, notes=?,
      tax_country=?, tax_rate=?, currency=?, currency_symbol=?, tax_number=?,
      jofotara_activity_number=?, jofotara_income_source_sequence=?, egypt_activity_code=?, is_active=? WHERE id=?`)
    .run(code || b.code, name,
      data.address !== undefined ? data.address : b.address,
      data.phone !== undefined ? data.phone : b.phone,
      data.manager !== undefined ? data.manager : b.manager,
      data.notes !== undefined ? data.notes : b.notes,
      t.country, t.rate, t.currency, t.symbol, t.tax_number, t.jo_activity, t.jo_seq, t.eg_activity,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : b.is_active, id);
  if (data.is_default) db.prepare('UPDATE branches SET is_default = 0 WHERE id <> ?').run(id);
  return getBranch(db, id);
}

function deleteBranch(db, id) {
  const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
  if (!b) return false;
  const total = db.prepare('SELECT COUNT(*) AS c FROM branches').get().c;
  if (total <= 1) throw new Error('لا يمكن حذف الفرع الوحيد');
  if (b.is_default) throw new Error('لا يمكن حذف الفرع الافتراضي؛ عيّن فرعاً آخر كافتراضياً أولاً');
  const wh = db.prepare('SELECT COUNT(*) AS c FROM warehouses WHERE branch_id = ?').get(id).c;
  const inv = db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE branch_id = ?').get(id).c;
  const je = db.prepare('SELECT COUNT(*) AS c FROM journal_entries WHERE branch_id = ?').get(id).c;
  if (wh || inv || je) throw new Error('لا يمكن حذف فرع مرتبط بمستودعات أو فواتير أو قيود');
  db.prepare('DELETE FROM branches WHERE id = ?').run(id);
  return true;
}

// إعادة الفرع المطلوب إلى فرع صالح، وإلا الفرع الافتراضي
function resolveBranchId(db, requested) {
  const rid = (requested === undefined || requested === null || requested === '') ? null : Number(requested);
  if (rid && db.prepare('SELECT id FROM branches WHERE id = ?').get(rid)) return rid;
  return defaultBranchId(db);
}

function branchName(db, id) {
  if (!id) return '';
  const row = db.prepare('SELECT name FROM branches WHERE id = ?').get(id);
  return row ? row.name : '';
}

module.exports = {
  nextBranchCode, listBranches, getBranch, createBranch, updateBranch, deleteBranch,
  resolveBranchId, branchName, defaultBranchId, enrich
};
