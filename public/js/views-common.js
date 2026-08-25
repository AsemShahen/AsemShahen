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
  hospital: { icon: '🏥', label: 'مستشفى' }
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
function setAuthUser(u) { _authUser = u; }
function getAuthUser() { return _authUser; }

function can(windowKey, action) {
  const u = getAuthUser();
  if (!u) return false;
  if (u.role === 'admin') return true;
  return !!(u.permissions && u.permissions[windowKey] && u.permissions[windowKey][action]);
}

// ==================== طلب واجهة برمجية مع المصادقة ====================
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
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
}

function exportJson(filename, data) {
  downloadFile(filename + '.json', JSON.stringify(data, null, 2), 'application/json');
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
      try { onData(JSON.parse(reader.result)); }
      catch (e) { alert(t('ملف JSON غير صالح')); }
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
      setTimeout(() => { try { window.print(); } catch (e) {} }, 100);
    },
    exportCsv,
    exportJson,
    importJsonFile
  }
};
