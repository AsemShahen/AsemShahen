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
const hospitalLib = require('./lib/hospital');

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

// ============ مستشفى ============
seedCompany({
  name: 'مستشفى الحياة التخصصي', business_type: 'hospital',
  cr_number: '4030123456', vat_number: '310999888777003', vat_rate: 15,
  address: 'الرياض - حي النرجس', phone: '0115566778', email: 'care@alhayah-hospital.sa'
}, (db, year, inv) => {
  const j = (date, desc, lines) => accounting.createJournalEntry(db, { date, description: desc, fiscal_year_id: year.id, lines });
  const L = (code, debit, credit, detail = '') => ({ account_id: acct(db, code).id, debit, credit, detail });

  j(year.start_date, 'رأس المال النقدي', [L('1111', 3000000), L('3101', 0, 3000000)]);
  j(year.start_date, 'شراء أجهزة ومعدات طبية', [L('1510', 1200000), L('1111', 0, 1200000)]);
  j(year.start_date, 'شراء مخزون أدوية ومستلزمات', [L('1315', 250000), L('1111', 0, 250000)]);

  const internal = hospitalLib.createDepartment(db, { name: 'الباطنية', description: 'قسم الأمراض الباطنية' });
  const pediatric = hospitalLib.createDepartment(db, { name: 'الأطفال' });
  const emergency = hospitalLib.createDepartment(db, { name: 'الطوارئ' });
  const surgery = hospitalLib.createDepartment(db, { name: 'الجراحة العامة' });
  const radiology = hospitalLib.createDepartment(db, { name: 'الأشعة والمختبر' });

  const d1 = hospitalLib.createDoctor(db, { name: 'د. خالد العتيبي', specialty: 'أمراض قلب', department_id: internal.id, qualification: 'استشاري', phone: '0551112223', consultation_fee: 300 });
  const d2 = hospitalLib.createDoctor(db, { name: 'د. سارة الشمري', specialty: 'طب أطفال', department_id: pediatric.id, qualification: 'أخصائي', phone: '0554445556', consultation_fee: 200 });
  const d3 = hospitalLib.createDoctor(db, { name: 'د. محمد القحطاني', specialty: 'طوارئ', department_id: emergency.id, qualification: 'أخصائي', consultation_fee: 250 });
  const d4 = hospitalLib.createDoctor(db, { name: 'د. نورة الدوسري', specialty: 'جراحة عامة', department_id: surgery.id, qualification: 'استشاري', consultation_fee: 500 });

  const p1 = hospitalLib.createPatient(db, { name: 'عبدالله محمد السالم', national_id: '1023456789', gender: 'ذكر', birth_date: '1985-04-12', phone: '0550001112', blood_type: 'O+', insurance_company: 'شركة التأمين العربية' });
  const p2 = hospitalLib.createPatient(db, { name: 'ريم فهد العنزي', national_id: '2098765432', gender: 'أنثى', birth_date: '1992-09-01', phone: '0553334445', blood_type: 'A+', insurance_company: 'التأمين الطبي المتحد' });
  const p3 = hospitalLib.createPatient(db, { name: 'خالد سعد الغامدي', national_id: '1056781234', gender: 'ذكر', birth_date: '1978-01-25', phone: '0567778889', blood_type: 'B+', insurance_company: '' });

  const svcConsult = hospitalLib.createService(db, { name: 'كشف طبيب باطنية', category: 'كشف واستشارات', price: 300, cost: 50, account_code: '4114', vat_applicable: true });
  const svcLab = hospitalLib.createService(db, { name: 'تحليل دم شامل', category: 'مختبر وأشعة', price: 150, cost: 60, account_code: '4115', vat_applicable: true });
  const svcXray = hospitalLib.createService(db, { name: 'أشعة سينية', category: 'مختبر وأشعة', price: 200, cost: 80, account_code: '4115', vat_applicable: true });
  const svcSurgery = hospitalLib.createService(db, { name: 'عملية استئصال الزائدة', category: 'عمليات جراحية', price: 4500, cost: 1800, account_code: '4116', vat_applicable: true });
  const svcRoom = hospitalLib.createService(db, { name: 'إقامة جناح خاص (ليلة)', category: 'تنويم وإقامة', price: 400, cost: 150, account_code: '4117', vat_applicable: true });
  const svcMed = hospitalLib.createService(db, { name: 'أدوية الصيدلية', category: 'صيدلية', price: 120, cost: 70, account_code: '4118', vat_applicable: true });

  hospitalLib.createAppointment(db, { patient_id: p1.id, doctor_id: d1.id, department_id: internal.id, date: '2026-06-01', time: '10:00', reason: 'ألم في الصدر', status: 'completed' });
  hospitalLib.createAppointment(db, { patient_id: p2.id, doctor_id: d2.id, department_id: pediatric.id, date: '2026-06-03', time: '11:30', reason: 'متابعة طفل', status: 'completed' });
  hospitalLib.createAppointment(db, { patient_id: p3.id, doctor_id: d3.id, department_id: emergency.id, date: '2026-06-05', time: '09:15', reason: 'إصابة طارئة', status: 'checked_in' });
  hospitalLib.createAppointment(db, { patient_id: p1.id, doctor_id: d1.id, department_id: internal.id, date: '2026-07-10', time: '10:30', reason: 'متابعة دورية', status: 'scheduled' });

  hospitalLib.createMedicalRecord(db, { patient_id: p1.id, doctor_id: d1.id, date: '2026-06-01', symptoms: 'ألم وضغط في الصدر', diagnosis: 'ارتفاع ضغط الدم', treatment: 'أدوية خافضة للضغط ومتابعة' });
  hospitalLib.createMedicalRecord(db, { patient_id: p2.id, doctor_id: d2.id, date: '2026-06-03', symptoms: 'حمى وسعال', diagnosis: 'التهاب الجهاز التنفسي', treatment: 'مضاد حيوي وخافض حرارة' });
  hospitalLib.createMedicalRecord(db, { patient_id: p3.id, doctor_id: d3.id, date: '2026-06-05', symptoms: 'جرح عميق في الساعد', diagnosis: 'جرح قطعي - تم خياطته', treatment: 'تطهير وخياطة وتطعيم ضد الكزاز' });

  hospitalLib.createBill(db, {
    patient_id: p1.id, date: '2026-06-01', fiscal_year_id: year.id, payer: 'patient', payment_method: 'mada',
    lines: [{ service_id: svcConsult.id, qty: 1, unit_price: 300 }, { service_id: svcLab.id, qty: 1, unit_price: 150 }]
  });
  hospitalLib.createBill(db, {
    patient_id: p2.id, date: '2026-06-03', fiscal_year_id: year.id, payer: 'patient', payment_method: 'credit', paid_amount: 0,
    lines: [{ service_id: svcConsult.id, qty: 1, unit_price: 200 }, { service_id: svcMed.id, qty: 2, unit_price: 120 }]
  });
  hospitalLib.createBill(db, {
    patient_id: p3.id, date: '2026-06-05', fiscal_year_id: year.id, payer: 'insurance', payment_method: 'credit', paid_amount: 0,
    lines: [{ service_id: svcXray.id, qty: 1, unit_price: 200 }, { service_id: svcSurgery.id, qty: 1, unit_price: 4500 }]
  });
  hospitalLib.createBill(db, {
    patient_id: p3.id, date: '2026-06-06', fiscal_year_id: year.id, payer: 'insurance', payment_method: 'credit', paid_amount: 0,
    lines: [{ service_id: svcRoom.id, qty: 2, unit_price: 400 }]
  });
  hospitalLib.createBill(db, {
    patient_id: p1.id, date: '2026-07-10', fiscal_year_id: year.id, payer: 'patient', payment_method: 'cash',
    lines: [{ service_id: svcConsult.id, qty: 1, unit_price: 300 }, { service_id: svcMed.id, qty: 3, unit_price: 120 }]
  });

  j('2026-06-30', 'رواتب الأطباء والتمريض', [L('5220', 120000), L('1111', 0, 120000)]);
  j('2026-06-30', 'شراء أدوية ومستلزمات طبية', [L('5217', 45000), L('1111', 0, 45000)]);
  j('2026-07-01', 'إيجار مبنى المستشفى', [L('5202', 150000), L('1111', 0, 150000)]);
});

console.log('تم إنشاء البيانات التجريبية بنجاح.');
