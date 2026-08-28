'use strict';
// نظام المستودعات والمنتجات والمخزون والجرد ونقاط البيع
const { createJournalEntry } = require('./accounting');

// ---------- أدوات ----------
function getDefaultAccount(db, code) {
  return db.prepare('SELECT * FROM accounts WHERE code = ?').get(code);
}

// ---------- المستودعات ----------
function nextWarehouseNo(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM warehouses').get();
  return `WH-${String(row.c + 1).padStart(3, '0')}`;
}

function listWarehouses(db) {
  return db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM product_stock ps JOIN products p ON p.id = ps.product_id
        WHERE ps.warehouse_id = w.id AND ps.qty <> 0) AS products_count,
      (SELECT COALESCE(SUM(ps.qty), 0) FROM product_stock ps WHERE ps.warehouse_id = w.id) AS total_qty,
      (SELECT COALESCE(SUM(ps.qty * p.purchase_price), 0) FROM product_stock ps
        JOIN products p ON p.id = ps.product_id WHERE ps.warehouse_id = w.id) AS value
    FROM warehouses w ORDER BY w.is_default DESC, w.name`).all();
}

function getWarehouse(db, id) {
  return db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id);
}

function createWarehouse(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم المستودع مطلوب');
  const info = db.prepare(`
    INSERT INTO warehouses (code, name, location, notes, is_default, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(nextWarehouseNo(db), name, data.location || '', data.notes || '',
      data.is_default ? 1 : 0, data.is_active === false ? 0 : 1, new Date().toISOString());
  if (data.is_default) db.prepare('UPDATE warehouses SET is_default = 0 WHERE id <> ?').run(info.lastInsertRowid);
  return getWarehouse(db, info.lastInsertRowid);
}

function updateWarehouse(db, id, data) {
  const w = getWarehouse(db, id);
  if (!w) return null;
  db.prepare(`UPDATE warehouses SET name=?, location=?, notes=?, is_active=? WHERE id=?`)
    .run((data.name || w.name), data.location !== undefined ? data.location : w.location,
      data.notes !== undefined ? data.notes : w.notes,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : w.is_active, id);
  if (data.is_default) db.prepare('UPDATE warehouses SET is_default = 0 WHERE id <> ?').run(id);
  return getWarehouse(db, id);
}

function deleteWarehouse(db, id) {
  const used = db.prepare('SELECT COUNT(*) AS c FROM product_stock WHERE warehouse_id = ? AND qty <> 0').get(id).c;
  const moves = db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE warehouse_id = ?').get(id).c;
  if (used > 0 || moves > 0) throw new Error('لا يمكن حذف مستودع يحتوي على أرصدة أو حركات مخزون');
  db.prepare('DELETE FROM warehouses WHERE id = ?').run(id);
  return true;
}

// ---------- المنتجات ----------
function nextProductNo(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM products').get();
  return `PRD-${String(row.c + 1).padStart(4, '0')}`;
}

function listProducts(db, { search, includeInactive = false } = {}) {
  let sql = `SELECT p.*,
      (SELECT COALESCE(SUM(ps.qty), 0) FROM product_stock ps WHERE ps.product_id = p.id) AS stock_qty
    FROM products p WHERE 1=1`;
  const params = [];
  if (!includeInactive) sql += ` AND p.is_active = 1`;
  if (search) {
    sql += ` AND (p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ?)`;
    const s = `%${String(search).trim()}%`;
    params.push(s, s, s);
  }
  sql += ` ORDER BY p.name`;
  return db.prepare(sql).all(...params);
}

function getProduct(db, id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return null;
  p.stock = db.prepare(`SELECT ps.warehouse_id, w.name AS warehouse_name, ps.qty FROM product_stock ps
    JOIN warehouses w ON w.id = ps.warehouse_id WHERE ps.product_id = ? ORDER BY w.name`).all(id);
  return p;
}

function findByBarcode(db, barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;
  return db.prepare(`SELECT p.*,
    (SELECT COALESCE(SUM(ps.qty), 0) FROM product_stock ps WHERE ps.product_id = p.id) AS stock_qty
    FROM products p WHERE p.barcode = ? LIMIT 1`).get(code);
}

