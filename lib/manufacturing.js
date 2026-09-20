'use strict';
// نظام التصنيع للشركات الصناعية (المصانع):
//   قوائم التصنيع BOM -> أوامر تصنيع -> صرف المواد -> مصروفات مباشرة/غير مباشرة -> إتمام الإنتاج.
// التكامل المحاسبي:
//   صرف المواد:      مدين مخزون الإنتاج تحت التشغيل 1312 / دائن مخزون المواد الأولية
//   مصروف مباشر/غير مباشر: مدين 1312 / دائن حساب الدفع
//   إتمام الأمر:     مدين مخزون الإنتاج التام 1313 / دائن 1312
//   عند الإلغاء تُعكس الحركات المخزنية والقيود المرتبطة بالكامل.
const { createJournalEntry } = require('./accounting');
const inventory = require('./inventory');

const WIP_ACCOUNT = '1312';
const FINISHED_ACCOUNT = '1313';
const RAW_FALLBACK = '1311';

// حسابات المصروفات المستخدمة كبنود تكلفة (تُسجَّل في التقرير وتُعرَض للمستخدم)
const COST_ACCOUNTS = {
  direct: {
    material: { code: '5111', name: 'المواد الأولية المباشرة' },
    labor: { code: '5112', name: 'الأجور المباشرة للإنتاج' },
    other: { code: '5110', name: 'مصروفات تصنيع مباشرة أخرى' }
  },
  indirect: {
    labor: { code: '5113', name: 'الأجور غير المباشرة' },
    utilities: { code: '5117', name: 'كهرباء ومياه ووقود المصنع' },
    rent: { code: '5116', name: 'إيجار ومصاريف المصنع' },
    depreciation: { code: '5118', name: 'إهلاك آلات ومعدات الإنتاج' },
    maintenance: { code: '5115', name: 'تشغيل وصيانة الآلات' },
    other: { code: '5119', name: 'مصروفات تصنيع غير مباشرة أخرى' }
  }
};

const EXPENSE_CATEGORIES = [
  { key: 'material', label: 'مواد ومستلزمات مباشرة', type: 'direct' },
  { key: 'labor', label: 'أجور مباشرة', type: 'direct' },
  { key: 'other', label: 'مصروف مباشر آخر', type: 'direct' },
  { key: 'labor_indirect', label: 'أجور غير مباشرة', type: 'indirect' },
  { key: 'utilities', label: 'كهرباء ومياه ووقود', type: 'indirect' },
  { key: 'rent', label: 'إيجار المصنع', type: 'indirect' },
  { key: 'depreciation', label: 'إهلاك الآلات', type: 'indirect' },
  { key: 'maintenance', label: 'تشغيل وصيانة', type: 'indirect' },
  { key: 'other_indirect', label: 'مصروف غير مباشر آخر', type: 'indirect' }
];

// الحسابات الدائنة المتاحة للدفع
const PAYMENT_ACCOUNTS = [
  { code: '1101', name: 'الصندوق / النقدية' },
  { code: '1111', name: 'البنك الرئيسي' },
  { code: '2101', name: 'الموردون (حسابات دائنة)' },
  { code: '2104', name: 'رواتب وأجور مستحقة' },
  { code: '1599', name: 'مجمع الإهلاك' }
];

// تعريفات الحسابات التي يحتاجها نظام التصنيع (لإضافتها للشركات القائمة)
const ACCOUNT_DEFS = [
  { code: '1311', name: 'مخزون المواد الأولية', type: 'asset', category: 'inventory', parent_code: '11', normal_side: 'debit' },
  { code: '1312', name: 'مخزون الإنتاج تحت التشغيل', type: 'asset', category: 'inventory', parent_code: '11', normal_side: 'debit' },
  { code: '1313', name: 'مخزون الإنتاج التام', type: 'asset', category: 'inventory', parent_code: '11', normal_side: 'debit' },
  { code: '5110', name: 'مصروفات تصنيع مباشرة أخرى', type: 'expense', category: 'production', parent_code: '5', normal_side: 'debit' },
  { code: '5111', name: 'المواد الأولية المباشرة', type: 'expense', category: 'production', parent_code: '5', normal_side: 'debit' },
  { code: '5112', name: 'الأجور المباشرة للإنتاج', type: 'expense', category: 'production', parent_code: '5', normal_side: 'debit' },
  { code: '5113', name: 'التكاليف الصناعية غير المباشرة', type: 'expense', category: 'production', parent_code: '5', normal_side: 'debit' },
  { code: '5115', name: 'تشغيل وصيانة الآلات', type: 'expense', category: 'production', parent_code: '5', normal_side: 'debit' },
  { code: '5116', name: 'إيجار ومصاريف المصنع', type: 'expense', category: 'production', parent_code: '5', normal_side: 'debit' },
  { code: '5117', name: 'كهرباء ومياه ووقود المصنع', type: 'expense', category: 'production', parent_code: '5', normal_side: 'debit' },
  { code: '5118', name: 'إهلاك آلات ومعدات الإنتاج', type: 'expense', category: 'production', parent_code: '5', normal_side: 'debit' },
  { code: '5119', name: 'مصروفات تصنيع غير مباشرة أخرى', type: 'expense', category: 'production', parent_code: '5', normal_side: 'debit' }
];

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function today() { return new Date().toISOString().slice(0, 10); }
function getAccount(db, code) { return db.prepare('SELECT * FROM accounts WHERE code = ?').get(code); }

