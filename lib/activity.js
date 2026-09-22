'use strict';
// سجل عمليات المستخدمين: تدقيق شامل لكل عملية (إضافة، تعديل، حذف، بحث، طباعة، استيراد، تصدير...)
// يُسجَّل مع كل عملية: المستخدم والشركة ونوع العملية والملخص والوقت وعنوان IP واسم الجهاز.
const { masterDb } = require('./master-db');
const usersLib = require('./users');

masterDb.exec(`
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT DEFAULT '',
  role TEXT DEFAULT '',
  company_id INTEGER,
  window_key TEXT DEFAULT '',
  window_label TEXT DEFAULT '',
  action TEXT NOT NULL,
  summary TEXT DEFAULT '',
  method TEXT DEFAULT '',
  path TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  device TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  status INTEGER DEFAULT 200,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_company ON activity_log(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_log(action);
`);

// أنواع العمليات المعروضة (تتوافق مع مفاتيح صلاحيات الإجراءات في users.js)
const ACTION_LABELS = {
  add: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف',
  search: 'بحث',
  print_preview: 'معاينة قبل الطباعة',
  print: 'طباعة',
  import: 'استيراد',
  export: 'تصدير',
  view: 'عرض',
  login: 'دخول',
  logout: 'خروج',
  other: 'عملية أخرى'
};

const MUTATION_ACTIONS = new Set(['add', 'edit', 'delete', 'import', 'export']);
const CLIENT_ACTIONS = new Set(['print_preview', 'print', 'import', 'export', 'search', 'view', 'other']);

// أسماء النوافذ العربية مستخرجة من نموذج الصلاحيات + نوافذ إدارية إضافية
const WINDOW_LABELS = {};
for (const w of usersLib.WINDOWS) WINDOW_LABELS[w.key] = w.label;
WINDOW_LABELS.companies = 'إدارة الشركات';
WINDOW_LABELS.users = 'المستخدمون والصلاحيات';
WINDOW_LABELS.activity = 'سجل عمليات المستخدمين';
WINDOW_LABELS.chat = 'المحادثة الداخلية';
WINDOW_LABELS.settings = 'الإعدادات';

// استنتاج النافذة من المسار عند عدم مرور الطلب بحارس صلاحيات نافذة
const PATH_WINDOWS = [
  ['/db-tools', 'settings'],
  ['/whatsapp-settings', 'settings'],
  ['/zatca-settings', 'settings'],
  ['/company-types', 'settings'],
  ['/users', 'users'],
  ['/companies', 'companies'],
  ['/chat', 'chat'],
  ['/accounts', 'accounts'],
  ['/journal', 'journal'],
  ['/invoices', 'invoices-sale'],
  ['/parties', 'parties'],
  ['/products', 'products'],
  ['/warehouses', 'warehouses'],
  ['/stock', 'inventory'],
  ['/counts', 'inventory'],
  ['/pos', 'pos'],
  ['/hr', 'hr-employees'],
  ['/hospital', 'hosp-dashboard'],
  ['/hotel', 'hotel-dashboard'],
  ['/restaurant', 'recipes'],
  ['/manufacturing', 'mfg-dashboard']
];

function inferWindow(path) {
  for (const [frag, key] of PATH_WINDOWS) if (path.includes(frag)) return key;
  return '';
}

function windowLabel(key) {
  return WINDOW_LABELS[key] || key || 'عام';
}

function actionLabel(action) {
  return ACTION_LABELS[action] || action || ACTION_LABELS.other;
}

// استخراج عنوان IP الحقيقي مع مراعاة الوسيط العكسي
function clientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  let ip = xff ? String(xff).split(',')[0].trim() : '';
  if (!ip) ip = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

function deviceOf(req) {
  const headers = req.headers || {};
  const named = String(headers['x-device-name'] || '').trim();
  if (named) return named.slice(0, 120);
  const ua = String(headers['user-agent'] || '');
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Linux/.test(ua)) return 'Linux';
  return ua ? 'متصفح' : 'غير معروف';
}