function createProduct(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم المنتج مطلوب');
  const code = String(data.code || '').trim() || nextProductNo(db);
  const dup = db.prepare('SELECT id FROM products WHERE code = ?').get(code);
  if (dup) throw new Error('رمز المنتج موجود مسبقاً');
  const barcode = String(data.barcode || '').trim();
  if (barcode) {
    const bd = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
    if (bd) throw new Error('الباركود مستخدم لمنتج آخر');
  }
  const info = db.prepare(`
    INSERT INTO products (code, name, barcode, category, unit, description, purchase_price, sale_price,
      min_stock, vat_applicable, sale_account, purchase_account, cogs_account, inventory_account, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, name, barcode, data.category || '', data.unit || '', data.description || '',
      Number(data.purchase_price) || 0, Number(data.sale_price) || 0, Number(data.min_stock) || 0,
      data.vat_applicable === false ? 0 : 1,
      data.sale_account || '4101', data.purchase_account || '5101', data.cogs_account || '5104',
      data.inventory_account || '1301', data.is_active === false ? 0 : 1, new Date().toISOString());
  return getProduct(db, info.lastInsertRowid);
}

function updateProduct(db, id, data) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return null;
  const barcode = data.barcode !== undefined ? String(data.barcode || '').trim() : p.barcode;
  if (barcode) {
    const bd = db.prepare('SELECT id FROM products WHERE barcode = ? AND id <> ?').get(barcode, id);
    if (bd) throw new Error('الباركود مستخدم لمنتج آخر');
  }
  db.prepare(`UPDATE products SET name=?, barcode=?, category=?, unit=?, description=?, purchase_price=?,
      sale_price=?, min_stock=?, vat_applicable=?, sale_account=?, purchase_account=?, cogs_account=?,
      inventory_account=?, is_active=? WHERE id=?`)
    .run((data.name || p.name), barcode,
      data.category !== undefined ? data.category : p.category,
      data.unit !== undefined ? data.unit : p.unit,
      data.description !== undefined ? data.description : p.description,
      data.purchase_price !== undefined ? Number(data.purchase_price) : p.purchase_price,
      data.sale_price !== undefined ? Number(data.sale_price) : p.sale_price,
      data.min_stock !== undefined ? Number(data.min_stock) : p.min_stock,
      data.vat_applicable !== undefined ? (data.vat_applicable ? 1 : 0) : p.vat_applicable,
      data.sale_account || p.sale_account, data.purchase_account || p.purchase_account,
      data.cogs_account || p.cogs_account, data.inventory_account || p.inventory_account,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : p.is_active, id);
  return getProduct(db, id);
}

function deleteProduct(db, id) {
  const used = db.prepare('SELECT COUNT(*) AS c FROM invoice_lines WHERE product_id = ?').get(id).c;
  if (used > 0) throw new Error('لا يمكن حذف منتج مستخدم في فواتير');
  const st = db.prepare('SELECT COALESCE(SUM(qty), 0) AS q FROM product_stock WHERE product_id = ?').get(id).q;
  if (Math.abs(st) > 0.001) throw new Error('لا يمكن حذف منتج لديه رصيد مخزون');
  db.prepare('DELETE FROM product_stock WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM stock_movements WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  return true;
}

// ---------- الأرصدة والحركات ----------
function defaultWarehouseId(db) {
  const w = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1').get()
    || db.prepare('SELECT id FROM warehouses ORDER BY id LIMIT 1').get();
  if (!w) throw new Error('لا يوجد مستودع، أنشئ مستودعاً أولاً');
  return w.id;
}

function getStockQty(db, productId, warehouseId) {
  const r = db.prepare('SELECT qty FROM product_stock WHERE product_id = ? AND warehouse_id = ?')
    .get(productId, warehouseId);
  return r ? Number(r.qty) : 0;
}

function setStock(db, productId, warehouseId, qty) {
  db.prepare(`INSERT INTO product_stock (product_id, warehouse_id, qty) VALUES (?, ?, ?)
    ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty`)
    .run(productId, warehouseId, qty);
}

function insertMovement(db, { productId, warehouseId, type, qty, ref_type, ref_id, date, notes }) {
  db.prepare(`INSERT INTO stock_movements (product_id, warehouse_id, type, qty, ref_type, ref_id, date, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(productId, warehouseId, type, qty, ref_type || '', ref_id || null, date, notes || '', new Date().toISOString());
}

// تطبيق حركة مخزون مع فحص الرصيد (delta سالب = صرف / بيع)
function applyStockMovement(db, { productId, warehouseId, delta, type, ref_type = '', ref_id = null, date, notes = '', allowNegative = false }) {
  const wid = warehouseId || defaultWarehouseId(db);
  const cur = getStockQty(db, productId, wid);
  const next = cur + delta;
  if (!allowNegative && next < -0.001) throw new Error('رصيد غير كافٍ للمنتج في المستودع المحدد');
  setStock(db, productId, wid, Math.max(next, 0));
  insertMovement(db, { productId, warehouseId: wid, type, qty: delta, ref_type, ref_id, date, notes });
  return getStockQty(db, productId, wid);
}

function stockBalances(db, { warehouseId, search } = {}) {
  let sql = `SELECT p.id AS product_id, p.code, p.name, p.barcode, p.category, p.unit, p.purchase_price,
      p.sale_price, p.min_stock, p.is_active, p.vat_applicable,
      COALESCE(${warehouseId ? 'ps.qty' : '(SELECT SUM(qty) FROM product_stock WHERE product_id = p.id)'}, 0) AS qty,
      COALESCE(${warehouseId ? 'ps.qty' : '(SELECT SUM(qty) FROM product_stock WHERE product_id = p.id)'}, 0) * p.purchase_price AS value,
      ${warehouseId ? 'w.name AS warehouse' : 'NULL AS warehouse'}
    FROM products p
    ${warehouseId ? `LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = ?
      LEFT JOIN warehouses w ON w.id = ps.warehouse_id` : ''}
    WHERE 1=1`;
  const params = [];
  if (warehouseId) params.push(Number(warehouseId));
  if (search) {
    sql += ` AND (p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ?)`;
    const s = `%${String(search).trim()}%`;
    params.push(s, s, s);
  }
  sql += ` ORDER BY p.name`;
  return db.prepare(sql).all(...params);
}

function stockSummary(db) {
  return {
    products: db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1').get().c,
    warehouses: db.prepare('SELECT COUNT(*) AS c FROM warehouses WHERE is_active = 1').get().c,
    value: db.prepare(`SELECT COALESCE(SUM(ps.qty * p.purchase_price), 0) AS v
      FROM product_stock ps JOIN products p ON p.id = ps.product_id`).get().v,
    low: db.prepare(`SELECT COUNT(*) AS c FROM products p WHERE p.is_active = 1 AND p.min_stock > 0
      AND (SELECT COALESCE(SUM(ps.qty), 0) FROM product_stock ps WHERE ps.product_id = p.id) < p.min_stock`).get().c
  };
}

function listMovements(db, { productId, warehouseId, limit = 300 } = {}) {
  let sql = `SELECT sm.*, p.name AS product_name, p.code AS product_code, w.name AS warehouse_name
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    JOIN warehouses w ON w.id = sm.warehouse_id
    WHERE 1=1`;
  const params = [];
  if (productId) { sql += ` AND sm.product_id = ?`; params.push(Number(productId)); }
  if (warehouseId) { sql += ` AND sm.warehouse_id = ?`; params.push(Number(warehouseId)); }
  sql += ` ORDER BY sm.date DESC, sm.id DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

// ---------- الجرد ----------
function nextCountNo(db, date) {
  const year = String(date).slice(0, 4);
  const row = db.prepare('SELECT COUNT(*) AS c FROM stock_counts WHERE date LIKE ?').get(year + '%');
  return `CT-${year}-${String(row.c + 1).padStart(4, '0')}`;
}

function createCount(db, { warehouse_id, date, notes = '', fiscal_year_id }) {
  const wid = warehouse_id || defaultWarehouseId(db);
  const countNo = nextCountNo(db, date);
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO stock_counts (count_no, warehouse_id, date, status, notes, fiscal_year_id, created_at)
      VALUES (?, ?, ?, 'open', ?, ?, ?)`)
      .run(countNo, wid, date, notes, fiscal_year_id, new Date().toISOString());
    const cid = info.lastInsertRowid;
    const prods = db.prepare(`SELECT p.id, COALESCE(ps.qty, 0) AS qty FROM products p
      LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = ?
      WHERE p.is_active = 1`).all(wid);
    const ins = db.prepare(`INSERT INTO stock_count_lines (count_id, product_id, system_qty, count_qty, diff) VALUES (?, ?, ?, ?, ?)`);
    for (const pr of prods) ins.run(cid, pr.id, pr.qty, pr.qty, 0);
    return cid;
  });
  return getCount(db, tx());
}

