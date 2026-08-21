'use strict';
// سكريبت تهيئة بيانات تجريبية لشركات مختلفة الأنشطة
const fs = require('fs');
const path = require('path');

// تنظيف مجلد البيانات قبل أي فتح لقواعد البيانات
const DATA_DIR = path.join(__dirname, 'data');
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const { createCompany } = require('./lib/master-db');
const accounting = require('./lib/accounting');
const { openCompanyDb } = require('./lib/company-db');
const invoicesLib = require('./lib/invoices');
const partiesLib = require('./lib/parties');
const usersLib = require('./lib/users');

// إنشاء حساب المدير الافتراضي: admin / admin123
usersLib.ensureDefaultAdmin();

function acct(db, code) {
  return db.prepare(`SELECT * FROM accounts WHERE code = ?`).get(code);
}

function fy(db) {
  return db.prepare(`SELECT * FROM fiscal_years WHERE status='open' ORDER BY id DESC LIMIT 1`).get();
}

function seedCompany(data, setup) {
  const company = createCompany(data);
  accounting.initCompanyDatabase(company);
  const db = openCompanyDb(company.id);
  const year = fy(db);
  const inv = (opts) => invoicesLib.createInvoice(db, { ...opts, company });
  setup(db, year, inv);
  db.close();
  console.log(`✓ ${company.name} (${data.business_type})`);
}

// ============ شركة استشارات ============
seedCompany({
  name: 'شركة الأفق للاستشارات المالية', business_type: 'corporate',
  cr_number: '1010456789', vat_number: '310123456700003', vat_rate: 15,
  address: 'الرياض - حي العليا', phone: '0112345678', email: 'info@ofoq.sa'
}, (db, year, inv) => {
  const j = (date, desc, lines) => accounting.createJournalEntry(db, { date, description: desc, fiscal_year_id: year.id, lines });
  const L = (code, debit, credit, detail = '') => ({ account_id: acct(db, code).id, debit, credit, detail });
  const fyStart = year.start_date;

  j(fyStart, 'رأس المال النقدي', [L('1111', 800000), L('3101', 0, 800000)]);
  j('2026-01-15', 'شراء أثاث مكتبي نقداً', [L('1505', 45000), L('1111', 0, 45000)]);
  j('2026-02-01', 'إيجار مكتب سنوي', [L('5202', 120000), L('1402', 0, 120000)]);
  j('2026-02-10', 'رواتب الموظفين', [L('5201', 60000), L('1111', 0, 60000)]);

  const cust = partiesLib.createParty(db, { type: 'customer', name: 'شركة النخبة للتطوير العقاري', tax_id: '300987654300003', phone: '0501112222' });
  const cust2 = partiesLib.createParty(db, { type: 'customer', name: 'مؤسسة البنيان التجارية', tax_id: '300111222333003' });
  inv({ kind: 'sale', party_id: cust.id, date: '2026-03-01', payment_method: 'bank_transfer', fiscal_year_id: year.id,
    lines: [{ description: 'خدمة استشارية - دراسة جدوى', qty: 1, unit_price: 95000 }] });
  inv({ kind: 'sale', party_id: cust2.id, date: '2026-04-05', payment_method: 'credit', paid_amount: 30000, fiscal_year_id: year.id,
    lines: [{ description: 'إعداد هيكل تنظيمي وإداري', qty: 1, unit_price: 60000 }] });
  inv({ kind: 'sale', party_id: cust.id, date: '2026-05-10', payment_method: 'apple_pay', fiscal_year_id: year.id,
    lines: [{ description: 'ورشة عمل - حوكمة الشركات', qty: 2, unit_price: 15000 }] });
  inv({ kind: 'sale', party_id: cust2.id, date: '2026-06-15', payment_method: 'sadad', fiscal_year_id: year.id,
    lines: [{ description: 'مراجعة وتدقيق الحسابات', qty: 1, unit_price: 70000 }] });

  j('2026-07-01', 'مصاريف اتصال وإنترنت', [L('5204', 4500), L('1111', 0, 4500)]);
  j('2026-08-01', 'تسويق وإعلان', [L('5206', 12000), L('1111', 0, 12000)]);
});

