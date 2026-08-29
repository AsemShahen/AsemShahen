'use strict';
// نظام الموارد البشرية: الأقسام والموظفون والحضور والإجازات والرواتب والأجور
const { createJournalEntry } = require('./accounting');

// ---------- أدوات ----------
function nextNo(db, table, col, prefix, pad) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
  return `${prefix}${String(row.c + 1).padStart(pad, '0')}`;
}

function requireAccount(db, code) {
  const acc = db.prepare('SELECT * FROM accounts WHERE code = ?').get(code);
  if (!acc) throw new Error(`الحساب المحاسبي (${code}) غير موجود في المخطط`);
  return acc;
}

function payrollAccounts(db) {
  const get = (k, d) => {
    const s = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    return (s && s.value) || d;
  };
  return { salary: get('hr_salary_account', '5201'), payable: get('hr_payable_account', '2104') };
}

// ---------- الأقسام ----------
function nextDeptNo(db) { return nextNo(db, 'hr_departments', 'code', 'DEP-', 3); }

function listDepartments(db) {
  return db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM hr_employees e WHERE e.department_id = d.id AND e.status = 'active') AS employees_count
    FROM hr_departments d ORDER BY d.name`).all();
}

function getDepartment(db, id) {
  return db.prepare('SELECT * FROM hr_departments WHERE id = ?').get(id);
}

function createDepartment(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم القسم مطلوب');
  const code = String(data.code || '').trim() || nextDeptNo(db);
  if (db.prepare('SELECT id FROM hr_departments WHERE code = ?').get(code)) throw new Error('رمز القسم موجود مسبقاً');
  const info = db.prepare(`
    INSERT INTO hr_departments (code, name, parent_id, manager_employee_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(code, name, data.parent_id || null, data.manager_employee_id || null, data.description || '', new Date().toISOString());
  return getDepartment(db, info.lastInsertRowid);
}

function updateDepartment(db, id, data) {
  const d = getDepartment(db, id);
  if (!d) return null;
  db.prepare(`UPDATE hr_departments SET name=?, parent_id=?, manager_employee_id=?, description=? WHERE id=?`)
    .run((data.name || d.name), data.parent_id !== undefined ? (data.parent_id || null) : d.parent_id,
      data.manager_employee_id !== undefined ? (data.manager_employee_id || null) : d.manager_employee_id,
      data.description !== undefined ? data.description : d.description, id);
  return getDepartment(db, id);
}

function deleteDepartment(db, id) {
  const used = db.prepare('SELECT COUNT(*) AS c FROM hr_employees WHERE department_id = ?').get(id).c;
  if (used > 0) throw new Error('لا يمكن حذف قسم يضم موظفين');
  db.prepare('DELETE FROM hr_departments WHERE id = ?').run(id);
  return true;
}

// ---------- الموظفون ----------
function nextEmpNo(db) { return nextNo(db, 'hr_employees', 'emp_no', 'EMP-', 4); }

function listEmployees(db, { search, includeInactive = false } = {}) {
  let sql = `SELECT e.*, d.name AS department_name,
      (SELECT COUNT(*) FROM hr_leaves l WHERE l.employee_id = e.id AND l.status = 'approved') AS leaves_count
    FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE 1=1`;
  const params = [];
  if (!includeInactive) sql += ` AND e.status = 'active'`;
  if (search) {
    sql += ` AND (e.name LIKE ? OR e.emp_no LIKE ? OR e.national_id LIKE ? OR e.job_title LIKE ?)`;
    const s = `%${String(search).trim()}%`;
    params.push(s, s, s, s);
  }
  sql += ` ORDER BY e.name`;
  return db.prepare(sql).all(...params);
}

function getEmployee(db, id) {
  const e = db.prepare(`
    SELECT e.*, d.name AS department_name
    FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id WHERE e.id = ?`).get(id);
  if (!e) return null;
  e.payroll_history = db.prepare(`SELECT month, net_salary, status FROM hr_payroll
    WHERE employee_id = ? ORDER BY month DESC LIMIT 12`).all(id);
  return e;
}

