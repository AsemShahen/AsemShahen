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
const usersLib = require('./lib/users');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(bodyParser.json({ limit: '10mb' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/js/') || req.path.startsWith('/css/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- المصادقة (بوابة الدخول) ----------
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/health') return next();
  const token = String(req.headers['x-auth-token'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = usersLib.getSessionUser(token);
  if (!user) return res.status(401).json({ error: 'الرجاء تسجيل الدخول' });
  req.user = user;
  req.token = token;
  next();
});

// ---------- أدوات التحقق من الصلاحيات ----------
function windowPerm(windowKey, action = 'view') {
  return (req, res, next) => {
    if (usersLib.hasPerm(req.user, windowKey, action)) return next();
    return res.status(403).json({ error: 'ليست لديك صلاحية لهذه العملية' });
  };
}

function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'هذه العملية متاحة لمدير النظام فقط' });
}

function invoiceWindow(kind) {
  return kind === 'purchase' ? 'invoices-purchase' : 'invoices-sale';
}

function invPerm(action) {
  return (req, res, next) => {
    const kind = (req.body && req.body.kind) || (req.query && req.query.kind);
    return windowPerm(invoiceWindow(kind), action)(req, res, next);
  };
}

// ---------- المصادقة: دخول وخروج وتفاصيل المستخدم ----------
app.post('/api/login', (req, res) => {
  const user = usersLib.authenticate(req.body && req.body.username, req.body && req.body.password);
  if (!user) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  const token = usersLib.createSession(user.id);
  res.json({ token, user });
});

