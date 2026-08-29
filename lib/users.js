'use strict';
// إدارة المستخدمين والصلاحيات وجلسات الدخول
const crypto = require('crypto');
const { masterDb } = require('./master-db');

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
  { key: 'warehouses', label: 'المستودعات' },
  { key: 'products', label: 'المنتجات' },
  { key: 'inventory', label: 'المخزون والجرد' },
  { key: 'pos', label: 'نقطة البيع' },
  { key: 'hr-employees', label: 'الموظفون والأقسام' },
  { key: 'hr-leaves', label: 'الإجازات' },
  { key: 'hr-payroll', label: 'الرواتب والأجور' },
  { key: 'hosp-dashboard', label: 'لوحة المشفى' },
  { key: 'hosp-patients', label: 'المرضى' },
  { key: 'hosp-doctors', label: 'الأطباء والأقسام' },
  { key: 'hosp-appointments', label: 'المواعيد' },
  { key: 'hosp-records', label: 'السجلات الطبية' },
  { key: 'hosp-billing', label: 'فوترة المرضى' }
];

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

masterDb.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- admin | user
  permissions TEXT NOT NULL DEFAULT '{}',     -- JSON: { windowKey: { actionKey: bool } }
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

// الصلاحيات مقيدة بشركة إذا كانت مفاتيح المستوى الأول أرقاماً (معرفات الشركات)
function isCompanyScoped(perms) {
  return Object.keys(perms || {}).some(k => /^\d+$/.test(k));
}

// مصفوفة صلاحيات فارغة لشركة واحدة (كل النوافذ والعمليات مغلقة)
function emptyCompanyPermissions() {
  const p = {};
  for (const w of WINDOWS) {
    p[w.key] = {};
    for (const a of ACTIONS) p[w.key][a.key] = false;
  }
  return p;
}

function hasPerm(user, companyId, windowKey, action) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const p = parsePerms(user);
  if (isCompanyScoped(p)) {
    const cp = p[String(companyId)];
    return !!(cp && cp[windowKey] && cp[windowKey][action]);
  }
  // صلاحيات قديمة (غير مقيدة بشركة) تنطبق على كل الشركات
  return !!(p[windowKey] && p[windowKey][action]);
}

// هل للمستخدم أي صلاحية داخل شركة معينة؟
function userHasCompany(user, companyId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const p = parsePerms(user);
  if (isCompanyScoped(p)) {
    const cp = p[String(companyId)];
    if (!cp) return false;
    return Object.keys(cp).some(w => Object.keys(cp[w] || {}).some(a => !!cp[w][a]));
  }
  return true; // صلاحيات قديمة تنطبق على كل الشركات
}

// عدد الصلاحيات الممنوحة داخل شركة معينة
function countCompanyPerms(perms, companyId) {
  const p = isCompanyScoped(perms) ? (perms[String(companyId)] || {}) : perms;
  let n = 0;
  for (const w of Object.keys(p)) for (const a of Object.keys(p[w] || {})) if (p[w][a]) n++;
  return n;
}

function toSafe(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return { ...rest, permissions: user.role === 'admin' ? defaultPermissions() : parsePerms(user) };
}

function getUser(id) {
  return masterDb.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function listUsers() {
  return masterDb.prepare('SELECT * FROM users ORDER BY (role = \'admin\') DESC, username').all().map(toSafe);
}

function createUser(data) {
  const username = String(data.username || '').trim();
  if (!username) throw new Error('اسم المستخدم مطلوب');
  if (!/^[^\s]{3,30}$/.test(username)) throw new Error('اسم المستخدم يجب أن يكون من 3 إلى 30 حرفاً بدون مسافات');
  const dup = masterDb.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (dup) throw new Error('اسم المستخدم موجود مسبقاً');
  const password = String(data.password || '');
  if (password.length < 4) throw new Error('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
  const role = data.role === 'admin' ? 'admin' : 'user';
  const perms = (data.permissions && typeof data.permissions === 'object')
    ? JSON.stringify(data.permissions)
    : JSON.stringify({});
  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const info = masterDb.prepare(`
    INSERT INTO users (username, password_hash, role, permissions, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username, `${salt}:${hashPassword(password, salt)}`, role, perms, data.is_active === false ? 0 : 1, now, now);
  return toSafe(getUser(info.lastInsertRowid));
}

function updateUser(id, data) {
  const u = getUser(id);
  if (!u) return null;

  const username = String(data.username !== undefined ? data.username : u.username).trim();
  if (!username) throw new Error('اسم المستخدم مطلوب');
  if (username !== u.username) {
    const dup = masterDb.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
    if (dup) throw new Error('اسم المستخدم موجود مسبقاً');
  }

  let role = u.role;
  if (data.role === 'admin' || data.role === 'user') role = data.role;
  if (u.role === 'admin' && role === 'user' && adminCount() <= 1) {
    throw new Error('لا يمكن إزالة صلاحية المدير عن آخر مدير في النظام');
  }

  const perms = (data.permissions && typeof data.permissions === 'object')
    ? JSON.stringify(data.permissions)
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
  if (u.role === 'admin' && adminCount() <= 1) throw new Error('لا يمكن حذف آخر مدير في النظام');
  masterDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  masterDb.prepare('DELETE FROM users WHERE id = ?').run(id);
  return true;
}

function adminCount() {
  return masterDb.prepare('SELECT COUNT(*) AS c FROM users WHERE role = \'admin\'').get().c;
}

function authenticate(username, password) {
  const u = masterDb.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
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
  const c = masterDb.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (c === 0) createUser({ username: 'admin', password: 'admin123', role: 'admin' });
}

module.exports = {
  WINDOWS, ACTIONS, hasPerm, defaultPermissions, emptyCompanyPermissions,
  isCompanyScoped, userHasCompany, countCompanyPerms, listUsers, getUser, createUser,
  updateUser, deleteUser, authenticate, createSession, getSessionUser, deleteSession,
  ensureDefaultAdmin, adminCount
};