function ensureAccounts(db) {
  const exists = db.prepare('SELECT 1 FROM accounts WHERE code = ?');
  const ins = db.prepare(`INSERT INTO accounts
    (code, name, type, category, parent_code, is_header, normal_side, vat_applicable, opening_balance, is_system, sort_order)
    VALUES (@code, @name, @type, @category, @parent_code, 0, @normal_side, 0, 0, 0, 0)`);
  const tx = db.transaction(() => {
    for (const d of ACCOUNT_DEFS) if (!exists.get(d.code)) ins.run(d);
  });
  tx();
}

function resolveAccount(db, code, fallback) {
  return getAccount(db, code) || getAccount(db, fallback) || null;
}

function costAccountFor(type, category) {
  const map = COST_ACCOUNTS[type] || COST_ACCOUNTS.direct;
  if (map[category]) return map[category];
  return map.other;
}

// ---------- قوائم التصنيع (BOM) ----------
function nextBomCode(db) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM manufacturing_boms`).get();
  return `BOM-${String(row.c + 1).padStart(4, '0')}`;
}

function getBom(db, id) {
  const bom = db.prepare(`SELECT b.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
      w.name AS warehouse_name
    FROM manufacturing_boms b
    LEFT JOIN products p ON p.id = b.product_id
    LEFT JOIN warehouses w ON w.id = b.warehouse_id
    WHERE b.id = ?`).get(id);
  if (!bom) return null;
  bom.lines = db.prepare(`SELECT l.*, p.code, p.name, p.unit, p.purchase_price, p.inventory_account
    FROM manufacturing_bom_lines l
    JOIN products p ON p.id = l.component_product_id
    WHERE l.bom_id = ? ORDER BY l.id`).all(id);
  return bom;
}

function listBoms(db, { search, productId } = {}) {
  let sql = `SELECT b.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
      (SELECT COUNT(*) FROM manufacturing_bom_lines l WHERE l.bom_id = b.id) AS lines_count
    FROM manufacturing_boms b
    LEFT JOIN products p ON p.id = b.product_id
    WHERE 1=1`;
  const params = [];
  if (search) {
    sql += ` AND (b.name LIKE ? OR b.code LIKE ? OR p.name LIKE ? OR p.code LIKE ?)`;
    const s = `%${String(search).trim()}%`;
    params.push(s, s, s, s);
  }
  if (productId) { sql += ` AND b.product_id = ?`; params.push(Number(productId)); }
  sql += ` ORDER BY b.id DESC`;
  return db.prepare(sql).all(...params);
}

function calcBomCost(db, bomId) {
  const bom = db.prepare('SELECT * FROM manufacturing_boms WHERE id = ?').get(bomId);
  if (!bom) return null;
  const yieldQty = num(bom.yield_qty) > 0 ? num(bom.yield_qty) : 1;
  const raw = db.prepare(`SELECT l.*, p.name, p.code, p.unit, p.purchase_price, p.inventory_account
    FROM manufacturing_bom_lines l JOIN products p ON p.id = l.component_product_id
    WHERE l.bom_id = ?`).all(bomId);
  const lines = raw.map(l => {
    const effQty = num(l.qty) * (1 + num(l.wastage_pct) / 100);
    const unitCost = num(l.purchase_price);
    return { ...l, eff_qty: effQty, eff_unit_cost: unitCost, line_cost: effQty * unitCost };
  });
  const batchCost = lines.reduce((s, l) => s + l.line_cost, 0);
  return { bom, yield_qty: yieldQty, lines, batch_cost: batchCost, unit_cost: batchCost / yieldQty };
}

function normalizeBomLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map(l => ({
      component_product_id: Number(l.component_product_id),
      qty: num(l.qty),
      wastage_pct: num(l.wastage_pct),
      notes: l.notes || ''
    }))
    .filter(l => l.component_product_id && l.qty > 0);
}

function createBom(db, data) {
  const productId = Number(data.product_id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('المنتج النهائي غير موجود');
  const lines = normalizeBomLines(data.lines);
  if (!lines.length) throw new Error('أضف مكوّناً واحداً على الأقل للقائمة');
  const code = (data.code || '').trim() || nextBomCode(db);
  if (db.prepare('SELECT 1 FROM manufacturing_boms WHERE code = ?').get(code)) throw new Error('كود القائمة مستخدم مسبقاً');
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO manufacturing_boms
      (code, name, product_id, warehouse_id, yield_qty, version, notes, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, data.name || product.name, productId, data.warehouse_id || null,
        num(data.yield_qty) > 0 ? num(data.yield_qty) : 1, data.version || '1',
        data.notes || '', data.is_active === false ? 0 : 1, new Date().toISOString());
    const bomId = info.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO manufacturing_bom_lines (bom_id, component_product_id, qty, wastage_pct, notes)
      VALUES (?, ?, ?, ?, ?)`);
    for (const l of lines) ins.run(bomId, l.component_product_id, l.qty, l.wastage_pct, l.notes);
    return bomId;
  });
  return getBom(db, tx());
}

