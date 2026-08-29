'use strict';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'لوحة التحكم', icon: '📊' },
  { key: 'accounts', label: 'المخطط المحاسبي', icon: '🗂️' },
  { key: 'journal', label: 'قيود اليومية', icon: '📒' },
  { key: 'ledger', label: 'دفتر الأستاذ', icon: '📖' },
  { key: 'trial-balance', label: 'ميزان المراجعة', icon: '⚖️' },
  { key: 'income-statement', label: 'قائمة الدخل', icon: '📈' },
  { key: 'balance-sheet', label: 'الميزانية العمومية', icon: '🏛️' },
  { key: 'vat', label: 'تقرير الضريبة (VAT)', icon: '🧾' },
  { key: 'invoices-sale', label: 'فواتير البيع', icon: '🛍️' },
  { key: 'invoices-purchase', label: 'فواتير الشراء', icon: '📦' },
  { key: 'parties', label: 'العملاء والموردون', icon: '👥' },
  { key: 'closing', label: 'الإقفال السنوي', icon: '🔒' },
  { key: 'settings', label: 'الإعدادات', icon: '⚙️' },
  { key: 'users', label: 'المستخدمون والصلاحيات', icon: '👤' },
  { key: 'warehouses', label: 'المستودعات', icon: '📦' },
  { key: 'products', label: 'المنتجات', icon: '🏷️' },
  { key: 'stock', label: 'المخزون والأرصدة', icon: '📊', perm: 'inventory' },
  { key: 'stock-counts', label: 'الجرد', icon: '🗒️', perm: 'inventory' },
  { key: 'pos', label: 'نقطة البيع', icon: '🛒' },
  { key: 'hr-employees', label: 'الموظفون والأقسام', icon: '👔' },
  { key: 'hr-leaves', label: 'الإجازات', icon: '🏖️' },
  { key: 'hr-payroll', label: 'الرواتب والأجور', icon: '💰' },
  { key: 'hosp-dashboard', label: 'لوحة المشفى', icon: '🏥', hospitalOnly: true },
  { key: 'hosp-patients', label: 'المرضى', icon: '🧑', hospitalOnly: true },
  { key: 'hosp-doctors', label: 'الأطباء والأقسام', icon: '🩺', hospitalOnly: true },
  { key: 'hosp-appointments', label: 'المواعيد', icon: '📅', hospitalOnly: true },
  { key: 'hosp-records', label: 'السجلات الطبية', icon: '📋', hospitalOnly: true },
  { key: 'hosp-billing', label: 'فوترة المرضى', icon: '🧾', hospitalOnly: true }
];

const { createApp } = Vue;

