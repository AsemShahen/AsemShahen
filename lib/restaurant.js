'use strict';
// نظام المطاعم والكفيهات: الوصفات (Recipe / BOM) والتكاليف والتصنيع
// الفكرة: الوجبة النهائية منتج له وصفة تربطه بمنتجات المواد الأولية بكميات محددة.
// عند التصنيع (أو البيع) تُخصم المواد الأولية من المستودع وتُضاف الوجبة الجاهزة برصيدها
// وتُحدَّث تكلفتها (purchase_price) لتصبح أساساً لتكلفة البضاعة المباعة COGS.
const { createJournalEntry } = require('./accounting');
const inventory = require('./inventory');

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function getDefaultAccount(db, code) { return db.prepare('SELECT * FROM accounts WHERE code = ?').get(code); }

// ---------- الوصفات ----------
function getRecipe(db, id) {
  const recipe = db.prepare(`
    SELECT r.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
      p.sale_price, p.purchase_price, p.inventory_account, p.is_active AS product_active
    FROM recipes r JOIN products p ON p.id = r.product_id
    WHERE r.id = ?`).get(id);
  if (!recipe) return null;
  recipe.lines = db.prepare(`
    SELECT rl.*, p.name AS ingredient_name, p.code AS ingredient_code, p.unit AS ingredient_unit,
      p.purchase_price, p.inventory_account
    FROM recipe_lines rl JOIN products p ON p.id = rl.ingredient_product_id
    WHERE rl.recipe_id = ? ORDER BY p.name`).all(id);
  const calc = calcRecipeCost(db, id);
  recipe.ingredient_cost = calc.batchCost;
  recipe.unit_cost = calc.unitCost;
  recipe.lines = calc.lines;
  return recipe;
}

// تكلفة الوصفة: لكل سطر كمية مُعدّلة بالهدر × سعر شراء المادة الأولية
// batchCost = تكلفة دفعة الوصفة كاملة، unitCost = تكلفة الحصة الواحدة + التكاليف الإضافية
function calcRecipeCost(db, recipeId) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
  const rows = db.prepare(`
    SELECT rl.*, p.name AS ingredient_name, p.code AS ingredient_code, p.unit AS ingredient_unit,
      p.purchase_price, p.inventory_account
    FROM recipe_lines rl JOIN products p ON p.id = rl.ingredient_product_id
    WHERE rl.recipe_id = ? ORDER BY p.name`).all(recipeId);
  let batchCost = 0;
  const lines = rows.map(l => {
    const effQty = num(l.qty) * (1 + num(l.wastage_pct) / 100);
    const lineCost = effQty * num(l.purchase_price);
    batchCost += lineCost;
    return { ...l, eff_qty: effQty, line_cost: lineCost, unit_price: num(l.purchase_price), total: lineCost };
  });
  const yieldQty = num(recipe && recipe.yield_qty) > 0 ? num(recipe.yield_qty) : 1;
  const overhead = num(recipe && recipe.overhead_cost);
  const unitCost = batchCost / yieldQty + overhead;
  return { lines, batchCost, yieldQty, overhead, unitCost };
}

function listRecipes(db, { search } = {}) {
  let sql = `SELECT r.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
      p.sale_price, p.is_active AS product_active,
      (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.recipe_id = r.id) AS lines_count
    FROM recipes r JOIN products p ON p.id = r.product_id WHERE 1=1`;
  const params = [];
  if (search) {
    sql += ` AND (p.name LIKE ? OR p.code LIKE ? OR r.name LIKE ?)`;
    const s = `%${String(search).trim()}%`;
    params.push(s, s, s);
  }
  sql += ` ORDER BY p.name`;
  const recipes = db.prepare(sql).all(...params);
  return recipes.map(r => {
    const calc = calcRecipeCost(db, r.id);
    r.ingredient_cost = calc.batchCost;
    r.unit_cost = calc.unitCost;
    return r;
  });
}