function createEmployee(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم الموظف مطلوب');
  if (!data.hire_date) throw new Error('تاريخ التعيين مطلوب');
  const empNo = String(data.emp_no || '').trim() || nextEmpNo(db);
  if (db.prepare('SELECT id FROM hr_employees WHERE emp_no = ?').get(empNo)) throw new Error('رقم الموظف موجود مسبقاً');
  const info = db.prepare(`
    INSERT INTO hr_employees (emp_no, name, national_id, gender, birth_date, phone, email, address,
      department_id, job_title, hire_date, basic_salary, allowances, bank_account, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(empNo, name, data.national_id || '', data.gender || '', data.birth_date || '', data.phone || '',
      data.email || '', data.address || '', data.department_id || null, data.job_title || '',
      data.hire_date, Number(data.basic_salary) || 0, Number(data.allowances) || 0,
      data.bank_account || '', data.status === 'terminated' ? 'terminated' : 'active',
      data.notes || '', new Date().toISOString());
  return getEmployee(db, info.lastInsertRowid);
}

function updateEmployee(db, id, data) {
  const e = getEmployee(db, id);
  if (!e) return null;
  db.prepare(`
    UPDATE hr_employees SET name=?, national_id=?, gender=?, birth_date=?, phone=?, email=?, address=?,
      department_id=?, job_title=?, hire_date=?, basic_salary=?, allowances=?, bank_account=?, status=?, notes=?
    WHERE id=?`)
    .run((data.name || e.name), data.national_id !== undefined ? data.national_id : e.national_id,
      data.gender !== undefined ? data.gender : e.gender, data.birth_date !== undefined ? data.birth_date : e.birth_date,
      data.phone !== undefined ? data.phone : e.phone, data.email !== undefined ? data.email : e.email,
      data.address !== undefined ? data.address : e.address,
      data.department_id !== undefined ? (data.department_id || null) : e.department_id,
      data.job_title !== undefined ? data.job_title : e.job_title,
      data.hire_date || e.hire_date, Number(data.basic_salary) || e.basic_salary,
      Number(data.allowances) || e.allowances, data.bank_account !== undefined ? data.bank_account : e.bank_account,
      data.status === 'terminated' ? 'terminated' : (data.status === 'active' ? 'active' : e.status),
      data.notes !== undefined ? data.notes : e.notes, id);
  return getEmployee(db, id);
}

function deleteEmployee(db, id) {
  const refs = db.prepare(`
    SELECT (SELECT COUNT(*) FROM hr_leaves WHERE employee_id = ?) +
           (SELECT COUNT(*) FROM hr_attendance WHERE employee_id = ?) +
           (SELECT COUNT(*) FROM hr_payroll WHERE employee_id = ?) AS c`).get(id, id, id).c;
  if (refs > 0) throw new Error('لا يمكن حذف موظف لديه إجازات أو حضور أو رواتب مسجلة؛ يمكن إيقافه بدلاً من الحذف');
  db.prepare('UPDATE hr_departments SET manager_employee_id = NULL WHERE manager_employee_id = ?').run(id);
  db.prepare('DELETE FROM hr_employees WHERE id = ?').run(id);
  return true;
}

// ---------- أنواع الإجازات ----------
function nextLeaveTypeNo(db) { return nextNo(db, 'hr_leave_types', 'code', 'LVT-', 2); }

function listLeaveTypes(db) {
  return db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM hr_leaves l WHERE l.leave_type_id = t.id) AS leaves_count
    FROM hr_leave_types t ORDER BY t.name`).all();
}

