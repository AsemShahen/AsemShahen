'use strict';
const { createJournalEntry } = require('./accounting');
const zatca = require('./zatca');
const jofotara = require('./jofotara');
const egypt = require('./egypt');
const inventory = require('./inventory');
const restaurant = require('./restaurant');
const branches = require('./branches');
const taxLib = require('./tax');
const currencyLib = require('./currency');

function nextInvoiceNo(db, kind, date) {
  const year = String(date).slice(0, 4);
  const prefix = kind === 'sale' ? 'INV' : 'PUR';
  const row = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE kind = ? AND date LIKE ?`).get(kind, year + '%');
  return `${prefix}-${year}-${String(row.c + 1).padStart(4, '0')}`;
}

function getVatAccount(db, type) {
  const code = type === 'input' ? '1401' : '2103';
  return db.prepare(`SELECT * FROM accounts WHERE code = ?`).get(code);
}

function getDefaultAccount(db, code) {
  return db.prepare(`SELECT * FROM accounts WHERE code = ?`).get(code);
}

// إنشاء فاتورة مبيعات/مشتريات وتوليد القيد المحاسبي تلقائياً
// company: بيانات الشركة البائعة (لتوليد الفاتورة الإلكترونية ZATCA) — اختياري
// lines: كل سطر قد يتضمن product_id (يُخصم/يُضاف المخزون) و warehouse_id
async function createInvoice(db, { kind, party_id, date, lines, discount = 0, vat_rate, payment_method = 'cash', paid_amount, due_date, notes, fiscal_year_id, company, warehouse_id, branch_id, tax_country, currency, exchange_rate }) {
  if (!lines || !lines.length) throw new Error('الفاتورة يجب أن تحتوي على سطر واحد على الأقل');

  const bid = branches.resolveBranchId(db, branch_id);
  const btax = taxLib.branchTax(db, bid);
  const country = tax_country ? taxLib.normalizeCountry(tax_country) : btax.country;
  const curr = String(currency || btax.currency || currencyLib.getBaseCurrency(db)).toUpperCase();
  const baseCurr = currencyLib.getBaseCurrency(db);
  // سعر الصرف إلى العملة الأساسية: base = doc × rate
  let xrate = 1;
  if (curr !== baseCurr) {
    xrate = (exchange_rate !== undefined && exchange_rate !== null && exchange_rate !== '') ? Number(exchange_rate) : currencyLib.getRate(db, curr);
    if (!Number.isFinite(xrate) || xrate <= 0) xrate = 1;
  }
  const taxLabel = taxLib.countryMeta(country).label;
  // أولوية النسبة: نسبة صريحة للفاتورة ثم نسبة الفرع ثم إعداد الشركة ثم الافتراضي حسب الدولة
  const settingsVat = db.prepare(`SELECT value FROM settings WHERE key='vat_rate'`).get();
  const companyCountry = taxLib.normalizeCountry(company && company.tax_country);
  let vatRate;
  if (vat_rate !== undefined && vat_rate !== null && vat_rate !== '') vatRate = Number(vat_rate);
  else if (btax.branch && btax.branch.tax_rate !== null && btax.branch.tax_rate !== undefined && btax.branch.tax_rate !== '') vatRate = Number(btax.branch.tax_rate);
  else if (country === companyCountry && settingsVat && settingsVat.value !== '' && settingsVat.value !== null) vatRate = Number(settingsVat.value);
  else vatRate = taxLib.defaultRate(country);
  const wid = warehouse_id || inventory.defaultWarehouseId(db);
  let subTotal = 0, totalLineVat = 0;
  const cleanLines = lines.map(l => {
    let product = null;
    if (l.product_id) product = db.prepare('SELECT * FROM products WHERE id = ?').get(l.product_id);
    const qty = Number(l.qty) || 1;
    const unitPrice = (l.unit_price !== undefined && l.unit_price !== null && l.unit_price !== '')
      ? Number(l.unit_price)
      : (product ? (kind === 'sale' ? Number(product.sale_price) : Number(product.purchase_price)) : 0);
    const lineDiscount = Number(l.discount) || 0;
    const lineTotal = qty * unitPrice - lineDiscount;
    const lineVatRate = (product && !product.vat_applicable) ? 0 : vatRate;
    subTotal += lineTotal;
    totalLineVat += lineTotal * lineVatRate / 100;
    return {
      product_id: product ? product.id : null,
      warehouse_id: (l.warehouse_id && Number(l.warehouse_id)) || wid,
      description: l.description || (product ? product.name : ''),
      qty, unit_price: unitPrice, discount: lineDiscount, vat_rate: lineVatRate, line_total: lineTotal,
      cost: product ? (Number(product.purchase_price) || 0) : 0,
      sale_account: product ? (product.sale_account || '4101') : '4101',
      purchase_account: product ? (product.purchase_account || '5101') : '5101',
      cogs_account: product ? (product.cogs_account || '5104') : '5104',
      inventory_account: product ? (product.inventory_account || '1301') : '1301'
    };
  });

  const totalDiscount = Number(discount) || 0;
  const taxable = subTotal - totalDiscount;
  const vat = subTotal > 0 ? totalLineVat * taxable / subTotal : 0;
  const total = taxable + vat;

  const paid = paid_amount !== undefined ? Number(paid_amount) : (payment_method === 'credit' ? 0 : total);
  const status = total <= paid + 0.01 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');

  // المبالغ المعادلة بالعملة الأساسية
  const baseSubTotal = subTotal * xrate;
  const baseVat = vat * xrate;
  const baseTotal = total * xrate;
  const basePaid = paid * xrate;

  const invoiceNo = nextInvoiceNo(db, kind, date);

  const tx = db.transaction(() => {
    // تصنيع تلقائي للوجبات التي لها وصفة قبل البيع (خصم المواد الأولية وتحديث التكلفة)
    if (kind === 'sale') {
      for (const l of cleanLines) {
        if (!l.product_id) continue;
        restaurant.ensureMealStock(db, {
          productId: l.product_id, warehouseId: l.warehouse_id, qty: l.qty, date, fiscal_year_id
        });
        const p = db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(l.product_id);
        if (p) l.cost = Number(p.purchase_price) || 0;
      }
    }

    const info = db.prepare(`
      INSERT INTO invoices (invoice_no, kind, party_id, date, sub_total, discount, vat, total, vat_rate,
        payment_method, status, paid_amount, due_date, notes, fiscal_year_id, branch_id, tax_country, currency,
        exchange_rate, base_sub_total, base_vat, base_total, base_paid_amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceNo, kind, party_id, date, subTotal, totalDiscount, vat, total, vatRate,
      payment_method, status, paid, due_date || null, notes || '', fiscal_year_id, bid, country, curr,
      xrate, baseSubTotal, baseVat, baseTotal, basePaid, new Date().toISOString());

    const invoiceId = info.lastInsertRowid;
    const insertLine = db.prepare(`
      INSERT INTO invoice_lines (invoice_id, product_id, warehouse_id, description, qty, unit_price, discount, vat_rate, line_total, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of cleanLines) {
      insertLine.run(invoiceId, l.product_id, l.warehouse_id, l.description, l.qty, l.unit_price, l.discount, l.vat_rate, l.line_total, l.cost);
    }

    // تحديث حركات المخزون
    for (const l of cleanLines) {
      if (!l.product_id) continue;
      if (kind === 'sale') {
        inventory.applyStockMovement(db, {
          productId: l.product_id, warehouseId: l.warehouse_id, delta: -l.qty,
          type: 'sale', ref_type: 'sale', ref_id: invoiceId, date, notes: invoiceNo
        });
      } else {
        inventory.applyStockMovement(db, {
          productId: l.product_id, warehouseId: l.warehouse_id, delta: l.qty,
          type: 'purchase', ref_type: 'purchase', ref_id: invoiceId, date, notes: invoiceNo
        });
      }
    }

    postInvoiceJournal(db, { invoiceId, kind, party_id, date, lines: cleanLines, subTotal, discount: totalDiscount, vat, total, vatRate, taxLabel, payment_method, paid, status, fiscal_year_id, branch_id: bid, currency: curr, exchange_rate: xrate, baseCurrency: baseCurr });
    return invoiceId;
  });

  const id = tx();
  let inv = getInvoice(db, id);
  if (kind === 'sale' && company) {
    const provider = taxLib.countryMeta(country).einvoice;
    if (provider === 'jofotara') inv = await jofotara.applyJoFotara(db, inv, company);
    else if (provider === 'egypt') inv = await egypt.applyEgypt(db, inv, company);
    else if (provider === 'zatca') inv = await zatca.applyZatca(db, inv, company);
  }
  return inv;
}

function postInvoiceJournal(db, { invoiceId, kind, party_id, date, lines, subTotal, discount, vat, total, vatRate, taxLabel, payment_method, paid, status, fiscal_year_id, branch_id, currency, exchange_rate, baseCurrency }) {
  const cashAcct = getDefaultAccount(db, '1101');
  const bankAcct = getDefaultAccount(db, '1111');
  const vatOutputAcct = getVatAccount(db, 'output');
  const vatInputAcct = getVatAccount(db, 'input');
  const lineSum = lines.reduce((s, l) => s + l.line_total, 0) || 1;
  // ترحيل المبالغ بالعملة الأساسية: الإيراد والضريبة والمدفوعات تُحوَّل بسعر الصرف،
  // أما تكلفة البضاعة والمخزون فمُسجّلة أصلاً بالعملة الأساسية.
  const rate = Number(exchange_rate) || 1;
  const bVat = vat * rate;
  const bTotal = total * rate;
  const bPaid = paid * rate;

  if (kind === 'sale') {
    const netRevenue = (subTotal - discount) * rate;
    const journalLines = [];

    // توزيع الإيراد على حسابات الإيرادات (حساب خاص للمنتج إن وُجد)
    const revenueMap = {};
    for (const l of lines) {
      const acc = getDefaultAccount(db, l.sale_account) || getDefaultAccount(db, '4101');
      revenueMap[acc.id] = (revenueMap[acc.id] || 0) + netRevenue * l.line_total / lineSum;
    }
    for (const [accId, amount] of Object.entries(revenueMap)) {
      if (Math.abs(amount) > 0.001) journalLines.push({ account_id: Number(accId), credit: amount, vat_amount: 0, vat_type: '', detail: 'قيمة الفاتورة قبل الضريبة' });
    }
    if (bVat > 0.01) journalLines.push({ account_id: vatOutputAcct.id, credit: bVat, vat_amount: bVat, vat_type: 'output', detail: `${taxLabel || 'ضريبة القيمة المضافة'} ${vatRate}%` });

    // تكلفة البضاعة المباعة وتخفيض المخزون (للمنتجات) — بالعملة الأساسية
    const cogsMap = {};
    const invMap = {};
    for (const l of lines) {
      if (!l.product_id) continue;
      const amount = l.qty * l.cost;
      if (amount <= 0.001) continue;
      const cogsAcc = getDefaultAccount(db, l.cogs_account) || getDefaultAccount(db, '5104');
      const invAcc = getDefaultAccount(db, l.inventory_account) || getDefaultAccount(db, '1301');
      cogsMap[cogsAcc.id] = (cogsMap[cogsAcc.id] || 0) + amount;
      invMap[invAcc.id] = (invMap[invAcc.id] || 0) + amount;
    }
    for (const [accId, amount] of Object.entries(cogsMap)) if (amount > 0.001) journalLines.push({ account_id: Number(accId), debit: amount, vat_amount: 0, vat_type: '', detail: 'تكلفة البضاعة المباعة' });
    for (const [accId, amount] of Object.entries(invMap)) if (amount > 0.001) journalLines.push({ account_id: Number(accId), credit: amount, vat_amount: 0, vat_type: '', detail: 'تخفيض المخزون' });

    // الجهة المدينة حسب طريقة الدفع
    if (payment_method === 'credit' || status === 'unpaid' || (status === 'partial' && bPaid < bTotal)) {
      const recvAcct = getDefaultAccount(db, '1201');
      journalLines.push({ account_id: recvAcct.id, debit: bTotal - bPaid, detail: 'رصيد مستحق من العميل' });
      if (bPaid > 0) {
        if (payment_method === 'bank_transfer' || payment_method === 'sadad') journalLines.push({ account_id: bankAcct.id, debit: bPaid, detail: `دفعة مستلمة - ${payment_method}` });
        else journalLines.push({ account_id: cashAcct.id, debit: bPaid, detail: `دفعة مستلمة - ${payment_method}` });
      }
    } else {
      if (payment_method === 'bank_transfer' || payment_method === 'sadad') journalLines.push({ account_id: bankAcct.id, debit: bTotal, detail: `تحصيل - ${payment_method}` });
      else if (payment_method === 'credit_card' || payment_method === 'mada' || payment_method === 'apple_pay' || payment_method === 'stc_pay') {
        journalLines.push({ account_id: bankAcct.id, debit: bTotal, detail: `مدفوعات إلكترونية - ${payment_method}` });
      } else {
        journalLines.push({ account_id: cashAcct.id, debit: bTotal, detail: 'دفع نقدي' });
      }
    }

    createJournalEntry(db, {
      date, description: `فاتورة مبيعات ${invoiceId} - إيراد المبيعات`, ref_type: 'sale', ref_id: invoiceId,
      fiscal_year_id, branch_id, lines: journalLines, currency, exchange_rate, amounts_in_base: true
    });
  } else {
    // شراء
    const netPurchase = (subTotal - discount) * rate;
    const journalLines = [];

    // توزيع على المخزون (للمنتجات) أو المشتريات (للخدمات)
    const inventoryMap = {};
    const purchaseMap = {};
    for (const l of lines) {
      const accCode = l.product_id ? l.inventory_account : l.purchase_account;
      const acc = getDefaultAccount(db, accCode) || getDefaultAccount(db, '5101');
      const amount = netPurchase * l.line_total / lineSum;
      if (l.product_id) inventoryMap[acc.id] = (inventoryMap[acc.id] || 0) + amount;
      else purchaseMap[acc.id] = (purchaseMap[acc.id] || 0) + amount;
    }
    for (const [accId, amount] of Object.entries(inventoryMap)) if (amount > 0.001) journalLines.push({ account_id: Number(accId), debit: amount, vat_amount: 0, vat_type: '', detail: 'زيادة المخزون' });
    for (const [accId, amount] of Object.entries(purchaseMap)) if (amount > 0.001) journalLines.push({ account_id: Number(accId), debit: amount, vat_amount: 0, vat_type: '', detail: 'قيمة الفاتورة قبل الضريبة' });
    if (bVat > 0.01) journalLines.push({ account_id: vatInputAcct.id, debit: bVat, vat_amount: bVat, vat_type: 'input', detail: `${taxLabel || 'ضريبة القيمة المضافة'} ${vatRate}%` });

    if (payment_method === 'credit' || status === 'unpaid' || (status === 'partial' && bPaid < bTotal)) {
      const payableAcct = getDefaultAccount(db, '2101');
      journalLines.push({ account_id: payableAcct.id, credit: bTotal - bPaid, detail: 'رصيد مستحق للمورد' });
      if (bPaid > 0) {
        if (payment_method === 'bank_transfer' || payment_method === 'sadad') journalLines.push({ account_id: bankAcct.id, credit: bPaid, detail: `دفعة للمورد - ${payment_method}` });
        else journalLines.push({ account_id: cashAcct.id, credit: bPaid, detail: `دفعة للمورد - ${payment_method}` });
      }
    } else {
      if (payment_method === 'bank_transfer' || payment_method === 'sadad') journalLines.push({ account_id: bankAcct.id, credit: bTotal, detail: `دفع للمورد - ${payment_method}` });
      else journalLines.push({ account_id: cashAcct.id, credit: bTotal, detail: 'دفع نقدي للمورد' });
    }

    createJournalEntry(db, {
      date, description: `فاتورة مشتريات ${invoiceId} - شراء بضاعة`, ref_type: 'purchase', ref_id: invoiceId,
      fiscal_year_id, branch_id, lines: journalLines, currency, exchange_rate, amounts_in_base: true
    });
  }
}

function getInvoice(db, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) return null;
  inv.lines = db.prepare(`SELECT l.*, p.name AS product_name, p.barcode AS product_barcode, w.name AS warehouse_name
    FROM invoice_lines l
    LEFT JOIN products p ON p.id = l.product_id
    LEFT JOIN warehouses w ON w.id = l.warehouse_id
    WHERE l.invoice_id = ? ORDER BY l.id`).all(id);
  if (inv.party_id) inv.party = db.prepare('SELECT id, name, tax_id FROM parties WHERE id = ?').get(inv.party_id);
  return inv;
}

function listInvoices(db, { kind, fiscal_year_id, branch_id, limit = 500 } = {}) {
  let sql = `SELECT * FROM invoices WHERE 1=1`;
  const params = [];
  if (kind) { sql += ` AND kind = ?`; params.push(kind); }
  if (fiscal_year_id) { sql += ` AND fiscal_year_id = ?`; params.push(fiscal_year_id); }
  if (branch_id) { sql += ` AND branch_id = ?`; params.push(Number(branch_id)); }
  sql += ` ORDER BY date DESC, id DESC LIMIT ?`;
  params.push(limit);
  const invs = db.prepare(sql).all(...params);
  return invs.map(i => {
    if (i.party_id) i.party = db.prepare('SELECT id, name, tax_id, phone FROM parties WHERE id = ?').get(i.party_id);
    return i;
  });
}

// تسجيل دفعة مستلمة / مدفوعة على فاتورة آجلة
function recordPayment(db, { invoiceId, amount, date, method, fiscal_year_id }) {
  const inv = getInvoice(db, invoiceId);
  if (!inv) throw new Error('الفاتورة غير موجودة');
  const paid = Number(amount) || 0;
  if (paid <= 0) throw new Error('مبلغ الدفعة يجب أن يكون أكبر من صفر');
  const remaining = inv.total - inv.paid_amount;
  if (paid > remaining + 0.01) throw new Error('مبلغ الدفعة أكبر من الرصيد المتبقي');
  const rate = Number(inv.exchange_rate) || 1;
  const basePaid = paid * rate;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE invoices SET paid_amount = paid_amount + ?, base_paid_amount = base_paid_amount + ?, status = ? WHERE id = ?`)
      .run(paid, basePaid, (inv.paid_amount + paid >= inv.total - 0.01) ? 'paid' : 'partial', invoiceId);

    const cashAcct = getDefaultAccount(db, '1101');
    const bankAcct = getDefaultAccount(db, '1111');

    if (inv.kind === 'sale') {
      const recvAcct = getDefaultAccount(db, '1201');
      const lines = [
        { account_id: method === 'bank_transfer' || method === 'sadad' ? bankAcct.id : cashAcct.id, debit: basePaid, detail: `تحصيل من عميل` },
        { account_id: recvAcct.id, credit: basePaid, detail: `سداد رصيد فاتورة ${inv.invoice_no}` }
      ];
      createJournalEntry(db, { date, description: `سداد عميل - فاتورة ${inv.invoice_no}`, ref_type: 'payment', ref_id: invoiceId, fiscal_year_id, branch_id: inv.branch_id, lines, currency: inv.currency || currencyLib.getBaseCurrency(db), exchange_rate: inv.exchange_rate || 1, amounts_in_base: true });
    } else {
      const payableAcct = getDefaultAccount(db, '2101');
      const lines = [
        { account_id: payableAcct.id, debit: basePaid, detail: `سداد للمورد - فاتورة ${inv.invoice_no}` },
        { account_id: method === 'bank_transfer' || method === 'sadad' ? bankAcct.id : cashAcct.id, credit: basePaid, detail: `دفعة للمورد` }
      ];
      createJournalEntry(db, { date, description: `سداد مورد - فاتورة ${inv.invoice_no}`, ref_type: 'payment', ref_id: invoiceId, fiscal_year_id, branch_id: inv.branch_id, lines, currency: inv.currency || currencyLib.getBaseCurrency(db), exchange_rate: inv.exchange_rate || 1, amounts_in_base: true });
    }
  });

  tx();
  return getInvoice(db, invoiceId);
}

module.exports = { createInvoice, getInvoice, listInvoices, recordPayment };