function normalizeLines(db, productId, lines) {
  const clean = [];
  const seen = new Set();
  for (const l of (lines || [])) {
    const pid = Number(l.ingredient_product_id);
    if (!pid) continue;
    if (pid === Number(productId)) throw new Error('لا يمكن أن تكون الوجبة مكوّناً لنفسها');
    if (seen.has(pid)) throw new Error('المكوّن مكرر في الوصفة');
    const prod = db.prepare('SELECT id FROM products WHERE id = ?').get(pid);
    if (!prod) throw new Error('أحد المكوّنات غير موجود');
    const qty = num(l.qty);
    if (qty <= 0) throw new Error('كمية المكوّن يجب أن تكون أكبر من صفر');
    seen.add(pid);
    clean.push({ ingredient_product_id: pid, qty, wastage_pct: Math.max(0, num(l.wastage_pct)), notes: l.notes || '' });
  }
  if (!clean.length) throw new Error('الوصفة يجب أن تحتوي على مكوّن واحد على الأقل');
  return clean;
}

function createRecipe(db, data) {
  const productId = Number(data.product_id);
  if (!productId) throw new Error('اختر الوجبة/المنتج النهائي');
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('المنتج النهائي غير موجود');
  const dup = db.prepare('SELECT id FROM recipes WHERE product_id = ?').get(productId);
  if (dup) throw new Error('يوجد وصفة مسجّلة لهذا المنتج مسبقاً');
  const lines = normalizeLines(db, productId, data.lines);
  const yieldQty = num(data.yield_qty) > 0 ? num(data.yield_qty) : 1;
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO recipes (product_id, name, yield_qty, overhead_cost, notes, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(productId, String(data.name || product.name).trim(), yieldQty, num(data.overhead_cost),
        data.notes || '', data.is_active === false ? 0 : 1, new Date().toISOString());
    const rid = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO recipe_lines (recipe_id, ingredient_product_id, qty, wastage_pct, notes) VALUES (?, ?, ?, ?, ?)');
    for (const l of lines) ins.run(rid, l.ingredient_product_id, l.qty, l.wastage_pct, l.notes);
    return rid;
  });
  return getRecipe(db, tx());
}

function updateRecipe(db, id, data) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
  if (!recipe) return null;
  let productId = recipe.product_id;
  if (data.product_id !== undefined && Number(data.product_id) !== Number(recipe.product_id)) {
    productId = Number(data.product_id);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) throw new Error('المنتج النهائي غير موجود');
    const dup = db.prepare('SELECT id FROM recipes WHERE product_id = ? AND id <> ?').get(productId, id);
    if (dup) throw new Error('يوجد وصفة مسجّلة لهذا المنتج مسبقاً');
  }
  const lines = data.lines !== undefined ? normalizeLines(db, productId, data.lines) : null;
  const yieldQty = data.yield_qty !== undefined ? (num(data.yield_qty) > 0 ? num(data.yield_qty) : 1) : recipe.yield_qty;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE recipes SET product_id=?, name=?, yield_qty=?, overhead_cost=?, notes=?, is_active=? WHERE id=?`)
      .run(productId,
        data.name !== undefined ? String(data.name).trim() : recipe.name,
        yieldQty,
        data.overhead_cost !== undefined ? num(data.overhead_cost) : recipe.overhead_cost,
        data.notes !== undefined ? data.notes : recipe.notes,
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : recipe.is_active,
        id);
    if (lines) {
      db.prepare('DELETE FROM recipe_lines WHERE recipe_id = ?').run(id);
      const ins = db.prepare('INSERT INTO recipe_lines (recipe_id, ingredient_product_id, qty, wastage_pct, notes) VALUES (?, ?, ?, ?, ?)');
      for (const l of lines) ins.run(id, l.ingredient_product_id, l.qty, l.wastage_pct, l.notes);
    }
  });
  tx();
  return getRecipe(db, id);
}

function deleteRecipe(db, id) {
  const recipe = db.prepare('SELECT id FROM recipes WHERE id = ?').get(id);
  if (!recipe) return false;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM recipe_lines WHERE recipe_id = ?').run(id);
    db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  });
  tx();
  return true;
}

// ---------- أوامر التصنيع ----------
function nextOrderNo(db, date) {
  const year = String(date).slice(0, 4);
  const row = db.prepare(`SELECT COUNT(*) AS c FROM production_orders WHERE date LIKE ?`).get(year + '%');
  return `PRD-${year}-${String(row.c + 1).padStart(4, '0')}`;
}

function getProductionOrder(db, id) {
  const order = db.prepare(`
    SELECT po.*, p.name AS product_name, p.code AS product_code, w.name AS warehouse_name,
      r.name AS recipe_name, fy.name AS fiscal_year_name
    FROM production_orders po
    JOIN products p ON p.id = po.product_id
    JOIN warehouses w ON w.id = po.warehouse_id
    JOIN recipes r ON r.id = po.recipe_id
    LEFT JOIN fiscal_years fy ON fy.id = po.fiscal_year_id
    WHERE po.id = ?`).get(id);
  if (!order) return null;
  order.lines = db.prepare(`
    SELECT pol.*, p.name AS ingredient_name, p.code AS ingredient_code, p.unit AS ingredient_unit
    FROM production_order_lines pol JOIN products p ON p.id = pol.ingredient_product_id
    WHERE pol.order_id = ? ORDER BY p.name`).all(id);
  return order;
}

function listProductionOrders(db, { productId, limit = 300 } = {}) {
  let sql = `SELECT po.*, p.name AS product_name, p.code AS product_code, w.name AS warehouse_name
    FROM production_orders po
    JOIN products p ON p.id = po.product_id
    JOIN warehouses w ON w.id = po.warehouse_id
    WHERE 1=1`;
  const params = [];
  if (productId) { sql += ` AND po.product_id = ?`; params.push(Number(productId)); }
  sql += ` ORDER BY po.date DESC, po.id DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

