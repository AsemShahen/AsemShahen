'use strict';
// ==================== إعدادات الضريبة السورية ====================
// لا توجد منظومة فاتورة إلكترونية سورية؛ لذلك يخزّن هذا القسم بيانات الملف الضريبي
// السوري للمنشأة (الأرقام والجهات والنسب) لاستخدامها في الإعدادات والطباعة.
const SYRIA_SETTINGS_KEYS = [
  'syria_active',
  'syria_taxpayer_name',
  'syria_tax_number',
  'syria_financial_number',
  'syria_commercial_register',
  'syria_activity_code',
  'syria_activity_desc',
  'syria_finance_office',
  'syria_chamber',
  'syria_sales_tax_rate',
  'syria_income_tax_rate',
  'syria_address',
  'syria_phone',
  'syria_notes'
];

const DEFAULTS = {
  active: false,
  taxpayerName: '',
  taxNumber: '',
  financialNumber: '',
  commercialRegister: '',
  activityCode: '',
  activityDesc: '',
  financeOffice: '',
  chamber: '',
  salesTaxRate: 20,
  incomeTaxRate: 0,
  address: '',
  phone: '',
  notes: ''
};

function getConfig(db, env = process.env) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
  return {
    active: s.syria_active === '1' || env.SYRIA_ACTIVE === '1',
    taxpayerName: s.syria_taxpayer_name || '',
    taxNumber: s.syria_tax_number || '',
    financialNumber: s.syria_financial_number || '',
    commercialRegister: s.syria_commercial_register || '',
    activityCode: s.syria_activity_code || '',
    activityDesc: s.syria_activity_desc || '',
    financeOffice: s.syria_finance_office || '',
    chamber: s.syria_chamber || '',
    salesTaxRate: num(s.syria_sales_tax_rate, DEFAULTS.salesTaxRate),
    incomeTaxRate: num(s.syria_income_tax_rate, DEFAULTS.incomeTaxRate),
    address: s.syria_address || '',
    phone: s.syria_phone || '',
    notes: s.syria_notes || ''
  };
}

function saveConfig(db, cfg) {
  const set = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const vals = {
    syria_active: cfg.active ? '1' : '0',
    syria_taxpayer_name: cfg.taxpayerName || '',
    syria_tax_number: cfg.taxNumber || '',
    syria_financial_number: cfg.financialNumber || '',
    syria_commercial_register: cfg.commercialRegister || '',
    syria_activity_code: cfg.activityCode || '',
    syria_activity_desc: cfg.activityDesc || '',
    syria_finance_office: cfg.financeOffice || '',
    syria_chamber: cfg.chamber || '',
    syria_sales_tax_rate: String(cfg.salesTaxRate === undefined || cfg.salesTaxRate === null ? '' : cfg.salesTaxRate),
    syria_income_tax_rate: String(cfg.incomeTaxRate === undefined || cfg.incomeTaxRate === null ? '' : cfg.incomeTaxRate),
    syria_address: cfg.address || '',
    syria_phone: cfg.phone || '',
    syria_notes: cfg.notes || ''
  };
  for (const [k, v] of Object.entries(vals)) set.run(k, String(v));
}

function maskConfig(config) {
  return { ...config };
}

module.exports = { getConfig, saveConfig, maskConfig, SYRIA_SETTINGS_KEYS };
