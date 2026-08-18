'use strict';
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const { listCompanies, getCompany, createCompany, updateCompany, deleteCompany } = require('./lib/master-db');
const accounting = require('./lib/accounting');
const invoicesLib = require('./lib/invoices');
const partiesLib = require('./lib/parties');
const chartsLib = require('./lib/charts');
const zatcaLib = require('./lib/zatca');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Middleware: تحميل شركة ----------
function loadCompany(req, res, next) {
  const id = Number(req.params.companyId);
  const company = getCompany(id);
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  req.company = company;
  req.db = accounting.getDb(id);
  next();
}

function currentFy(db, res) {
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy && res) res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' });
  return fy;
}

// ==================== الشركات ====================
app.get('/api/companies', (req, res) => {
  const companies = listCompanies().map(c => {
    const db = accounting.getDb(c.id);
    const fy = db.prepare(`SELECT * FROM fiscal_years ORDER BY id DESC LIMIT 1`).get();
    const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM journal_entries) AS entries, (SELECT COUNT(*) FROM invoices) AS invoices`).get();
    db.close();
    return { ...c, current_fiscal_year: fy, counts };
  });
  res.json(companies);
});

app.get('/api/company-types', (req, res) => {
  res.json(chartsLib.getChartForType('corporate').length ? {
    types: Object.keys({
      corporate: chartsLib.typeLabel('corporate'),
      supermarket: chartsLib.typeLabel('supermarket'),
      factory: chartsLib.typeLabel('factory'),
      medical_lab: chartsLib.typeLabel('medical_lab')
    }).map(t => ({ code: t, label: chartsLib.typeLabel(t) }))
  } : {});
});

app.post('/api/companies', (req, res) => {
  try {
    const company = createCompany(req.body);
    try {
      const result = accounting.initCompanyDatabase(company);
      res.json({ company, ...result });
    } catch (e) {
      deleteCompany(company.id);
      throw e;
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/companies/:companyId', loadCompany, (req, res) => {
  try {
    const company = updateCompany(req.params.companyId, req.body);
    res.json(company);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId', loadCompany, (req, res) => {
  const fy = db ? null : null;
  const settings = Object.fromEntries(req.db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
  const years = req.db.prepare('SELECT * FROM fiscal_years ORDER BY id').all();
  req.db.close();
  res.json({ company: req.company, settings, fiscal_years: years, fy });
});

// ==================== الشركة: البيانات الأساسية ====================
app.get('/api/companies/:companyId/info', loadCompany, (req, res) => {
  const settings = Object.fromEntries(req.db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
  const years = req.db.prepare('SELECT * FROM fiscal_years ORDER BY id').all();
  const activeFy = years.find(y => y.status === 'open') || years[years.length - 1];
  const paymentMethods = req.db.prepare('SELECT * FROM payment_methods ORDER BY is_active DESC, code').all();
  const counts = req.db.prepare(`SELECT
    (SELECT COUNT(*) FROM journal_entries) AS entries,
    (SELECT COUNT(*) FROM invoices) AS invoices,
    (SELECT COUNT(*) FROM parties) AS parties,
    (SELECT COUNT(*) FROM accounts WHERE is_header=0) AS accounts`).get();
  const vat = accounting.vatReport(req.db, {});
  const totals = req.db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN kind='sale' THEN total END),0) AS sales,
    COALESCE(SUM(CASE WHEN kind='purchase' THEN total END),0) AS purchases,
    COALESCE(SUM(CASE WHEN kind='sale' AND status!='paid' THEN total-paid_amount END),0) AS receivables,
    COALESCE(SUM(CASE WHEN kind='purchase' AND status!='paid' THEN total-paid_amount END),0) AS payables
    FROM invoices`).get();
  res.json({ settings, fiscal_years: years, active_fiscal_year: activeFy, payment_methods: paymentMethods, counts, vat, totals, business_type_label: chartsLib.typeLabel(req.company.business_type) });
  req.db.close();
});

