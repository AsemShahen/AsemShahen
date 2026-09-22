'use strict';
// إدارة المستخدمين والصلاحيات وجلسات الدخول
// نموذج الأدوار:
//   platform : مدير المنصة (يُنشأ عند التنصيب) — يدير الشركات ويدقق فيها قراءةً فقط
//   admin    : مدير شركة معيّنة — صلاحيات كاملة داخل شركته فقط
//   user     : مستخدم يملك صلاحيات محددة داخل شركته فقط
const crypto = require('crypto');
const { masterDb } = require('./master-db');

// الأنشطة التي تحتوي بضائع/مخزون (تُتاح لها نوافذ المستودعات والمنتجات والمخزون ونقطة البيع)
const GOODS_TYPES = ['supermarket', 'factory', 'hospital', 'medical_lab', 'restaurant'];

const WINDOWS = [
  { key: 'dashboard', label: 'لوحة التحكم' },
  { key: 'accounts', label: 'المخطط المحاسبي' },
  { key: 'journal', label: 'قيود اليومية' },
  { key: 'ledger', label: 'دفتر الأستاذ' },
  { key: 'trial-balance', label: 'ميزان المراجعة' },
  { key: 'income-statement', label: 'قائمة الدخل' },
  { key: 'balance-sheet', label: 'الميزانية العمومية' },
  { key: 'vat', label: 'تقرير الضريبة (VAT)' },
  { key: 'invoices-sale', label: 'فواتير البيع' },
  { key: 'invoices-purchase', label: 'فواتير الشراء' },
  { key: 'parties', label: 'العملاء والموردون' },
  { key: 'closing', label: 'الإقفال السنوي' },
  { key: 'settings', label: 'الإعدادات' },
  { key: 'activity-log', label: 'سجل عمليات المستخدمين' },
  { key: 'warehouses', label: 'المستودعات', businessTypes: GOODS_TYPES },
  { key: 'products', label: 'المنتجات', businessTypes: GOODS_TYPES },
  { key: 'inventory', label: 'المخزون والجرد', businessTypes: GOODS_TYPES },
  { key: 'pos', label: 'نقطة البيع', businessTypes: GOODS_TYPES },
  { key: 'recipes', label: 'الوصفات والتكاليف', businessTypes: ['restaurant'] },
  { key: 'production', label: 'التصنيع والإنتاج', businessTypes: ['restaurant'] },
  { key: 'hr-employees', label: 'الموظفون والأقسام' },
  { key: 'hr-leaves', label: 'الإجازات' },
  { key: 'hr-payroll', label: 'الرواتب والأجور' },
  { key: 'hosp-dashboard', label: 'لوحة المشفى', businessTypes: ['hospital'] },
  { key: 'hosp-patients', label: 'المرضى', businessTypes: ['hospital'] },
  { key: 'hosp-doctors', label: 'الأطباء والأقسام', businessTypes: ['hospital'] },
  { key: 'hosp-appointments', label: 'المواعيد', businessTypes: ['hospital'] },
  { key: 'hosp-records', label: 'السجلات الطبية', businessTypes: ['hospital'] },
  { key: 'hosp-billing', label: 'فوترة المرضى', businessTypes: ['hospital'] },
  { key: 'hotel-dashboard', label: 'لوحة الفندق', businessTypes: ['hotel'] },
  { key: 'hotel-rooms', label: 'الغرف والوحدات', businessTypes: ['hotel'] },
  { key: 'hotel-guests', label: 'النزلاء', businessTypes: ['hotel'] },
  { key: 'hotel-bookings', label: 'الحجوزات', businessTypes: ['hotel'] },
  { key: 'hotel-services', label: 'الخدمات الفندقية', businessTypes: ['hotel'] },
  { key: 'hotel-billing', label: 'حساب النزيل والفوترة', businessTypes: ['hotel'] },
  { key: 'mfg-dashboard', label: 'لوحة التصنيع', businessTypes: ['factory'] },
  { key: 'mfg-boms', label: 'قوائم التصنيع (BOM)', businessTypes: ['factory'] },
  { key: 'mfg-orders', label: 'أوامر التصنيع', businessTypes: ['factory'] },
  { key: 'mfg-expenses', label: 'مصروفات التصنيع', businessTypes: ['factory'] },
  { key: 'mfg-reports', label: 'تقارير التصنيع', businessTypes: ['factory'] }
];

