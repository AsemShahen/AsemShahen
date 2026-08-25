'use strict';
// نظام المشافي: أقسام، أطباء، مرضى، مواعيد، سجلات طبية، خدمات، فوترة مرضى
const { createJournalEntry } = require('./accounting');

const SERVICE_ACCOUNTS = {
  consultation: '4114',
  lab: '4115',
  surgery: '4116',
  inpatient: '4117',
  pharmacy: '4118',
  emergency: '4119',
  other: '4120'
};

function getDefaultAccount(db, code) {
  return db.prepare('SELECT * FROM accounts WHERE code = ?').get(code);
}

function getVatOutputAccount(db) {
  return db.prepare('SELECT * FROM accounts WHERE code = ?').get('2103');
}

// ==================== الأقسام ====================
function listDepartments(db) {
  return db.prepare(`SELECT d.*, (SELECT COUNT(*) FROM hospital_doctors x WHERE x.department_id = d.id) AS doctors_count
    FROM hospital_departments d ORDER BY d.name`).all();
}

function createDepartment(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم القسم مطلوب');
  const info = db.prepare(`INSERT INTO hospital_departments (name, description, is_active, created_at) VALUES (?, ?, ?, ?)`)
    .run(name, data.description || '', data.is_active === false ? 0 : 1, new Date().toISOString());
  return db.prepare('SELECT * FROM hospital_departments WHERE id = ?').get(info.lastInsertRowid);
}

function updateDepartment(db, id, data) {
  const d = db.prepare('SELECT * FROM hospital_departments WHERE id = ?').get(id);
  if (!d) return null;
  db.prepare(`UPDATE hospital_departments SET name=?, description=?, is_active=? WHERE id=?`)
    .run((data.name || d.name), data.description !== undefined ? data.description : d.description,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : d.is_active, id);
  return db.prepare('SELECT * FROM hospital_departments WHERE id = ?').get(id);
}

function deleteDepartment(db, id) {
  const used = db.prepare('SELECT COUNT(*) AS c FROM hospital_doctors WHERE department_id = ?').get(id).c;
  if (used > 0) throw new Error('لا يمكن حذف قسم مرتبط بأطباء');
  db.prepare('DELETE FROM hospital_departments WHERE id = ?').run(id);
  return true;
}

// ==================== الأطباء ====================
function listDoctors(db, includeInactive = false) {
  const where = includeInactive ? '' : 'WHERE d.is_active = 1';
  return db.prepare(`SELECT d.*, dep.name AS department_name FROM hospital_doctors d
    LEFT JOIN hospital_departments dep ON dep.id = d.department_id ${where} ORDER BY d.name`).all();
}

