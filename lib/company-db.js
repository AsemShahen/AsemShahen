'use strict';
const Database = require('better-sqlite3');
const { companyDbPath } = require('./master-db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS fiscal_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open | closing | closed
  closed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  manager TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,             -- asset | liability | equity | revenue | expense
  category TEXT NOT NULL,         -- e.g. current_asset, fixed_asset, ...
  parent_code TEXT,
  is_header INTEGER NOT NULL DEFAULT 0,
  normal_side TEXT NOT NULL DEFAULT 'debit',  -- debit | credit
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  opening_balance REAL NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT 'manual',
  ref_id INTEGER,
  fiscal_year_id INTEGER NOT NULL,
  branch_id INTEGER,
  is_closing INTEGER NOT NULL DEFAULT 0,
  is_opening INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  vat_type TEXT DEFAULT '',
  detail TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,            -- customer | supplier
  name TEXT NOT NULL,
  tax_id TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL,
  kind TEXT NOT NULL,            -- sale | purchase
  party_id INTEGER,
  date TEXT NOT NULL,
  sub_total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 15,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'paid',   -- paid | partial | unpaid
  paid_amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER NOT NULL,
  branch_id INTEGER,
  invoice_uuid TEXT DEFAULT '',
  issue_datetime TEXT DEFAULT '',
  invoice_type TEXT DEFAULT '',          -- simplified | standard
  qr_data TEXT DEFAULT '',
  xml_data TEXT DEFAULT '',
  zatca_hash TEXT DEFAULT '',
  zatca_status TEXT DEFAULT '',          -- not_configured | submitting | submitted | cleared | failed
  zatca_response TEXT DEFAULT '',
  zatca_submitted_at TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_methods (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS hospital_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  specialty TEXT DEFAULT '',
  department_id INTEGER,
  qualification TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  consultation_fee REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  national_id TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  birth_date TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  blood_type TEXT DEFAULT '',
  insurance_company TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER,
  department_id INTEGER,
  date TEXT NOT NULL,
  time TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | checked_in | completed | cancelled | no_show
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_medical_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER,
  appointment_id INTEGER,
  date TEXT NOT NULL,
  symptoms TEXT DEFAULT '',
  diagnosis TEXT DEFAULT '',
  treatment TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  account_code TEXT DEFAULT '',
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  sub_total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 15,
  payer TEXT NOT NULL DEFAULT 'patient',  -- patient | insurance
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'paid',    -- paid | partial | unpaid
  paid_amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_bill_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  service_id INTEGER,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  branch_id INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  barcode TEXT DEFAULT '',
  category TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  purchase_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  sale_account TEXT DEFAULT '4101',
  purchase_account TEXT DEFAULT '5101',
  cogs_account TEXT DEFAULT '5104',
  inventory_account TEXT DEFAULT '1301',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_stock (
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  type TEXT NOT NULL,             -- initial | purchase | sale | adjustment | count
  qty REAL NOT NULL,
  ref_type TEXT DEFAULT '',
  ref_id INTEGER,
  date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_no TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | completed | cancelled
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  system_qty REAL NOT NULL DEFAULT 0,
  count_qty REAL NOT NULL DEFAULT 0,
  diff REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS hr_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id INTEGER,
  manager_employee_id INTEGER,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  national_id TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  birth_date TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  department_id INTEGER,
  job_title TEXT DEFAULT '',
  hire_date TEXT NOT NULL,
  basic_salary REAL NOT NULL DEFAULT 0,
  allowances REAL NOT NULL DEFAULT 0,
  bank_account TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',   -- active | terminated
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  days_per_year REAL NOT NULL DEFAULT 0,
  is_paid INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_no TEXT NOT NULL,
  employee_id INTEGER NOT NULL,
  leave_type_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | cancelled
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  month TEXT NOT NULL,                     -- YYYY-MM
  working_days REAL NOT NULL DEFAULT 0,
  present_days REAL NOT NULL DEFAULT 0,
  absent_days REAL NOT NULL DEFAULT 0,
  late_days REAL NOT NULL DEFAULT 0,
  overtime_hours REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS hr_payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,                     -- YYYY-MM
  employee_id INTEGER NOT NULL,
  basic_salary REAL NOT NULL DEFAULT 0,
  allowances REAL NOT NULL DEFAULT 0,
  overtime REAL NOT NULL DEFAULT 0,
  absences REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  net_salary REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',    -- draft | posted
  fiscal_year_id INTEGER NOT NULL,
  journal_entry_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (month, employee_id)
);

-- ==================== نظام المطاعم والكفيهات (الوصفات والتكاليف والتصنيع) ====================
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL UNIQUE,      -- الوجبة/المشروب النهائي (منتج)
  name TEXT DEFAULT '',
  yield_qty REAL NOT NULL DEFAULT 1,       -- عدد الحصص الناتجة من الوصفة
  overhead_cost REAL NOT NULL DEFAULT 0,   -- تكاليف إضافية/تغليف لكل حصة
  notes TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  ingredient_product_id INTEGER NOT NULL,
  qty REAL NOT NULL DEFAULT 0,             -- الكمية لكل حصة
  wastage_pct REAL NOT NULL DEFAULT 0,     -- نسبة الهدر/الفاقد %
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL,
  recipe_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  qty REAL NOT NULL DEFAULT 1,             -- عدد الحصص المنتجة
  unit_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',-- completed | cancelled
  auto INTEGER NOT NULL DEFAULT 0,         -- 1 = توليد تلقائي عند البيع
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  ingredient_product_id INTEGER NOT NULL,
  description TEXT DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,             -- الكمية المصروفة فعلياً
  unit_cost REAL NOT NULL DEFAULT 0,
  line_cost REAL NOT NULL DEFAULT 0
);

-- ==================== نظام التصنيع للمصانع (قوائم BOM وأوامر التصنيع والمصروفات) ====================
CREATE TABLE IF NOT EXISTS manufacturing_boms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  product_id INTEGER NOT NULL,              -- المنتج التام الناتج
  warehouse_id INTEGER,                     -- المستودع الافتراضي
  yield_qty REAL NOT NULL DEFAULT 1,        -- كمية الناتج من القائمة
  version TEXT DEFAULT '1',
  notes TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manufacturing_bom_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_id INTEGER NOT NULL,
  component_product_id INTEGER NOT NULL,    -- المكوّن
  qty REAL NOT NULL DEFAULT 0,              -- الكمية لكل كمية الناتج
  wastage_pct REAL NOT NULL DEFAULT 0,      -- نسبة الهدر %
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS manufacturing_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL,
  bom_id INTEGER,
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  planned_qty REAL NOT NULL DEFAULT 0,      -- الكمية المخطّطة
  produced_qty REAL NOT NULL DEFAULT 0,     -- الكمية المنتجة فعلاً
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | in_progress | completed | cancelled
  start_date TEXT,
  due_date TEXT,
  date TEXT,                                -- تاريخ الإتمام
  material_cost REAL NOT NULL DEFAULT 0,    -- تكلفة المواد المصروفة
  direct_cost REAL NOT NULL DEFAULT 0,      -- المصروفات المباشرة
  indirect_cost REAL NOT NULL DEFAULT 0,    -- المصروفات غير المباشرة
  total_cost REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS manufacturing_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  component_product_id INTEGER NOT NULL,
  description TEXT DEFAULT '',
  planned_qty REAL NOT NULL DEFAULT 0,      -- المطلوب حسب القائمة
  issued_qty REAL NOT NULL DEFAULT 0,       -- المصروف فعلاً
  unit_cost REAL NOT NULL DEFAULT 0,
  line_cost REAL NOT NULL DEFAULT 0,
  issued INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS manufacturing_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  type TEXT NOT NULL DEFAULT 'direct',      -- direct | indirect
  category TEXT DEFAULT 'other',
  description TEXT DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  payment_account TEXT DEFAULT '1101',      -- الحساب الدائن للدفع
  cost_account TEXT DEFAULT '',             -- حساب بند التكلفة (للتقارير)
  journal_entry_id INTEGER,
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mfg_bom_product ON manufacturing_boms(product_id);
CREATE INDEX IF NOT EXISTS idx_mfg_bom_lines_bom ON manufacturing_bom_lines(bom_id);
CREATE INDEX IF NOT EXISTS idx_mfg_orders_status ON manufacturing_orders(status);
CREATE INDEX IF NOT EXISTS idx_mfg_orders_product ON manufacturing_orders(product_id);
CREATE INDEX IF NOT EXISTS idx_mfg_order_lines_order ON manufacturing_order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_expenses_order ON manufacturing_expenses(order_id);

-- ==================== نظام الفنادق والضيافة (فندق / شقق مفروشة) ====================
CREATE TABLE IF NOT EXISTS hotel_room_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  base_price REAL NOT NULL DEFAULT 0,        -- سعر الليلة الأساسي
  description TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_no TEXT NOT NULL UNIQUE,
  room_type_id INTEGER,
  floor TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available',  -- available | occupied | cleaning | maintenance | out_of_service
  notes TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  national_id TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  nationality TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_no TEXT NOT NULL,
  guest_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  room_type_id INTEGER,
  check_in_date TEXT NOT NULL,
  check_out_date TEXT NOT NULL,
  nights INTEGER NOT NULL DEFAULT 1,
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,              -- سعر الليلة
  status TEXT NOT NULL DEFAULT 'reserved',   -- reserved | checked_in | checked_out | cancelled | no_show
  discount REAL NOT NULL DEFAULT 0,
  sub_total REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 15,
  paid_amount REAL NOT NULL DEFAULT 0,
  deposit REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  notes TEXT DEFAULT '',
  fiscal_year_id INTEGER,
  checked_in_at TEXT,
  checked_out_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  charge_type TEXT NOT NULL DEFAULT 'service',  -- room | service | other
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  account_code TEXT DEFAULT '',
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'cash',
  notes TEXT DEFAULT '',
  journal_entry_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  account_code TEXT DEFAULT '4131',
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_je_fy ON journal_entries(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_inv_kind ON invoices(kind);
CREATE INDEX IF NOT EXISTS idx_hb_patient ON hospital_bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_ha_date ON hospital_appointments(date);
CREATE INDEX IF NOT EXISTS idx_hr_patient ON hospital_medical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_sm_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_sm_warehouse ON stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_scl_count ON stock_count_lines(count_id);
CREATE INDEX IF NOT EXISTS idx_prod_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_hr_emp_dept ON hr_employees(department_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_emp ON hr_leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_pay_month ON hr_payroll(month);
CREATE INDEX IF NOT EXISTS idx_hr_att_month ON hr_attendance(month);
CREATE INDEX IF NOT EXISTS idx_recipe_lines ON recipe_lines(recipe_id);
CREATE INDEX IF NOT EXISTS idx_prod_order_lines ON production_order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_prod_order_prod ON production_orders(product_id);
CREATE INDEX IF NOT EXISTS idx_hotel_bk_room ON hotel_bookings(room_id);
CREATE INDEX IF NOT EXISTS idx_hotel_bk_guest ON hotel_bookings(guest_id);
CREATE INDEX IF NOT EXISTS idx_hotel_bk_status ON hotel_bookings(status);
CREATE INDEX IF NOT EXISTS idx_hotel_ch_booking ON hotel_charges(booking_id);
CREATE INDEX IF NOT EXISTS idx_hotel_pay_booking ON hotel_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_hotel_room_type ON hotel_rooms(room_type_id);

-- ==================== نظام المحادثة الداخلية ====================
CREATE TABLE IF NOT EXISTS chat_members (
  user_id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  department_id INTEGER,
  title TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'general',        -- general | department
  department_id INTEGER,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (department_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER,
  user_a INTEGER,
  user_b INTEGER,
  sender_id INTEGER NOT NULL,
  sender_name TEXT NOT NULL,
  sender_dept TEXT DEFAULT '',
  msg_type TEXT NOT NULL DEFAULT 'text',        -- text|audio|image|video|file|system
  body TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  file_mime TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cmsg_chan ON chat_messages(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_cmsg_dm ON chat_messages(user_a, user_b, id);
CREATE INDEX IF NOT EXISTS idx_cmsg_time ON chat_messages(created_at);

CREATE TABLE IF NOT EXISTS chat_reads (
  user_id INTEGER NOT NULL,
  channel_id INTEGER,
  peer_id INTEGER,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel_id, peer_id)
);

CREATE TABLE IF NOT EXISTS chat_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL DEFAULT 'dm',       -- dm | channel
  channel_id INTEGER,
  caller_id INTEGER NOT NULL,
  callee_id INTEGER,
  call_type TEXT NOT NULL,                      -- voice | video
  status TEXT NOT NULL DEFAULT 'ringing',       -- ringing|accepted|ended|missed|rejected|busy|timeout
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  ended_at INTEGER,
  end_reason TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ccall_user ON chat_calls(callee_id, status);

CREATE TABLE IF NOT EXISTS chat_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER,
  action TEXT NOT NULL,                         -- delete_message | purge_channel
  actor_id INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  details TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
`;

const DEFAULT_PAYMENT_METHODS = [
  ['cash', 'نقداً', '💵'],
  ['mada', 'مدى', '💳'],
  ['credit_card', 'بطاقة ائتمانية', '💳'],
  ['bank_transfer', 'تحويل بنكي', '🏦'],
  ['sadad', 'سداد', '🏧'],
  ['apple_pay', 'Apple Pay', '📱'],
  ['stc_pay', 'STC Pay', '📱'],
  ['check', 'شيك', '📄'],
  ['credit', 'آجل / على الحساب', '📋'],
  ['other', 'أخرى', '🧾']
];

const ZATCA_COLUMNS = {
  invoice_uuid: "TEXT DEFAULT ''",
  issue_datetime: "TEXT DEFAULT ''",
  invoice_type: "TEXT DEFAULT ''",
  qr_data: "TEXT DEFAULT ''",
  xml_data: "TEXT DEFAULT ''",
  zatca_hash: "TEXT DEFAULT ''",
  zatca_status: "TEXT DEFAULT ''",
  zatca_response: "TEXT DEFAULT ''",
  zatca_submitted_at: "TEXT DEFAULT ''"
};

const INVOICE_LINE_EXTRA = {
  product_id: 'INTEGER',
  warehouse_id: 'INTEGER',
  cost: 'REAL NOT NULL DEFAULT 0'
};

// حسابات إضافية لدعم المخزون والجرد (تُضاف بشكل آمن لجميع الشركات)
function ensureInventoryExtras(db) {
  const has = (code) => !!db.prepare('SELECT id FROM accounts WHERE code = ?').get(code);
  const insert = db.prepare(`INSERT INTO accounts (code, name, type, category, parent_code, is_header, normal_side, vat_applicable, opening_balance, is_system, sort_order)
    VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 1, 0) ON CONFLICT(code) DO NOTHING`);
  if (!has('5120')) insert.run('5120', 'فرق الجرد (نقص / عجز)', 'expense', 'admin', '5', 'debit');
  if (!has('4121')) insert.run('4121', 'إيرادات فروق الجرد (زيادة)', 'revenue', 'other_income', '4', 'credit');
}

// فرع افتراضي تلقائياً عند فتح قاعدة بيانات الشركة + ربط السجلات القديمة به
function ensureDefaultBranch(db) {
  let branch = db.prepare('SELECT * FROM branches ORDER BY is_default DESC, id LIMIT 1').get();
  if (!branch) {
    const now = new Date().toISOString();
    const info = db.prepare(`INSERT INTO branches (code, name, address, phone, manager, notes, is_default, is_active, created_at)
      VALUES ('BR-001', 'الفرع الرئيسي', '', '', '', '', 1, 1, ?)`).run(now);
    branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(info.lastInsertRowid);
  }
  // ترحيل السجلات القديمة غير المرتبطة بفرع إلى الفرع الافتراضي
  for (const table of ['warehouses', 'invoices', 'journal_entries']) {
    db.prepare(`UPDATE ${table} SET branch_id = ? WHERE branch_id IS NULL`).run(branch.id);
  }
  return branch;
}

function defaultBranchId(db) {
  const row = db.prepare('SELECT id FROM branches ORDER BY is_default DESC, id LIMIT 1').get();
  return row ? row.id : null;
}

// مستودع افتراضي تلقائياً عند فتح قاعدة بيانات الشركة
function ensureDefaultWarehouse(db) {
  const any = db.prepare('SELECT id FROM warehouses LIMIT 1').get();
  if (!any) {
    const branchId = defaultBranchId(db);
    db.prepare(`INSERT INTO warehouses (code, name, location, notes, branch_id, is_default, is_active, created_at)
      VALUES ('WH-001', 'المستودع الرئيسي', '', '', ?, 1, 1, ?)`)
      .run(branchId, new Date().toISOString());
  }
}

const BRANCH_COLUMNS = {
  warehouses: 'INTEGER',
  invoices: 'INTEGER',
  journal_entries: 'INTEGER'
};

function openCompanyDb(id) {
  const db = new Database(companyDbPath(id));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  const cols = new Set(db.prepare(`PRAGMA table_info(invoices)`).all().map(c => c.name));
  for (const [name, def] of Object.entries(ZATCA_COLUMNS)) {
    if (!cols.has(name)) db.exec(`ALTER TABLE invoices ADD COLUMN ${name} ${def}`);
  }
  const ilCols = new Set(db.prepare(`PRAGMA table_info(invoice_lines)`).all().map(c => c.name));
  for (const [name, def] of Object.entries(INVOICE_LINE_EXTRA)) {
    if (!ilCols.has(name)) db.exec(`ALTER TABLE invoice_lines ADD COLUMN ${name} ${def}`);
  }
  // إضافة عمود الفرع للجداول الموجودة مسبقاً (ترحيل آمن)
  for (const [table, def] of Object.entries(BRANCH_COLUMNS)) {
    const tCols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    if (!tCols.has('branch_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN branch_id ${def}`);
  }
  const pCols = new Set(db.prepare('PRAGMA table_info(products)').all().map(c => c.name));
  if (!pCols.has('image')) db.exec(`ALTER TABLE products ADD COLUMN image TEXT DEFAULT ''`);
  const insertPm = db.prepare('INSERT OR IGNORE INTO payment_methods (code, name, icon) VALUES (?, ?, ?)');
  for (const pm of DEFAULT_PAYMENT_METHODS) insertPm.run(...pm);
  ensureInventoryExtras(db);
  ensureDefaultBranch(db);
  ensureDefaultWarehouse(db);
  return db;
}

module.exports = { openCompanyDb, DEFAULT_PAYMENT_METHODS, defaultBranchId };