// ============ سوبر ماركت ============
seedCompany({
  name: 'سوبر ماركت الخير للمواد الغذائية', business_type: 'supermarket',
  cr_number: '2050456789', vat_number: '310555666700003', vat_rate: 15,
  address: 'جدة - حي الروضة', phone: '0123456789', email: 'sales@alkhair.sa'
}, (db, year, inv) => {
  const j = (date, desc, lines) => accounting.createJournalEntry(db, { date, description: desc, fiscal_year_id: year.id, lines });
  const L = (code, debit, credit, detail = '') => ({ account_id: acct(db, code).id, debit, credit, detail });

  j(year.start_date, 'رأس المال النقدي', [L('1101', 150000), L('3101', 0, 150000)]);

  const supplier = partiesLib.createParty(db, { type: 'supplier', name: 'شركة الوفير للمواد الغذائية', tax_id: '300777888900003', phone: '0554443332' });
  const supplier2 = partiesLib.createParty(db, { type: 'supplier', name: 'مصنع الألبان الطازج', tax_id: '300123321000003' });
  const c1 = partiesLib.createParty(db, { type: 'customer', name: 'عميل نقدي' });
  const c2 = partiesLib.createParty(db, { type: 'customer', name: 'مؤسسة التموين الذهبية', tax_id: '300999888777003' });

  inv({ kind: 'purchase', party_id: supplier.id, date: '2026-01-10', payment_method: 'credit', paid_amount: 80000, fiscal_year_id: year.id,
    lines: [{ description: 'مواد غذائية متنوعة', qty: 1, unit_price: 120000 }] });
  inv({ kind: 'purchase', party_id: supplier2.id, date: '2026-01-15', payment_method: 'bank_transfer', fiscal_year_id: year.id,
    lines: [{ description: 'ألبان ومشتقات', qty: 1, unit_price: 40000 }] });

  inv({ kind: 'sale', party_id: c1.id, date: '2026-02-03', payment_method: 'mada', fiscal_year_id: year.id,
    lines: [{ description: 'بقالة متنوعة', qty: 60, unit_price: 500 }, { description: 'عصائر ومشروبات', qty: 40, unit_price: 350 }] });
  inv({ kind: 'sale', party_id: c2.id, date: '2026-02-20', payment_method: 'credit', paid_amount: 20000, fiscal_year_id: year.id,
    lines: [{ description: 'توريد بضاعة لحفلات', qty: 1, unit_price: 45000 }] });
  inv({ kind: 'sale', party_id: c1.id, date: '2026-03-05', payment_method: 'apple_pay', fiscal_year_id: year.id,
    lines: [{ description: 'معلبات وحبوب', qty: 80, unit_price: 400 }] });
  inv({ kind: 'sale', party_id: c1.id, date: '2026-03-18', payment_method: 'stc_pay', fiscal_year_id: year.id,
    lines: [{ description: 'منظفات ومواد استهلاكية', qty: 50, unit_price: 300 }] });
  inv({ kind: 'sale', party_id: c1.id, date: '2026-04-02', payment_method: 'cash', fiscal_year_id: year.id,
    lines: [{ description: 'خضار وفواكه', qty: 30, unit_price: 600 }] });

  j('2026-04-30', 'رواتب موظفي السوبر ماركت', [L('5201', 25000), L('1101', 0, 25000)]);
  j('2026-05-01', 'إيجار المقر التجاري', [L('5202', 30000), L('1101', 0, 30000)]);
  j('2026-05-15', 'مصروفات كهرباء وتبريد', [L('5203', 8000), L('1101', 0, 8000)]);
});

// ============ مصنع ============
seedCompany({
  name: 'مصنع النور للصناعات الغذائية', business_type: 'factory',
  cr_number: '2055678123', vat_number: '310111222333003', vat_rate: 15,
  address: 'الدمام - المنطقة الصناعية الثانية', phone: '0138456789', email: 'info@alnoor-factory.sa'
}, (db, year, inv) => {
  const j = (date, desc, lines) => accounting.createJournalEntry(db, { date, description: desc, fiscal_year_id: year.id, lines });
  const L = (code, debit, credit, detail = '') => ({ account_id: acct(db, code).id, debit, credit, detail });

  j(year.start_date, 'رأس المال - إيداع بنكي', [L('1111', 2000000), L('3101', 0, 2000000)]);
  j(year.start_date, 'شراء آلات إنتاج', [L('1508', 500000), L('1111', 0, 500000)]);
  j(year.start_date, 'شراء خط تعبئة', [L('1503', 300000), L('1111', 0, 300000)]);

  const supplier = partiesLib.createParty(db, { type: 'supplier', name: 'شركة الحبوب والمواد الخام', tax_id: '300444555666003' });
  const supplier2 = partiesLib.createParty(db, { type: 'supplier', name: 'مؤسسة التغليف الحديثة', tax_id: '300777888999003' });
  const customer = partiesLib.createParty(db, { type: 'customer', name: 'التموين المركزية', tax_id: '300123456789003' });
  const customer2 = partiesLib.createParty(db, { type: 'customer', name: 'هايبر الشرق للتجزئة', tax_id: '300987654321003' });

  inv({ kind: 'purchase', party_id: supplier.id, date: '2026-02-01', payment_method: 'bank_transfer', fiscal_year_id: year.id,
    lines: [{ description: 'مواد أولية - دقيق وسكر وزيت', qty: 1, unit_price: 350000 }] });
  inv({ kind: 'purchase', party_id: supplier2.id, date: '2026-02-10', payment_method: 'credit', paid_amount: 30000, fiscal_year_id: year.id,
    lines: [{ description: 'عبوات ومواد تغليف', qty: 1, unit_price: 60000 }] });

  // إنتاج وأجور
  j('2026-03-01', 'أجور عمال الإنتاج (شهر فبراير)', [L('5112', 90000), L('1111', 0, 90000)]);
  j('2026-03-01', 'رواتب إدارية وفنية', [L('5201', 60000), L('1111', 0, 60000)]);
  j('2026-03-05', 'صيانة وتشغيل الآلات', [L('5115', 18000), L('1111', 0, 18000)]);
  j('2026-03-10', 'مصروفات كهرباء ووقود المصنع', [L('5203', 25000), L('1111', 0, 25000)]);
  j('2026-03-15', 'مصروف إهلاك آلات وخطوط الإنتاج', [L('5207', 22000), L('1599', 0, 22000)]);

  inv({ kind: 'sale', party_id: customer.id, date: '2026-03-20', payment_method: 'credit', paid_amount: 150000, fiscal_year_id: year.id,
    lines: [{ description: 'منتجات مصنعة - بسكويت وحلويات (بالجملة)', qty: 5000, unit_price: 40 }] });
  inv({ kind: 'sale', party_id: customer2.id, date: '2026-04-05', payment_method: 'bank_transfer', fiscal_year_id: year.id,
    lines: [{ description: 'تعبئة عائلية - تشكيلة', qty: 3000, unit_price: 55 }] });
  inv({ kind: 'sale', party_id: customer.id, date: '2026-05-01', payment_method: 'sadad', fiscal_year_id: year.id,
    lines: [{ description: 'منتجات مصنعة - وافل', qty: 2500, unit_price: 35 }] });
});