function updateBom(db, id, data) {
  const bom = db.prepare('SELECT * FROM manufacturing_boms WHERE id = ?').get(id);
  if (!bom) return null;
  const tx = db.transaction(() => {
    const productId = data.product_id ? Number(data.product_id) : bom.product_id;
    db.prepare(`UPDATE manufacturing_boms SET name = ?, product_id = ?, warehouse_id = ?, yield_qty = ?,
      version = ?, notes = ?, is_active = ? WHERE id = ?`)
      .run(data.name || bom.name, productId,
        data.warehouse_id !== undefined ? (data.warehouse_id || null) : bom.warehouse_id,
        data.yield_qty !== undefined ? (num(data.yield_qty) > 0 ? num(data.yield_qty) : 1) : bom.yield_qty,
        data.version !== undefined ? (data.version || '1') : bom.version,
        data.notes !== undefined ? (data.notes || '') : bom.notes,
        data.is_active === undefined ? bom.is_active : (data.is_active ? 1 : 0), id);
    if (Array.isArray(data.lines)) {
      const lines = normalizeBomLines(data.lines);
      if (!lines.length) throw new Error('أضف مكوّناً واحداً على الأقل للقائمة');
      db.prepare('DELETE FROM manufacturing_bom_lines WHERE bom_id = ?').run(id);
      const ins = db.prepare(`INSERT INTO manufacturing_bom_lines (bom_id, component_product_id, qty, wastage_pct, notes)
        VALUES (?, ?, ?, ?, ?)`);
      for (const l of lines) ins.run(id, l.component_product_id, l.qty, l.wastage_pct, l.notes);
    }
  });
  tx();
  return getBom(db, id);
}

function deleteBom(db, id) {
  const bom = db.prepare('SELECT 1 FROM manufacturing_boms WHERE id = ?').get(id);
  if (!bom) return false;
  const used = db.prepare(`SELECT COUNT(*) AS c FROM manufacturing_orders WHERE bom_id = ? AND status != 'cancelled'`).get(id).c;
  if (used) throw new Error('لا يمكن حذف قائمة مرتبطة بأوامر تصنيع');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM manufacturing_bom_lines WHERE bom_id = ?').run(id);
    db.prepare('DELETE FROM manufacturing_boms WHERE id = ?').run(id);
  });
  tx();
  return true;
}

// ---------- أوامر التصنيع ----------
function nextOrderNo(db, date) {
  const year = String(date || today()).slice(0, 4);
  const row = db.prepare('SELECT COUNT(*) AS c FROM manufacturing_orders WHERE order_no LIKE ?').get(`MO-${year}%`);
  return `MO-${year}-${String(row.c + 1).padStart(4, '0')}`;
}

function getOrder(db, id) {
  const order = db.prepare(`SELECT o.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
      b.code AS bom_code, b.name AS bom_name, w.name AS warehouse_name
    FROM manufacturing_orders o
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN manufacturing_boms b ON b.id = o.bom_id
    LEFT JOIN warehouses w ON w.id = o.warehouse_id
    WHERE o.id = ?`).get(id);
  if (!order) return null;
  order.lines = db.prepare(`SELECT l.*, p.code, p.name, p.unit, p.purchase_price, p.inventory_account
    FROM manufacturing_order_lines l JOIN products p ON p.id = l.component_product_id
    WHERE l.order_id = ? ORDER BY l.id`).all(id);
  order.expenses = db.prepare(`SELECT * FROM manufacturing_expenses WHERE order_id = ? ORDER BY id`).all(id);
  return order;
}

