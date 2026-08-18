'use strict';

// ==================== أدوات مساعدة للعرض ====================
const fmt = {
  money(v, currency = 'ر.س') {
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
    return { asset: 'أصل', liability: 'خصم', equity: 'حقوق ملكية', revenue: 'إيراد', expense: 'مصروف' }[type] || type;
  },
  sideColor(type) {
    return { asset: 'green', liability: 'yellow', equity: 'gray', revenue: 'green', expense: 'red' }[type] || 'gray';
  },
  invStatus(s) {
    return { paid: { t: 'مدفوعة', c: 'green' }, partial: { t: 'مدفوعة جزئياً', c: 'yellow' }, unpaid: { t: 'غير مدفوعة', c: 'red' } }[s] || { t: s, c: 'gray' };
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
      not_configured: { t: 'لم تُرسل (غير مُفعّل)', c: 'gray' },
      submitting: { t: 'جارٍ الإرسال...', c: 'yellow' },
      submitted: { t: 'تم الإبلاغ', c: 'green' },
      cleared: { t: 'تم الاعتماد', c: 'green' },
      failed: { t: 'فشل الإرسال', c: 'red' }
    }[s] || { t: '—', c: 'gray' };
  },
  zatcaType(t) {
    return { standard: 'قياسية (B2B)', simplified: 'مبسطة (B2C)' }[t] || t || '—';
  }
};

const typesMeta = {
  corporate: { icon: '🏢', label: 'شركة' },
  supermarket: { icon: '🛒', label: 'سوبر ماركت' },
  factory: { icon: '🏭', label: 'مصنع' },
  medical_lab: { icon: '🔬', label: 'مخبر طبي' }
};

function typeIcon(t) { return (typesMeta[t] || typesMeta.corporate).icon; }
function typeLabel(t) { return (typesMeta[t] || typesMeta.corporate).label; }

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
    printReport() { return printReport; }
  },
  methods: {
    async api(path, opts = {}) {
      const r = await fetch(path, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'خطأ في الطلب');
      return data;
    },
    toast(message, type = 'success') {
      this.alert = { type, message };
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => (this.alert = null), 4000);
    }
  }
};
