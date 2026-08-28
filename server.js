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
const hospitalLib = require('./lib/hospital');
const inventoryLib = require('./lib/inventory');

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
    const companyId = Number(req.params.companyId);
    if (usersLib.hasPerm(req.user, companyId, windowKey, action)) return next();
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
  // المستخدم العادي يرى فقط الشركات التي لديه صلاحيات فيها
  const visible = req.user.role === 'admin'
    ? companies
    : companies.filter(c => usersLib.userHasCompany(req.user, c.id));
  res.json({ companies: visible });
});

app.get('/api/company-types', (req, res) => {
  const types = Object.keys({
    corporate: chartsLib.typeLabel('corporate'),
    supermarket: chartsLib.typeLabel('supermarket'),
    factory: chartsLib.typeLabel('factory'),
    medical_lab: chartsLib.typeLabel('medical_lab'),
    hospital: chartsLib.typeLabel('hospital')
  }).map(t => ({ code: t, label: chartsLib.typeLabel(t) }));
  res.json({ types });
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
  if (!usersLib.userHasCompany(req.user, company.id)) {
    return res.status(403).json({ error: 'ليست لديك صلاحية لهذه الشركة' });
  }
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
  if (!usersLib.hasPerm(req.user, company.id, invoiceWindow(inv.kind), 'view')) { db.close(); return res.status(403).json({ error: 'ليست لديك صلاحية لهذه العملية' }); }
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
    if (!usersLib.hasPerm(req.user, company.id, invoiceWindow(inv.kind), 'edit')) { db.close(); return res.status(403).json({ error: 'ليست لديك صلاحية لهذه العملية' }); }
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

// ==================== نظام المشافي ====================
function getCompanyDb(req, res) {
  const company = getCompany(Number(req.params.companyId));
  if (!company) { res.status(404).json({ error: 'الشركة غير موجودة' }); return null; }
  const db = accounting.getDb(company.id);
  return { company, db };
}

// ==================== نظام المستودعات والمخزون ====================

// ---------- المستودعات ----------
app.get('/api/companies/:companyId/warehouses', windowPerm('warehouses', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(inventoryLib.listWarehouses(ctx.db));
  ctx.db.close();
});

app.post('/api/companies/:companyId/warehouses', windowPerm('warehouses', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { res.json(inventoryLib.createWarehouse(ctx.db, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.put('/api/companies/:companyId/warehouses/:whId', windowPerm('warehouses', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const w = inventoryLib.updateWarehouse(ctx.db, req.params.whId, req.body);
  ctx.db.close();
  if (!w) return res.status(404).json({ error: 'المستودع غير موجود' });
  res.json(w);
});

app.delete('/api/companies/:companyId/warehouses/:whId', windowPerm('warehouses', 'delete'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { inventoryLib.deleteWarehouse(ctx.db, req.params.whId); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

// ---------- المنتجات ----------
app.get('/api/companies/:companyId/products', windowPerm('products', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(inventoryLib.listProducts(ctx.db, { search: req.query.search, includeInactive: req.query.all === '1' }));
  ctx.db.close();
});

app.get('/api/companies/:companyId/products/barcode/:code', windowPerm('products', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const p = inventoryLib.findByBarcode(ctx.db, req.params.code);
  ctx.db.close();
  if (!p) return res.status(404).json({ error: 'لا يوجد منتج بهذا الباركود' });
  res.json(p);
});

app.post('/api/companies/:companyId/products', windowPerm('products', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { res.json(inventoryLib.createProduct(ctx.db, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.put('/api/companies/:companyId/products/:productId', windowPerm('products', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try {
    const p = inventoryLib.updateProduct(ctx.db, req.params.productId, req.body);
    ctx.db.close();
    if (!p) return res.status(404).json({ error: 'المنتج غير موجود' });
    res.json(p);
  } catch (e) {
    ctx.db.close();
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/companies/:companyId/products/:productId', windowPerm('products', 'delete'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { inventoryLib.deleteProduct(ctx.db, req.params.productId); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

// ---------- الأرصدة والحركات ----------
app.get('/api/companies/:companyId/stock', windowPerm('inventory', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(inventoryLib.stockBalances(ctx.db, { warehouseId: req.query.warehouse_id, search: req.query.search }));
  ctx.db.close();
});

app.get('/api/companies/:companyId/stock/summary', windowPerm('inventory', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(inventoryLib.stockSummary(ctx.db));
  ctx.db.close();
});

app.get('/api/companies/:companyId/stock/movements', windowPerm('inventory', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(inventoryLib.listMovements(ctx.db, { productId: req.query.product_id, warehouseId: req.query.warehouse_id }));
  ctx.db.close();
});

// ---------- الجرد ----------
app.get('/api/companies/:companyId/counts', windowPerm('inventory', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const fy = ctx.db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { ctx.db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  res.json(inventoryLib.listCounts(ctx.db, { fiscal_year_id: fy.id }));
  ctx.db.close();
});

app.post('/api/companies/:companyId/counts', windowPerm('inventory', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try {
    const fy = ctx.db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!fy) { ctx.db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    res.json(inventoryLib.createCount(ctx.db, { ...req.body, fiscal_year_id: fy.id }));
  } catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.get('/api/companies/:companyId/counts/:countId', windowPerm('inventory', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const c = inventoryLib.getCount(ctx.db, req.params.countId);
  ctx.db.close();
  if (!c) return res.status(404).json({ error: 'الجرد غير موجود' });
  res.json(c);
});

app.put('/api/companies/:companyId/counts/:countId/lines/:lineId', windowPerm('inventory', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { res.json(inventoryLib.updateCountLine(ctx.db, req.params.countId, req.params.lineId, req.body.count_qty)); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.post('/api/companies/:companyId/counts/:countId/finalize', windowPerm('inventory', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try {
    const fy = ctx.db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!fy) { ctx.db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    res.json(inventoryLib.finalizeCount(ctx.db, req.params.countId, fy.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.post('/api/companies/:companyId/counts/:countId/cancel', windowPerm('inventory', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { inventoryLib.cancelCount(ctx.db, req.params.countId); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

// ---------- نقطة البيع ----------
app.post('/api/companies/:companyId/pos/sell', windowPerm('pos', 'add'), async (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try {
    const fy = ctx.db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!fy) { ctx.db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    let party = ctx.db.prepare(`SELECT id FROM parties WHERE type = 'customer' AND name = ? LIMIT 1`).get('عميل نقدي');
    if (!party) party = partiesLib.createParty(ctx.db, { type: 'customer', name: 'عميل نقدي' });
    const inv = await invoicesLib.createInvoice(ctx.db, { kind: 'sale', party_id: party.id, ...req.body, fiscal_year_id: fy.id, company: ctx.company });
    ctx.db.close();
    res.json(inv);
  } catch (e) {
    ctx.db.close();
    res.status(400).json({ error: e.message });
  }
});

// ---------- الأقسام ----------
app.get('/api/companies/:companyId/hospital/departments', windowPerm('hosp-doctors', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(hospitalLib.listDepartments(ctx.db));
  ctx.db.close();
});

app.post('/api/companies/:companyId/hospital/departments', windowPerm('hosp-doctors', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { res.json(hospitalLib.createDepartment(ctx.db, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.put('/api/companies/:companyId/hospital/departments/:depId', windowPerm('hosp-doctors', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const d = hospitalLib.updateDepartment(ctx.db, req.params.depId, req.body);
  ctx.db.close();
  if (!d) return res.status(404).json({ error: 'القسم غير موجود' });
  res.json(d);
});

app.delete('/api/companies/:companyId/hospital/departments/:depId', windowPerm('hosp-doctors', 'delete'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { hospitalLib.deleteDepartment(ctx.db, req.params.depId); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

// ---------- الأطباء ----------
app.get('/api/companies/:companyId/hospital/doctors', windowPerm('hosp-doctors', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(hospitalLib.listDoctors(ctx.db, req.query.all === '1'));
  ctx.db.close();
});

app.post('/api/companies/:companyId/hospital/doctors', windowPerm('hosp-doctors', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { res.json(hospitalLib.createDoctor(ctx.db, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.put('/api/companies/:companyId/hospital/doctors/:doctorId', windowPerm('hosp-doctors', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const d = hospitalLib.updateDoctor(ctx.db, req.params.doctorId, req.body);
  ctx.db.close();
  if (!d) return res.status(404).json({ error: 'الطبيب غير موجود' });
  res.json(d);
});

app.delete('/api/companies/:companyId/hospital/doctors/:doctorId', windowPerm('hosp-doctors', 'delete'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  hospitalLib.deleteDoctor(ctx.db, req.params.doctorId);
  ctx.db.close();
  res.json({ ok: true });
});

// ---------- المرضى ----------
app.get('/api/companies/:companyId/hospital/patients', windowPerm('hosp-patients', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(hospitalLib.listPatients(ctx.db, req.query.search));
  ctx.db.close();
});

app.post('/api/companies/:companyId/hospital/patients', windowPerm('hosp-patients', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { res.json(hospitalLib.createPatient(ctx.db, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.put('/api/companies/:companyId/hospital/patients/:patientId', windowPerm('hosp-patients', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const p = hospitalLib.updatePatient(ctx.db, req.params.patientId, req.body);
  ctx.db.close();
  if (!p) return res.status(404).json({ error: 'المريض غير موجود' });
  res.json(p);
});

app.delete('/api/companies/:companyId/hospital/patients/:patientId', windowPerm('hosp-patients', 'delete'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  hospitalLib.deletePatient(ctx.db, req.params.patientId);
  ctx.db.close();
  res.json({ ok: true });
});

// ---------- المواعيد ----------
app.get('/api/companies/:companyId/hospital/appointments', windowPerm('hosp-appointments', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(hospitalLib.listAppointments(ctx.db, { status: req.query.status, patient_id: req.query.patient_id }));
  ctx.db.close();
});

app.post('/api/companies/:companyId/hospital/appointments', windowPerm('hosp-appointments', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { res.json(hospitalLib.createAppointment(ctx.db, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.put('/api/companies/:companyId/hospital/appointments/:apptId', windowPerm('hosp-appointments', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const a = hospitalLib.updateAppointment(ctx.db, req.params.apptId, req.body);
  ctx.db.close();
  if (!a) return res.status(404).json({ error: 'الموعد غير موجود' });
  res.json(a);
});

app.delete('/api/companies/:companyId/hospital/appointments/:apptId', windowPerm('hosp-appointments', 'delete'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  hospitalLib.deleteAppointment(ctx.db, req.params.apptId);
  ctx.db.close();
  res.json({ ok: true });
});

// ---------- السجلات الطبية ----------
app.get('/api/companies/:companyId/hospital/records', windowPerm('hosp-records', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(hospitalLib.listMedicalRecords(ctx.db, req.query.patient_id));
  ctx.db.close();
});

app.post('/api/companies/:companyId/hospital/records', windowPerm('hosp-records', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { res.json(hospitalLib.createMedicalRecord(ctx.db, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.put('/api/companies/:companyId/hospital/records/:recordId', windowPerm('hosp-records', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const r = hospitalLib.updateMedicalRecord(ctx.db, req.params.recordId, req.body);
  ctx.db.close();
  if (!r) return res.status(404).json({ error: 'السجل غير موجود' });
  res.json(r);
});

app.delete('/api/companies/:companyId/hospital/records/:recordId', windowPerm('hosp-records', 'delete'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  hospitalLib.deleteMedicalRecord(ctx.db, req.params.recordId);
  ctx.db.close();
  res.json({ ok: true });
});

// ---------- الخدمات الطبية ----------
app.get('/api/companies/:companyId/hospital/services', windowPerm('hosp-billing', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  res.json(hospitalLib.listServices(ctx.db, req.query.all === '1'));
  ctx.db.close();
});

app.post('/api/companies/:companyId/hospital/services', windowPerm('hosp-billing', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { res.json(hospitalLib.createService(ctx.db, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

app.put('/api/companies/:companyId/hospital/services/:serviceId', windowPerm('hosp-billing', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const s = hospitalLib.updateService(ctx.db, req.params.serviceId, req.body);
  ctx.db.close();
  if (!s) return res.status(404).json({ error: 'الخدمة غير موجودة' });
  res.json(s);
});

app.delete('/api/companies/:companyId/hospital/services/:serviceId', windowPerm('hosp-billing', 'delete'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try { hospitalLib.deleteService(ctx.db, req.params.serviceId); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { ctx.db.close(); }
});

// ---------- فواتير المرضى ----------
app.get('/api/companies/:companyId/hospital/bills', windowPerm('hosp-billing', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const fy = ctx.db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { ctx.db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  res.json(hospitalLib.listBills(ctx.db, { fiscal_year_id: fy.id, status: req.query.status }));
  ctx.db.close();
});

app.get('/api/companies/:companyId/hospital/bills/:billId', windowPerm('hosp-billing', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const b = hospitalLib.getBill(ctx.db, req.params.billId);
  ctx.db.close();
  if (!b) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  res.json(b);
});

app.post('/api/companies/:companyId/hospital/bills', windowPerm('hosp-billing', 'add'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try {
    const fy = ctx.db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!fy) { ctx.db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    const bill = hospitalLib.createBill(ctx.db, { ...req.body, fiscal_year_id: fy.id });
    ctx.db.close();
    res.json(bill);
  } catch (e) {
    ctx.db.close();
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/companies/:companyId/hospital/bills/:billId/pay', windowPerm('hosp-billing', 'edit'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try {
    const fy = ctx.db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
    if (!fy) { ctx.db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
    const bill = hospitalLib.recordBillPayment(ctx.db, { billId: req.params.billId, ...req.body, fiscal_year_id: fy.id });
    ctx.db.close();
    res.json(bill);
  } catch (e) {
    ctx.db.close();
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/companies/:companyId/hospital/bills/:billId', windowPerm('hosp-billing', 'delete'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  try {
    const ok = hospitalLib.deleteBill(ctx.db, req.params.billId);
    if (!ok) { ctx.db.close(); return res.status(404).json({ error: 'الفاتورة غير موجودة' }); }
    ctx.db.close();
    res.json({ ok: true });
  } catch (e) {
    ctx.db.close();
    res.status(400).json({ error: e.message });
  }
});

// ---------- لوحة تحكم المشفى ----------
app.get('/api/companies/:companyId/hospital/dashboard', windowPerm('hosp-dashboard', 'view'), (req, res) => {
  const ctx = getCompanyDb(req, res);
  if (!ctx) return;
  const fy = ctx.db.prepare(`SELECT * FROM fiscal_years WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) { ctx.db.close(); return res.status(400).json({ error: 'لا توجد سنة مالية مفتوحة' }); }
  res.json(hospitalLib.hospitalDashboard(ctx.db, fy.id));
  ctx.db.close();
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