function listOrders(db, { status, productId, search, limit = 300 } = {}) {
  let sql = `SELECT o.*, p.name AS product_name, p.code AS product_code, b.code AS bom_code, w.name AS warehouse_name
    FROM manufacturing_orders o
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN manufacturing_boms b ON b.id = o.bom_id
    LEFT JOIN warehouses w ON w.id = o.warehouse_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND o.status = ?`; params.push(status); }
  if (productId) { sql += ` AND o.product_id = ?`; params.push(Number(productId)); }
  if (search) {
    sql += ` AND (o.order_no LIKE ? OR p.name LIKE ? OR b.code LIKE ?)`;
    const s = `%${String(search).trim()}%`;
    params.push(s, s, s);
  }
  sql += ` ORDER BY o.id DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

// إنشاء أمر تصنيع (مسودة) مع توليد سطور المواد من قائمة BOM
function createOrder(db, { bom_id, planned_qty, warehouse_id, start_date, due_date, notes = '', fiscal_year_id }) {
  const bom = db.prepare('SELECT * FROM manufacturing_boms WHERE id = ?').get(bom_id);
  if (!bom) throw new Error('قائمة التصنيع غير موجودة');
  const calc = calcBomCost(db, bom_id);
  if (!calc.lines.length) throw new Error('قائمة التصنيع لا تحتوي على مكوّنات');
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(bom.product_id);
  if (!product) throw new Error('المنتج النهائي غير موجود');
  const outputQty = num(planned_qty) > 0 ? num(planned_qty) : calc.yield_qty;
  const yieldQty = calc.yield_qty > 0 ? calc.yield_qty : 1;
  const scale = outputQty / yieldQty;
  const wid = warehouse_id ? Number(warehouse_id) : (bom.warehouse_id || inventory.defaultWarehouseId(db));
  const sdate = start_date || today();
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO manufacturing_orders
      (order_no, bom_id, product_id, warehouse_id, planned_qty, produced_qty, status, start_date, due_date,
       date, notes, fiscal_year_id, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 'draft', ?, ?, NULL, ?, ?, ?)`)
      .run(nextOrderNo(db, sdate), bom.id, product.id, wid, outputQty, sdate, due_date || null,
        notes, fiscal_year_id || null, new Date().toISOString());
    const orderId = info.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO manufacturing_order_lines
      (order_id, component_product_id, description, planned_qty, issued_qty, unit_cost, line_cost, issued)
      VALUES (?, ?, ?, ?, 0, ?, 0, 0)`);
    for (const l of calc.lines) {
      ins.run(orderId, l.component_product_id, l.name, l.eff_qty * scale, num(l.purchase_price));
    }
    return orderId;
  });
  return getOrder(db, tx());
}

function updateOrder(db, id, data) {
  const order = db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(id);
  if (!order) return null;
  if (order.status !== 'draft') throw new Error('لا يمكن تعديل أمر بعد بدء صرف المواد');
  const tx = db.transaction(() => {
    if (data.planned_qty !== undefined && num(data.planned_qty) > 0 && num(data.planned_qty) !== num(order.planned_qty)) {
      const lines = db.prepare('SELECT * FROM manufacturing_order_lines WHERE order_id = ?').all(id);
      const scale = num(data.planned_qty) / (num(order.planned_qty) || 1);
      const upd = db.prepare('UPDATE manufacturing_order_lines SET planned_qty = ? WHERE id = ?');
      for (const l of lines) upd.run(num(l.planned_qty) * scale, l.id);
      order.planned_qty = num(data.planned_qty);
    }
    db.prepare(`UPDATE manufacturing_orders SET planned_qty = ?, start_date = ?, due_date = ?, notes = ?,
      warehouse_id = ? WHERE id = ?`)
      .run(order.planned_qty, data.start_date || order.start_date, data.due_date || order.due_date,
        data.notes !== undefined ? (data.notes || '') : order.notes,
        data.warehouse_id ? Number(data.warehouse_id) : order.warehouse_id, id);
  });
  tx();
  return getOrder(db, id);
}

// صرف المواد: يخصم المخزون ويثبت التكلفة في WIP
function issueMaterials(db, orderId, { date, lines, fiscal_year_id } = {}) {
  const order = db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('أمر التصنيع غير موجود');
  if (order.status === 'completed') throw new Error('أمر التصنيع مكتمل');
  if (order.status === 'cancelled') throw new Error('أمر التصنيع ملغي');
  const idate = date || today();
  const orderLines = db.prepare('SELECT * FROM manufacturing_order_lines WHERE order_id = ?').all(orderId);
  const requested = Array.isArray(lines) && lines.length
    ? lines.map(l => ({ id: Number(l.id), qty: num(l.qty) })).filter(l => l.id && l.qty > 0)
    : orderLines.filter(l => num(l.planned_qty) - num(l.issued_qty) > 0.0001)
      .map(l => ({ id: l.id, qty: num(l.planned_qty) - num(l.issued_qty) }));
  if (!requested.length) throw new Error('لا توجد كميات متبقية للصرف');

  const credits = {};
  let total = 0;
  const tx = db.transaction(() => {
    for (const r of requested) {
      const line = orderLines.find(l => l.id === r.id);
      if (!line) continue;
      const remaining = num(line.planned_qty) - num(line.issued_qty);
      const qty = Math.min(r.qty, remaining);
      if (qty <= 0.0001) continue;
      inventory.applyStockMovement(db, {
        productId: line.component_product_id, warehouseId: order.warehouse_id, delta: -qty,
        type: 'manufacturing', ref_type: 'manufacturing_issue', ref_id: orderId, date: idate,
        notes: `صرف مواد لأمر ${order.order_no}`
      });
      const unitCost = num(line.unit_cost) || num(db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(line.component_product_id)?.purchase_price);
      const lineCost = qty * unitCost;
      total += lineCost;
      const comp = db.prepare('SELECT inventory_account FROM products WHERE id = ?').get(line.component_product_id);
      const accCode = (comp && comp.inventory_account) || RAW_FALLBACK;
      credits[accCode] = (credits[accCode] || 0) + lineCost;
      db.prepare('UPDATE manufacturing_order_lines SET issued_qty = issued_qty + ?, line_cost = line_cost + ?, issued = 1 WHERE id = ?')
        .run(qty, lineCost, line.id);
    }
  });
  tx();

  if (total > 0.001) {
    const wip = resolveAccount(db, WIP_ACCOUNT, '1301');
    const jlines = [{ account_id: wip.id, debit: total, vat_amount: 0, vat_type: '', detail: `صرف مواد أمر ${order.order_no}` }];
    for (const [code, amount] of Object.entries(credits)) {
      if (amount < 0.001) continue;
      const acc = resolveAccount(db, code, '1301');
      jlines.push({ account_id: acc.id, credit: amount, vat_amount: 0, vat_type: '', detail: `صرف مواد أمر ${order.order_no}` });
    }
    createJournalEntry(db, {
      date: idate, description: `صرف مواد لأمر تصنيع ${order.order_no}`, ref_type: 'manufacturing_issue',
      ref_id: orderId, fiscal_year_id: fiscal_year_id || order.fiscal_year_id || null, lines: jlines
    });
  }

  db.prepare(`UPDATE manufacturing_orders SET status = 'in_progress' WHERE id = ? AND status = 'draft'`).run(orderId);
  recalcOrderCosts(db, orderId);
  return getOrder(db, orderId);
}

// إضافة مصروف مباشر أو غير مباشر مرتبط بأمر التصنيع
function addExpense(db, orderId, { type = 'direct', category = 'other', description = '', amount, date, payment_account = '1101', notes = '', fiscal_year_id }) {
  const order = db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('أمر التصنيع غير موجود');
  if (order.status === 'completed') throw new Error('أمر التصنيع مكتمل');
  if (order.status === 'cancelled') throw new Error('أمر التصنيع ملغي');
  const amt = num(amount);
  if (amt <= 0) throw new Error('قيمة المصروف يجب أن تكون أكبر من صفر');
  const etype = type === 'indirect' ? 'indirect' : 'direct';
  const edate = date || today();
  const costAcc = costAccountFor(etype, category);
  const payAcc = resolveAccount(db, payment_account, '1101');
  if (!payAcc) throw new Error('حساب الدفع غير موجود');
  const wip = resolveAccount(db, WIP_ACCOUNT, '1301');

  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO manufacturing_expenses
      (order_id, type, category, description, amount, date, payment_account, cost_account, journal_entry_id, notes, fiscal_year_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`)
      .run(orderId, etype, category, description || costAcc.name, amt, edate, payAcc.code, costAcc.code, notes, fiscal_year_id || order.fiscal_year_id || null, new Date().toISOString());
    const expenseId = info.lastInsertRowid;
    const entry = createJournalEntry(db, {
      date: edate,
      description: `مصروف ${etype === 'direct' ? 'مباشر' : 'غير مباشر'} - ${description || costAcc.name} (${order.order_no})`,
      ref_type: 'manufacturing_expense', ref_id: expenseId,
      fiscal_year_id: fiscal_year_id || order.fiscal_year_id || null,
      lines: [
        { account_id: wip.id, debit: amt, vat_amount: 0, vat_type: '', detail: costAcc.name },
        { account_id: payAcc.id, credit: amt, vat_amount: 0, vat_type: '', detail: costAcc.name }
      ]
    });
    db.prepare('UPDATE manufacturing_expenses SET journal_entry_id = ? WHERE id = ?').run(entry.id, expenseId);
    db.prepare(`UPDATE manufacturing_orders SET status = 'in_progress' WHERE id = ? AND status = 'draft'`).run(orderId);
    recalcOrderCosts(db, orderId);
    return expenseId;
  });
  const expenseId = tx();
  return db.prepare('SELECT * FROM manufacturing_expenses WHERE id = ?').get(expenseId);
}