app.post('/api/logout', (req, res) => {
  usersLib.deleteSession(req.token);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: req.user }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ==================== المستخدمون والصلاحيات (للمدير فقط) ====================
app.get('/api/permission-model', adminOnly, (req, res) => {
  res.json({ windows: usersLib.WINDOWS, actions: usersLib.ACTIONS });
});

app.get('/api/users', adminOnly, (req, res) => {
  res.json(usersLib.listUsers());
});

app.post('/api/users', adminOnly, (req, res) => {
  try {
    res.json(usersLib.createUser(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/users/:id', adminOnly, (req, res) => {
  try {
    const u = usersLib.updateUser(Number(req.params.id), req.body);
    if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json(u);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/users/:id', adminOnly, (req, res) => {
  try {
    const ok = usersLib.deleteUser(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ==================== الشركات ====================
app.get('/api/companies', (req, res) => {
  const companies = listCompanies().map(c => {
    const db = accounting.getDb(c.id);
    const fy = db.prepare(`SELECT * FROM fiscal_years ORDER BY id DESC LIMIT 1`).get();
    const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM journal_entries) AS entries, (SELECT COUNT(*) FROM invoices) AS invoices`).get();
    db.close();
    return { ...c, current_fiscal_year: fy, counts };
  });
  res.json({ companies });
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

app.post('/api/companies', adminOnly, (req, res) => {
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

app.put('/api/companies/:companyId', adminOnly, (req, res) => {
  try {
    const company = updateCompany(req.params.companyId, req.body);
    res.json(company);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId', adminOnly, (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
  const years = db.prepare('SELECT * FROM fiscal_years ORDER BY id').all();
  db.close();
  res.json({ company, settings, fiscal_years: years });
});

// ==================== الشركة: البيانات الأساسية ====================
app.get('/api/companies/:companyId/info', (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
  const years = db.prepare('SELECT * FROM fiscal_years ORDER BY id').all();
  const activeFy = years.find(y => y.status === 'open') || years[years.length - 1];
  const paymentMethods = db.prepare('SELECT * FROM payment_methods ORDER BY is_active DESC, code').all();
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM journal_entries) AS entries,
    (SELECT COUNT(*) FROM invoices) AS invoices,
    (SELECT COUNT(*) FROM parties) AS parties,
    (SELECT COUNT(*) FROM accounts WHERE is_header=0) AS accounts`).get();
  const vat = accounting.vatReport(db, {});
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN kind='sale' THEN total END),0) AS sales,
    COALESCE(SUM(CASE WHEN kind='purchase' THEN total END),0) AS purchases,
    COALESCE(SUM(CASE WHEN kind='sale' AND status!='paid' THEN total-paid_amount END),0) AS receivables,
    COALESCE(SUM(CASE WHEN kind='purchase' AND status!='paid' THEN total-paid_amount END),0) AS payables
    FROM invoices`).get();
  res.json({ settings, fiscal_years: years, active_fiscal_year: activeFy, payment_methods: paymentMethods, counts, vat, totals, business_type_label: chartsLib.typeLabel(company.business_type) });
  db.close();
});

// ==================== المخطط المحاسبي ====================
app.get('/api/companies/:companyId/accounts', windowPerm('accounts', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY code').all();
  const result = accounts.map(a => {
    const bal = accounting.accountBalance(db, a, { fiscal_year_id: fy.id });
    return { ...a, balance: bal.balance, debit: bal.debit, credit: bal.credit, fiscal_year: fy };
  });
  db.close();
  res.json(result);
});

app.post('/api/companies/:companyId/accounts', windowPerm('accounts', 'add'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  try {
    const b = req.body;
    const exists = db.prepare('SELECT id FROM accounts WHERE code = ?').get(b.code);
    if (exists) throw new Error('رقم الحساب موجود مسبقاً');
    const info = db.prepare(`
      INSERT INTO accounts (code, name, type, category, parent_code, is_header, normal_side, vat_applicable, opening_balance, is_system, sort_order)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0)
    `).run(b.code, b.name, b.type, b.category || 'other', b.parent_code || null, b.normal_side || (b.type === 'asset' || b.type === 'expense' ? 'debit' : 'credit'), b.vat_applicable !== undefined ? (b.vat_applicable ? 1 : 0) : 1, Number(b.opening_balance) || 0);
    if (Number(b.opening_balance) || 0) {
      const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
      const retained = db.prepare(`SELECT * FROM accounts WHERE code='3201'`).get();
      const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
      if (fy && retained) {
        const side = acct.normal_side === 'credit' ? 1 : -1;
        const lines = [];
        if (side > 0) { lines.push({ account_id: acct.id, credit: Number(b.opening_balance) }); lines.push({ account_id: retained.id, debit: Number(b.opening_balance) }); }
        else { lines.push({ account_id: acct.id, debit: Number(b.opening_balance) }); lines.push({ account_id: retained.id, credit: Number(b.opening_balance) }); }
        accounting.createJournalEntry(db, { date: fy.start_date, description: `رصيد افتتاحي للحساب ${b.code} - ${b.name}`, fiscal_year_id: fy.id, lines });
      }
    }
    const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
    db.close();
    res.json(acct);
  } catch (e) {
    db.close();
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/companies/:companyId/accounts/:accountId', windowPerm('accounts', 'edit'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const b = req.body;
  db.prepare(`
    UPDATE accounts SET name=?, type=?, category=?, normal_side=?, vat_applicable=? WHERE id=?
  `).run(b.name || '', b.type || 'asset', b.category || 'other', b.normal_side || 'debit', b.vat_applicable !== undefined ? (b.vat_applicable ? 1 : 0) : 1, req.params.accountId);
  const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.accountId);
  db.close();
  res.json(acct);
});

// ==================== قيود اليومية ====================
app.get('/api/companies/:companyId/journal', windowPerm('journal', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  const entries = accounting.listJournalEntries(db, { fiscal_year_id: fy.id, limit: 1000 });
  db.close();
  res.json(entries);
});

app.post('/api/companies/:companyId/journal', windowPerm('journal', 'add'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  try {
    const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    const entry = accounting.createJournalEntry(db, { ...req.body, fiscal_year_id: fy.id });
    db.close();
    res.json(entry);
  } catch (e) {
    db.close();
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId/journal/:entryId', windowPerm('journal', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const entry = accounting.getJournalEntry(db, req.params.entryId);
  db.close();
  if (!entry) return res.status(404).json({ error: 'القيد غير موجود' });
  res.json(entry);
});

app.delete('/api/companies/:companyId/journal/:entryId', windowPerm('journal', 'delete'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.entryId);
  if (!entry) { db.close(); return res.status(404).json({ error: 'القيد غير موجود' }); }
  if (entry.is_closing || entry.is_opening) { db.close(); return res.status(400).json({ error: 'لا يمكن حذف قيود الإقفال أو الافتتاح' }); }
  db.prepare('DELETE FROM journal_lines WHERE entry_id = ?').run(entry.id);
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(entry.id);
  db.close();
  res.json({ ok: true });
});

// ==================== دليل الأستاذ ====================
app.get('/api/companies/:companyId/ledger/:accountId', windowPerm('ledger', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.accountId);
  if (!account) { db.close(); return res.status(404).json({ error: 'الحساب غير موجود' }); }
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  const { from, to } = req.query;
  const lines = accounting.getLedger(db, account.id, { from, to, fiscal_year_id: fy.id });
  const bal = accounting.accountBalance(db, account, { asOf: to || null, fiscal_year_id: fy.id });
  db.close();
  res.json({ account, lines, balance: bal, fiscal_year: fy });
});

// ==================== ميزان المراجعة ====================
app.get('/api/companies/:companyId/trial-balance', windowPerm('trial-balance', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  const tb = accounting.trialBalance(db, { fiscal_year_id: fy.id, asOf: req.query.asOf });
  db.close();
  res.json(tb);
});

// ==================== القوائم المالية ====================
app.get('/api/companies/:companyId/income-statement', windowPerm('income-statement', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  const stmt = accounting.incomeStatement(db, { fiscal_year_id: fy.id, asOf: req.query.asOf });
  db.close();
  res.json(stmt);
});

app.get('/api/companies/:companyId/balance-sheet', windowPerm('balance-sheet', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  const bs = accounting.balanceSheet(db, { fiscal_year_id: fy.id, asOf: req.query.asOf });
  db.close();
  res.json(bs);
});

// ==================== تقرير الضريبة ====================
app.get('/api/companies/:companyId/vat-report', windowPerm('vat', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  const vat = accounting.vatReport(db, { asOf: req.query.asOf, fiscal_year_id: fy.id });
  const details = db.prepare(`
    SELECT je.date, je.entry_no, je.description, jl.vat_amount, jl.vat_type, a.code, a.name AS account_name
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
    WHERE jl.vat_amount > 0 ORDER BY je.date DESC LIMIT 500
  `).all();
  db.close();
  res.json({ ...vat, details });
});

// ==================== العملاء والموردون ====================
app.get('/api/companies/:companyId/parties', windowPerm('parties', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const list = partiesLib.listParties(db, req.query.type);
  db.close();
  res.json(list);
});

app.post('/api/companies/:companyId/parties', windowPerm('parties', 'add'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const party = partiesLib.createParty(db, req.body);
  db.close();
  res.json(party);
});

app.put('/api/companies/:companyId/parties/:partyId', windowPerm('parties', 'edit'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const party = partiesLib.updateParty(db, req.params.partyId, req.body);
  db.close();
  if (!party) return res.status(404).json({ error: 'الطرف غير موجود' });
  res.json(party);
});

// ==================== الفواتير ====================
app.get('/api/companies/:companyId/invoices', invPerm('view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  const invs = invoicesLib.listInvoices(db, { kind: req.query.kind, fiscal_year_id: fy.id });
  db.close();
  res.json(invs);
});

app.post('/api/companies/:companyId/invoices', invPerm('add'), async (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  try {
    const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    const inv = await invoicesLib.createInvoice(db, { ...req.body, fiscal_year_id: fy.id, company });
    db.close();
    res.json(inv);
  } catch (e) {
    db.close();
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId/invoices/:invoiceId', (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const inv = invoicesLib.getInvoice(db, req.params.invoiceId);
  if (!inv) { db.close(); return res.status(404).json({ error: 'الفاتورة غير موجودة' }); }
  if (!usersLib.hasPerm(req.user, invoiceWindow(inv.kind), 'view')) { db.close(); return res.status(403).json({ error: 'ليست لديك صلاحية لهذه العملية' }); }
  db.close();
  res.json(inv);
});

app.post('/api/companies/:companyId/invoices/:invoiceId/pay', (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.invoiceId);
    if (!inv) { db.close(); return res.status(404).json({ error: 'الفاتورة غير موجودة' }); }
    if (!usersLib.hasPerm(req.user, invoiceWindow(inv.kind), 'edit')) { db.close(); return res.status(403).json({ error: 'ليست لديك صلاحية لهذه العملية' }); }
    const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    const result = invoicesLib.recordPayment(db, { invoiceId: req.params.invoiceId, ...req.body, fiscal_year_id: fy.id });
    db.close();
    res.json(result);
  } catch (e) {
    db.close();
    res.status(400).json({ error: e.message });
  }
});

// ==================== الفاتورة الإلكترونية ZATCA ====================
app.get('/api/companies/:companyId/invoices/:invoiceId/zatca', windowPerm('invoices-sale', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const inv = invoicesLib.getInvoice(db, req.params.invoiceId);
  if (!inv) { db.close(); return res.status(404).json({ error: 'الفاتورة غير موجودة' }); }
  const config = zatcaLib.getConfig(db);
  db.close();
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

app.post('/api/companies/:companyId/invoices/:invoiceId/resubmit', windowPerm('invoices-sale', 'edit'), async (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  try {
    const inv = invoicesLib.getInvoice(db, req.params.invoiceId);
    if (!inv) { db.close(); return res.status(404).json({ error: 'الفاتورة غير موجودة' }); }
    if (inv.kind !== 'sale') { db.close(); return res.status(400).json({ error: 'إعادة الإرسال متاحة لفواتير البيع فقط' }); }
    const result = await zatcaLib.applyZatca(db, inv, company);
    db.close();
    res.json(result);
  } catch (e) {
    db.close();
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId/zatca-settings', windowPerm('settings', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const config = zatcaLib.getConfig(db);
  db.close();
  res.json(zatcaLib.maskConfig(config));
});

app.put('/api/companies/:companyId/zatca-settings', windowPerm('settings', 'edit'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const b = req.body;
  const existing = zatcaLib.getConfig(db);
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
  zatcaLib.saveConfig(db, config);
  const saved = zatcaLib.getConfig(db);
  db.close();
  res.json(zatcaLib.maskConfig(saved));
});

// ==================== طرق الدفع ====================
app.get('/api/companies/:companyId/payment-methods', (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const methods = db.prepare('SELECT * FROM payment_methods ORDER BY is_active DESC, code').all();
  db.close();
  res.json(methods);
});

// ==================== السنوات المالية والإقفال ====================
app.get('/api/companies/:companyId/fiscal-years', windowPerm('closing', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const years = db.prepare('SELECT * FROM fiscal_years ORDER BY id').all();
  db.close();
  res.json(years);
});

app.post('/api/companies/:companyId/fiscal-years', windowPerm('closing', 'edit'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  try {
    const active = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!active) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    const name = req.body.name || accounting.nextFiscalYear(db);
    const start = req.body.start_date || `${name}-01-01`;
    const end = req.body.end_date || `${Number(name) + 1}-01-01`;
    const info = db.prepare(`INSERT INTO fiscal_years (name, start_date, end_date, status, created_at) VALUES (?, ?, ?, 'open', ?)`)
      .run(String(name), start, end, new Date().toISOString());
    db.prepare(`UPDATE fiscal_years SET status = 'closed', closed_at = ? WHERE id = ?`).run(new Date().toISOString(), active.id);
    db.close();
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    db.close();
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/companies/:companyId/close-year', windowPerm('closing', 'edit'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  try {
    const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    const result = accounting.closeFiscalYear(db, fy.id, req.body.new_year_start_date);
    db.close();
    res.json(result);
  } catch (e) {
    db.close();
    res.status(400).json({ error: e.message });
  }
});

// ==================== لوحة التحكم ====================
app.get('/api/companies/:companyId/dashboard', windowPerm('dashboard', 'view'), (req, res) => {
  const company = getCompany(Number(req.params.companyId));
  if (!company) return res.status(404).json({ error: 'الشركة غير موجودة' });
  const db = accounting.getDb(company.id);
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  const stmt = accounting.incomeStatement(db, { fiscal_year_id: fy.id });
  const bs = accounting.balanceSheet(db, { fiscal_year_id: fy.id });
  const sales = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM invoices WHERE kind='sale' AND fiscal_year_id=?`).get(fy.id).t;
  const purchases = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM invoices WHERE kind='purchase' AND fiscal_year_id=?`).get(fy.id).t;
  const receivables = db.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) AS t FROM invoices WHERE kind='sale' AND fiscal_year_id=? AND status!='paid'`).get(fy.id).t;
  const payables = db.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) AS t FROM invoices WHERE kind='purchase' AND fiscal_year_id=? AND status!='paid'`).get(fy.id).t;
  const recentEntries = accounting.listJournalEntries(db, { fiscal_year_id: fy.id, limit: 8 });
  const recentInvoices = invoicesLib.listInvoices(db, { fiscal_year_id: fy.id, limit: 8 });
  const cash = accounting.accountBalance(db, db.prepare(`SELECT * FROM accounts WHERE code='1101'`).get()).balance;
  const bank = accounting.accountBalance(db, db.prepare(`SELECT * FROM accounts WHERE code='1111'`).get()).balance;

  const salesByMonth = db.prepare(`
    SELECT strftime('%m', date) AS m, COALESCE(SUM(total),0) AS t FROM invoices
    WHERE kind='sale' AND fiscal_year_id=? GROUP BY m ORDER BY m
  `).all(fy.id);

  db.close();
  res.json({ fy, stmt, bs, sales, purchases, receivables, payables, cash, bank, salesByMonth, recentEntries, recentInvoices });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

usersLib.ensureDefaultAdmin();

app.listen(PORT, () => {
  console.log(`نظام المحاسب يعمل على المنفذ ${PORT}`);
});
