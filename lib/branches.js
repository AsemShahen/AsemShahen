'use strict';
// إدارة فروع الشركة: تعريف الفروع وربط المستودعات والفواتير والقيود بها
const { defaultBranchId } = require('./company-db');

function nextBranchCode(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM branches').get();
  return `BR-${String(row.c + 1).padStart(3, '0')}`;
}

function listBranches(db, { includeInactive = true } = {}) {
  let sql = `SELECT b.*,
      (SELECT COUNT(*) FROM warehouses w WHERE w.branch_id = b.id) AS warehouses_count,
      (SELECT COUNT(*) FROM invoices i WHERE i.branch_id = b.id) AS invoices_count
    FROM branches b`;
  if (!includeInactive) sql += ` WHERE b.is_active = 1`;
  sql += ` ORDER BY b.is_default DESC, b.name`;
  return db.prepare(sql).all();
}

function getBranch(db, id) {
  return db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
}

function createBranch(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم الفرع مطلوب');
  const code = String(data.code || '').trim() || nextBranchCode(db);
  const dup = db.prepare('SELECT id FROM branches WHERE code = ?').get(code);
  if (dup) throw new Error('رمز الفرع موجود مسبقاً');
  const info = db.prepare(`
    INSERT INTO branches (code, name, address, phone, manager, notes, is_default, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, name, data.address || '', data.phone || '', data.manager || '', data.notes || '',
      data.is_default ? 1 : 0, data.is_active === false ? 0 : 1, new Date().toISOString());
  if (data.is_default) db.prepare('UPDATE branches SET is_default = 0 WHERE id <> ?').run(info.lastInsertRowid);
  return getBranch(db, info.lastInsertRowid);
}

function updateBranch(db, id, data) {
  const b = getBranch(db, id);
  if (!b) return null;
  const name = data.name !== undefined ? String(data.name || '').trim() : b.name;
  if (!name) throw new Error('اسم الفرع مطلوب');
  const code = data.code !== undefined ? String(data.code || '').trim() : b.code;
  if (code && code !== b.code) {
    const dup = db.prepare('SELECT id FROM branches WHERE code = ? AND id <> ?').get(code, id);
    if (dup) throw new Error('رمز الفرع موجود مسبقاً');
  }
  db.prepare(`UPDATE branches SET code=?, name=?, address=?, phone=?, manager=?, notes=?, is_active=? WHERE id=?`)
    .run(code || b.code, name,
      data.address !== undefined ? data.address : b.address,
      data.phone !== undefined ? data.phone : b.phone,
      data.manager !== undefined ? data.manager : b.manager,
      data.notes !== undefined ? data.notes : b.notes,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : b.is_active, id);
  if (data.is_default) db.prepare('UPDATE branches SET is_default = 0 WHERE id <> ?').run(id);
  return getBranch(db, id);
}

function deleteBranch(db, id) {
  const b = getBranch(db, id);
  if (!b) return false;
  const total = db.prepare('SELECT COUNT(*) AS c FROM branches').get().c;
  if (total <= 1) throw new Error('لا يمكن حذف الفرع الوحيد');
  if (b.is_default) throw new Error('لا يمكن حذف الفرع الافتراضي؛ عيّن فرعاً آخر كافتراضي أولاً');
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
  resolveBranchId, branchName, defaultBranchId
};