function createDoctor(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم الطبيب مطلوب');
  const info = db.prepare(`INSERT INTO hospital_doctors (name, specialty, department_id, qualification, phone, email, consultation_fee, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, data.specialty || '', data.department_id || null, data.qualification || '', data.phone || '',
      data.email || '', Number(data.consultation_fee) || 0, data.is_active === false ? 0 : 1, new Date().toISOString());
  return getDoctor(db, info.lastInsertRowid);
}

function getDoctor(db, id) {
  return db.prepare(`SELECT d.*, dep.name AS department_name FROM hospital_doctors d
    LEFT JOIN hospital_departments dep ON dep.id = d.department_id WHERE d.id = ?`).get(id);
}

function updateDoctor(db, id, data) {
  const d = getDoctor(db, id);
  if (!d) return null;
  db.prepare(`UPDATE hospital_doctors SET name=?, specialty=?, department_id=?, qualification=?, phone=?, email=?, consultation_fee=?, is_active=? WHERE id=?`)
    .run((data.name || d.name), data.specialty !== undefined ? data.specialty : d.specialty,
      data.department_id !== undefined ? data.department_id : d.department_id,
      data.qualification !== undefined ? data.qualification : d.qualification,
      data.phone !== undefined ? data.phone : d.phone,
      data.email !== undefined ? data.email : d.email,
      data.consultation_fee !== undefined ? Number(data.consultation_fee) : d.consultation_fee,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : d.is_active, id);
  return getDoctor(db, id);
}

function deleteDoctor(db, id) {
  db.prepare('DELETE FROM hospital_doctors WHERE id = ?').run(id);
  return true;
}

// ==================== المرضى ====================
function nextPatientNo(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM hospital_patients').get();
  return `PT-${String(row.c + 1).padStart(4, '0')}`;
}

function listPatients(db, search) {
  let sql = `SELECT p.*,
    (SELECT COUNT(*) FROM hospital_appointments a WHERE a.patient_id = p.id) AS visits_count,
    (SELECT COALESCE(SUM(b.total - b.paid_amount),0) FROM hospital_bills b WHERE b.patient_id = p.id AND b.status != 'paid') AS outstanding
    FROM hospital_patients p`;
  const params = [];
  if (search && String(search).trim()) {
    sql += ` WHERE p.name LIKE ? OR p.patient_no LIKE ? OR p.phone LIKE ? OR p.national_id LIKE ?`;
    const like = '%' + String(search).trim() + '%';
    params.push(like, like, like, like);
  }
  sql += ` ORDER BY p.id DESC`;
  return db.prepare(sql).all(...params);
}

function getPatient(db, id) {
  return db.prepare('SELECT * FROM hospital_patients WHERE id = ?').get(id);
}

function createPatient(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم المريض مطلوب');
  const no = data.patient_no || nextPatientNo(db);
  const info = db.prepare(`INSERT INTO hospital_patients (patient_no, name, national_id, gender, birth_date, phone, email, address, blood_type, insurance_company, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(no, name, data.national_id || '', data.gender || '', data.birth_date || '', data.phone || '',
      data.email || '', data.address || '', data.blood_type || '', data.insurance_company || '',
      data.notes || '', new Date().toISOString());
  return getPatient(db, info.lastInsertRowid);
}

function updatePatient(db, id, data) {
  const p = getPatient(db, id);
  if (!p) return null;
  db.prepare(`UPDATE hospital_patients SET name=?, national_id=?, gender=?, birth_date=?, phone=?, email=?, address=?, blood_type=?, insurance_company=?, notes=? WHERE id=?`)
    .run((data.name || p.name), data.national_id !== undefined ? data.national_id : p.national_id,
      data.gender !== undefined ? data.gender : p.gender,
      data.birth_date !== undefined ? data.birth_date : p.birth_date,
      data.phone !== undefined ? data.phone : p.phone,
      data.email !== undefined ? data.email : p.email,
      data.address !== undefined ? data.address : p.address,
      data.blood_type !== undefined ? data.blood_type : p.blood_type,
      data.insurance_company !== undefined ? data.insurance_company : p.insurance_company,
      data.notes !== undefined ? data.notes : p.notes, id);
  return getPatient(db, id);
}

function deletePatient(db, id) {
  db.prepare('DELETE FROM hospital_patients WHERE id = ?').run(id);
  return true;
}

// ==================== المواعيد ====================
function listAppointments(db, filter) {
  let sql = `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone, p.patient_no,
    d.name AS doctor_name, d.specialty AS doctor_specialty, dep.name AS department_name
    FROM hospital_appointments a
    LEFT JOIN hospital_patients p ON p.id = a.patient_id
    LEFT JOIN hospital_doctors d ON d.id = a.doctor_id
    LEFT JOIN hospital_departments dep ON dep.id = a.department_id WHERE 1=1`;
  const params = [];
  if (filter && filter.status) { sql += ` AND a.status = ?`; params.push(filter.status); }
  if (filter && filter.patient_id) { sql += ` AND a.patient_id = ?`; params.push(filter.patient_id); }
  sql += ` ORDER BY a.date DESC, a.time DESC, a.id DESC LIMIT ?`;
  params.push(filter && filter.limit ? Number(filter.limit) : 500);
  return db.prepare(sql).all(...params);
}

function createAppointment(db, data) {
  const patientId = Number(data.patient_id);
  if (!patientId || !db.prepare('SELECT id FROM hospital_patients WHERE id = ?').get(patientId)) {
    throw new Error('يجب اختيار مريض');
  }
  if (!data.date) throw new Error('تاريخ الموعد مطلوب');
  const info = db.prepare(`INSERT INTO hospital_appointments (patient_id, doctor_id, department_id, date, time, reason, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(patientId, data.doctor_id || null, data.department_id || null, data.date, data.time || '',
      data.reason || '', data.status || 'scheduled', data.notes || '', new Date().toISOString());
  return getAppointment(db, info.lastInsertRowid);
}

function getAppointment(db, id) {
  return db.prepare(`SELECT a.*, p.name AS patient_name, p.phone AS patient_phone, p.patient_no,
    d.name AS doctor_name, d.specialty AS doctor_specialty, dep.name AS department_name
    FROM hospital_appointments a
    LEFT JOIN hospital_patients p ON p.id = a.patient_id
    LEFT JOIN hospital_doctors d ON d.id = a.doctor_id
    LEFT JOIN hospital_departments dep ON dep.id = a.department_id WHERE a.id = ?`).get(id);
}

function updateAppointment(db, id, data) {
  const a = getAppointment(db, id);
  if (!a) return null;
  db.prepare(`UPDATE hospital_appointments SET patient_id=?, doctor_id=?, department_id=?, date=?, time=?, reason=?, status=?, notes=? WHERE id=?`)
    .run(data.patient_id || a.patient_id, data.doctor_id !== undefined ? data.doctor_id : a.doctor_id,
      data.department_id !== undefined ? data.department_id : a.department_id,
      data.date || a.date, data.time !== undefined ? data.time : a.time,
      data.reason !== undefined ? data.reason : a.reason,
      data.status !== undefined ? data.status : a.status,
      data.notes !== undefined ? data.notes : a.notes, id);
  return getAppointment(db, id);
}

function deleteAppointment(db, id) {
  db.prepare('DELETE FROM hospital_appointments WHERE id = ?').run(id);
  return true;
}

// ==================== السجلات الطبية ====================
function listMedicalRecords(db, patientId) {
  let sql = `SELECT r.*, p.name AS patient_name, p.patient_no, d.name AS doctor_name, d.specialty AS doctor_specialty
    FROM hospital_medical_records r
    LEFT JOIN hospital_patients p ON p.id = r.patient_id
    LEFT JOIN hospital_doctors d ON d.id = r.doctor_id WHERE 1=1`;
  const params = [];
  if (patientId) { sql += ` AND r.patient_id = ?`; params.push(patientId); }
  sql += ` ORDER BY r.date DESC, r.id DESC LIMIT 500`;
  return db.prepare(sql).all(...params);
}

function createMedicalRecord(db, data) {
  const patientId = Number(data.patient_id);
  if (!patientId || !db.prepare('SELECT id FROM hospital_patients WHERE id = ?').get(patientId)) {
    throw new Error('يجب اختيار مريض');
  }
  if (!data.date) throw new Error('تاريخ السجل مطلوب');
  const info = db.prepare(`INSERT INTO hospital_medical_records (patient_id, doctor_id, appointment_id, date, symptoms, diagnosis, treatment, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(patientId, data.doctor_id || null, data.appointment_id || null, data.date,
      data.symptoms || '', data.diagnosis || '', data.treatment || '', data.notes || '', new Date().toISOString());
  return getMedicalRecord(db, info.lastInsertRowid);
}

function getMedicalRecord(db, id) {
  return db.prepare(`SELECT r.*, p.name AS patient_name, p.patient_no, d.name AS doctor_name
    FROM hospital_medical_records r
    LEFT JOIN hospital_patients p ON p.id = r.patient_id
    LEFT JOIN hospital_doctors d ON d.id = r.doctor_id WHERE r.id = ?`).get(id);
}

function updateMedicalRecord(db, id, data) {
  const r = getMedicalRecord(db, id);
  if (!r) return null;
  db.prepare(`UPDATE hospital_medical_records SET patient_id=?, doctor_id=?, appointment_id=?, date=?, symptoms=?, diagnosis=?, treatment=?, notes=? WHERE id=?`)
    .run(data.patient_id || r.patient_id, data.doctor_id !== undefined ? data.doctor_id : r.doctor_id,
      data.appointment_id !== undefined ? data.appointment_id : r.appointment_id,
      data.date || r.date, data.symptoms !== undefined ? data.symptoms : r.symptoms,
      data.diagnosis !== undefined ? data.diagnosis : r.diagnosis,
      data.treatment !== undefined ? data.treatment : r.treatment,
      data.notes !== undefined ? data.notes : r.notes, id);
  return getMedicalRecord(db, id);
}

function deleteMedicalRecord(db, id) {
  db.prepare('DELETE FROM hospital_medical_records WHERE id = ?').run(id);
  return true;
}

// ==================== الخدمات الطبية ====================
function listServices(db, includeInactive = false) {
  const where = includeInactive ? '' : 'WHERE s.is_active = 1';
  return db.prepare(`SELECT s.* FROM hospital_services s ${where} ORDER BY s.category, s.name`).all();
}

function createService(db, data) {
  const code = String(data.code || '').trim();
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم الخدمة مطلوب');
  const finalCode = code || `SVC-${db.prepare('SELECT COUNT(*) AS c FROM hospital_services').get().c + 1}`;
  const dup = db.prepare('SELECT id FROM hospital_services WHERE code = ?').get(finalCode);
  if (dup) throw new Error('رمز الخدمة موجود مسبقاً');
  const info = db.prepare(`INSERT INTO hospital_services (code, name, category, price, cost, account_code, vat_applicable, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(finalCode, name, data.category || 'other', Number(data.price) || 0, Number(data.cost) || 0,
      data.account_code || SERVICE_ACCOUNTS[data.category || 'other'] || SERVICE_ACCOUNTS.other,
      data.vat_applicable === false ? 0 : 1, data.is_active === false ? 0 : 1, new Date().toISOString());
  return db.prepare('SELECT * FROM hospital_services WHERE id = ?').get(info.lastInsertRowid);
}

function updateService(db, id, data) {
  const s = db.prepare('SELECT * FROM hospital_services WHERE id = ?').get(id);
  if (!s) return null;
  db.prepare(`UPDATE hospital_services SET code=?, name=?, category=?, price=?, cost=?, account_code=?, vat_applicable=?, is_active=? WHERE id=?`)
    .run((data.code || s.code), (data.name || s.name), (data.category || s.category),
      data.price !== undefined ? Number(data.price) : s.price,
      data.cost !== undefined ? Number(data.cost) : s.cost,
      data.account_code !== undefined ? data.account_code : s.account_code,
      data.vat_applicable !== undefined ? (data.vat_applicable ? 1 : 0) : s.vat_applicable,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : s.is_active, id);
  return db.prepare('SELECT * FROM hospital_services WHERE id = ?').get(id);
}

function deleteService(db, id) {
  const used = db.prepare('SELECT COUNT(*) AS c FROM hospital_bill_lines WHERE service_id = ?').get(id).c;
  if (used > 0) throw new Error('لا يمكن حذف خدمة مستخدمة في فواتير سابقة');
  db.prepare('DELETE FROM hospital_services WHERE id = ?').run(id);
  return true;
}

// ==================== فوترة المرضى ====================
function nextBillNo(db, date) {
  const year = String(date).slice(0, 4);
  const row = db.prepare(`SELECT COUNT(*) AS c FROM hospital_bills WHERE date LIKE ?`).get(year + '%');
  return `PB-${year}-${String(row.c + 1).padStart(4, '0')}`;
}

function createBill(db, { patient_id, date, lines, discount = 0, vat_rate, payer = 'patient', payment_method = 'cash', paid_amount, due_date, notes, fiscal_year_id }) {
  if (!patient_id || !db.prepare('SELECT id FROM hospital_patients WHERE id = ?').get(patient_id)) {
    throw new Error('يجب اختيار مريض');
  }
  if (!lines || !lines.length) throw new Error('الفاتورة يجب أن تحتوي على سطر واحد على الأقل');
  const vatRate = vat_rate !== undefined ? Number(vat_rate) : Number(db.prepare(`SELECT value FROM settings WHERE key='vat_rate'`).get().value) || 15;

  let subTotal = 0;
  const cleanLines = lines.map(l => {
    const svc = l.service_id ? db.prepare('SELECT * FROM hospital_services WHERE id = ?').get(l.service_id) : null;
    const qty = Number(l.qty) || 1;
    const unitPrice = Number(l.unit_price) || 0;
    const lineDiscount = Number(l.discount) || 0;
    const lineTotal = qty * unitPrice - lineDiscount;
    subTotal += lineTotal;
    return {
      service_id: svc ? svc.id : null,
      description: l.description || (svc ? svc.name : ''),
      qty, unit_price: unitPrice, discount: lineDiscount,
      vat_rate: (svc && !svc.vat_applicable) ? 0 : vatRate,
      line_total: lineTotal,
      account_code: (l.account_code) || (svc ? svc.account_code : '') || SERVICE_ACCOUNTS.other,
      vat_applicable: svc ? !!svc.vat_applicable : true
    };
  });

  const totalDiscount = Number(discount) || 0;
  const taxable = subTotal - totalDiscount;
  const vat = taxable * vatRate / 100;
  const total = taxable + vat;

  const paid = paid_amount !== undefined ? Number(paid_amount) : (payment_method === 'credit' ? 0 : total);
  const status = total <= paid + 0.01 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
  const billNo = nextBillNo(db, date);

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO hospital_bills (bill_no, patient_id, date, sub_total, discount, vat, total, vat_rate, payer,
        payment_method, status, paid_amount, due_date, notes, fiscal_year_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(billNo, patient_id, date, subTotal, totalDiscount, vat, total, vatRate, payer === 'insurance' ? 'insurance' : 'patient',
      payment_method, status, paid, due_date || null, notes || '', fiscal_year_id, new Date().toISOString());

    const billId = info.lastInsertRowid;
    const insertLine = db.prepare(`
      INSERT INTO hospital_bill_lines (bill_id, service_id, description, qty, unit_price, discount, vat_rate, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of cleanLines) insertLine.run(billId, l.service_id, l.description, l.qty, l.unit_price, l.discount, l.vat_rate, l.line_total);

    postBillJournal(db, { billId, billNo, patient_id, date, lines: cleanLines, subTotal, discount: totalDiscount, vat, total, vatRate, payer, payment_method, paid, status, fiscal_year_id });
    return billId;
  });

  const id = tx();
  return getBill(db, id);
}

function postBillJournal(db, { billId, billNo, patient_id, date, lines, subTotal, discount, vat, total, vatRate, payer, payment_method, paid, status, fiscal_year_id }) {
  const cashAcct = getDefaultAccount(db, '1101');
  const bankAcct = getDefaultAccount(db, '1111');
  const vatOutputAcct = getVatOutputAccount(db);

  // توزيع صافي الإيراد على حسابات الإيرادات حسب الخدمات
  const revenueMap = {};
  const lineSum = lines.reduce((s, l) => s + l.line_total, 0);
  const netRevenue = subTotal - discount;
  for (const l of lines) {
    if (lineSum <= 0) continue;
    const account = getDefaultAccount(db, l.account_code) || getDefaultAccount(db, SERVICE_ACCOUNTS.other);
    const amount = netRevenue * l.line_total / lineSum;
    revenueMap[account.id] = (revenueMap[account.id] || 0) + amount;
  }

  const journalLines = [];
  for (const [accountId, amount] of Object.entries(revenueMap)) {
    if (Math.abs(amount) > 0.001) journalLines.push({ account_id: Number(accountId), credit: amount, vat_amount: 0, detail: 'إيراد خدمات طبية' });
  }
  if (vat > 0.01) journalLines.push({ account_id: vatOutputAcct.id, credit: vat, vat_amount: vat, vat_type: 'output', detail: `ضريبة القيمة المضافة ${vatRate}%` });

  // الجهة المدينة حسب طريقة الدفع والمسؤول عن السداد
  const receivableCode = payer === 'insurance' ? '1207' : '1206';
  const recvAcct = getDefaultAccount(db, receivableCode);
  if (payment_method === 'credit' || status === 'unpaid' || (status === 'partial' && paid < total)) {
    journalLines.push({ account_id: recvAcct.id, debit: total - paid, detail: payer === 'insurance' ? 'مستحق على شركة التأمين' : 'رصيد مستحق على المريض' });
    if (paid > 0) {
      if (payment_method === 'bank_transfer' || payment_method === 'sadad') journalLines.push({ account_id: bankAcct.id, debit: paid, detail: `دفعة مستلمة - ${payment_method}` });
      else journalLines.push({ account_id: cashAcct.id, debit: paid, detail: `دفعة مستلمة - ${payment_method}` });
    }
  } else {
    if (payment_method === 'bank_transfer' || payment_method === 'sadad' || payment_method === 'credit_card' || payment_method === 'mada' || payment_method === 'apple_pay' || payment_method === 'stc_pay') {
      journalLines.push({ account_id: bankAcct.id, debit: total, detail: `تحصيل - ${payment_method}` });
    } else {
      journalLines.push({ account_id: cashAcct.id, debit: total, detail: 'دفع نقدي' });
    }
  }

  createJournalEntry(db, {
    date, description: `فاتورة علاج ${billNo} - إيرادات خدمات طبية`, ref_type: 'hospital_bill', ref_id: billId,
    fiscal_year_id, lines: journalLines
  });
}

function getBill(db, id) {
  const b = db.prepare(`SELECT b.*, p.name AS patient_name, p.patient_no, p.national_id, p.insurance_company
    FROM hospital_bills b LEFT JOIN hospital_patients p ON p.id = b.patient_id WHERE b.id = ?`).get(id);
  if (!b) return null;
  b.lines = db.prepare('SELECT * FROM hospital_bill_lines WHERE bill_id = ? ORDER BY id').all(id);
  return b;
}

function listBills(db, { fiscal_year_id, status, limit = 500 } = {}) {
  let sql = `SELECT b.*, p.name AS patient_name, p.patient_no FROM hospital_bills b
    LEFT JOIN hospital_patients p ON p.id = b.patient_id WHERE 1=1`;
  const params = [];
  if (fiscal_year_id) { sql += ` AND b.fiscal_year_id = ?`; params.push(fiscal_year_id); }
  if (status) { sql += ` AND b.status = ?`; params.push(status); }
  sql += ` ORDER BY b.date DESC, b.id DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function recordBillPayment(db, { billId, amount, date, method, fiscal_year_id }) {
  const bill = getBill(db, billId);
  if (!bill) throw new Error('الفاتورة غير موجودة');
  const paid = Number(amount) || 0;
  if (paid <= 0) throw new Error('مبلغ الدفعة يجب أن يكون أكبر من صفر');
  const remaining = bill.total - bill.paid_amount;
  if (paid > remaining + 0.01) throw new Error('مبلغ الدفعة أكبر من الرصيد المتبقي');

  const tx = db.transaction(() => {
    db.prepare(`UPDATE hospital_bills SET paid_amount = paid_amount + ?, status = ? WHERE id = ?`)
      .run(paid, (bill.paid_amount + paid >= bill.total - 0.01) ? 'paid' : 'partial', billId);

    const cashAcct = getDefaultAccount(db, '1101');
    const bankAcct = getDefaultAccount(db, '1111');
    const recvAcct = getDefaultAccount(db, bill.payer === 'insurance' ? '1207' : '1206');
    const debitAcct = (method === 'bank_transfer' || method === 'sadad' || method === 'credit_card' || method === 'mada' || method === 'apple_pay' || method === 'stc_pay') ? bankAcct : cashAcct;
    const lines = [
      { account_id: debitAcct.id, debit: paid, detail: bill.payer === 'insurance' ? 'تحصيل من شركة التأمين' : 'تحصيل من مريض' },
      { account_id: recvAcct.id, credit: paid, detail: `سداد رصيد فاتورة علاج ${bill.bill_no}` }
    ];
    createJournalEntry(db, { date, description: `سداد فاتورة علاج ${bill.bill_no}`, ref_type: 'hospital_payment', ref_id: billId, fiscal_year_id, lines });
  });

  tx();
  return getBill(db, billId);
}

function deleteBill(db, id) {
  const b = db.prepare('SELECT * FROM hospital_bills WHERE id = ?').get(id);
  if (!b) return false;
  db.prepare('DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE ref_type = ? AND ref_id = ?)').run('hospital_bill', id);
  db.prepare('DELETE FROM journal_entries WHERE ref_type = ? AND ref_id = ?').run('hospital_bill', id);
  db.prepare('DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE ref_type = ? AND ref_id = ?)').run('hospital_payment', id);
  db.prepare('DELETE FROM journal_entries WHERE ref_type = ? AND ref_id = ?').run('hospital_payment', id);
  db.prepare('DELETE FROM hospital_bill_lines WHERE bill_id = ?').run(id);
  db.prepare('DELETE FROM hospital_bills WHERE id = ?').run(id);
  return true;
}

// ==================== لوحة تحكم المشفى ====================
function hospitalDashboard(db, fiscalYearId) {
  const totals = (sql) => db.prepare(sql).get(fiscalYearId);
  const revenue = db.prepare(`
    SELECT a.code, a.name, COALESCE(SUM(jl.credit),0) AS amount FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
    WHERE je.fiscal_year_id = ? AND jl.credit > 0 AND a.code IN ('4114','4115','4116','4117','4118','4119','4120')
    GROUP BY a.code, a.name ORDER BY a.code`).all(fiscalYearId);

  return {
    patients: db.prepare('SELECT COUNT(*) AS c FROM hospital_patients').get().c,
    appointmentsToday: db.prepare(`SELECT COUNT(*) AS c FROM hospital_appointments WHERE date = ?`).get(new Date().toISOString().slice(0, 10)).c,
    appointmentsScheduled: db.prepare(`SELECT COUNT(*) AS c FROM hospital_appointments WHERE status = 'scheduled'`).get().c,
    doctors: db.prepare('SELECT COUNT(*) AS c FROM hospital_doctors WHERE is_active = 1').get().c,
    services: db.prepare('SELECT COUNT(*) AS c FROM hospital_services WHERE is_active = 1').get().c,
    bills: totals(`SELECT COALESCE(SUM(total),0) AS t, COUNT(*) AS n FROM hospital_bills WHERE fiscal_year_id = ?`),
    outstanding: totals(`SELECT COALESCE(SUM(total - paid_amount),0) AS t FROM hospital_bills WHERE fiscal_year_id = ? AND status != 'paid'`).t,
    revenue,
    revenueTotal: revenue.reduce((s, r) => s + r.amount, 0)
  };
}

module.exports = {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listDoctors, createDoctor, updateDoctor, deleteDoctor,
  listPatients, getPatient, createPatient, updatePatient, deletePatient,
  listAppointments, createAppointment, updateAppointment, deleteAppointment,
  listMedicalRecords, createMedicalRecord, updateMedicalRecord, deleteMedicalRecord,
  listServices, createService, updateService, deleteService,
  createBill, getBill, listBills, recordBillPayment, deleteBill,
  hospitalDashboard
};
