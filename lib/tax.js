'use strict';
// ==================== نموذج الضريبة حسب الدولة ====================
// يدعم النظام أنظمة ضريبية متعددة: السعودية (ضريبة القيمة المضافة)، الأردن (ضريبة المبيعات)،
// سوريا (ضريبة المبيعات) ومصر (ضريبة القيمة المضافة).
// يُختار النظام الضريبي على مستوى الفرع، ولكل فرع نسبة قابلة للتعديل وعملته الخاصة.

const TAX_COUNTRIES = {
  SA: {
    code: 'SA',
    name: 'السعودية',
    nameEn: 'Saudi Arabia',
    label: 'ضريبة القيمة المضافة',
    labelEn: 'Value Added Tax',
    defaultRate: 15,
    currency: 'SAR',
    currencySymbol: 'ر.س',
    authority: 'هيئة الزكاة والضريبة والجمارك (ZATCA)',
    einvoice: 'zatca'
  },
  JO: {
    code: 'JO',
    name: 'الأردن',
    nameEn: 'Jordan',
    label: 'ضريبة المبيعات',
    labelEn: 'General Sales Tax',
    defaultRate: 16,
    currency: 'JOD',
    currencySymbol: 'د.أ',
    authority: 'دائرة ضريبة الدخل والمبيعات',
    einvoice: 'jofotara'
  },
  SY: {
    code: 'SY',
    name: 'سوريا',
    nameEn: 'Syria',
    label: 'ضريبة المبيعات',
    labelEn: 'General Sales Tax',
    defaultRate: 20,
    currency: 'SYP',
    currencySymbol: 'ل.س',
    authority: 'الهيئة العامة للضرائب والرسوم',
    einvoice: null
  },
  EG: {
    code: 'EG',
    name: 'مصر',
    nameEn: 'Egypt',
    label: 'ضريبة القيمة المضافة',
    labelEn: 'Value Added Tax',
    defaultRate: 14,
    currency: 'EGP',
    currencySymbol: 'ج.م',
    authority: 'مصلحة الضرائب المصرية (ETA)',
    einvoice: 'egypt'
  }
};

function countryMeta(code) {
  return TAX_COUNTRIES[String(code || '').toUpperCase()] || TAX_COUNTRIES.SA;
}

function taxCountries() {
  return Object.values(TAX_COUNTRIES);
}

function normalizeCountry(code) {
  const c = String(code || '').toUpperCase();
  return TAX_COUNTRIES[c] ? c : 'SA';
}

function defaultRate(code) { return countryMeta(code).defaultRate; }
function defaultCurrency(code) { return countryMeta(code).currency; }
function defaultSymbol(code) { return countryMeta(code).currencySymbol; }

// النسبة الفعلية لفرع: إن حُددت نسبة للفرع تُستخدم، وإلا النسبة الافتراضية للدولة
function branchRate(branch) {
  if (!branch) return defaultRate('SA');
  const r = branch.tax_rate;
  if (r === null || r === undefined || r === '') return defaultRate(branch.tax_country);
  const n = Number(r);
  return Number.isFinite(n) ? n : defaultRate(branch.tax_country);
}

// ملخص ضريبة الفرع الجاهز للاستخدام في الفواتير والقوائم
function branchTax(db, branchId) {
  let branch = null;
  if (branchId && db) {
    try { branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId); } catch (e) { branch = null; }
  }
  const code = branch ? normalizeCountry(branch.tax_country) : 'SA';
  const meta = countryMeta(code);
  return {
    branch: branch || null,
    country: code,
    label: meta.label,
    authority: meta.authority,
    einvoice: meta.einvoice,
    rate: branch ? branchRate(branch) : meta.defaultRate,
    currency: (branch && branch.currency) ? branch.currency : meta.currency,
    currencySymbol: (branch && branch.currency_symbol) ? branch.currency_symbol : meta.currencySymbol
  };
}

module.exports = {
  TAX_COUNTRIES, countryMeta, taxCountries, normalizeCountry,
  defaultRate, defaultCurrency, defaultSymbol, branchRate, branchTax
};