// نوافذ الصلاحيات المتاحة لنوع نشاط معيّن (عزل صلاحيات كل شركة حسب نشاطها)
function windowsFor(businessType) {
  const type = String(businessType || '').trim();
  return WINDOWS.filter(w => !w.businessTypes || w.businessTypes.includes(type));
}

const ACTIONS = [
  { key: 'view', label: 'العرض' },
  { key: 'add', label: 'الإضافة' },
  { key: 'edit', label: 'التعديل' },
  { key: 'search', label: 'البحث' },
  { key: 'delete', label: 'الحذف' },
  { key: 'print_preview', label: 'معاينة قبل الطباعة' },
  { key: 'print', label: 'الطباعة' },
  { key: 'import', label: 'الاستيراد' },
  { key: 'export', label: 'التصدير' }
];

// إجراءات القراءة التي يملكها مدير المنصة عند التدقيق داخل أي شركة
const PLATFORM_READONLY_ACTIONS = new Set(['view', 'search', 'print_preview', 'print', 'export']);

masterDb.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- platform | admin | user
  company_id INTEGER,                          -- NULL = مدير المنصة
  permissions TEXT NOT NULL DEFAULT '{}',      -- JSON: { windowKey: { actionKey: bool } } (مسطح — لشركة الحساب فقط)
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`);

// ترقية قاعدة بيانات قديمة: ربط المستخدمين بشركة وتحويل المدير العام إلى مدير منصة
function migrateLegacyUsers() {
  const cols = masterDb.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (cols.includes('company_id')) return;

  const companies = masterDb.prepare('SELECT id FROM companies ORDER BY id').all();
  const rows = masterDb.prepare('SELECT * FROM users').all();
  const hadAdmin = rows.some(r => r.role === 'admin');

  masterDb.pragma('foreign_keys = OFF');
  masterDb.exec(`
    ALTER TABLE users RENAME TO users_legacy;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      company_id INTEGER,
      permissions TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const insert = masterDb.prepare(`
    INSERT INTO users (id, username, password_hash, role, company_id, permissions, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const flatOf = (windowMap) => {
    const out = {};
    for (const w of Object.keys(windowMap || {})) {
      out[w] = {};
      for (const a of Object.keys(windowMap[w] || {})) out[w][a] = !!windowMap[w][a];
    }
    return out;
  };
  const grantedFlat = (m) => {
    let n = 0;
    for (const w of Object.keys(m)) for (const a of Object.keys(m[w] || {})) if (m[w][a]) n++;
    return n;
  };

  for (const r of rows) {
    let role = r.role === 'admin' ? 'platform' : 'user';
    let companyId = null;
    let perms = {};
    const raw = parsePerms(r);
    if (role === 'user') {
      const scopedKeys = Object.keys(raw).filter(k => /^\d+$/.test(k));
      let chosen = null;
      let best = -1;
      for (const cid of scopedKeys) {
        const n = grantedFlat(raw[cid]);
        if (n > best) { best = n; chosen = cid; }
      }
      if (chosen !== null) {
        companyId = Number(chosen);
        perms = flatOf(raw[chosen]);
      } else if (companies.length) {
        // صلاحيات قديمة غير مقيدة بشركة: تنسب لأول شركة قائمة
        companyId = companies[0].id;
        perms = flatOf(raw);
      }
    }
    insert.run(r.id, r.username, r.password_hash, role, companyId, JSON.stringify(perms), r.is_active, r.created_at, r.updated_at);
  }

  masterDb.exec('DROP TABLE users_legacy');
  masterDb.pragma('foreign_keys = ON');

  // مدير المنصة الافتراضي: admin / admin123 (يبقى كما كان سابقاً إن وُجد)
  if (hadAdmin) {
    const plat = masterDb.prepare('SELECT id FROM users WHERE role = ?').get('platform');
    if (!plat) ensureDefaultAdmin();
  }
}

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(String(password)).digest('hex');
}

function defaultPermissions() {
  const p = {};
  for (const w of WINDOWS) {
    p[w.key] = {};
    for (const a of ACTIONS) p[w.key][a.key] = true;
  }
  return p;
}

function parsePerms(user) {
  try {
    const raw = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions;
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (e) { return {}; }
}

// تطبيع مصفوفة الصلاحيات: يدعم الوارد القديم المتعدد الشركات فيُسقِطه لمصفوفة مسطحة لشركة واحدة
function normalizePerms(input, companyId) {
  const p = (input && typeof input === 'object') ? input : {};
  const scopedKeys = Object.keys(p).filter(k => /^\d+$/.test(k));
  if (!scopedKeys.length) return p;
  const target = String(companyId);
  return (p[target] && typeof p[target] === 'object') ? p[target] : {};
}

function isPlatform(user) { return !!(user && user.role === 'platform'); }

function belongsToCompany(user, companyId) {
  return !!(user && !isPlatform(user) && user.company_id != null && Number(user.company_id) === Number(companyId));
}

// هل يمكن للمستخدم الوصول (حتى بالقراءة) إلى شركة؟
function canAccessCompany(user, companyId) {
  return isPlatform(user) || belongsToCompany(user, companyId);
}

// مدير شركة معيّنة؟
function isCompanyAdmin(user, companyId) {
  return !!(user && user.role === 'admin' && belongsToCompany(user, companyId));
}

// هل يمكنه إدارة مستخدمي هذه الشركة؟ (مدير المنصة + مدير الشركة)
function canManageCompanyUsers(user, companyId) {
  return isPlatform(user) || isCompanyAdmin(user, companyId);
}

function hasPerm(user, companyId, windowKey, action) {
  if (!user) return false;
  if (isPlatform(user)) return PLATFORM_READONLY_ACTIONS.has(action);
  if (!belongsToCompany(user, companyId)) return false;
  if (user.role === 'admin') return true;
  const p = parsePerms(user);
  return !!(p[windowKey] && p[windowKey][action]);
}

// هل للمستخدم أي صلاحية داخل شركة معينة؟ (تُستخدم لقوائم الشركات المتاحة للحساب)
function userHasCompany(user, companyId) {
  return canAccessCompany(user, companyId);
}

function toSafe(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return { ...rest, permissions: parsePerms(user) };
}

function getUser(id) {
  return masterDb.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function listUsers() {
  return masterDb.prepare('SELECT * FROM users ORDER BY username').all().map(toSafe);
}

function listCompanyUsers(companyId) {
  return masterDb.prepare('SELECT * FROM users WHERE company_id = ? ORDER BY (role = \'admin\') DESC, username')
    .all(Number(companyId)).map(toSafe);
}

function companyAdminCount(companyId) {
  return masterDb.prepare('SELECT COUNT(*) AS c FROM users WHERE role = \'admin\' AND company_id = ?').get(Number(companyId)).c;
}

function createUser(data) {
  const username = String(data.username || '').trim();
  if (!username) throw new Error('اسم المستخدم مطلوب');
  if (!/^[^\s]{3,30}$/.test(username)) throw new Error('اسم المستخدم يجب أن يكون من 3 إلى 30 حرفاً بدون مسافات');

  const role = data.role === 'admin' ? 'admin'
    : (data.role === 'platform' ? 'platform' : 'user');
  let companyId = null;
  if (data.company_id !== undefined && data.company_id !== null && data.company_id !== '') {
    companyId = Number(data.company_id);
    if (!Number.isFinite(companyId)) throw new Error('معرّف الشركة غير صالح');
  }
  if (role !== 'platform') {
    if (companyId === null) throw new Error('يجب ربط حساب المستخدم بشركة');
    const company = masterDb.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
    if (!company) throw new Error('الشركة غير موجودة');
  } else {
    companyId = null;
    const existingPlatform = masterDb.prepare('SELECT id FROM users WHERE role = ?').get('platform');
    if (existingPlatform) throw new Error('يوجد بالفعل مدير منصة واحد');
  }

  const dup = masterDb.prepare('SELECT id FROM users WHERE username = ? AND COALESCE(company_id, -1) = ?')
    .get(username, companyId === null ? -1 : companyId);
  if (dup) throw new Error('اسم المستخدم موجود مسبقاً في هذه الشركة');

  const password = String(data.password || '');
  if (password.length < 4) throw new Error('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
  const perms = (data.permissions && typeof data.permissions === 'object')
    ? JSON.stringify(normalizePerms(data.permissions, companyId))
    : JSON.stringify({});
  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const info = masterDb.prepare(`
    INSERT INTO users (username, password_hash, role, company_id, permissions, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(username, `${salt}:${hashPassword(password, salt)}`, role, companyId, perms, data.is_active === false ? 0 : 1, now, now);
  return toSafe(getUser(info.lastInsertRowid));
}

function updateUser(id, data) {
  const u = getUser(id);
  if (!u) return null;

  const username = String(data.username !== undefined ? data.username : u.username).trim();
  if (!username) throw new Error('اسم المستخدم مطلوب');
  if (username !== u.username) {
    const dup = masterDb.prepare('SELECT id FROM users WHERE username = ? AND COALESCE(company_id, -1) = ? AND id != ?')
      .get(username, u.company_id === null ? -1 : u.company_id, id);
    if (dup) throw new Error('اسم المستخدم موجود مسبقاً في هذه الشركة');
  }

  let role = u.role;
  const nextRole = data.role === 'admin' ? 'admin' : (data.role === 'user' ? 'user' : data.role);
  if (nextRole === 'admin' || nextRole === 'user') {
    if (u.company_id === null) throw new Error('لا يمكن تحويل حساب المنصة إلى مستخدم شركة');
    role = nextRole;
    if (u.role === 'admin' && role === 'user' && companyAdminCount(u.company_id) <= 1) {
      throw new Error('لا يمكن إزالة صلاحية المدير عن آخر مدير في الشركة');
    }
  } else if (nextRole === 'platform') {
    throw new Error('لا يمكن إنشاء مدير منصة من هنا');
  }

  const perms = (data.permissions && typeof data.permissions === 'object')
    ? JSON.stringify(normalizePerms(data.permissions, u.company_id))
    : u.permissions;

  let passSql = '';
  const params = [];
  if (data.password) {
    if (String(data.password).length < 4) throw new Error('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
    const salt = crypto.randomBytes(16).toString('hex');
    passSql = ', password_hash = ?';
    params.push(`${salt}:${hashPassword(String(data.password), salt)}`);
  }

  const isActive = data.is_active !== undefined ? (data.is_active ? 1 : 0) : u.is_active;
  masterDb.prepare(`
    UPDATE users SET username = ?, role = ?, permissions = ?, is_active = ?, updated_at = ? ${passSql}
    WHERE id = ?
  `).run(username, role, perms, isActive, new Date().toISOString(), ...params, id);

  if (!isActive) masterDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return toSafe(getUser(id));
}

function deleteUser(id) {
  const u = getUser(id);
  if (!u) return false;
  if (u.company_id !== null && u.role === 'admin' && companyAdminCount(u.company_id) <= 1) {
    throw new Error('لا يمكن حذف آخر مدير في الشركة');
  }
  if (u.company_id === null && u.role === 'platform') throw new Error('لا يمكن حذف مدير المنصة');
  masterDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  masterDb.prepare('DELETE FROM users WHERE id = ?').run(id);
  return true;
}

// تسجيل الدخول: إما (username, password) لحساب المنصة، أو (username, password, companyId) لحساب شركة
function authenticate(username, password, companyId) {
  const name = String(username || '').trim();
  const cid = (companyId === undefined || companyId === null || companyId === '')
    ? null
    : Number(companyId);

  const u = (cid === null)
    ? masterDb.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(name, 'platform')
    : masterDb.prepare('SELECT * FROM users WHERE username = ? AND company_id = ?').get(name, cid);
  if (!u || !u.is_active) return null;
  const parts = String(u.password_hash).split(':');
  const salt = parts[0] || '';
  const hash = parts[1] || '';
  if (hashPassword(String(password), salt) === hash) return toSafe(u);
  return null;
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  masterDb.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)')
    .run(token, userId, new Date().toISOString());
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const u = masterDb.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND u.is_active = 1
  `).get(token);
  return u ? toSafe(u) : null;
}

function deleteSession(token) {
  masterDb.prepare('DELETE FROM sessions WHERE token = ?').run(String(token || ''));
}

function ensureDefaultAdmin() {
  const hasPlatform = masterDb.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get('platform').c;
  if (hasPlatform === 0) createUser({ username: 'admin', password: 'admin123', role: 'platform' });
}

migrateLegacyUsers();

// فهرس تفرد اسم المستخدم ضمن نطاق الشركة (يُنشأ بعد الترحيل ليكون آمناً على القواعد القديمة)
masterDb.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_username
    ON users (COALESCE(company_id, -1), username);
`);

module.exports = {
  WINDOWS, ACTIONS, PLATFORM_READONLY_ACTIONS, hasPerm, defaultPermissions, windowsFor,
  parsePerms, normalizePerms, isPlatform, belongsToCompany, canAccessCompany,
  isCompanyAdmin, canManageCompanyUsers, userHasCompany, listUsers, listCompanyUsers,
  getUser, createUser, updateUser, deleteUser, authenticate, createSession,
  getSessionUser, deleteSession, ensureDefaultAdmin, companyAdminCount
};