// إدراج سجل عملية واحد
function record(entry) {
  try {
    const now = entry.created_at || new Date().toISOString();
    masterDb.prepare(`
      INSERT INTO activity_log
        (user_id, username, role, company_id, window_key, window_label, action, summary,
         method, path, ip, device, user_agent, status, created_at)
      VALUES
        (@user_id, @username, @role, @company_id, @window_key, @window_label, @action, @summary,
         @method, @path, @ip, @device, @user_agent, @status, @created_at)
    `).run({
      user_id: entry.user_id != null ? Number(entry.user_id) : null,
      username: entry.username || '',
      role: entry.role || '',
      company_id: entry.company_id != null && entry.company_id !== '' ? Number(entry.company_id) : null,
      window_key: entry.window_key || '',
      window_label: entry.window_label || windowLabel(entry.window_key),
      action: entry.action || 'other',
      summary: String(entry.summary || '').slice(0, 500),
      method: entry.method || '',
      path: entry.path || '',
      ip: entry.ip || '',
      device: String(entry.device || '').slice(0, 160),
      user_agent: String(entry.user_agent || '').slice(0, 400),
      status: entry.status != null ? Number(entry.status) : 200,
      created_at: now
    });
    return true;
  } catch (e) {
    return false;
  }
}

// بناء ملخص مقروء للعملية انطلاقاً من بيانات الطلب
function identifierFrom(req) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const keys = ['name', 'title', 'username', 'full_name', 'party_name', 'product_name',
    'invoice_no', 'order_no', 'bom_no', 'code', 'number', 'description', 'category', 'status'];
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 80);
  }
  // آخر معرّف في المسار غير معرّف الشركة
  const params = req.params || {};
  for (const k of Object.keys(params)) {
    if (/^companyId$/i.test(k)) continue;
    if (/(Id|_id)$/.test(k) && params[k]) return '#' + params[k];
  }
  return '';
}

function searchDescription(query) {
  const parts = [];
  if (query.from) parts.push('من ' + query.from);
  if (query.to) parts.push('إلى ' + query.to);
  for (const [k, v] of Object.entries(query || {})) {
    if (['from', 'to', 'limit', 'offset', 'page', 'page_size'].includes(k)) continue;
    if (v === '' || v === undefined || v === null) continue;
    parts.push(`${k}: ${String(v).slice(0, 40)}`);
  }
  return parts.join(' · ').slice(0, 200);
}

// مسارات إدارية لا تُسجَّل (تسجيل الدخول والخروج يُسجَّلان صراحةً)
const SKIP_PATHS = new Set(['/api/health', '/api/companies-meta', '/api/company-types', '/api/me', '/api/login', '/api/logout']);
// مسارات عمليات تُعامل كتعديل رغم أنها POST
const EDIT_VERBS = ['/complete', '/cancel', '/issue', '/finalize', '/close-year', '/resubmit',
  '/status', '/send', '/confirm', '/reopen', '/approve', '/reject', '/payment', '/pay', '/cancelled'];
// مسارات قراءة فقط تُنفَّذ بـ POST (لا تُسجَّل كإضافة)
const READONLY_POST = ['/preview'];

// مفاتيح الاستعلام التي تدل على قيام المستخدم ببحث/تصفية مقصودة
const SEARCH_KEYS = ['search', 'q', 'query', 'from', 'to', 'status', 'type', 'category',
  'party_id', 'product_id', 'warehouse_id', 'account_id', 'employee_id', 'guest_id'];

// تصنيف الطلب وإرجاع بيانات السجل أو null إن كان غير قابل للتسجيل
function classify(req) {
  const path = req.path || req.originalUrl || '';
  if (!path.startsWith('/api/')) return null;
  if (SKIP_PATHS.has(path)) return null;
  if (path.includes('/activity')) return null;

  const method = String(req.method || 'GET').toUpperCase();
  const windowKey = req.activityWindow || inferWindow(path);
  const paramAction = req.activityAction || '';
  const q = req.query || {};
  const hasFilters = SEARCH_KEYS.some(k => q[k] !== undefined && q[k] !== '' && q[k] != null);

  let action = null;
  if (method === 'POST') {
    if (READONLY_POST.some(v => path.includes(v))) return null;
    if (path.includes('/import') || path.includes('/restore')) action = 'import';
    else if (path.includes('/export') || path.includes('/backup')) action = 'export';
    else if (EDIT_VERBS.some(v => path.includes(v))) action = 'edit';
    else action = 'add';
  } else if (method === 'PUT' || method === 'PATCH') {
    action = 'edit';
  } else if (method === 'DELETE') {
    action = 'delete';
  } else if (method === 'GET') {
    if (hasFilters) action = 'search';
    else return null;
  } else {
    return null;
  }

  // إجراء الصلاحية أدق في حالات مثل مسارات النشر/الإلغاء
  if (paramAction && MUTATION_ACTIONS.has(paramAction)) action = paramAction;

  return { action, windowKey, method, path: req.originalUrl || path };
}