function deleteExpense(db, expenseId) {
  const exp = db.prepare('SELECT * FROM manufacturing_expenses WHERE id = ?').get(expenseId);
  if (!exp) return false;
  const order = db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(exp.order_id);
  if (order && order.status === 'completed') throw new Error('لا يمكن حذف مصروف أمر مكتمل');
  if (exp.journal_entry_id) reverseEntry(db, exp.journal_entry_id);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM manufacturing_expenses WHERE id = ?').run(expenseId);
    if (order) recalcOrderCosts(db, order.id);
  });
  tx();
  return true;
}

function listExpenses(db, { orderId, type, from, to, limit = 500 } = {}) {
  let sql = `SELECT e.*, o.order_no, o.product_id, p.name AS product_name
    FROM manufacturing_expenses e
    LEFT JOIN manufacturing_orders o ON o.id = e.order_id
    LEFT JOIN products p ON p.id = o.product_id
    WHERE 1=1`;
  const params = [];
  if (orderId) { sql += ` AND e.order_id = ?`; params.push(Number(orderId)); }
  if (type) { sql += ` AND e.type = ?`; params.push(type === 'indirect' ? 'indirect' : 'direct'); }
  if (from) { sql += ` AND e.date >= ?`; params.push(from); }
  if (to) { sql += ` AND e.date <= ?`; params.push(to); }
  sql += ` ORDER BY e.date DESC, e.id DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function recalcOrderCosts(db, orderId) {
  const material = db.prepare('SELECT COALESCE(SUM(line_cost), 0) AS v FROM manufacturing_order_lines WHERE order_id = ?').get(orderId).v;
  const direct = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM manufacturing_expenses WHERE order_id = ? AND type = 'direct'`).get(orderId).v;
  const indirect = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM manufacturing_expenses WHERE order_id = ? AND type = 'indirect'`).get(orderId).v;
  const total = num(material) + num(direct) + num(indirect);
  const order = db.prepare('SELECT produced_qty FROM manufacturing_orders WHERE id = ?').get(orderId);
  const produced = order ? num(order.produced_qty) : 0;
  const unit = produced > 0 ? total / produced : 0;
  db.prepare(`UPDATE manufacturing_orders SET material_cost = ?, direct_cost = ?, indirect_cost = ?,
    total_cost = ?, unit_cost = ? WHERE id = ?`)
    .run(material, direct, indirect, total, unit, orderId);
  return { material: num(material), direct: num(direct), indirect: num(indirect), total, unit };
}

// إتمام أمر التصنيع: صرف المتبقي + نقل التكلفة إلى الإنتاج التام + إضافة المخزون
function completeOrder(db, orderId, { date, produced_qty, fiscal_year_id } = {}) {
  const order = db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('أمر التصنيع غير موجود');
  if (order.status === 'completed') throw new Error('أمر التصنيع مكتمل مسبقاً');
  if (order.status === 'cancelled') throw new Error('أمر التصنيع ملغي');
  const cdate = date || today();
  const outputQty = num(produced_qty) > 0 ? num(produced_qty) : num(order.planned_qty);
  if (outputQty <= 0) throw new Error('كمية الإنتاج يجب أن تكون أكبر من صفر');
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(order.product_id);

  // صرف أي مواد متبقية تلقائياً
  const remaining = db.prepare(`SELECT COUNT(*) AS c FROM manufacturing_order_lines
    WHERE order_id = ? AND planned_qty - issued_qty > 0.0001`).get(orderId).c;
  if (remaining) issueMaterials(db, orderId, { date: cdate, fiscal_year_id: fiscal_year_id || order.fiscal_year_id });

  const costs = recalcOrderCosts(db, orderId);
  const total = costs.total;

  const tx = db.transaction(() => {
    inventory.applyStockMovement(db, {
      productId: order.product_id, warehouseId: order.warehouse_id, delta: outputQty,
      type: 'manufacturing', ref_type: 'manufacturing_complete', ref_id: orderId, date: cdate,
      notes: `إنتاج تام لأمر ${order.order_no}`
    });
    if (product && total > 0.001) {
      const unit = total / outputQty;
      db.prepare('UPDATE products SET purchase_price = ? WHERE id = ?').run(unit, product.id);
    }
    if (total > 0.001) {
      const finAccCode = (product && product.inventory_account) || FINISHED_ACCOUNT;
      const fin = resolveAccount(db, finAccCode, FINISHED_ACCOUNT);
      const wip = resolveAccount(db, WIP_ACCOUNT, '1301');
      createJournalEntry(db, {
        date: cdate, description: `إتمام أمر تصنيع ${order.order_no} - ${product ? product.name : ''}`,
        ref_type: 'manufacturing_complete', ref_id: orderId,
        fiscal_year_id: fiscal_year_id || order.fiscal_year_id || null,
        lines: [
          { account_id: fin.id, debit: total, vat_amount: 0, vat_type: '', detail: `إنتاج تام ${order.order_no}` },
          { account_id: wip.id, credit: total, vat_amount: 0, vat_type: '', detail: `تكلفة الإنتاج التام ${order.order_no}` }
        ]
      });
    }
    db.prepare(`UPDATE manufacturing_orders SET status = 'completed', produced_qty = ?, date = ?,
      material_cost = ?, direct_cost = ?, indirect_cost = ?, total_cost = ?, unit_cost = ?, completed_at = ?
      WHERE id = ?`)
      .run(outputQty, cdate, costs.material, costs.direct, costs.indirect, total, total / outputQty, new Date().toISOString(), orderId);
  });
  tx();
  return getOrder(db, orderId);
}

// عكس قيد محاسبي (بإنشاء قيد معاكس وتأشير الأصل كملغى)
function reverseEntry(db, entryId) {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  if (!entry) return;
  if (String(entry.ref_type).endsWith('_void')) return;
  const lines = db.prepare('SELECT * FROM journal_lines WHERE entry_id = ?').all(entryId);
  const rev = lines
    .filter(l => num(l.debit) > 0 || num(l.credit) > 0)
    .map(l => ({ account_id: l.account_id, debit: num(l.credit), credit: num(l.debit), vat_amount: 0, vat_type: '', detail: 'عكس: ' + (l.detail || '') }));
  if (rev.length >= 2) {
    createJournalEntry(db, {
      date: entry.date, description: `إلغاء ${entry.description}`, ref_type: 'manufacturing_reversal',
      ref_id: entry.ref_id, fiscal_year_id: entry.fiscal_year_id, lines: rev
    });
  }
  db.prepare(`UPDATE journal_entries SET ref_type = ref_type || '_void' WHERE id = ?`).run(entryId);
}

function reverseEntriesByRef(db, refType, refId) {
  const entries = db.prepare('SELECT id FROM journal_entries WHERE ref_type = ? AND ref_id = ?').all(refType, refId);
  for (const e of entries) reverseEntry(db, e.id);
}

// إلغاء أمر تصنيع: استرجاع المخزون وعكس كل القيود المرتبطة (مواد/مصروفات/إتمام)
function cancelOrder(db, orderId) {
  const order = getOrder(db, orderId);
  if (!order) throw new Error('أمر التصنيع غير موجود');
  if (order.status === 'cancelled') throw new Error('أمر التصنيع ملغي مسبقاً');
  const cdate = today();
  const tx = db.transaction(() => {
    // استرجاع المواد المصروفة
    for (const l of order.lines) {
      if (num(l.issued_qty) > 0.0001) {
        inventory.applyStockMovement(db, {
          productId: l.component_product_id, warehouseId: order.warehouse_id, delta: num(l.issued_qty),
          type: 'manufacturing', ref_type: 'manufacturing_cancel', ref_id: orderId, date: cdate,
          notes: `إلغاء أمر ${order.order_no}`
        });
      }
    }
    // إزالة الإنتاج التام إن كان الأمر مكتملاً
    if (order.status === 'completed' && num(order.produced_qty) > 0.0001) {
      inventory.applyStockMovement(db, {
        productId: order.product_id, warehouseId: order.warehouse_id, delta: -num(order.produced_qty),
        type: 'manufacturing', ref_type: 'manufacturing_cancel', ref_id: orderId, date: cdate,
        notes: `إلغاء إنتاج أمر ${order.order_no}`
      });
    }
    // عكس القيود: الإتمام ثم المصروفات ثم صرف المواد
    reverseEntriesByRef(db, 'manufacturing_complete', orderId);
    for (const exp of order.expenses) reverseEntriesByRef(db, 'manufacturing_expense', exp.id);
    reverseEntriesByRef(db, 'manufacturing_issue', orderId);
    db.prepare(`UPDATE manufacturing_orders SET status = 'cancelled' WHERE id = ?`).run(orderId);
  });
  tx();
  return getOrder(db, orderId);
}

// ---------- ملخص ولوحة المعلومات ----------
function summary(db) {
  const boms = db.prepare('SELECT COUNT(*) AS c FROM manufacturing_boms WHERE is_active = 1').get().c;
  const byStatus = {};
  for (const r of db.prepare('SELECT status, COUNT(*) AS c FROM manufacturing_orders GROUP BY status').all()) byStatus[r.status] = r.c;
  const completed = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(total_cost), 0) AS cost,
      COALESCE(SUM(produced_qty), 0) AS qty
    FROM manufacturing_orders WHERE status = 'completed'`).get();
  const wip = db.prepare(`SELECT COALESCE(SUM(total_cost), 0) AS v FROM manufacturing_orders
    WHERE status = 'in_progress'`).get().v;
  const expenses = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type = 'direct' THEN amount ELSE 0 END), 0) AS direct,
      COALESCE(SUM(CASE WHEN type = 'indirect' THEN amount ELSE 0 END), 0) AS indirect
    FROM manufacturing_expenses`).get();
  const lowMaterials = db.prepare(`
    SELECT p.id, p.code, p.name, p.unit, p.min_stock,
      COALESCE((SELECT SUM(qty) FROM product_stock ps WHERE ps.product_id = p.id), 0) AS qty
    FROM products p WHERE p.is_active = 1 AND p.min_stock > 0
      AND COALESCE((SELECT SUM(qty) FROM product_stock ps WHERE ps.product_id = p.id), 0) < p.min_stock
    ORDER BY p.name LIMIT 50`).all();
  const recent = listOrders(db, { limit: 8 });
  const topProducts = db.prepare(`SELECT p.name, COUNT(*) AS orders, COALESCE(SUM(o.total_cost), 0) AS cost
    FROM manufacturing_orders o JOIN products p ON p.id = o.product_id
    WHERE o.status = 'completed' GROUP BY o.product_id ORDER BY cost DESC LIMIT 6`).all();
  return {
    boms_count: boms,
    orders_by_status: byStatus,
    completed_orders: completed.c,
    completed_cost: completed.cost,
    completed_qty: completed.qty,
    wip_cost: wip,
    direct_cost: expenses.direct,
    indirect_cost: expenses.indirect,
    low_materials: lowMaterials,
    recent_orders: recent,
    top_products: topProducts
  };
}

// تقارير التصنيع: تحليل التكلفة والانحراف للمخطط مقابل الفعلي
function reports(db, { from, to, productId } = {}) {
  let where = `WHERE o.status = 'completed'`;
  const params = [];
  if (from) { where += ` AND o.date >= ?`; params.push(from); }
  if (to) { where += ` AND o.date <= ?`; params.push(to); }
  if (productId) { where += ` AND o.product_id = ?`; params.push(Number(productId)); }
  const orders = db.prepare(`SELECT o.*, p.name AS product_name, p.code AS product_code, b.code AS bom_code
    FROM manufacturing_orders o
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN manufacturing_boms b ON b.id = o.bom_id
    ${where} ORDER BY o.date DESC, o.id DESC`).all(...params);
  const totals = orders.reduce((s, o) => {
    s.material += num(o.material_cost);
    s.direct += num(o.direct_cost);
    s.indirect += num(o.indirect_cost);
    s.total += num(o.total_cost);
    s.qty += num(o.produced_qty);
    return s;
  }, { material: 0, direct: 0, indirect: 0, total: 0, qty: 0 });
  // ملخص المصروفات حسب البند
  let ew = 'WHERE 1=1';
  const ep = [];
  if (from) { ew += ' AND e.date >= ?'; ep.push(from); }
  if (to) { ew += ' AND e.date <= ?'; ep.push(to); }
  const byCategory = db.prepare(`SELECT e.type, e.cost_account, e.category, COUNT(*) AS cnt, COALESCE(SUM(e.amount), 0) AS amount
    FROM manufacturing_expenses e ${ew} GROUP BY e.type, e.cost_account, e.category ORDER BY amount DESC`).all(...ep);
  const byType = db.prepare(`SELECT e.type, COALESCE(SUM(e.amount), 0) AS amount, COUNT(*) AS cnt
    FROM manufacturing_expenses e ${ew} GROUP BY e.type`).all(...ep);
  const monthlies = db.prepare(`SELECT substr(o.date, 1, 7) AS month, COUNT(*) AS orders,
      COALESCE(SUM(o.produced_qty), 0) AS qty, COALESCE(SUM(o.total_cost), 0) AS cost
    FROM manufacturing_orders o ${where} GROUP BY substr(o.date, 1, 7) ORDER BY month DESC LIMIT 12`).all(...params);
  return { totals, orders, by_category: byCategory, by_type: byType, monthly: monthlies };
}

module.exports = {
  ensureAccounts, costAccountFor, EXPENSE_CATEGORIES, PAYMENT_ACCOUNTS, COST_ACCOUNTS,
  calcBomCost, getBom, listBoms, createBom, updateBom, deleteBom,
  getOrder, listOrders, createOrder, updateOrder,
  issueMaterials, addExpense, deleteExpense, listExpenses,
  completeOrder, cancelOrder, recalcOrderCosts, summary, reports
};