// تصنيع كمية من الوجبة: خصم المواد الأولية + إضافة الوجبة الجاهزة + تحديث التكلفة + قيد القيمة
function produce(db, { recipe_id, qty, date, warehouse_id, notes = '', fiscal_year_id, auto = false }) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipe_id);
  if (!recipe) throw new Error('الوصفة غير موجودة');
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(recipe.product_id);
  if (!product) throw new Error('المنتج النهائي غير موجود');
  const batchQty = num(qty) > 0 ? num(qty) : 1;
  const wid = warehouse_id ? Number(warehouse_id) : inventory.defaultWarehouseId(db);
  const calc = calcRecipeCost(db, recipe_id);
  if (!calc.lines.length) throw new Error('الوصفة لا تحتوي على مكوّنات');
  const yieldQty = calc.yieldQty > 0 ? calc.yieldQty : 1;
  const unitCost = calc.batchCost / yieldQty + calc.overhead;
  const totalCost = unitCost * batchQty;

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO production_orders (order_no, recipe_id, product_id, warehouse_id, qty, unit_cost, total_cost,
        date, status, auto, notes, fiscal_year_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`)
      .run(nextOrderNo(db, date), recipe_id, product.id, wid, batchQty, unitCost, totalCost,
        date, auto ? 1 : 0, notes, fiscal_year_id || null, new Date().toISOString());
    const orderId = info.lastInsertRowid;
    const insLine = db.prepare(`INSERT INTO production_order_lines
      (order_id, ingredient_product_id, description, qty, unit_cost, line_cost) VALUES (?, ?, ?, ?, ?, ?)`);
    const credits = {};
    for (const l of calc.lines) {
      const usedQty = (l.eff_qty / yieldQty) * batchQty;
      const lineCost = usedQty * num(l.purchase_price);
      inventory.applyStockMovement(db, {
        productId: l.ingredient_product_id, warehouseId: wid, delta: -usedQty,
        type: 'production', ref_type: 'production', ref_id: orderId, date,
        notes: `تصنيع ${product.name}`
      });
      insLine.run(orderId, l.ingredient_product_id, l.ingredient_name, usedQty, num(l.purchase_price), lineCost);
      const accCode = l.inventory_account || '1301';
      credits[accCode] = (credits[accCode] || 0) + lineCost;
    }
    // إضافة الوجبة الجاهزة وتحديث تكلفتها (أساس COGS)
    inventory.applyStockMovement(db, {
      productId: product.id, warehouseId: wid, delta: batchQty,
      type: 'production', ref_type: 'production', ref_id: orderId, date,
      notes: `إنتاج ${product.name}`
    });
    db.prepare('UPDATE products SET purchase_price = ? WHERE id = ?').run(unitCost, product.id);

    // قيد تحويل قيمة المواد الأولية إلى مخزون الوجبات (يُسجّل عند اختلاف الحسابات)
    const finAccCode = product.inventory_account || '1301';
    const codes = Object.keys(credits);
    const sameAccount = codes.every(c => c === finAccCode);
    if (!sameAccount && totalCost > 0.001) {
      const finAcc = getDefaultAccount(db, finAccCode) || getDefaultAccount(db, '1301');
      const journalLines = [{ account_id: finAcc.id, debit: calc.batchCost * batchQty / yieldQty, vat_amount: 0, vat_type: '', detail: `إنتاج ${product.name}` }];
      for (const [code, amount] of Object.entries(credits)) {
        if (amount < 0.001) continue;
        const acc = getDefaultAccount(db, code) || getDefaultAccount(db, '1301');
        journalLines.push({ account_id: acc.id, credit: amount, vat_amount: 0, vat_type: '', detail: `صرف مواد - ${product.name}` });
      }
      if (journalLines.length >= 2) {
        createJournalEntry(db, {
          date, description: `أمر تصنيع ${product.name}`, ref_type: 'production', ref_id: orderId,
          fiscal_year_id: fiscal_year_id || null, lines: journalLines
        });
      }
    }
    return orderId;
  });
  return getProductionOrder(db, tx());
}

function cancelProductionOrder(db, id) {
  const order = getProductionOrder(db, id);
  if (!order) throw new Error('أمر التصنيع غير موجود');
  if (order.status !== 'completed') throw new Error('لا يمكن إلغاء أمر تصنيع غير مكتمل');
  const tx = db.transaction(() => {
    for (const l of order.lines) {
      inventory.applyStockMovement(db, {
        productId: l.ingredient_product_id, warehouseId: order.warehouse_id, delta: num(l.qty),
        type: 'production', ref_type: 'production_cancel', ref_id: id, date: order.date,
        notes: `إلغاء أمر ${order.order_no}`
      });
    }
    inventory.applyStockMovement(db, {
      productId: order.product_id, warehouseId: order.warehouse_id, delta: -num(order.qty),
      type: 'production', ref_type: 'production_cancel', ref_id: id, date: order.date,
      notes: `إلغاء أمر ${order.order_no}`
    });
    db.prepare("UPDATE production_orders SET status = 'cancelled' WHERE id = ?").run(id);
  });
  tx();
  return getProductionOrder(db, id);
}

// تصنيع تلقائي عند البيع: إن لم تكفِ كمية الوجبة الجاهزة يتم إنتاج النقص من المواد الأولية
function ensureMealStock(db, { productId, warehouseId, qty, date, fiscal_year_id }) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE product_id = ? AND is_active = 1').get(productId);
  if (!recipe) return null;
  const wid = warehouseId || inventory.defaultWarehouseId(db);
  const have = inventory.getStockQty(db, productId, wid);
  const need = num(qty) - have;
  if (need <= 0.001) return null;
  return produce(db, {
    recipe_id: recipe.id, qty: need, date, warehouse_id: wid, fiscal_year_id,
    auto: true, notes: 'تصنيع تلقائي عند البيع'
  });
}

// ---------- ملخص ----------
function summary(db) {
  const recipesCount = db.prepare('SELECT COUNT(*) AS c FROM recipes WHERE is_active = 1').get().c;
  const orders = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(total_cost), 0) AS cost
    FROM production_orders WHERE status = 'completed'`).get();
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(total_cost), 0) AS cost
    FROM production_orders WHERE status = 'completed' AND date = ?`).get(today);
  const lowIngredients = db.prepare(`
    SELECT p.id, p.code, p.name, p.unit, p.min_stock,
      COALESCE((SELECT SUM(qty) FROM product_stock ps WHERE ps.product_id = p.id), 0) AS qty
    FROM products p WHERE p.is_active = 1 AND p.min_stock > 0
      AND COALESCE((SELECT SUM(qty) FROM product_stock ps WHERE ps.product_id = p.id), 0) < p.min_stock
    ORDER BY p.name LIMIT 50`).all();
  return {
    recipes_count: recipesCount,
    orders_count: orders.c,
    orders_cost: orders.cost,
    today_orders: todayOrders.c,
    today_cost: todayOrders.cost,
    low_ingredients: lowIngredients
  };
}

module.exports = {
  getRecipe, listRecipes, createRecipe, updateRecipe, deleteRecipe, calcRecipeCost,
  getProductionOrder, listProductionOrders, produce, cancelProductionOrder, ensureMealStock, summary
};