function createLeaveType(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم نوع الإجازة مطلوب');
  const code = String(data.code || '').trim() || nextLeaveTypeNo(db);
  if (db.prepare('SELECT id FROM hr_leave_types WHERE code = ?').get(code)) throw new Error('رمز نوع الإجازة موجود مسبقاً');
  const info = db.prepare(`
    INSERT INTO hr_leave_types (code, name, days_per_year, is_paid, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(code, name, Number(data.days_per_year) || 0, data.is_paid === false ? 0 : 1,
      data.is_active === false ? 0 : 1, new Date().toISOString());
  return db.prepare('SELECT * FROM hr_leave_types WHERE id = ?').get(info.lastInsertRowid);
}

function updateLeaveType(db, id, data) {
  const t = db.prepare('SELECT * FROM hr_leave_types WHERE id = ?').get(id);
  if (!t) return null;
  db.prepare(`UPDATE hr_leave_types SET name=?, days_per_year=?, is_paid=?, is_active=? WHERE id=?`)
    .run((data.name || t.name), Number(data.days_per_year) || t.days_per_year,
      data.is_paid !== undefined ? (data.is_paid ? 1 : 0) : t.is_paid,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : t.is_active, id);
  return db.prepare('SELECT * FROM hr_leave_types WHERE id = ?').get(id);
}

function deleteLeaveType(db, id) {
  const used = db.prepare('SELECT COUNT(*) AS c FROM hr_leaves WHERE leave_type_id = ?').get(id).c;
  if (used > 0) throw new Error('لا يمكن حذف نوع إجازة مستخدم في طلبات الإجازات');
  db.prepare('DELETE FROM hr_leave_types WHERE id = ?').run(id);
  return true;
}

// ---------- الإجازات ----------
function nextLeaveNo(db) {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT COUNT(*) AS c FROM hr_leaves').get();
  return `LV-${year}-${String(row.c + 1).padStart(4, '0')}`;
}

function calcDays(start, end) {
  const s = new Date(start), e = new Date(end);
  if (isNaN(s) || isNaN(e)) return 0;
  const diff = Math.round((e - s) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}

function listLeaves(db, { status, search } = {}) {
  let sql = `SELECT l.*, e.name AS employee_name, e.emp_no, t.name AS leave_type_name, t.is_paid,
      (SELECT COALESCE(SUM(x.days),0) FROM hr_leaves x
        WHERE x.employee_id = l.employee_id AND x.leave_type_id = l.leave_type_id AND x.status = 'approved'
          AND x.start_date < l.start_date) AS approved_days_before
    FROM hr_leaves l
    JOIN hr_employees e ON e.id = l.employee_id
    JOIN hr_leave_types t ON t.id = l.leave_type_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND l.status = ?`; params.push(status); }
  if (search) {
    sql += ` AND (e.name LIKE ? OR e.emp_no LIKE ? OR l.leave_no LIKE ?)`;
    const s = `%${String(search).trim()}%`;
    params.push(s, s, s);
  }
  sql += ` ORDER BY l.start_date DESC, l.id DESC`;
  return db.prepare(sql).all(...params);
}

function getLeave(db, id) {
  return db.prepare(`
    SELECT l.*, e.name AS employee_name, e.emp_no, t.name AS leave_type_name
    FROM hr_leaves l JOIN hr_employees e ON e.id = l.employee_id
    JOIN hr_leave_types t ON t.id = l.leave_type_id WHERE l.id = ?`).get(id);
}

function createLeave(db, data) {
  if (!data.employee_id || !data.leave_type_id) throw new Error('الموظف ونوع الإجازة مطلوبان');
  if (!data.start_date || !data.end_date) throw new Error('تاريخا البداية والنهاية مطلوبان');
  const days = calcDays(data.start_date, data.end_date);
  if (days <= 0) throw new Error('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
  const info = db.prepare(`
    INSERT INTO hr_leaves (leave_no, employee_id, leave_type_id, start_date, end_date, days, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(nextLeaveNo(db), data.employee_id, data.leave_type_id, data.start_date, data.end_date, days,
      'pending', data.notes || '', new Date().toISOString());
  return getLeave(db, info.lastInsertRowid);
}

function updateLeave(db, id, data) {
  const l = getLeave(db, id);
  if (!l) return null;
  if (l.status !== 'pending') throw new Error('لا يمكن تعديل إجازة تمت معالجتها');
  const start = data.start_date || l.start_date;
  const end = data.end_date || l.end_date;
  const days = calcDays(start, end);
  if (days <= 0) throw new Error('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
  db.prepare(`UPDATE hr_leaves SET employee_id=?, leave_type_id=?, start_date=?, end_date=?, days=?, notes=? WHERE id=?`)
    .run(data.employee_id || l.employee_id, data.leave_type_id || l.leave_type_id, start, end, days,
      data.notes !== undefined ? data.notes : l.notes, id);
  return getLeave(db, id);
}

function setLeaveStatus(db, id, status) {
  const l = getLeave(db, id);
  if (!l) return null;
  if (!['pending', 'approved', 'rejected', 'cancelled'].includes(status)) throw new Error('حالة إجازة غير صالحة');
  if (l.status === 'cancelled') throw new Error('لا يمكن تغيير حالة إجازة ملغاة');
  if (status === 'approved' && l.status === 'approved') throw new Error('الإجازة معتمدة مسبقاً');
  db.prepare('UPDATE hr_leaves SET status=? WHERE id=?').run(status, id);
  return getLeave(db, id);
}

function deleteLeave(db, id) {
  const l = getLeave(db, id);
  if (!l) return null;
  if (l.status !== 'pending') throw new Error('لا يمكن حذف إجازة تمت معالجتها');
  db.prepare('DELETE FROM hr_leaves WHERE id=?').run(id);
  return true;
}

// ---------- الحضور والانصراف ----------
function listAttendance(db, month) {
  return db.prepare(`
    SELECT a.*, e.name AS employee_name, e.emp_no, e.department_id, d.name AS department_name
    FROM hr_attendance a
    JOIN hr_employees e ON e.id = a.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE a.month = ? ORDER BY e.name`).all(month);
}

function upsertAttendance(db, data) {
  if (!data.employee_id || !data.month) throw new Error('الموظف والشهر مطلوبان');
  db.prepare(`
    INSERT INTO hr_attendance (employee_id, month, working_days, present_days, absent_days, late_days, overtime_hours, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, month) DO UPDATE SET
      working_days=excluded.working_days, present_days=excluded.present_days,
      absent_days=excluded.absent_days, late_days=excluded.late_days,
      overtime_hours=excluded.overtime_hours, notes=excluded.notes`)
    .run(data.employee_id, data.month, Number(data.working_days) || 0, Number(data.present_days) || 0,
      Number(data.absent_days) || 0, Number(data.late_days) || 0, Number(data.overtime_hours) || 0,
      data.notes || '');
  return db.prepare('SELECT * FROM hr_attendance WHERE employee_id=? AND month=?').get(data.employee_id, data.month);
}

function deleteAttendance(db, employeeId, month) {
  db.prepare('DELETE FROM hr_attendance WHERE employee_id=? AND month=?').run(employeeId, month);
  return true;
}

// ---------- الرواتب والأجور ----------
function listPayroll(db, month) {
  return db.prepare(`
    SELECT p.*, e.name AS employee_name, e.emp_no, d.name AS department_name, e.job_title
    FROM hr_payroll p
    JOIN hr_employees e ON e.id = p.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE p.month = ? ORDER BY e.name`).all(month);
}

function payrollTotals(db, month) {
  const t = db.prepare(`
    SELECT COALESCE(SUM(basic_salary),0) AS basic, COALESCE(SUM(allowances),0) AS allowances,
      COALESCE(SUM(overtime),0) AS overtime, COALESCE(SUM(absences),0) AS absences,
      COALESCE(SUM(deductions),0) AS deductions, COALESCE(SUM(net_salary),0) AS net
    FROM hr_payroll WHERE month=?`).get(month);
  t.posted = !!db.prepare(`SELECT id FROM hr_payroll WHERE month=? AND status='posted' LIMIT 1`).get(month);
  return t;
}

function generatePayroll(db, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('صيغة الشهر يجب أن تكون YYYY-MM');
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status='open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) throw new Error('لا توجد سنة مالية مفتوحة');
  const employees = db.prepare(`SELECT * FROM hr_employees WHERE status = 'active' ORDER BY name`).all();
  if (!employees.length) throw new Error('لا يوجد موظفون نشطون لإنشاء الرواتب');
  const tx = db.transaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO hr_payroll (month, employee_id, basic_salary, allowances, overtime, absences,
        deductions, net_salary, status, fiscal_year_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`);
    const att = db.prepare('SELECT * FROM hr_attendance WHERE month=?').all(month);
    const attMap = Object.fromEntries(att.map(a => [a.employee_id, a]));
    for (const e of employees) {
      const a = attMap[e.id] || { absent_days: 0, overtime_hours: 0 };
      const basic = Number(e.basic_salary) || 0;
      const allowances = Number(e.allowances) || 0;
      const overtime = Math.round((Number(a.overtime_hours) || 0) * (basic / 30 / 8) * 100) / 100;
      const absences = Math.round((Number(a.absent_days) || 0) * (basic / 30) * 100) / 100;
      const net = Math.round((basic + allowances + overtime - absences) * 100) / 100;
      insert.run(month, e.id, basic, allowances, overtime, absences, 0, net, fy.id, new Date().toISOString());
    }
  });
  tx();
  return listPayroll(db, month);
}

function updatePayrollRow(db, id, data) {
  const row = db.prepare('SELECT * FROM hr_payroll WHERE id=?').get(id);
  if (!row) return null;
  if (row.status === 'posted') throw new Error('لا يمكن تعديل رواتب تم ترحيلها إلى القيود');
  const basic = Number(data.basic_salary) || 0;
  const allowances = Number(data.allowances) || 0;
  const overtime = Number(data.overtime) || 0;
  const absences = Number(data.absences) || 0;
  const deductions = Number(data.deductions) || 0;
  const net = Math.round((basic + allowances + overtime - absences - deductions) * 100) / 100;
  db.prepare(`UPDATE hr_payroll SET basic_salary=?, allowances=?, overtime=?, absences=?, deductions=?, net_salary=? WHERE id=?`)
    .run(basic, allowances, overtime, absences, deductions, net, id);
  return db.prepare('SELECT * FROM hr_payroll WHERE id=?').get(id);
}

function deletePayrollRow(db, id) {
  const row = db.prepare('SELECT * FROM hr_payroll WHERE id=?').get(id);
  if (!row) return null;
  if (row.status === 'posted') throw new Error('لا يمكن حذف رواتب مرحلة إلى القيود');
  db.prepare('DELETE FROM hr_payroll WHERE id=?').run(id);
  return true;
}

function postPayroll(db, month) {
  const rows = db.prepare(`
    SELECT p.*, e.name AS employee_name, e.emp_no
    FROM hr_payroll p JOIN hr_employees e ON e.id = p.employee_id WHERE p.month = ?`).all(month);
  if (!rows.length) throw new Error('لا توجد رواتب لهذا الشهر');
  const existing = rows.find(r => r.status === 'posted');
  if (existing) throw new Error('رواتب هذا الشهر مرحّلة مسبقاً إلى القيود');
  const fy = db.prepare(`SELECT * FROM fiscal_years WHERE status='open' ORDER BY id DESC LIMIT 1`).get();
  if (!fy) throw new Error('لا توجد سنة مالية مفتوحة');
  const acc = payrollAccounts(db);
  const salaryAcc = requireAccount(db, acc.salary);
  const payableAcc = requireAccount(db, acc.payable);

  let total = 0;
  const lines = rows.map(r => {
    const net = Number(r.net_salary) || 0;
    total += net;
    return { account_id: salaryAcc.id, debit: net, credit: 0, detail: `${r.employee_name || 'موظف'} — ${r.emp_no}` };
  });
  if (total <= 0) throw new Error('صافي الرواتب صفر؛ لا يمكن الترحيل');
  lines.push({ account_id: payableAcc.id, debit: 0, credit: total, detail: `رواتب شهر ${month}` });

  const entry = createJournalEntry(db, {
    date: `${month}-01`, description: `رواتب وأجور شهر ${month}`,
    ref_type: 'payroll', ref_id: null, fiscal_year_id: fy.id, lines
  });

  const tx = db.transaction(() => {
    for (const r of rows) {
      db.prepare(`UPDATE hr_payroll SET status='posted', journal_entry_id=? WHERE id=?`).run(entry.id, r.id);
    }
  });
  tx();
  return { entry, totals: payrollTotals(db, month) };
}

function reversePayroll(db, month) {
  const rows = db.prepare(`SELECT * FROM hr_payroll WHERE month=?`).all(month);
  const posted = rows.filter(r => r.status === 'posted');
  if (!posted.length) throw new Error('لا توجد رواتب مرحّلة لهذا الشهر');
  const entryId = posted[0].journal_entry_id;
  if (entryId) {
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE id=? AND ref_type='payroll'`).get(entryId);
    if (entry) {
      const used = db.prepare(`SELECT COUNT(*) AS c FROM hr_payroll WHERE journal_entry_id=? AND month<>?`).get(entryId, month).c;
      if (used > 0) throw new Error('قيد الرواتب مرتبط بأشهر أخرى');
      db.prepare('DELETE FROM journal_lines WHERE entry_id=?').run(entryId);
      db.prepare('DELETE FROM journal_entries WHERE id=?').run(entryId);
    }
  }
  db.prepare(`UPDATE hr_payroll SET status='draft', journal_entry_id=NULL WHERE month=?`).run(month);
  return payrollTotals(db, month);
}

module.exports = {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee,
  listLeaveTypes, createLeaveType, updateLeaveType, deleteLeaveType,
  listLeaves, getLeave, createLeave, updateLeave, setLeaveStatus, deleteLeave,
  listAttendance, upsertAttendance, deleteAttendance,
  listPayroll, payrollTotals, generatePayroll, updatePayrollRow, deletePayrollRow,
  postPayroll, reversePayroll, payrollAccounts
};