function getCount(db, id) {
  const c = db.prepare(`SELECT c.*, w.name AS warehouse_name FROM stock_counts c
    JOIN warehouses w ON w.id = c.warehouse_id WHERE c.id = ?`).get(id);
  if (!c) return null;
  c.lines = db.prepare(`SELECT l.*, p.code, p.name, p.barcode, p.unit, p.purchase_price, p.inventory_account
    FROM stock_count_lines l JOIN products p ON p.id = l.product_id
    WHERE l.count_id = ? ORDER BY p.name`).all(id);
  return c;
}

function listCounts(db, { fiscal_year_id } = {}) {
  let sql = `SELECT c.*, w.name AS warehouse_name FROM stock_counts c
    JOIN warehouses w ON w.id = c.warehouse_id WHERE 1=1`;
  const params = [];
  if (fiscal_year_id) { sql += ` AND c.fiscal_year_id = ?`; params.push(fiscal_year_id); }
  sql += ` ORDER BY c.date DESC, c.id DESC`;
  return db.prepare(sql).all(...params);
}

function updateCountLine(db, countId, lineId, countQty) {
  const line = db.prepare('SELECT * FROM stock_count_lines WHERE id = ? AND count_id = ?').get(lineId, countId);
  if (!line) throw new Error('سطر الجرد غير موجود');
  const c = db.prepare('SELECT status FROM stock_counts WHERE id = ?').get(countId);
  if (c.status !== 'open') throw new Error('لا يمكن تعديل جرد منتهي');
  const q = Number(countQty) || 0;
  db.prepare('UPDATE stock_count_lines SET count_qty = ?, diff = ? WHERE id = ?')
    .run(q, q - Number(line.system_qty), lineId);
  return getCount(db, countId);
}

