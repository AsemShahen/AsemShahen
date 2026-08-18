'use strict';
const { openCompanyDb } = require('./company-db');
const { getChartForType, typeLabel } = require('./charts');

// ---------- دالة مساعدة: رقم القيد ----------
function nextEntryNo(db, date) {
  const year = String(date).slice(0, 4);
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM journal_entries WHERE date LIKE ?`
  ).get(year + '%');
  return `QY-${year}-${String(row.c + 1).padStart(4, '0')}`;
}

function nextFiscalYear(db) {
  const row = db.prepare('SELECT name FROM fiscal_years ORDER BY id DESC LIMIT 1').get();
  if (!row) return 1;
  const m = String(row.name).match(/(\d{4})/);
  return m ? Number(m[1]) + 1 : 1;
}

// ---------- تهيئة شركة جديدة ----------
function initCompanyDatabase(company) {
  const db = openCompanyDb(company.id);

  const now = new Date().toISOString();
  const currentYear = new Date().getFullYear();
  const startMonth = company.fiscal_year_start_month || 1;

  // إنشاء سنة مالية أولى
  const startDate = `${currentYear}-${String(startMonth).padStart(2, '0')}-01`;
  const endDate = `${currentYear + 1}-${String(startMonth).padStart(2, '0')}-01`;
  const fyInfo = db.prepare(
    `INSERT INTO fiscal_years (name, start_date, end_date, status, created_at) VALUES (?, ?, ?, 'open', ?)`
  ).run(`${currentYear}`, startDate, endDate, now);
  const fiscalYearId = fyInfo.lastInsertRowid;

  // إدراج المخطط المحاسبي
  const chart = getChartForType(company.business_type);
  const insert = db.prepare(`
    INSERT INTO accounts (code, name, type, category, parent_code, is_header, normal_side,
      vat_applicable, opening_balance, is_system, sort_order)
    VALUES (@code, @name, @type, @category, @parent_code, @is_header, @normal_side,
      @vat_applicable, @opening_balance, @is_system, @sort_order)
  `);
  const tx = db.transaction(() => {
    for (const acc of chart) insert.run(acc);
  });
  tx();

  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run('currency', company.currency);
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run('vat_rate', String(company.vat_rate));
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run('fiscal_year_start_month', String(company.fiscal_year_start_month));

  db.close();
  return { fiscalYearId, startDate, endDate };
}

// ---------- فتح قاعدة بيانات الشركة ----------
function getDb(companyId) {
  return openCompanyDb(companyId);
}

// ---------- قيود اليومية ----------
function createJournalEntry(db, { date, description, ref_type = 'manual', ref_id = null, fiscal_year_id, lines, is_closing = 0, is_opening = 0 }) {
  if (!lines || lines.length < 2) throw new Error('القيد يجب أن يحتوي على سطرين على الأقل');
  let totalDebit = 0, totalCredit = 0;
  const cleanLines = lines.filter(l => (Number(l.debit) || 0) + (Number(l.credit) || 0) > 0);
  if (cleanLines.length < 2) throw new Error('القيد يجب أن يحتوي على سطرين على الأقل بقيم غير صفرية');

  for (const l of cleanLines) {
    const debit = Number(l.debit) || 0;
    const credit = Number(l.credit) || 0;
    if (debit > 0 && credit > 0) throw new Error('السطر الواحد لا يمكن أن يكون مديناً ودائنًا معاً');
    totalDebit += debit;
    totalCredit += credit;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`القيد غير متوازن: المدين (${totalDebit.toFixed(2)}) لا يساوي الدائن (${totalCredit.toFixed(2)})`);
  }

  const entryNo = nextEntryNo(db, date);
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO journal_entries (entry_no, date, description, ref_type, ref_id, fiscal_year_id, is_closing, is_opening, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entryNo, date, description || '', ref_type, ref_id, fiscal_year_id, is_closing, is_opening, new Date().toISOString());
    const entryId = info.lastInsertRowid;

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (entry_id, account_id, debit, credit, vat_amount, vat_type, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of cleanLines) {
      insertLine.run(entryId, l.account_id, Number(l.debit) || 0, Number(l.credit) || 0, Number(l.vat_amount) || 0, l.vat_type || '', l.detail || '');
    }
    return entryId;
  });

  const entryId = tx();
  return getJournalEntry(db, entryId);
}

function getJournalEntry(db, entryId) {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  if (!entry) return null;
  entry.lines = db.prepare(`
    SELECT jl.*, a.code, a.name AS account_name FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = ? ORDER BY jl.id
  `).all(entryId);
  return entry;
}

function listJournalEntries(db, { fiscal_year_id, limit = 500 } = {}) {
  let sql = `SELECT * FROM journal_entries`;
  const params = [];
  if (fiscal_year_id) { sql += ` WHERE fiscal_year_id = ?`; params.push(fiscal_year_id); }
  sql += ` ORDER BY date DESC, id DESC LIMIT ?`;
  params.push(limit);
  const entries = db.prepare(sql).all(...params);
  return entries.map(e => {
    e.lines = db.prepare(`
      SELECT jl.*, a.code, a.name AS account_name FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = ? ORDER BY jl.id
    `).all(e.id);
    return e;
  });
}

// ---------- دليل الأستاذ ----------
function getLedger(db, accountId, { from, to, fiscal_year_id } = {}) {
  let sql = `
    SELECT jl.*, je.date, je.entry_no, je.description, je.ref_type
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_id = ?
  `;
  const params = [accountId];
  if (fiscal_year_id) { sql += ` AND je.fiscal_year_id = ?`; params.push(fiscal_year_id); }
  if (from && to) { sql += ` AND je.date BETWEEN ? AND ?`; params.push(from, to); }
  sql += ` ORDER BY je.date, je.id, jl.id`;
  return db.prepare(sql).all(...params);
}

// ---------- حساب الرصيد ----------
// balance موجب دائماً في اتجاه طبيعة الحساب:
//  - حسابات مدينة (أصول/مصروفات): موجب = رصيد مدين
//  - حسابات دائنة (خصوم/إيرادات/حقوق ملكية): موجب = رصيد دائن
function accountBalance(db, account, opts = {}) {
  const opening = Number(account.opening_balance) || 0;
  const isCredit = account.normal_side === 'credit';
  let sql = `
    SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_id = ?
  `;
  const params = [account.id];
  if (opts.asOf) { sql += ` AND je.date <= ?`; params.push(opts.asOf); }
  if (opts.fiscal_year_id) { sql += ` AND je.fiscal_year_id = ?`; params.push(opts.fiscal_year_id); }
  const row = db.prepare(sql).get(...params);
  const netDebit = row.d - row.c;
  const netCredit = row.c - row.d;
  return {
    debit: row.d,
    credit: row.c,
    netDebit, netCredit,
    balance: opening + (isCredit ? netCredit : netDebit)
  };
}

// ---------- ميزان المراجعة ----------
function trialBalance(db, { asOf, fiscal_year_id } = {}) {
  const where = [];
  const params = [];
  if (asOf) where.push(`je.date <= ?`), params.push(asOf);
  if (fiscal_year_id) where.push(`je.fiscal_year_id = ?`), params.push(fiscal_year_id);

  let sql = `
    SELECT a.id, a.code, a.name, a.type, a.category, a.normal_side, a.opening_balance, a.is_header,
      COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id
  `;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` GROUP BY a.id, a.code, a.name, a.type, a.category, a.normal_side, a.opening_balance, a.is_header ORDER BY a.code`;

  const rows = db.prepare(sql).all(...params);
  let totalDebit = 0, totalCredit = 0;
  const items = rows.map(r => {
    const isCredit = r.normal_side === 'credit';
    const netDebit = r.debit - r.credit;
    const netCredit = r.credit - r.debit;
    const balance = Number(r.opening_balance) + (isCredit ? netCredit : netDebit);
    totalDebit += Number(r.debit);
    totalCredit += Number(r.credit);
    return { ...r, balance };
  });
  return { items, totals: { debit: totalDebit, credit: totalCredit } };
}

// ---------- تصفية حسابات الأبناء ----------
function leafAccounts(db, type) {
  return db.prepare(`SELECT * FROM accounts WHERE type = ? AND is_header = 0 ORDER BY code`).all(type);
}

// ---------- قائمة الدخل ----------
function incomeStatement(db, { asOf, fiscal_year_id } = {}) {
  // الإيرادات تُحسب موجبة لحسابات الإيرادات الدائنة، والمردودات (مدينة) سالبة
  const revenues = leafAccounts(db, 'revenue').map(acc => {
    const { balance } = accountBalance(db, acc, { asOf, fiscal_year_id });
    const signed = acc.normal_side === 'credit' ? balance : -balance;
    return { ...acc, raw: balance, amount: signed };
  });
  // المصروفات موجبة للحسابات المدينة، والمردودات (دائنة) سالبة
  const expenses = leafAccounts(db, 'expense').map(acc => {
    const { balance } = accountBalance(db, acc, { asOf, fiscal_year_id });
    const signed = acc.normal_side === 'debit' ? balance : -balance;
    return { ...acc, raw: balance, amount: signed };
  });

  const revenueTotal = revenues.reduce((s, r) => s + r.amount, 0);
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);

  // أقسام المصروفات
  const groupByCategory = (list) => {
    const map = {};
    for (const item of list) {
      const key = item.category;
      if (!map[key]) map[key] = { category: key, items: [], total: 0 };
      map[key].items.push(item);
      map[key].total += item.amount;
    }
    return Object.values(map);
  };

  return {
    revenues,
    revenueTotal,
    expenseGroups: groupByCategory(expenses),
    expenses,
    expenseTotal,
    netIncome: revenueTotal - expenseTotal
  };
}

// ---------- الميزانية العمومية ----------
function balanceSheet(db, { asOf, fiscal_year_id } = {}) {
  // الرصيد المُوقَّع حسب قسم القائمة:
  //  - الأصول: حسابات مدينة موجبة، وحسابات دائنة (مضادة) سالبة
  //  - الخصوم وحقوق الملكية: حسابات دائنة موجبة، وحسابات مدينة سالبة
  const signAmount = (acc) => {
    const b = acc.balance;
    if (acc.type === 'asset') return acc.normal_side === 'debit' ? b : -b;
    return acc.normal_side === 'credit' ? b : -b;
  };

  const assets = leafAccounts(db, 'asset').map(acc => {
    const { balance } = accountBalance(db, acc, { asOf, fiscal_year_id });
    return { ...acc, raw: balance, amount: signAmount({ ...acc, balance }) };
  });
  const liabilities = leafAccounts(db, 'liability').map(acc => {
    const { balance } = accountBalance(db, acc, { asOf, fiscal_year_id });
    return { ...acc, raw: balance, amount: signAmount({ ...acc, balance }) };
  });
  const equity = leafAccounts(db, 'equity').map(acc => {
    const { balance } = accountBalance(db, acc, { asOf, fiscal_year_id });
    return { ...acc, raw: balance, amount: signAmount({ ...acc, balance }) };
  });

  // صافي الدخل الحالي ليظهر في حقوق الملكية
  const inc = incomeStatement(db, { asOf, fiscal_year_id });
  const netIncome = inc.netIncome;

  const assetTotal = assets.reduce((s, a) => s + a.amount, 0);
  const liabilityTotal = liabilities.reduce((s, l) => s + l.amount, 0);
  let equityTotal = equity.reduce((s, e) => s + e.amount, 0);
  equityTotal += netIncome;

  return { assets, liabilities, equity, netIncome, assetTotal, liabilityTotal, equityTotal };
}

// ---------- كشف الضريبة ----------
function vatReport(db, { asOf, fiscal_year_id } = {}) {
  let sql = `SELECT COALESCE(SUM(jl.vat_amount),0) AS total, COUNT(*) AS count
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.vat_type = ? AND jl.vat_amount > 0`;
  const cond = [];
  const params = [];
  if (asOf) { cond.push(`je.date <= ?`); params.push(asOf); }
  if (fiscal_year_id) { cond.push(`je.fiscal_year_id = ?`); params.push(fiscal_year_id); }
  if (cond.length) sql += ` AND ${cond.join(' AND ')}`;

  const input = db.prepare(sql).get('input', ...params);
  const output = db.prepare(sql).get('output', ...params);
  return {
    input: input.total, inputCount: input.count,
    output: output.total, outputCount: output.count,
    netDue: output.total - input.total
  };
}

// ---------- إقفال السنة والترحيل ----------
function closeFiscalYear(db, fiscalYearId, newYearStartDate) {
  const fy = db.prepare('SELECT * FROM fiscal_years WHERE id = ?').get(fiscalYearId);
  if (!fy) throw new Error('السنة المالية غير موجودة');
  if (fy.status === 'closed') throw new Error('السنة المالية مقفلة بالفعل');

  const nextName = String(Number(fy.name) + 1);
  const startDate = newYearStartDate || `${nextName}-01-01`;
  const endDate = `${Number(nextName) + 1}-01-01`;

  const inc = incomeStatement(db, { fiscal_year_id: fiscalYearId });
  const netIncome = inc.netIncome;

  const retainedAcct = db.prepare(`SELECT * FROM accounts WHERE code = '3201'`).get();
  const profitAcct = db.prepare(`SELECT * FROM accounts WHERE code = '3202'`).get();
  if (!retainedAcct) throw new Error('حساب الأرباح المحتجزة غير موجود');
  if (!profitAcct) throw new Error('حساب أرباح السنة الحالية غير موجود');

  const revenueAccts = leafAccounts(db, 'revenue');
  const expenseAccts = leafAccounts(db, 'expense');

  // قيد إقفال: صفر الإيرادات والمصروفات
  const closingLines = [];
  for (const rev of revenueAccts) {
    const { balance } = accountBalance(db, rev, { asOf: fy.end_date, fiscal_year_id: fiscalYearId });
    if (Math.abs(balance) > 0.01) {
      if (balance > 0) closingLines.push({ account_id: rev.id, debit: balance, credit: 0 });
      else closingLines.push({ account_id: rev.id, debit: 0, credit: -balance });
    }
  }
  for (const exp of expenseAccts) {
    const { balance } = accountBalance(db, exp, { asOf: fy.end_date, fiscal_year_id: fiscalYearId });
    if (Math.abs(balance) > 0.01) {
      if (balance > 0) closingLines.push({ account_id: exp.id, debit: 0, credit: balance });
      else closingLines.push({ account_id: exp.id, debit: -balance, credit: 0 });
    }
  }

  // الطرف المقابل = الأرباح المحتجزة
  if (Math.abs(netIncome) > 0.01) {
    if (netIncome > 0) closingLines.push({ account_id: retainedAcct.id, debit: 0, credit: netIncome });
    else closingLines.push({ account_id: retainedAcct.id, debit: -netIncome, credit: 0 });
  }

  let closingEntryId = null;
  if (closingLines.length >= 2) {
    closingEntryId = createJournalEntry(db, {
      date: fy.end_date,
      description: `إقفال حسابات الإيرادات والمصروفات للسنة المالية ${fy.name} وترحيل صافي النتيجة للأرباح المحتجزة`,
      ref_type: 'closing', fiscal_year_id: fiscalYearId,
      lines: closingLines, is_closing: 1
    }).id;
  }

  // الأرصدة الختامية لحسابات الميزانية (بعد قيد الإقفال)
  const bs = balanceSheet(db, { asOf: fy.end_date, fiscal_year_id: fiscalYearId });
  const carriedAccounts = [...bs.assets, ...bs.liabilities, ...bs.equity];
  const openingLines = [];
  for (const acc of carriedAccounts) {
    const isCredit = acc.normal_side === 'credit';
    if (acc.code === '3202') continue; // أرباح السنة الحالية تُصفَّر
    const amount = acc.raw; // الرصيد في اتجاه طبيعة الحساب
    if (Math.abs(amount) < 0.01) continue;
    if (isCredit) {
      if (amount > 0) openingLines.push({ account_id: acc.id, debit: 0, credit: amount });
      else openingLines.push({ account_id: acc.id, debit: -amount, credit: 0 });
    } else {
      if (amount > 0) openingLines.push({ account_id: acc.id, debit: amount, credit: 0 });
      else openingLines.push({ account_id: acc.id, debit: 0, credit: -amount });
    }
  }

  // ضمان توازن قيد الافتتاح
  const openingLinesBalanced = balanceOpeningLines(openingLines, retainedAcct, db);

  // إنشاء السنة الجديدة وقيد الافتتاح
  const tx = db.transaction(() => {
    const fyInfo = db.prepare(
      `INSERT INTO fiscal_years (name, start_date, end_date, status, created_at) VALUES (?, ?, ?, 'open', ?)`
    ).run(nextName, startDate, endDate, new Date().toISOString());
    const newFyId = fyInfo.lastInsertRowid;

    if (openingLinesBalanced.length >= 2) {
      createJournalEntry(db, {
        date: startDate,
        description: `قيد افتتاحي - ترحيل أرصدة السنة المالية ${fy.name} إلى السنة المالية ${nextName}`,
        ref_type: 'opening', fiscal_year_id: newFyId,
        lines: openingLinesBalanced, is_opening: 1
      });
    }

    db.prepare(`UPDATE fiscal_years SET status = 'closed', closed_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), fiscalYearId);

    return newFyId;
  });

  const newFyId = tx();
  return { closingEntryId, newFyId, nextName, netIncome };
}

function balanceOpeningLines(openingLines, retainedAcct, db) {
  let totalDebit = 0, totalCredit = 0;
  for (const l of openingLines) {
    totalDebit += l.debit || 0;
    totalCredit += l.credit || 0;
  }
  const diff = totalDebit - totalCredit;
  if (Math.abs(diff) > 0.01) {
    // فرق يذهب إلى الأرباح المحتجزة لضمان التوازن
    if (diff > 0) openingLines.push({ account_id: retainedAcct.id, debit: 0, credit: diff });
    else openingLines.push({ account_id: retainedAcct.id, debit: -diff, credit: 0 });
  }
  return openingLines;
}

module.exports = {
  initCompanyDatabase, getDb, createJournalEntry, getJournalEntry, listJournalEntries,
  getLedger, accountBalance, trialBalance, incomeStatement, balanceSheet, vatReport,
  closeFiscalYear, nextFiscalYear
};
