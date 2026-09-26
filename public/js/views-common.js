'use strict';

// ==================== أدوات مساعدة للعرض ====================
const fmt = {
  money(v, currency = t('ر.س')) {
    const n = Number(v) || 0;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
  },
  num(v) {
    return (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  date(d) {
    if (!d) return '—';
    return String(d);
  },
  sideText(type) {
    return { asset: t('أصل'), liability: t('خصم'), equity: t('حقوق ملكية'), revenue: t('إيراد'), expense: t('مصروف') }[type] || type;
  },
  sideColor(type) {
    return { asset: 'green', liability: 'yellow', equity: 'gray', revenue: 'green', expense: 'red' }[type] || 'gray';
  },
  invStatus(s) {
    return { paid: { t: t('مدفوعة'), c: 'green' }, partial: { t: t('مدفوعة جزئياً'), c: 'yellow' }, unpaid: { t: t('غير مدفوعة'), c: 'red' } }[s] || { t: s, c: 'gray' };
  },
  payMethod(p, methods) {
    if (!p) return '—';
    const m = (methods || []).find(x => x.code === p);
    return m ? (m.icon ? m.icon + ' ' : '') + m.name : p;
  },
  accountLabel(acc) {
    return acc ? `${acc.code} - ${acc.name}` : '—';
  },
  zatcaStatus(s) {
    return {
      not_configured: { t: t('لم تُرسل (غير مُفعّل)'), c: 'gray' },
      submitting: { t: t('جارٍ الإرسال...'), c: 'yellow' },
      submitted: { t: t('تم الإبلاغ'), c: 'green' },
      cleared: { t: t('تم الاعتماد'), c: 'green' },
      failed: { t: t('فشل الإرسال'), c: 'red' }
    }[s] || { t: '—', c: 'gray' };
  },
  zatcaType(type) {
    return { standard: t('قياسية (B2B)'), simplified: t('مبسطة (B2C)') }[type] || type || '—';
  }
};

const typesMeta = {
  corporate: { icon: '🏢', label: 'شركة' },
  supermarket: { icon: '🛒', label: 'سوبر ماركت' },
  factory: { icon: '🏭', label: 'مصنع' },
  medical_lab: { icon: '🔬', label: 'مخبر طبي' },
  hospital: { icon: '🏥', label: 'مستشفى' },
  restaurant: { icon: '🍽️', label: 'مطعم / كافيه' },
  hotel: { icon: '🏨', label: 'فندق / شقق مفروشة' }
};

function typeIcon(type) { return (typesMeta[type] || typesMeta.corporate).icon; }
function typeLabel(type) { return t((typesMeta[type] || typesMeta.corporate).label); }

const accountTypeLabels = {
  asset: 'أصل', liability: 'خصم / التزام', equity: 'حقوق ملكية', revenue: 'إيراد', expense: 'مصروف'
};
const accountCategoryLabels = {
  header: 'تجميع',
  cash: 'نقدية وبنوك',
  receivable: 'مدينون',
  inventory: 'مخزون',
  vat: 'ضريبة القيمة المضافة',
  prepaid: 'مصاريف مقدمة',
  fixed_asset: 'أصول ثابتة',
  other: 'أصول أخرى',
  payable: 'دائنون',
  capital: 'رأس المال',
  retained: 'أرباح محتجزة',
  withdrawals: 'سحوبات',
  sales: 'مبيعات',
  sales_return: 'مردودات مبيعات',
  other_income: 'إيرادات أخرى',
  purchases: 'مشتريات',
  purchases_return: 'مردودات مشتريات',
  cogs: 'تكلفة المبيعات',
  production: 'تكاليف إنتاج',
  admin: 'مصاريف إدارية وعمومية'
};

// ==================== المستخدم الحالي والصلاحيات ====================
let _authUser = null;
let _activeCompanyId = null;
let _activeView = null;
function setAuthUser(u) { _authUser = u; }
function getAuthUser() { return _authUser; }
function setActiveCompanyId(id) { _activeCompanyId = id; }
function setActiveView(v) { _activeView = v; }
function getActiveView() { return _activeView; }

// اسم الجهاز/المتصفح (لا يمكن للمتصفح قراءة اسم الحاسب الفعلي، لذا نبني بصمة ثابتة للجهاز)
function deviceName() {
  try {
    let d = localStorage.getItem('muhasib_device');
    if (d) return d;
    const ua = navigator.userAgent || '';
    const os = /Windows/.test(ua) ? 'Windows'
      : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
        : /Android/.test(ua) ? 'Android'
          : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
            : /Linux/.test(ua) ? 'Linux' : 'جهاز';
    const br = /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Firefox\//.test(ua) ? 'Firefox'
            : /Safari\//.test(ua) ? 'Safari' : 'متصفح';
    d = os + ' · ' + br + ' · ' + Math.random().toString(36).slice(2, 7).toUpperCase();
    localStorage.setItem('muhasib_device', d);
    return d;
  } catch (e) { return 'جهاز'; }
}

// تسجيل حدث من الواجهة في سجل عمليات المستخدمين (طباعة/تصدير/استيراد...)
function logActivity(action, summary) {
  const cid = _activeCompanyId;
  const token = localStorage.getItem('muhasib_token');
  if (!cid || !token) return;
  try {
    fetch(`/api/companies/${cid}/activity/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token,
        'X-Device-Name': deviceName()
      },
      body: JSON.stringify({ action, summary: summary || '', window_key: _activeView || '' })
    }).catch(() => {});
  } catch (e) { /* تجاهل */ }
}

// إجراءات القراءة المسموحة لمدير المنصة أثناء التدقيق
const PLATFORM_READONLY = ['view', 'search', 'print_preview', 'print', 'export'];

function isPlatformUser(u) { return !!(u && u.role === 'platform'); }

function isCompanyAdminUser(u, companyId) {
  return !!(u && u.role === 'admin' && u.company_id != null && Number(u.company_id) === Number(companyId));
}

function can(windowKey, action, companyId) {
  const u = getAuthUser();
  if (!u) return false;
  const cid = companyId !== undefined ? companyId : _activeCompanyId;
  if (isPlatformUser(u)) return PLATFORM_READONLY.includes(action);
  // حساب الشركة لا يملك أي صلاحية خارج شركته
  if (u.company_id != null && Number(u.company_id) !== Number(cid)) return false;
  if (u.role === 'admin') return true;
  const p = u.permissions || {};
  return !!(p[windowKey] && p[windowKey][action]);
}

// ==================== طلب واجهة برمجية مع المصادقة ====================
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Device-Name': deviceName(), ...(opts.headers || {}) };
  let body = opts.body;
  if (body !== undefined && body !== null && typeof body === 'object'
    && !(typeof Blob !== 'undefined' && body instanceof Blob)
    && !(typeof FormData !== 'undefined' && body instanceof FormData)) {
    body = JSON.stringify(body);
  }
  const token = localStorage.getItem('muhasib_token');
  if (token) headers['x-auth-token'] = token;
  const r = await fetch(path, { ...opts, body, headers });
  if (r.status === 401) window.dispatchEvent(new Event('muhasib-auth-expired'));
  return r;
}

// ==================== المعاينة والطباعة ====================
const printStore = Vue.reactive({ open: false, title: '', sub: '', cols: [], rows: [], footer: [] });

function openPrintPreview(opts) {
  printStore.title = opts.title || '';
  printStore.sub = opts.sub || '';
  printStore.cols = opts.cols || [];
  printStore.rows = opts.rows || [];
  printStore.footer = opts.footer || [];
  printStore.open = true;
  logActivity('print_preview', opts.title || '');
}

function closePrintPreview() { printStore.open = false; }

// ==================== تصدير واستيراد ====================
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(filename, cols, rows) {
  const esc = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
  const csv = [cols.map(esc).join(',')]
    .concat(rows.map(r => r.map(esc).join(',')))
    .join('\r\n');
  downloadFile(filename + '.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
  logActivity('export', 'CSV: ' + filename);
}

function exportJson(filename, data) {
  downloadFile(filename + '.json', JSON.stringify(data, null, 2), 'application/json');
  logActivity('export', 'JSON: ' + filename);
}

function importJsonFile(onData) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onData(JSON.parse(reader.result));
        logActivity('import', 'JSON: ' + f.name);
      } catch (e) { alert(t('ملف JSON غير صالح')); }
    };
    reader.readAsText(f);
  };
  input.click();
}

// تحميل بيانات الشركة
async function loadInfo(company) {
  const r = await fetch(`/api/companies/${company.id}/info`);
  return await r.json();
}

const WaPreviewModal = {
  name: 'WaPreviewModal',
  props: {
    preview: { type: Object, default: null },
    busy: { type: Boolean, default: false }
  },
  emits: ['close', 'confirm'],
  computed: {
    res() { return this.preview ? this.preview.res : null; }
  },
  template: `
  <div v-if="preview" class="modal-overlay" @click.self="!busy && $emit('close')">
    <div class="modal" style="max-width:520px;">
      <h3>{{ t('معاينة رسالة واتساب') }}</h3>
      <div class="muted mb-2">
        {{ t('إلى:') }} <strong dir="ltr">{{ res.to }}</strong><template v-if="res.party"> ({{ res.party }})</template>
      </div>
      <div class="receipt-box" style="white-space:pre-wrap;text-align:right;direction:rtl;font-size:14px;">{{ res.text }}</div>
      <p v-if="res.method === 'link'" class="muted" style="font-size:12px;margin-top:6px;">{{ t('سيُفتح واتساب برسالة جاهزة، اضغط إرسال بعد المعاينة.') }}</p>
      <p v-else class="muted" style="font-size:12px;margin-top:6px;">{{ t('سيُرسل تلقائياً عبر WhatsApp Cloud API.') }}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" @click="$emit('close')" :disabled="busy">{{ t('إلغاء') }}</button>
        <button class="btn btn-primary" @click="$emit('confirm')" :disabled="busy">{{ busy ? t('جارٍ الإرسال...') : (res.method === 'api' ? t('إرسال عبر واتساب') : t('فتح واتساب')) }}</button>
      </div>
    </div>
  </div>
  `
};

// مزيج معاينة وإرسال الواتساب (معاينة أولاً ثم تأكيد قبل الإرسال / فتح الرابط)
const WaSendMixin = {
  data() {
    return { waPreview: null, waBusy: false };
  },
  methods: {
    async askWhatsApp(payload) {
      try {
        const res = await this.api(`/api/companies/${this.company.id}/whatsapp/preview`, { method: 'POST', body: payload });
        this.waPreview = { payload, res };
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async confirmWhatsApp() {
      if (!this.waPreview) return;
      const { payload, res } = this.waPreview;
      try {
        if (res.method === 'api') {
          this.waBusy = true;
          const r = await this.api(`/api/companies/${this.company.id}/whatsapp/send`, { method: 'POST', body: payload });
          if (r.method === 'api' && r.sent) this.toast(t('تم إرسال الرسالة عبر واتساب'));
          else if (r.link) window.open(r.link, '_blank');
        } else if (res.link) {
          window.open(res.link, '_blank');
        }
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.waBusy = false; }
      this.waPreview = null;
    }
  }
};

// مكونات مشتركة تُسجل في كل الشاشات
const CommonMixin = {
  props: {
    company: { type: Object, required: true },
    info: { type: Object, default: () => ({ settings: {}, active_fiscal_year: null, vat: null }) }
  },
  computed: {
    fmt() { return fmt; },
    typeIcon() { return typeIcon; },
    typeLabel() { return typeLabel; },
    accountTypeLabels() { return accountTypeLabels; },
    accountCategoryLabels() { return accountCategoryLabels; },
    can() { return can; },
    printStore() { return printStore; }
  },
  methods: {
    async api(path, opts = {}) {
      const r = await apiFetch(path, opts);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || t('خطأ في الطلب'));
      return data;
    },
    toast(message, type = 'success') {
      this.alert = { type, message };
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => (this.alert = null), 4000);
    },
    openPrintPreview,
    closePrintPreview,
    doPrint() {
      if (!this.printStore.open) {
        const preview = typeof this.preview === 'function' ? this.preview
          : (typeof this.previewLedger === 'function' ? this.previewLedger : null);
        if (preview) preview.call(this);
      }
      logActivity('print', this.printStore.title || '');
      setTimeout(() => { try { window.print(); } catch (e) {} }, 100);
    },
    exportCsv,
    exportJson,
    importJsonFile,
    logActivity
  }
};

// ==================== تصفية التقارير حسب الفرع ====================
// يوفّر قائمة الفروع + المعرّف المختار ويستدعي reload() عند تغييره
const ReportBranchMixin = {
  data() { return { branches: [], branchId: '' }; },
  async created() {
    try { this.branches = await this.api(`/api/companies/${this.company.id}/branches`).catch(() => []) || []; }
    catch (e) { this.branches = []; }
  },
  watch: {
    branchId() { if (typeof this.reload === 'function') this.reload(); }
  },
  methods: {
    branchQuery() { return this.branchId ? `?branch=${this.branchId}` : ''; },
    branchJoin() { return this.branchId ? '&branch=' + this.branchId : ''; }
  }
};