// يُستدعى عند اكتمال الاستجابة (res.on('finish')) لتسجيل العملية
function capture(req, res) {
  try {
    const info = classify(req);
    if (!info) return;
    const summary = buildSummary(info.action, info.windowKey, req) || (actionLabel(info.action) + ' · ' + windowLabel(info.windowKey));
    record({
      user_id: req.user ? req.user.id : null,
      username: req.user ? req.user.username : '',
      role: req.user ? req.user.role : '',
      company_id: req.params && req.params.companyId ? Number(req.params.companyId) : null,
      window_key: info.windowKey,
      action: info.action,
      summary,
      method: info.method,
      path: info.path,
      ip: clientIp(req),
      device: deviceOf(req),
      user_agent: req.headers['user-agent'] || '',
      status: res.statusCode || 200
    });
  } catch (e) { /* لا نُعطّل الطلب بسبب تعذّر التسجيل */ }
}

function buildSummary(action, windowKey, req) {
  const base = actionLabel(action) + ' · ' + windowLabel(windowKey);
  if (action === 'search') {
    const d = searchDescription(req.query);
    return d ? base + ' · ' + d : base;
  }
  if (action === 'export' || action === 'import') return base;
  const ident = identifierFrom(req);
  return ident ? base + ' · ' + ident : base;
}

// تسجيل حدث من الواجهة الأمامية (طباعة/تصدير/استيراد/بحث) لا يظهر للخادم
function recordClientEvent(req, { action, summary, window_key: windowKey }) {
  const act = CLIENT_ACTIONS.has(action) ? action : 'other';
  return record({
    user_id: req.user ? req.user.id : null,
    username: req.user ? req.user.username : '',
    role: req.user ? req.user.role : '',
    company_id: req.params && req.params.companyId ? Number(req.params.companyId) : null,
    window_key: windowKey || '',
    action: act,
    summary: summary || '',
    method: 'CLIENT',
    path: req.originalUrl || '',
    ip: clientIp(req),
    device: deviceOf(req),
    user_agent: req.headers['user-agent'] || '',
    status: 200
  });
}

// قائمة السجلات مع التصفية والترقيم
function list(filters = {}) {
  const where = [];
  const params = {};
  const { companyId, userId, action, windowKey, from, to, q } = filters;

  if (companyId !== undefined && companyId !== null && companyId !== '') {
    where.push('a.company_id = @companyId');
    params.companyId = Number(companyId);
  }
  if (userId !== undefined && userId !== null && userId !== '') {
    where.push('a.user_id = @userId');
    params.userId = Number(userId);
  }
  if (action) { where.push('a.action = @action'); params.action = String(action); }
  if (windowKey) { where.push('a.window_key = @windowKey'); params.windowKey = String(windowKey); }
  if (from) { where.push('a.created_at >= @from'); params.from = String(from) + 'T00:00:00.000Z'; }
  if (to) { where.push('a.created_at <= @to'); params.to = String(to) + 'T23:59:59.999Z'; }
  if (q) {
    where.push('(a.summary LIKE @q OR a.username LIKE @q OR a.device LIKE @q OR a.ip LIKE @q OR a.path LIKE @q)');
    params.q = '%' + String(q).trim() + '%';
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = masterDb.prepare(`SELECT COUNT(*) AS c FROM activity_log a ${whereSql}`).get(params).c;

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 5000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const rows = masterDb.prepare(`
    SELECT a.*, c.name AS company_name
    FROM activity_log a
    LEFT JOIN companies c ON c.id = a.company_id
    ${whereSql}
    ORDER BY a.id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  return { total, rows };
}

// قائمة المستخدمين المميزين في السجل (لعناصر التصفية)
function usersInLog(companyId) {
  const params = {};
  let sql = 'SELECT DISTINCT user_id, username FROM activity_log a';
  if (companyId) { sql += ' WHERE a.company_id = @companyId'; params.companyId = Number(companyId); }
  sql += ' ORDER BY username';
  return masterDb.prepare(sql).all(params).filter(u => u.username);
}

module.exports = {
  ACTION_LABELS, WINDOW_LABELS, actionLabel, windowLabel,
  record, capture, recordClientEvent, list, usersInLog, clientIp, deviceOf
};