const App = {
  data() {
    return {
      authUser: null,
      loginForm: { username: '', password: '' },
      loginAlert: '',
      loggingIn: false,
      companies: [],
      activeCompany: null,
      info: { settings: {}, active_fiscal_year: null },
      view: 'dashboard',
      openCreateCompany: false,
      newCompany: {
        name: '', business_type: 'corporate', cr_number: '', vat_number: '',
        vat_rate: 15, fiscal_year_start_month: 1, address: '', phone: '', email: ''
      },
      businessTypes: []
    };
  },
  computed: {
    viewComponent() {
      const map = {
        'dashboard': DashboardView,
        'accounts': AccountsView,
        'journal': JournalView,
        'ledger': LedgerView,
        'trial-balance': TrialBalanceView,
        'income-statement': IncomeStatementView,
        'balance-sheet': BalanceSheetView,
        'vat': VatReportView,
        'invoices-sale': InvoicesView,
        'invoices-purchase': InvoicesView,
        'parties': PartiesView,
        'closing': ClosingView,
        'settings': SettingsView,
        'users': UsersView,
        'warehouses': WarehousesView,
        'products': ProductsView,
        'stock': StockView,
        'stock-counts': StockCountsView,
        'pos': PosView,
        'hr-employees': HrEmployeesView,
        'hr-leaves': HrLeavesView,
        'hr-payroll': HrPayrollView,
        'hosp-dashboard': HospitalDashboardView,
        'hosp-patients': HospitalPatientsView,
        'hosp-doctors': HospitalDoctorsView,
        'hosp-appointments': HospitalAppointmentsView,
        'hosp-records': HospitalRecordsView,
        'hosp-billing': HospitalBillingView
      };
      return map[this.view] || DashboardView;
    },
    viewKind() {
      if (this.view === 'invoices-sale') return 'sale';
      if (this.view === 'invoices-purchase') return 'purchase';
      return undefined;
    },
    currentNavLabel() {
      const item = NAV_ITEMS.find(i => i.key === this.view);
      return item ? t(item.label) : '';
    },
    navItems() {
      const isHospital = this.activeCompany && this.activeCompany.business_type === 'hospital';
      return NAV_ITEMS.filter(i => {
        if (i.hospitalOnly) return isHospital;
        if (i.key === 'users') return this.authUser && this.authUser.role === 'admin';
        return can(i.perm || i.key, 'view');
      }).map(i => ({ ...i, label: t(i.label) }));
    },
    printStore() { return printStore; }
  },
  methods: {
    typeIcon, typeLabel,
    canWindow(windowKey, action) { return can(windowKey, action); },
    async api(path, opts = {}) {
      const r = await apiFetch(path, opts);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || t('خطأ في الطلب'));
      return data;
    },
    async doLogin() {
      this.loggingIn = true;
      this.loginAlert = '';
      try {
        const r = await apiFetch('/api/login', {
          method: 'POST',
          body: JSON.stringify({ username: this.loginForm.username, password: this.loginForm.password })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || t('فشل تسجيل الدخول'));
        localStorage.setItem('muhasib_token', data.token);
        setAuthUser(data.user);
        this.authUser = data.user;
        await this.loadCompanies();
        await this.loadBusinessTypes();
        const savedId = localStorage.getItem('muhasib_company');
        if (savedId && this.companies.some(c => String(c.id) === savedId)) {
          this.activeCompany = this.companies.find(c => String(c.id) === savedId);
          setActiveCompanyId(this.activeCompany.id);
          this.view = 'dashboard';
          await this.loadInfo();
        }
      } catch (e) {
        this.loginAlert = e.message;
      } finally {
        this.loggingIn = false;
      }
    },
    async logout() {
      try {
        await apiFetch('/api/logout', { method: 'POST' });
      } catch (e) { /* تجاهل */ }
      localStorage.removeItem('muhasib_token');
      localStorage.removeItem('muhasib_company');
      setAuthUser(null);
      setActiveCompanyId(null);
      this.authUser = null;
      this.activeCompany = null;
      this.view = 'dashboard';
      this.loginForm = { username: '', password: '' };
    },
    navigate(view) { this.view = view; },
    openPrintPreview,
    closePrintPreview,
    doPrint() {
      setTimeout(() => { try { window.print(); } catch (e) {} }, 100);
    },
    goDashboard() { this.view = 'dashboard'; },
    backToCompanies() {
      this.activeCompany = null;
      setActiveCompanyId(null);
      this.view = 'dashboard';
      localStorage.removeItem('muhasib_company');
      this.loadCompanies();
    },
    async selectCompany(c) {
      this.activeCompany = c;
      localStorage.setItem('muhasib_company', String(c.id));
      setActiveCompanyId(c.id);
      this.view = 'dashboard';
      await this.loadInfo();
    },
    async loadCompanies() {
      try {
        const r = await apiFetch('/api/companies');
        const d = await r.json();
        this.companies = d.companies || [];
      } catch (e) { console.error(e); }
    },
    async loadBusinessTypes() {
      try {
        const r = await apiFetch('/api/company-types');
        const d = await r.json();
        this.businessTypes = d.types || [];
      } catch (e) { console.error(e); }
    },
    async loadInfo() {
      if (!this.activeCompany) return;
      try {
        const r = await apiFetch(`/api/companies/${this.activeCompany.id}/info`);
        this.info = await r.json();
      } catch (e) { console.error(e); }
    },
    async createCompany() {
      try {
        const r = await apiFetch('/api/companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.newCompany)
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || t('خطأ'));
        this.openCreateCompany = false;
        this.newCompany = { name: '', business_type: 'corporate', cr_number: '', vat_number: '', vat_rate: 15, fiscal_year_start_month: 1, address: '', phone: '', email: '' };
        await this.loadCompanies();
        await this.selectCompany(data.company);
      } catch (e) { alert(e.message); }
    }
  },
  async created() {
    const token = localStorage.getItem('muhasib_token');
    if (token) {
      try {
        const me = await this.api('/api/me');
        setAuthUser(me.user);
        this.authUser = me.user;
      } catch (e) {
        localStorage.removeItem('muhasib_token');
      }
    }
    window.addEventListener('muhasib-auth-expired', () => {
      localStorage.removeItem('muhasib_token');
      localStorage.removeItem('muhasib_company');
      setAuthUser(null);
      this.authUser = null;
      this.activeCompany = null;
    });
    if (!this.authUser) return;
    await Promise.all([this.loadCompanies(), this.loadBusinessTypes()]);
    const savedId = localStorage.getItem('muhasib_company');
    if (savedId && this.companies.some(c => String(c.id) === savedId)) {
      this.activeCompany = this.companies.find(c => String(c.id) === savedId);
      setActiveCompanyId(this.activeCompany.id);
      this.view = 'dashboard';
      await this.loadInfo();
    }
  },
  template: document.getElementById('app').innerHTML
};

const app = createApp(App);
app.config.globalProperties.t = t;
app.config.globalProperties.i18n = I18N;
app.mount('#app');