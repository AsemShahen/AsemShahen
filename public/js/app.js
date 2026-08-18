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
  { key: 'settings', label: 'الإعدادات', icon: '⚙️' }
];

const { createApp } = Vue;

const App = {
  data() {
    return {
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
        'settings': SettingsView
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
      return item ? item.label : '';
    },
    navItems() { return NAV_ITEMS; }
  },
  methods: {
    typeIcon, typeLabel,
    navigate(view) { this.view = view; },
    goDashboard() { this.view = 'dashboard'; },
    backToCompanies() {
      this.activeCompany = null;
      this.view = 'dashboard';
      localStorage.removeItem('muhasib_company');
      this.loadCompanies();
    },
    async selectCompany(c) {
      this.activeCompany = c;
      localStorage.setItem('muhasib_company', String(c.id));
      this.view = 'dashboard';
      await this.loadInfo();
    },
    async loadCompanies() {
      try {
        const r = await fetch('/api/companies');
        this.companies = await r.json();
      } catch (e) { console.error(e); }
    },
    async loadBusinessTypes() {
      try {
        const r = await fetch('/api/company-types');
        const d = await r.json();
        this.businessTypes = d.types || [];
      } catch (e) { console.error(e); }
    },
    async loadInfo() {
      if (!this.activeCompany) return;
      try {
        const r = await fetch(`/api/companies/${this.activeCompany.id}/info`);
        this.info = await r.json();
      } catch (e) { console.error(e); }
    },
    async createCompany() {
      try {
        const r = await fetch('/api/companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.newCompany)
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'خطأ');
        this.openCreateCompany = false;
        this.newCompany = { name: '', business_type: 'corporate', cr_number: '', vat_number: '', vat_rate: 15, fiscal_year_start_month: 1, address: '', phone: '', email: '' };
        await this.loadCompanies();
        await this.selectCompany(data.company);
      } catch (e) { alert(e.message); }
    }
  },
  async created() {
    await Promise.all([this.loadCompanies(), this.loadBusinessTypes()]);
    const savedId = localStorage.getItem('muhasib_company');
    if (savedId && this.companies.some(c => String(c.id) === savedId)) {
      this.activeCompany = this.companies.find(c => String(c.id) === savedId);
      this.view = 'dashboard';
      await this.loadInfo();
    }
  },
  template: document.getElementById('app').innerHTML
};

createApp(App).mount('#app');
