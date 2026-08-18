'use strict';
const { createJournalEntry } = require('./accounting');
const zatca = require('./zatca');

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
async function createInvoice(db, { kind, party_id, date, lines, discount = 0, vat_rate, payment_method = 'cash', paid_amount, due_date, notes, fiscal_year_id, company }) {
  if (!lines || !lines.length) throw new Error('الفاتورة يجب أن تحتوي على سطر واحد على الأقل');

  const vatRate = vat_rate !== undefined ? Number(vat_rate) : Number(db.prepare(`SELECT value FROM settings WHERE key='vat_rate'`).get().value) || 15;
  let subTotal = 0;
  const cleanLines = lines.map(l => {
    const qty = Number(l.qty) || 1;
    const unitPrice = Number(l.unit_price) || 0;
    const lineDiscount = Number(l.discount) || 0;
    const lineTotal = qty * unitPrice - lineDiscount;
    subTotal += lineTotal;
    return { description: l.description || '', qty, unit_price: unitPrice, discount: lineDiscount, vat_rate: vatRate, line_total: lineTotal };
  });

  const totalDiscount = Number(discount) || 0;
  const taxable = subTotal - totalDiscount;
  const vat = taxable * vatRate / 100;
  const total = taxable + vat;

  const paid = paid_amount !== undefined ? Number(paid_amount) : (payment_method === 'credit' ? 0 : total);
  const status = total <= paid + 0.01 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');

  const invoiceNo = nextInvoiceNo(db, kind, date);

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO invoices (invoice_no, kind, party_id, date, sub_total, discount, vat, total, vat_rate,
        payment_method, status, paid_amount, due_date, notes, fiscal_year_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceNo, kind, party_id, date, subTotal, totalDiscount, vat, total, vatRate,
      payment_method, status, paid, due_date || null, notes || '', fiscal_year_id, new Date().toISOString());

    const invoiceId = info.lastInsertRowid;
    const insertLine = db.prepare(`
      INSERT INTO invoice_lines (invoice_id, description, qty, unit_price, discount, vat_rate, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of cleanLines) insertLine.run(invoiceId, l.description, l.qty, l.unit_price, l.discount, l.vat_rate, l.line_total);

    postInvoiceJournal(db, { invoiceId, kind, party_id, date, subTotal, discount: totalDiscount, vat, total, vatRate, payment_method, paid, status, fiscal_year_id });
    return invoiceId;
  });

  const id = tx();
  let inv = getInvoice(db, id);
  if (kind === 'sale' && company) {
    inv = await zatca.applyZatca(db, inv, company);
  }
  return inv;
}

function postInvoiceJournal(db, { invoiceId, kind, party_id, date, subTotal, discount, vat, total, vatRate, payment_method, paid, status, fiscal_year_id }) {
  const cashAcct = getDefaultAccount(db, '1101');
  const bankAcct = getDefaultAccount(db, '1111');
  const vatOutputAcct = getVatAccount(db, 'output');
  const vatInputAcct = getVatAccount(db, 'input');

  if (kind === 'sale') {
    const revenueAcct = getDefaultAccount(db, '4101');
    const lines = [];
    const netRevenue = subTotal - discount;
    lines.push({ account_id: revenueAcct.id, credit: netRevenue, vat_amount: 0, vat_type: '', detail: `قيمة الفاتورة قبل الضريبة` });
    if (vat > 0.01) lines.push({ account_id: vatOutputAcct.id, credit: vat, vat_amount: vat, vat_type: 'output', detail: `ضريبة القيمة المضافة ${vatRate}%` });

    // الجهة المدينة حسب طريقة الدفع
    if (payment_method === 'credit' || status === 'unpaid' || (status === 'partial' && paid < total)) {
      const recvAcct = getDefaultAccount(db, '1201');
      lines.push({ account_id: recvAcct.id, debit: total - paid, detail: `رصيد مستحق من العميل` });
      if (paid > 0) {
        if (payment_method === 'bank_transfer' || payment_method === 'sadad') lines.push({ account_id: bankAcct.id, debit: paid, detail: `دفعة مستلمة - ${payment_method}` });
        else lines.push({ account_id: cashAcct.id, debit: paid, detail: `دفعة مستلمة - ${payment_method}` });
      }
    } else {
      if (payment_method === 'bank_transfer' || payment_method === 'sadad') lines.push({ account_id: bankAcct.id, debit: total, detail: `تحصيل - ${payment_method}` });
      else if (payment_method === 'credit_card' || payment_method === 'mada' || payment_method === 'apple_pay' || payment_method === 'stc_pay') {
        lines.push({ account_id: bankAcct.id, debit: total, detail: `مدفوعات إلكترونية - ${payment_method}` });
      } else {
        lines.push({ account_id: cashAcct.id, debit: total, detail: `دفع نقدي` });
      }
    }

    createJournalEntry(db, {
      date, description: `فاتورة مبيعات ${invoiceId} - إيراد المبيعات`, ref_type: 'sale', ref_id: invoiceId,
      fiscal_year_id, lines
    });
  } else {
    // شراء
    const purchasesAcct = getDefaultAccount(db, '5101');
    const lines = [];
    const netPurchase = subTotal - discount;
    lines.push({ account_id: purchasesAcct.id, debit: netPurchase, vat_amount: 0, detail: `قيمة الفاتورة قبل الضريبة` });
    if (vat > 0.01) lines.push({ account_id: vatInputAcct.id, debit: vat, vat_amount: vat, vat_type: 'input', detail: `ضريبة القيمة المضافة ${vatRate}%` });

    if (payment_method === 'credit' || status === 'unpaid' || (status === 'partial' && paid < total)) {
      const payableAcct = getDefaultAccount(db, '2101');
      lines.push({ account_id: payableAcct.id, credit: total - paid, detail: `رصيد مستحق للمورد` });
      if (paid > 0) {
        if (payment_method === 'bank_transfer' || payment_method === 'sadad') lines.push({ account_id: bankAcct.id, credit: paid, detail: `دفعة للمورد - ${payment_method}` });
        else lines.push({ account_id: cashAcct.id, credit: paid, detail: `دفعة للمورد - ${payment_method}` });
      }
    } else {
      if (payment_method === 'bank_transfer' || payment_method === 'sadad') lines.push({ account_id: bankAcct.id, credit: total, detail: `دفع للمورد - ${payment_method}` });
      else lines.push({ account_id: cashAcct.id, credit: total, detail: `دفع نقدي للمورد` });
    }

    createJournalEntry(db, {
      date, description: `فاتورة مشتريات ${invoiceId} - شراء بضاعة`, ref_type: 'purchase', ref_id: invoiceId,
      fiscal_year_id, lines
    });
  }
}

function getInvoice(db, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) return null;
  inv.lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(id);
  if (inv.party_id) inv.party = db.prepare('SELECT id, name, tax_id FROM parties WHERE id = ?').get(inv.party_id);
  return inv;
}

function listInvoices(db, { kind, fiscal_year_id, limit = 500 } = {}) {
  let sql = `SELECT * FROM invoices WHERE 1=1`;
  const params = [];
  if (kind) { sql += ` AND kind = ?`; params.push(kind); }
  if (fiscal_year_id) { sql += ` AND fiscal_year_id = ?`; params.push(fiscal_year_id); }
  sql += ` ORDER BY date DESC, id DESC LIMIT ?`;
  params.push(limit);
  const invs = db.prepare(sql).all(...params);
  return invs.map(i => {
    if (i.party_id) i.party = db.prepare('SELECT id, name, tax_id FROM parties WHERE id = ?').get(i.party_id);
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

  const tx = db.transaction(() => {
    db.prepare(`UPDATE invoices SET paid_amount = paid_amount + ?, status = ? WHERE id = ?`)
      .run(paid, (inv.paid_amount + paid >= inv.total - 0.01) ? 'paid' : 'partial', invoiceId);

    const cashAcct = getDefaultAccount(db, '1101');
    const bankAcct = getDefaultAccount(db, '1111');

    if (inv.kind === 'sale') {
      const recvAcct = getDefaultAccount(db, '1201');
      const lines = [
        { account_id: method === 'bank_transfer' || method === 'sadad' ? bankAcct.id : cashAcct.id, debit: paid, detail: `تحصيل من عميل` },
        { account_id: recvAcct.id, credit: paid, detail: `سداد رصيد فاتورة ${inv.invoice_no}` }
      ];
      createJournalEntry(db, { date, description: `سداد عميل - فاتورة ${inv.invoice_no}`, ref_type: 'payment', ref_id: invoiceId, fiscal_year_id, lines });
    } else {
      const payableAcct = getDefaultAccount(db, '2101');
      const lines = [
        { account_id: payableAcct.id, debit: paid, detail: `سداد للمورد - فاتورة ${inv.invoice_no}` },
        { account_id: method === 'bank_transfer' || method === 'sadad' ? bankAcct.id : cashAcct.id, credit: paid, detail: `دفعة للمورد` }
      ];
      createJournalEntry(db, { date, description: `سداد مورد - فاتورة ${inv.invoice_no}`, ref_type: 'payment', ref_id: invoiceId, fiscal_year_id, lines });
    }
  });

  tx();
  return getInvoice(db, invoiceId);
}

module.exports = { createInvoice, getInvoice, listInvoices, recordPayment };