// ==================== المخطط المحاسبي ====================
app.get('/api/companies/:companyId/accounts', loadCompany, (req, res) => {
  const fy = currentFy(req.db, res);
  if (!fy) return;
  const accounts = req.db.prepare('SELECT * FROM accounts ORDER BY code').all();
  const result = accounts.map(a => {
    const bal = accounting.accountBalance(req.db, a, { fiscal_year_id: fy.id });
    return { ...a, balance: bal.balance, debit: bal.debit, credit: bal.credit, fiscal_year: fy };
  });
  req.db.close();
  res.json(result);
});

app.post('/api/companies/:companyId/accounts', loadCompany, (req, res) => {
  try {
    const b = req.body;
    const exists = req.db.prepare('SELECT id FROM accounts WHERE code = ?').get(b.code);
    if (exists) throw new Error('رقم الحساب موجود مسبقاً');
    const info = req.db.prepare(`
      INSERT INTO accounts (code, name, type, category, parent_code, is_header, normal_side, vat_applicable, opening_balance, is_system, sort_order)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0)
    `).run(b.code, b.name, b.type, b.category || 'other', b.parent_code || null, b.normal_side || (b.type === 'asset' || b.type === 'expense' ? 'debit' : 'credit'), b.vat_applicable !== undefined ? (b.vat_applicable ? 1 : 0) : 1, Number(b.opening_balance) || 0);
    if (Number(b.opening_balance) || 0) {
      const acct = req.db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
      const retained = req.db.prepare(`SELECT * FROM accounts WHERE code='3201'`).get();
      const fy = currentFy(req.db, res);
      const side = acct.normal_side === 'credit' ? 1 : -1;
      const lines = [];
      if (side > 0) { lines.push({ account_id: acct.id, credit: Number(b.opening_balance) }); lines.push({ account_id: retained.id, debit: Number(b.opening_balance) }); }
      else { lines.push({ account_id: acct.id, debit: Number(b.opening_balance) }); lines.push({ account_id: retained.id, credit: Number(b.opening_balance) }); }
      accounting.createJournalEntry(req.db, { date: fy.start_date, description: `رصيد افتتاحي للحساب ${b.code} - ${b.name}`, fiscal_year_id: fy.id, lines });
    }
    const acct = req.db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
    req.db.close();
    res.json(acct);
  } catch (e) {
    req.db.close();
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/companies/:companyId/accounts/:accountId', loadCompany, (req, res) => {
  const b = req.body;
  req.db.prepare(`
    UPDATE accounts SET name=?, type=?, category=?, normal_side=?, vat_applicable=? WHERE id=?
  `).run(b.name || '', b.type || 'asset', b.category || 'other', b.normal_side || 'debit', b.vat_applicable !== undefined ? (b.vat_applicable ? 1 : 0) : 1, req.params.accountId);
  const acct = req.db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.accountId);
  req.db.close();
  res.json(acct);
});

// ==================== قيود اليومية ====================
app.get('/api/companies/:companyId/journal', loadCompany, (req, res) => {
  const fy = currentFy(req.db, res);
  if (!fy) return;
  const entries = accounting.listJournalEntries(req.db, { fiscal_year_id: fy.id, limit: 1000 });
  req.db.close();
  res.json(entries);
});

app.post('/api/companies/:companyId/journal', loadCompany, (req, res) => {
  try {
    const fy = currentFy(req.db, res);
    if (!fy) return;
    const entry = accounting.createJournalEntry(req.db, { ...req.body, fiscal_year_id: fy.id });
    req.db.close();
    res.json(entry);
  } catch (e) {
    req.db.close();
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId/journal/:entryId', loadCompany, (req, res) => {
  const entry = accounting.getJournalEntry(req.db, req.params.entryId);
  req.db.close();
  if (!entry) return res.status(404).json({ error: 'القيد غير موجود' });
  res.json(entry);
});

app.delete('/api/companies/:companyId/journal/:entryId', loadCompany, (req, res) => {
  const entry = req.db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.entryId);
  if (!entry) { req.db.close(); return res.status(404).json({ error: 'القيد غير موجود' }); }
  if (entry.is_closing || entry.is_opening) { req.db.close(); return res.status(400).json({ error: 'لا يمكن حذف قيود الإقفال أو الافتتاح' }); }
  req.db.prepare('DELETE FROM journal_lines WHERE entry_id = ?').run(entry.id);
  req.db.prepare('DELETE FROM journal_entries WHERE id = ?').run(entry.id);
  req.db.close();
  res.json({ ok: true });
});

