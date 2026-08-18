'use strict';

// دالة إضافة حساب
function a(code, name, type, category, opts = {}) {
  return {
    code, name, type, category,
    parent_code: opts.parent_code || null,
    is_header: opts.is_header ? 1 : 0,
    normal_side: opts.normal_side || (type === 'asset' || type === 'expense' ? 'debit' : 'credit'),
    vat_applicable: opts.vat_applicable !== undefined ? (opts.vat_applicable ? 1 : 0) : 1,
    opening_balance: opts.opening_balance || 0,
    is_system: opts.is_system ? 1 : 0,
    sort_order: opts.sort_order || 0
  };
}

// ---------- المخطط الأساسي المشترك ----------
function baseChart() {
  const chart = [];

  // ================= الأصول (1) =================
  chart.push(a('1', 'الأصول', 'asset', 'header', { is_header: true }));
  chart.push(a('11', 'الأصول المتداولة', 'asset', 'header', { is_header: true, parent_code: '1' }));

  chart.push(a('1101', 'الصندوق / النقدية', 'asset', 'cash', { parent_code: '11', normal_side: 'debit', is_system: 1 }));
  chart.push(a('1111', 'البنك الرئيسي', 'asset', 'cash', { parent_code: '11', normal_side: 'debit', is_system: 1 }));
  chart.push(a('1112', 'البنك - فرعي', 'asset', 'cash', { parent_code: '11', normal_side: 'debit' }));

  chart.push(a('1201', 'العملاء (حسابات مدينة)', 'asset', 'receivable', { parent_code: '11', normal_side: 'debit', is_system: 1 }));
  chart.push(a('1202', 'أوراق قبض', 'asset', 'receivable', { parent_code: '11' }));
  chart.push(a('1203', 'سلف العاملين', 'asset', 'receivable', { parent_code: '11' }));
  chart.push(a('1204', 'مدينون آخرون', 'asset', 'receivable', { parent_code: '11' }));

  chart.push(a('1301', 'مخزون البضاعة', 'asset', 'inventory', { parent_code: '11', normal_side: 'debit' }));

  chart.push(a('1401', 'ضريبة القيمة المضافة القابلة للخصم', 'asset', 'vat', { parent_code: '11', normal_side: 'debit', vat_applicable: 0, is_system: 1 }));
  chart.push(a('1402', 'مصروفات مدفوعة مقدماً', 'asset', 'prepaid', { parent_code: '11' }));
  chart.push(a('1403', 'ودائع تأمين', 'asset', 'prepaid', { parent_code: '11' }));

  chart.push(a('15', 'الأصول الثابتة', 'asset', 'header', { is_header: true, parent_code: '1' }));
  chart.push(a('1501', 'أراضي', 'asset', 'fixed_asset', { parent_code: '15' }));
  chart.push(a('1502', 'مباني', 'asset', 'fixed_asset', { parent_code: '15' }));
  chart.push(a('1503', 'آلات ومعدات', 'asset', 'fixed_asset', { parent_code: '15' }));
  chart.push(a('1504', 'معدات مكتبية وحاسوب', 'asset', 'fixed_asset', { parent_code: '15' }));
  chart.push(a('1505', 'أثاث وتجهيزات', 'asset', 'fixed_asset', { parent_code: '15' }));
  chart.push(a('1506', 'سيارات ونقل', 'asset', 'fixed_asset', { parent_code: '15' }));
  chart.push(a('1507', 'الأجهزة الطبية', 'asset', 'fixed_asset', { parent_code: '15' }));
  chart.push(a('1599', 'مجمع الإهلاك', 'asset', 'fixed_asset', { parent_code: '15', normal_side: 'credit', vat_applicable: 0 }));

  chart.push(a('19', 'الأصول الأخرى', 'asset', 'header', { is_header: true, parent_code: '1' }));
  chart.push(a('1901', 'الأصول غير الملموسة', 'asset', 'other', { parent_code: '19' }));
  chart.push(a('1902', 'أصول أخرى', 'asset', 'other', { parent_code: '19' }));

  // ================= الخصوم (2) =================
  chart.push(a('2', 'الخصوم', 'liability', 'header', { is_header: true }));
  chart.push(a('21', 'الخصوم المتداولة', 'liability', 'header', { is_header: true, parent_code: '2' }));

  chart.push(a('2101', 'الموردون (حسابات دائنة)', 'liability', 'payable', { parent_code: '21', normal_side: 'credit', is_system: 1 }));
  chart.push(a('2102', 'أوراق دفع', 'liability', 'payable', { parent_code: '21' }));
  chart.push(a('2103', 'ضريبة القيمة المضافة المستحقة', 'liability', 'vat', { parent_code: '21', normal_side: 'credit', vat_applicable: 0, is_system: 1 }));
  chart.push(a('2104', 'رواتب وأجور مستحقة', 'liability', 'payable', { parent_code: '21' }));
  chart.push(a('2105', 'قروض قصيرة الأجل', 'liability', 'payable', { parent_code: '21' }));
  chart.push(a('2106', 'دائنون آخرون', 'liability', 'payable', { parent_code: '21' }));
  chart.push(a('2107', 'دفعات مقدمة من العملاء', 'liability', 'payable', { parent_code: '21' }));
  chart.push(a('2108', 'الزكاة المستحقة', 'liability', 'payable', { parent_code: '21', vat_applicable: 0 }));

  chart.push(a('22', 'الخصوم طويلة الأجل', 'liability', 'header', { is_header: true, parent_code: '2' }));
  chart.push(a('2201', 'قروض طويلة الأجل', 'liability', 'payable', { parent_code: '22' }));
  chart.push(a('2202', 'مكافأة نهاية الخدمة', 'liability', 'payable', { parent_code: '22', vat_applicable: 0 }));

  // ================= حقوق الملكية (3) =================
  chart.push(a('3', 'حقوق الملكية', 'equity', 'header', { is_header: true }));
  chart.push(a('3101', 'رأس المال', 'equity', 'capital', { parent_code: '3', normal_side: 'credit', is_system: 1 }));
  chart.push(a('3102', 'رأس مال إضافي مدفوع', 'equity', 'capital', { parent_code: '3' }));
  chart.push(a('3201', 'الأرباح المحتجزة', 'equity', 'retained', { parent_code: '3', normal_side: 'credit', vat_applicable: 0, is_system: 1 }));
  chart.push(a('3202', 'أرباح / خسائر السنة الحالية', 'equity', 'retained', { parent_code: '3', normal_side: 'credit', vat_applicable: 0, is_system: 1 }));
  chart.push(a('3203', 'سحوبات المالك', 'equity', 'withdrawals', { parent_code: '3', normal_side: 'debit', vat_applicable: 0 }));
  chart.push(a('3204', 'الاحتياطيات', 'equity', 'retained', { parent_code: '3', vat_applicable: 0 }));

  // ================= الإيرادات (4) =================
  chart.push(a('4', 'الإيرادات', 'revenue', 'header', { is_header: true }));
  chart.push(a('4101', 'إيرادات المبيعات', 'revenue', 'sales', { parent_code: '4', normal_side: 'credit', is_system: 1 }));
  chart.push(a('4102', 'مردودات المبيعات', 'revenue', 'sales_return', { parent_code: '4', normal_side: 'debit' }));
  chart.push(a('4103', 'الخصم المسموح به', 'revenue', 'sales_return', { parent_code: '4', normal_side: 'debit' }));
  chart.push(a('4301', 'إيرادات أخرى', 'revenue', 'other_income', { parent_code: '4', normal_side: 'credit' }));
  chart.push(a('4302', 'إيرادات فوائد', 'revenue', 'other_income', { parent_code: '4', normal_side: 'credit' }));

  // ================= المصروفات (5) =================
  chart.push(a('5', 'المصروفات', 'expense', 'header', { is_header: true }));

  chart.push(a('5101', 'المشتريات', 'expense', 'purchases', { parent_code: '5', normal_side: 'debit' }));
  chart.push(a('5102', 'مردودات المشتريات', 'expense', 'purchases_return', { parent_code: '5', normal_side: 'credit' }));
  chart.push(a('5103', 'الخصم المكتسب', 'expense', 'purchases_return', { parent_code: '5', normal_side: 'credit' }));
  chart.push(a('5104', 'تكلفة البضاعة المباعة', 'expense', 'cogs', { parent_code: '5', normal_side: 'debit' }));

  chart.push(a('5201', 'الرواتب والأجور', 'expense', 'admin', { parent_code: '5', normal_side: 'debit' }));
  chart.push(a('5202', 'الإيجارات', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5203', 'مصروفات المياه والكهرباء والوقود', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5204', 'مصروفات الاتصالات والإنترنت', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5205', 'الصيانة والتشغيل', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5206', 'التسويق والإعلان', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5207', 'مصروف الإهلاك', 'expense', 'admin', { parent_code: '5', vat_applicable: 0 }));
  chart.push(a('5208', 'التأمين', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5209', 'السفر والانتقال', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5210', 'مصروفات مكتبية وقرطاسية', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5211', 'رسوم مهنية وقانونية', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5212', 'مصاريف بنكية', 'expense', 'admin', { parent_code: '5', vat_applicable: 0 }));
  chart.push(a('5213', 'رسوم حكومية واشتراكات', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5299', 'مصروفات متنوعة', 'expense', 'admin', { parent_code: '5' }));
  chart.push(a('5301', 'الديون المعدومة', 'expense', 'admin', { parent_code: '5' }));

  return chart;
}

// ---------- إضافات السوبر ماركت ----------
function supermarketAdditions() {
  return [
    a('1302', 'مخزون المواد الغذائية', 'asset', 'inventory', { parent_code: '11' }),
    a('1303', 'مخزون المواد الاستهلاكية', 'asset', 'inventory', { parent_code: '11' }),
    a('1113', 'ماكينة نقاط البيع (كاشير)', 'asset', 'cash', { parent_code: '11' }),
    a('4105', 'إيرادات بيع المنتجات الغذائية', 'revenue', 'sales', { parent_code: '4' }),
    a('4106', 'إيرادات الخدمات المساندة (شحن، حفلات، أخرى)', 'revenue', 'sales', { parent_code: '4' }),
    a('5105', 'تكلفة المبيعات - السوبر ماركت', 'expense', 'cogs', { parent_code: '5' })
  ];
}

// ---------- إضافات المصنع ----------
function factoryAdditions() {
  return [
    a('1311', 'مخزون المواد الأولية', 'asset', 'inventory', { parent_code: '11' }),
    a('1312', 'مخزون الإنتاج تحت التشغيل', 'asset', 'inventory', { parent_code: '11' }),
    a('1313', 'مخزون الإنتاج التام', 'asset', 'inventory', { parent_code: '11' }),
    a('1314', 'مخزون قطع الغيار', 'asset', 'inventory', { parent_code: '11' }),
    a('1508', 'آلات الإنتاج', 'asset', 'fixed_asset', { parent_code: '15' }),
    a('4107', 'إيرادات بيع المنتجات المصنعة', 'revenue', 'sales', { parent_code: '4' }),
    a('4108', 'إيرادات بيع خردة ومخلفات', 'revenue', 'other_income', { parent_code: '4' }),
    a('5111', 'المواد الأولية المباشرة', 'expense', 'production', { parent_code: '5' }),
    a('5112', 'الأجور المباشرة للإنتاج', 'expense', 'production', { parent_code: '5' }),
    a('5113', 'التكاليف الصناعية غير المباشرة', 'expense', 'production', { parent_code: '5' }),
    a('5114', 'تكلفة الإنتاج التام', 'expense', 'cogs', { parent_code: '5' }),
    a('5115', 'تشغيل وصيانة الآلات', 'expense', 'production', { parent_code: '5' })
  ];
}

// ---------- إضافات المخبر الطبي ----------
function labAdditions() {
  return [
    a('1114', 'صندوق الوردية', 'asset', 'cash', { parent_code: '11' }),
    a('1205', 'ذمم شركات التأمين', 'asset', 'receivable', { parent_code: '11' }),
    a('1509', 'أجهزة ومعدات التحاليل', 'asset', 'fixed_asset', { parent_code: '15' }),
    a('4109', 'إيرادات التحاليل المخبرية', 'revenue', 'sales', { parent_code: '4' }),
    a('4110', 'إيرادات الخدمات الطبية المساعدة (أشعة، فحوصات)', 'revenue', 'sales', { parent_code: '4' }),
    a('4111', 'إيرادات الزيارات المنزلية', 'revenue', 'sales', { parent_code: '4' }),
    a('5214', 'المواد والمستلزمات الطبية والمخبرية', 'expense', 'admin', { parent_code: '5' }),
    a('5215', 'مستلزمات التحاليل الكيميائية', 'expense', 'admin', { parent_code: '5' })
  ];
}

// ---------- إضافات الشركات ----------
function corporateAdditions() {
  return [
    a('4112', 'إيرادات الخدمات الاستشارية', 'revenue', 'sales', { parent_code: '4' }),
    a('4113', 'إيرادات الخدمات الإدارية', 'revenue', 'sales', { parent_code: '4' }),
    a('5216', 'مصروفات تدريب وتطوير', 'expense', 'admin', { parent_code: '5' })
  ];
}

function getChartForType(businessType) {
  const chart = baseChart();
  const extra = {
    supermarket: supermarketAdditions,
    factory: factoryAdditions,
    medical_lab: labAdditions,
    corporate: corporateAdditions
  }[businessType];
  if (extra) chart.push(...extra());
  return chart;
}

function typeLabel(businessType) {
  return {
    corporate: 'شركة',
    supermarket: 'سوبر ماركت',
    factory: 'مصنع / شركة صناعية',
    medical_lab: 'مخبر طبي'
  }[businessType] || 'شركة';
}

function accountTypeLabel(type) {
  return {
    asset: 'أصل',
    liability: 'التزام / خصم',
    equity: 'حقوق ملكية',
    revenue: 'إيراد',
    expense: 'مصروف'
  }[type] || type;
}

function categoryLabel(category) {
  const labels = {
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
  return labels[category] || category;
}

module.exports = { getChartForType, typeLabel, accountTypeLabel, categoryLabel };