function finalizeCount(db, countId, fiscal_year_id) {
  const c = getCount(db, countId);
  if (!c) throw new Error('الجرد غير موجود');
  if (c.status !== 'open') throw new Error('الجرد منتهي بالفعل');

  const tx = db.transaction(() => {
    const journalLines = [];
    const shortageTotal = [];
    const surplusTotal = [];
    for (const l of c.lines) {
      const diff = Number(l.diff) || 0;
      if (Math.abs(diff) < 0.001) continue;
      // تحديث الرصيد وتسجيل الحركة
      const cur = getStockQty(db, l.product_id, c.warehouse_id);
      setStock(db, l.product_id, c.warehouse_id, cur + diff);
      insertMovement(db, {
        productId: l.product_id, warehouseId: c.warehouse_id, type: 'count', qty: diff,
        ref_type: 'stock_count', ref_id: countId, date: c.date, notes: `جرد ${c.count_no}`
      });
      const amount = Math.abs(diff) * (Number(l.purchase_price) || 0);
      if (amount < 0.001) continue;
      const invAcc = getDefaultAccount(db, l.inventory_account || '1301') || getDefaultAccount(db, '1301');
      if (diff > 0) {
        journalLines.push({ account_id: invAcc.id, debit: amount, vat_amount: 0, vat_type: '', detail: `زيادة أرصدة الجرد - ${l.name}` });
        surplusTotal.push(amount);
      } else {
        journalLines.push({ account_id: invAcc.id, credit: amount, vat_amount: 0, vat_type: '', detail: `نقص أرصدة الجرد - ${l.name}` });
        shortageTotal.push(amount);
      }
    }
    const shortage = shortageTotal.reduce((s, v) => s + v, 0);
    const surplus = surplusTotal.reduce((s, v) => s + v, 0);
    if (shortage > 0.001) {
      const ac = getDefaultAccount(db, '5120');
      journalLines.push({ account_id: ac.id, debit: shortage, vat_amount: 0, vat_type: '', detail: 'عجز الجرد (نقص)' });
    }
    if (surplus > 0.001) {
      const ac = getDefaultAccount(db, '4121');
      journalLines.push({ account_id: ac.id, credit: surplus, vat_amount: 0, vat_type: '', detail: 'زيادة الجرد' });
    }
    if (journalLines.length >= 2) {
      createJournalEntry(db, {
        date: c.date, description: `جرد بضاعة ${c.count_no}`, ref_type: 'stock_count', ref_id: countId,
        fiscal_year_id, lines: journalLines
      });
    }
    db.prepare("UPDATE stock_counts SET status = 'completed' WHERE id = ?").run(countId);
  });

  tx();
  return getCount(db, countId);
}

function cancelCount(db, countId) {
  const c = db.prepare('SELECT status FROM stock_counts WHERE id = ?').get(countId);
  if (!c) throw new Error('الجرد غير موجود');
  if (c.status !== 'open') throw new Error('لا يمكن إلغاء جرد منتهي');
  db.prepare("UPDATE stock_counts SET status = 'cancelled' WHERE id = ?").run(countId);
  return true;
}

module.exports = {
  listWarehouses, getWarehouse, createWarehouse, updateWarehouse, deleteWarehouse,
  listProducts, getProduct, findByBarcode, createProduct, updateProduct, deleteProduct,
  defaultWarehouseId, getStockQty, setStock, applyStockMovement, stockBalances, stockSummary, listMovements,
  createCount, getCount, listCounts, updateCountLine, finalizeCount, cancelCount
};