// ==================== دليل الأستاذ ====================
app.get('/api/companies/:companyId/ledger/:accountId', loadCompany, (req, res) => {
  const account = req.db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.accountId);
  if (!account) { req.db.close(); return res.status(404).json({ error: 'الحساب غير موجود' }); }
  const fy = currentFy(req.db, res);
  if (!fy) return;
  const { from, to } = req.query;
  const lines = accounting.getLedger(req.db, account.id, { from, to, fiscal_year_id: fy.id });
  const bal = accounting.accountBalance(req.db, account, { asOf: to || null, fiscal_year_id: fy.id });
  req.db.close();
  res.json({ account, lines, balance: bal, fiscal_year: fy });
});

// ==================== ميزان المراجعة ====================
app.get('/api/companies/:companyId/trial-balance', loadCompany, (req, res) => {
  const fy = currentFy(req.db, res);
  if (!fy) return;
  const tb = accounting.trialBalance(req.db, { fiscal_year_id: fy.id, asOf: req.query.asOf });
  req.db.close();
  res.json(tb);
});

// ==================== القوائم المالية ====================
app.get('/api/companies/:companyId/income-statement', loadCompany, (req, res) => {
  const fy = currentFy(req.db, res);
  if (!fy) return;
  const stmt = accounting.incomeStatement(req.db, { fiscal_year_id: fy.id, asOf: req.query.asOf });
  req.db.close();
  res.json(stmt);
});

app.get('/api/companies/:companyId/balance-sheet', loadCompany, (req, res) => {
  const fy = currentFy(req.db, res);
  if (!fy) return;
  const bs = accounting.balanceSheet(req.db, { fiscal_year_id: fy.id, asOf: req.query.asOf });
  req.db.close();
  res.json(bs);
});

// ==================== تقرير الضريبة ====================
app.get('/api/companies/:companyId/vat-report', loadCompany, (req, res) => {
  const fy = currentFy(req.db, res);
  if (!fy) return;
  const vat = accounting.vatReport(req.db, { asOf: req.query.asOf, fiscal_year_id: fy.id });
  const details = req.db.prepare(`
    SELECT je.date, je.entry_no, je.description, jl.vat_amount, jl.vat_type, a.code, a.name AS account_name
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
    WHERE jl.vat_amount > 0 ORDER BY je.date DESC LIMIT 500
  `).all();
  req.db.close();
  res.json({ ...vat, details });
});

// ==================== العملاء والموردون ====================
app.get('/api/companies/:companyId/parties', loadCompany, (req, res) => {
  const list = partiesLib.listParties(req.db, req.query.type);
  req.db.close();
  res.json(list);
});

app.post('/api/companies/:companyId/parties', loadCompany, (req, res) => {
  const party = partiesLib.createParty(req.db, req.body);
  req.db.close();
  res.json(party);
});

app.put('/api/companies/:companyId/parties/:partyId', loadCompany, (req, res) => {
  const party = partiesLib.updateParty(req.db, req.params.partyId, req.body);
  req.db.close();
  if (!party) return res.status(404).json({ error: 'الطرف غير موجود' });
  res.json(party);
});

// ==================== الفواتير ====================
app.get('/api/companies/:companyId/invoices', loadCompany, (req, res) => {
  const fy = currentFy(req.db, res);
  if (!fy) return;
  const invs = invoicesLib.listInvoices(req.db, { kind: req.query.kind, fiscal_year_id: fy.id });
  req.db.close();
  res.json(invs);
});