// ============ مخبر طبي ============
seedCompany({
  name: 'مخبر المستقبل الطبي للتحاليل', business_type: 'medical_lab',
  cr_number: '4030456789', vat_number: '310222333444003', vat_rate: 15,
  address: 'الرياض - حي السليمانية', phone: '0114587896', email: 'care@almustaqbal-lab.sa'
}, (db, year, inv) => {
  const j = (date, desc, lines) => accounting.createJournalEntry(db, { date, description: desc, fiscal_year_id: year.id, lines });
  const L = (code, debit, credit, detail = '') => ({ account_id: acct(db, code).id, debit, credit, detail });

  j(year.start_date, 'رأس المال النقدي', [L('1111', 500000), L('3101', 0, 500000)]);
  j(year.start_date, 'شراء أجهزة تحاليل', [L('1509', 260000), L('1111', 0, 260000)]);
  j(year.start_date, 'تجهيزات وأثاث مختبر', [L('1505', 40000), L('1111', 0, 40000)]);

  const supplier = partiesLib.createParty(db, { type: 'supplier', name: 'شركة المستلزمات الطبية الحديثة', tax_id: '300222111000003' });
  const insurance = partiesLib.createParty(db, { type: 'customer', name: 'شركة التأمين الصحية المتكاملة', tax_id: '300555444333003' });
  const clinic = partiesLib.createParty(db, { type: 'customer', name: 'عيادات الطبيب المتميز', tax_id: '300888777666003' });

  inv({ kind: 'purchase', party_id: supplier.id, date: '2026-01-20', payment_method: 'bank_transfer', fiscal_year_id: year.id,
    lines: [{ description: 'مستلزمات ومحاليل مخبرية', qty: 1, unit_price: 45000 }] });

  inv({ kind: 'sale', party_id: insurance.id, date: '2026-02-10', payment_method: 'credit', paid_amount: 25000, fiscal_year_id: year.id,
    lines: [{ description: 'تحاليل طبية - عقود تأمين', qty: 1, unit_price: 80000 }] });
  inv({ kind: 'sale', party_id: clinic.id, date: '2026-03-02', payment_method: 'credit', paid_amount: 20000, fiscal_year_id: year.id,
    lines: [{ description: 'فحوصات مخبرية - عيادات', qty: 1, unit_price: 35000 }] });
  inv({ kind: 'sale', party_id: null, date: '2026-03-15', payment_method: 'mada', fiscal_year_id: year.id,
    lines: [{ description: 'تحاليل مباشرة - عملاء', qty: 1, unit_price: 25000 }] });

  j('2026-03-31', 'رواتب طاقم المختبر', [L('5201', 45000), L('1111', 0, 45000)]);
  j('2026-04-01', 'إيجار المقر الطبي', [L('5202', 60000), L('1111', 0, 60000)]);
  j('2026-04-10', 'مصروف إهلاك الأجهزة الطبية', [L('5207', 18000), L('1599', 0, 18000)]);
});

console.log('تم إنشاء البيانات التجريبية بنجاح.');
