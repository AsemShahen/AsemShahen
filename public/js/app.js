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
  { key: 'chat', label: 'المحادثة الداخلية', icon: '💬', alwaysShow: true },
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
      companies: [],
      activeCompany: null,
      info: { settings: {}, active_fiscal_year: null },
      view: 'dashboard',
      sidebarOpen: false,
      businessTypes: [],
      // نافذة تسجيل الدخول (للأوامر الإدارية أو فتح شركة)
      loginModal: { open: false, action: null, company: null, username: '', password: '', error: '', busy: false },
      // إنشاء شركة
      openCreateCompany: false,
      newCompany: {
        name: '', business_type: 'corporate', cr_number: '', vat_number: '',
        vat_rate: 15, fiscal_year_start_date: '', fiscal_year_end_date: '',
        address: '', phone: '', email: '', adminUsername: '', adminPassword: ''
      },
      // تعديل شركة
      editOpen: false,
      editForm: {},
      savingCompany: false,
      // حذف شركة
      deleteTarget: null,
      deletingCompany: false
    };
  },
  computed: {
    isPlatform() { return !!(this.authUser && this.authUser.role === 'platform'); },
    loginModalTitle() {
      if (this.loginModal.action === 'open') return t('تسجيل الدخول للشركة');
      if (this.loginModal.action === 'create') return t('تسجيل دخول مدير المنصة — إنشاء شركة');
      if (this.loginModal.action === 'edit') return t('تسجيل دخول مدير المنصة — تعديل شركة');
      if (this.loginModal.action === 'delete') return t('تسجيل دخول مدير المنصة — حذف شركة');
      return t('تسجيل الدخول');
    },
    isCompanyAdminOfActive() {
      return !!(this.authUser && this.authUser.role === 'admin' && this.activeCompany
        && Number(this.authUser.company_id) === Number(this.activeCompany.id));
    },
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
        'chat': ChatView,
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
      const platform = this.isPlatform;
      return NAV_ITEMS.filter(i => {
        if (i.hospitalOnly) return isHospital;
        if (platform) {
          // مدير المنصة يدقق (قراءة فقط) ويشارك في محادثة الشركة التي يدخلها
          if (i.key === 'users') return false;
          if (i.key === 'chat') return !!this.activeCompany;
          return can(i.perm || i.key, 'view');
        }
        if (i.key === 'users') return this.isCompanyAdminOfActive;
        if (i.alwaysShow) return true;
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
    resetNewCompany() {
      this.newCompany = {
        name: '', business_type: 'corporate', cr_number: '', vat_number: '',
        vat_rate: 15, fiscal_year_start_date: '', fiscal_year_end_date: '',
        address: '', phone: '', email: '', adminUsername: '', adminPassword: ''
      };
    },
    // تنفيذ إجراء على الشركات: مدير المنصة ينفّذه مباشرة، وغيره يفتح نافذة تسجيل الدخول
    requestAction(action, company) {
      if (action === 'create') {
        if (this.isPlatform) { this.resetNewCompany(); this.openCreateCompany = true; }
        else this.openLogin('create', null);
        return;
      }
      if (this.isPlatform) {
        if (action === 'edit') this.openEdit(company);
        else if (action === 'delete') this.deleteTarget = company;
        else if (action === 'open') this.selectCompany(company);
        return;
      }
      this.openLogin(action, company);
    },
    openLogin(action, company) {
      this.loginModal = { open: true, action, company, username: '', password: '', error: '', busy: false };
    },
    async submitLogin() {
      const m = this.loginModal;
      m.busy = true; m.error = '';
      try {
        const r = await apiFetch('/api/login', {
          method: 'POST',
          body: JSON.stringify({
            username: m.username,
            password: m.password,
            companyId: (m.action === 'open' && m.company) ? m.company.id : null
          })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || t('فشل تسجيل الدخول'));
        const adminActions = ['create', 'edit', 'delete'];
        if (adminActions.includes(m.action) && data.user.role !== 'platform') {
          try { await apiFetch('/api/logout', { method: 'POST', headers: { 'x-auth-token': data.token } }); } catch (e) { /* تجاهل */ }
          throw new Error(t('هذه العملية تتطلب حساب مدير المنصة'));
        }
        localStorage.setItem('muhasib_token', data.token);
        setAuthUser(data.user);
        this.authUser = data.user;
        const action = m.action, company = m.company;
        m.open = false;
        if (action === 'open') {
          await this.selectCompany(company);
        } else {
          this.activeCompany = null;
          setActiveCompanyId(null);
          localStorage.removeItem('muhasib_company');
          this.view = 'dashboard';
          await Promise.all([this.loadCompanies(), this.loadBusinessTypes()]);
          if (action === 'create') { this.resetNewCompany(); this.openCreateCompany = true; }
          else if (action === 'edit') await this.openEdit(company);
          else if (action === 'delete') this.deleteTarget = company;
        }
      } catch (e) {
        m.error = e.message;
      } finally {
        m.busy = false;
      }
    },
    async enterAfterLogin() {
      if (this.isPlatform) {
        // مدير المنصة: سجل الشركات لإدارتها والتدقيق
        this.activeCompany = null;
        setActiveCompanyId(null);
        localStorage.removeItem('muhasib_company');
        this.view = 'dashboard';
        await Promise.all([this.loadCompanies(), this.loadBusinessTypes()]);
        return;
      }
      await this.loadCompanies();
      await this.loadBusinessTypes();
      const mine = this.companies.find(c => Number(c.id) === Number(this.authUser.company_id));
      if (mine) await this.selectCompany(mine);
    },
    async openEdit(company) {
      try {
        const d = await this.api(`/api/companies/${company.id}`);
        this.editForm = { ...d.company };
        this.editOpen = true;
      } catch (e) { window.alert(e.message); }
    },
    async saveCompany() {
      this.savingCompany = true;
      try {
        await this.api(`/api/companies/${this.editForm.id}`, { method: 'PUT', body: this.editForm });
        this.editOpen = false;
        await this.loadCompanies();
      } catch (e) { window.alert(e.message); }
      finally { this.savingCompany = false; }
    },
    async confirmDeleteCompany() {
      if (!this.deleteTarget) return;
      this.deletingCompany = true;
      try {
        await this.api(`/api/companies/${this.deleteTarget.id}`, { method: 'DELETE' });
        this.deleteTarget = null;
        await this.loadCompanies();
      } catch (e) { window.alert(e.message); }
      finally { this.deletingCompany = false; }
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
      this.loginModal = { open: false, action: null, company: null, username: '', password: '', error: '', busy: false };
      await this.loadCompanies();
    },
    navigate(view) { this.view = view; this.sidebarOpen = false; },
    toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; },
    openPrintPreview,
    closePrintPreview,
    doPrint() {
      setTimeout(() => { try { window.print(); } catch (e) {} }, 100);
    },
    goDashboard() { this.view = 'dashboard'; this.sidebarOpen = false; },
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
    async openCompanyChat(c) {
      this.activeCompany = c;
      localStorage.setItem('muhasib_company', String(c.id));
      setActiveCompanyId(c.id);
      this.view = 'chat';
      await this.loadInfo();
    },
    async loadCompanies() {
      try {
        const r = await fetch('/api/companies-meta');
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
      if (!this.newCompany.name || !this.newCompany.adminUsername || this.newCompany.adminPassword.length < 4) {
        window.alert(t('يجب إدخال اسم الشركة واسم مستخدم المدير وكلمة مرور من 4 أحرف على الأقل'));
        return;
      }
      try {
        const r = await apiFetch('/api/companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.newCompany)
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || t('خطأ'));
        const created = data.company;
        await this.createAdminAccount(created.id, this.newCompany.adminUsername, this.newCompany.adminPassword);
        this.openCreateCompany = false;
        this.resetNewCompany();
        await this.loadCompanies();
        window.alert(t('تم إنشاء الشركة وتعيين مديرها'));
      } catch (e) { window.alert(e.message); }
    },
    async createAdminAccount(companyId, username, password) {
      const r = await apiFetch(`/api/companies/${companyId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role: 'admin' })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || t('خطأ'));
      return data;
    }
  },
  async created() {
    await this.loadCompanies();
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
      setActiveCompanyId(null);
      this.authUser = null;
      this.activeCompany = null;
      this.loadCompanies();
    });
    if (!this.authUser) return;
    await this.enterAfterLogin();
  },
  template: document.getElementById('app').innerHTML
};

const app = createApp(App);
app.config.globalProperties.t = t;
app.config.globalProperties.i18n = I18N;
app.component('wa-preview-modal', WaPreviewModal);
app.mount('#app');