app.post('/api/companies/:companyId/invoices', loadCompany, async (req, res) => {
  try {
    const fy = currentFy(req.db, res);
    if (!fy) return;
    const inv = await invoicesLib.createInvoice(req.db, { ...req.body, fiscal_year_id: fy.id, company: req.company });
    req.db.close();
    res.json(inv);
  } catch (e) {
    req.db.close();
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId/invoices/:invoiceId', loadCompany, (req, res) => {
  const inv = invoicesLib.getInvoice(req.db, req.params.invoiceId);
  req.db.close();
  if (!inv) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  res.json(inv);
});

app.post('/api/companies/:companyId/invoices/:invoiceId/pay', loadCompany, (req, res) => {
  try {
    const fy = currentFy(req.db, res);
    if (!fy) return;
    const inv = invoicesLib.recordPayment(req.db, { invoiceId: req.params.invoiceId, ...req.body, fiscal_year_id: fy.id });
    req.db.close();
    res.json(inv);
  } catch (e) {
    req.db.close();
    res.status(400).json({ error: e.message });
  }
});

// ==================== الفاتورة الإلكترونية ZATCA ====================
app.get('/api/companies/:companyId/invoices/:invoiceId/zatca', loadCompany, (req, res) => {
  const inv = invoicesLib.getInvoice(req.db, req.params.invoiceId);
  if (!inv) { req.db.close(); return res.status(404).json({ error: 'الفاتورة غير موجودة' }); }
  const config = zatcaLib.getConfig(req.db);
  req.db.close();
  res.json({
    invoice_no: inv.invoice_no,
    kind: inv.kind,
    invoice_uuid: inv.invoice_uuid,
    issue_datetime: inv.issue_datetime,
    invoice_type: inv.invoice_type,
    qr_data: inv.qr_data,
    xml_data: inv.xml_data,
    zatca_hash: inv.zatca_hash,
    zatca_status: inv.zatca_status,
    zatca_response: inv.zatca_response,
    zatca_submitted_at: inv.zatca_submitted_at,
    config: zatcaLib.maskConfig(config)
  });
});

app.post('/api/companies/:companyId/invoices/:invoiceId/resubmit', loadCompany, async (req, res) => {
  try {
    const inv = invoicesLib.getInvoice(req.db, req.params.invoiceId);
    if (!inv) { req.db.close(); return res.status(404).json({ error: 'الفاتورة غير موجودة' }); }
    if (inv.kind !== 'sale') { req.db.close(); return res.status(400).json({ error: 'إعادة الإرسال متاحة لفواتير البيع فقط' }); }
    const result = await zatcaLib.applyZatca(req.db, inv, req.company);
    req.db.close();
    res.json(result);
  } catch (e) {
    req.db.close();
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId/zatca-settings', loadCompany, (req, res) => {
  const config = zatcaLib.getConfig(req.db);
  req.db.close();
  res.json(zatcaLib.maskConfig(config));
});

app.put('/api/companies/:companyId/zatca-settings', loadCompany, (req, res) => {
  const b = req.body;
  const existing = zatcaLib.getConfig(req.db);
  const config = {
    active: b.active !== undefined ? !!b.active : existing.active,
    mode: b.mode || existing.mode,
    baseUrl: b.baseUrl !== undefined ? b.baseUrl : existing.baseUrl,
    csid: b.csid !== undefined ? b.csid : existing.csid,
    privateKeyPem: b.privateKeyPem !== undefined ? b.privateKeyPem : existing.privateKeyPem,
    certB64: b.certB64 !== undefined ? b.certB64 : existing.certB64,
    otp: b.otp !== undefined ? b.otp : existing.otp,
    deviceSerialNumber: b.deviceSerialNumber !== undefined ? b.deviceSerialNumber : existing.deviceSerialNumber
  };
  zatcaLib.saveConfig(req.db, config);
  const saved = zatcaLib.getConfig(req.db);
  req.db.close();
  res.json(zatcaLib.maskConfig(saved));
});

// ==================== طرق الدفع ====================
app.get('/api/companies/:companyId/payment-methods', loadCompany, (req, res) => {
  const methods = req.db.prepare('SELECT * FROM payment_methods ORDER BY is_active DESC, code').all();
  req.db.close();
  res.json(methods);
});

// ==================== السنوات المالية والإقفال ====================
app.get('/api/companies/:companyId/fiscal-years', loadCompany, (req, res) => {
  const years = req.db.prepare('SELECT * FROM fiscal_years ORDER BY id').all();
  req.db.close();
  res.json(years);
});

app.post('/api/companies/:companyId/fiscal-years', loadCompany, (req, res) => {
  try {
    const active = currentFy(req.db, res);
    if (!active) return;
    const name = req.body.name || accounting.nextFiscalYear(req.db);
    const start = req.body.start_date || `${name}-01-01`;
    const end = req.body.end_date || `${Number(name) + 1}-01-01`;
    const info = req.db.prepare(`INSERT INTO fiscal_years (name, start_date, end_date, status, created_at) VALUES (?, ?, ?, 'open', ?)`)
      .run(String(name), start, end, new Date().toISOString());
    req.db.prepare(`UPDATE fiscal_years SET status = 'closed', closed_at = ? WHERE id = ?`).run(new Date().toISOString(), active.id);
    req.db.close();
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    req.db.close();
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/companies/:companyId/close-year', loadCompany, (req, res) => {
  try {
    const fy = currentFy(req.db, res);
    if (!fy) return;
    const result = accounting.closeFiscalYear(req.db, fy.id, req.body.new_year_start_date);
    req.db.close();
    res.json(result);
  } catch (e) {
    req.db.close();
    res.status(400).json({ error: e.message });
  }
});

// ==================== لوحة التحكم ====================
app.get('/api/companies/:companyId/dashboard', loadCompany, (req, res) => {
  const fy = currentFy(req.db, res);
  if (!fy) return;
  const stmt = accounting.incomeStatement(req.db, { fiscal_year_id: fy.id });
  const bs = accounting.balanceSheet(req.db, { fiscal_year_id: fy.id });
  const sales = req.db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM invoices WHERE kind='sale' AND fiscal_year_id=?`).get(fy.id).t;
  const purchases = req.db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM invoices WHERE kind='purchase' AND fiscal_year_id=?`).get(fy.id).t;
  const receivables = req.db.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) AS t FROM invoices WHERE kind='sale' AND fiscal_year_id=? AND status!='paid'`).get(fy.id).t;
  const payables = req.db.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) AS t FROM invoices WHERE kind='purchase' AND fiscal_year_id=? AND status!='paid'`).get(fy.id).t;
  const recentEntries = accounting.listJournalEntries(req.db, { fiscal_year_id: fy.id, limit: 8 });
  const recentInvoices = invoicesLib.listInvoices(req.db, { fiscal_year_id: fy.id, limit: 8 });
  const cash = accounting.accountBalance(req.db, req.db.prepare(`SELECT * FROM accounts WHERE code='1101'`).get()).balance;
  const bank = accounting.accountBalance(req.db, req.db.prepare(`SELECT * FROM accounts WHERE code='1111'`).get()).balance;

  const salesByMonth = req.db.prepare(`
    SELECT strftime('%m', date) AS m, COALESCE(SUM(total),0) AS t FROM invoices
    WHERE kind='sale' AND fiscal_year_id=? GROUP BY m ORDER BY m
  `).all(fy.id);

  req.db.close();
  res.json({ fy, stmt, bs, sales, purchases, receivables, payables, cash, bank, salesByMonth, recentEntries, recentInvoices });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`نظام المحاسب يعمل على المنفذ ${PORT}`);
});
