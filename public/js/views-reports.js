'use strict';


// ==================== ميزان المراجعة ====================
const TrialBalanceView = {
  name: 'TrialBalanceView',
  mixins: [CommonMixin],
  data() { return { tb: null, loading: true, alert: null }; },
  async created() {
    try { this.tb = await this.api(`/api/companies/${this.company.id}/trial-balance`); }
    catch (e) { this.toast(e.message, 'error'); }
    finally { this.loading = false; }
  },
  computed: {
    rows() {
      return this.tb ? this.tb.items.filter(i => !i.is_header && (i.debit > 0 || i.credit > 0)) : [];
    }
  },
  methods: {
    preview() {
      const rows = this.rows.map(i => [i.code, i.name, i.debit ? this.fmt.num(i.debit) : '—', i.credit ? this.fmt.num(i.credit) : '—']);
      this.openPrintPreview({
        title: 'ميزان المراجعة',
        sub: `${this.company.name} - السنة المالية ${this.info.active_fiscal_year ? this.info.active_fiscal_year.name : ''}`,
        cols: ['الرمز', 'اسم الحساب', 'مدين', 'دائن'],
        rows,
        footer: this.rows.length ? [`المجموع: مدين ${this.fmt.money(this.tb.totals.debit)} / دائن ${this.fmt.money(this.tb.totals.credit)}`] : []
      });
    },
    exportData() {
      const rows = this.rows.map(i => [i.code, i.name, this.fmt.num(i.debit), this.fmt.num(i.credit)]);
      this.exportCsv(`trial-balance-${this.company.id}`, ['code', 'name', 'debit', 'credit'], rows);
    }
  },
  template: `
  <div class="statement-box">
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>
    <div class="panel">
      <div class="panel-header">
        <h3>ميزان المراجعة</h3>
        <div class="flex flex-wrap">
          <button v-if="can('trial-balance', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ معاينة قبل الطباعة</button>
          <button v-if="can('trial-balance', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ طباعة</button>
          <button v-if="can('trial-balance', 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ تصدير CSV</button>
        </div>
      </div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>الرمز</th><th>اسم الحساب</th><th>مدين</th><th>دائن</th></tr>
            </thead>
            <tbody>
              <tr v-for="i in rows" :key="i.id">
                <td class="monospace">{{ i.code }}</td>
                <td>{{ i.name }}</td>
                <td class="num">{{ i.debit ? fmt.num(i.debit) : '—' }}</td>
                <td class="num">{{ i.credit ? fmt.num(i.credit) : '—' }}</td>
              </tr>
              <tr v-if="!rows.length"><td colspan="4" class="muted">لا توجد حركات</td></tr>
            </tbody>
            <tfoot v-if="rows.length">
              <tr class="total-row">
                <td colspan="2">المجموع</td>
                <td class="num">{{ fmt.num(tb.totals.debit) }}</td>
                <td class="num">{{ fmt.num(tb.totals.credit) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  </div>
  `
};

// ==================== قائمة الدخل ====================
const IncomeStatementView = {
  name: 'IncomeStatementView',
  mixins: [CommonMixin],
  data() { return { s: null, loading: true, alert: null }; },
  async created() {
    try { this.s = await this.api(`/api/companies/${this.company.id}/income-statement`); }
    catch (e) { this.toast(e.message, 'error'); }
    finally { this.loading = false; }
  },
  computed: {
    revRows() { return this.s ? this.s.revenues.filter(r => Math.abs(r.amount) > 0.01) : []; },
    expenseRows() { return this.s ? this.s.expenses.filter(e => Math.abs(e.amount) > 0.01) : []; }
  },
  methods: {
    preview() {
      const rows = [];
      for (const r of this.revRows) rows.push([r.code + ' - ' + r.name, this.fmt.money(r.amount)]);
      for (const e of this.expenseRows) rows.push([e.code + ' - ' + e.name, this.fmt.money(e.amount)]);
      this.openPrintPreview({
        title: 'قائمة الدخل',
        sub: `${this.company.name} - السنة المالية ${this.info.active_fiscal_year ? this.info.active_fiscal_year.name : ''}`,
        cols: ['الحساب', 'المبلغ'],
        rows,
        footer: this.s ? [`إجمالي الإيرادات: ${this.fmt.money(this.s.revenueTotal)}`, `إجمالي المصروفات: ${this.fmt.money(this.s.expenseTotal)}`, `صافي الدخل / (الخسارة): ${this.fmt.money(this.s.netIncome)}`] : []
      });
    },
    exportData() {
      const rows = [];
      for (const r of this.revRows) rows.push([r.code + ' - ' + r.name, this.fmt.num(r.amount), 'إيراد']);
      for (const e of this.expenseRows) rows.push([e.code + ' - ' + e.name, this.fmt.num(e.amount), 'مصروف']);
      this.exportCsv(`income-statement-${this.company.id}`, ['account', 'amount', 'type'], rows);
    }
  },
  template: `
  <div class="statement-box">
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>
    <div class="statement-title">
      <h3>قائمة الدخل</h3>
      <div class="company">{{ company.name }}</div>
      <div class="muted" v-if="s">السنة المالية {{ info.active_fiscal_year ? info.active_fiscal_year.name : '' }}</div>
    </div>
    <div class="panel">
      <div class="panel-body pad-0">
        <div class="statement-section-title">الإيرادات</div>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr v-for="r in revRows" :key="r.id"><td>{{ r.code }} - {{ r.name }}</td><td class="num">{{ fmt.money(r.amount) }}</td></tr>
              <tr v-if="!revRows.length"><td class="muted">لا توجد إيرادات</td><td></td></tr>
              <tr class="total-row" v-if="s"><td>إجمالي الإيرادات</td><td class="num">{{ fmt.money(s.revenueTotal) }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="statement-section-title">المصروفات</div>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr v-for="e in expenseRows" :key="e.id"><td>{{ e.code }} - {{ e.name }}</td><td class="num">{{ fmt.money(e.amount) }}</td></tr>
              <tr v-if="!expenseRows.length"><td class="muted">لا توجد مصروفات</td><td></td></tr>
              <tr class="total-row" v-if="s"><td>إجمالي المصروفات</td><td class="num">{{ fmt.money(s.expenseTotal) }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="table-wrap">
          <table>
            <tfoot>
              <tr class="total-row" v-if="s">
                <td style="font-size:16px;">صافي الدخل / (الخسارة) قبل الضريبة</td>
                <td class="num" style="font-size:16px;" :class="s.netIncome >= 0 ? 'pos' : 'neg'">{{ fmt.money(s.netIncome) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap" style="justify-content:flex-end;">
      <button v-if="can('income-statement', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ معاينة قبل الطباعة</button>
      <button v-if="can('income-statement', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ طباعة</button>
      <button v-if="can('income-statement', 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ تصدير CSV</button>
    </div>
  </div>
  `
};

// ==================== الميزانية العمومية ====================
const BalanceSheetView = {
  name: 'BalanceSheetView',
  mixins: [CommonMixin],
  data() { return { s: null, loading: true, alert: null }; },
  async created() {
    try { this.s = await this.api(`/api/companies/${this.company.id}/balance-sheet`); }
    catch (e) { this.toast(e.message, 'error'); }
    finally { this.loading = false; }
  },
  computed: {
    assetsRows() { return this.s ? this.s.assets.filter(a => Math.abs(a.amount) > 0.01) : []; },
    liabRows() { return this.s ? this.s.liabilities.filter(a => Math.abs(a.amount) > 0.01) : []; },
    equityRows() { return this.s ? this.s.equity.filter(a => Math.abs(a.amount) > 0.01) : []; }
  },
  methods: {
    preview() {
      const rows = [];
      for (const a of this.assetsRows) rows.push([a.code + ' - ' + a.name, this.fmt.money(a.amount)]);
      rows.push(['إجمالي الأصول', this.fmt.money(this.s ? this.s.assetTotal : 0)]);
      for (const l of this.liabRows) rows.push([l.code + ' - ' + l.name, this.fmt.money(l.amount)]);
      rows.push(['إجمالي الخصوم', this.fmt.money(this.s ? this.s.liabilityTotal : 0)]);
      for (const e of this.equityRows) rows.push([e.code + ' - ' + e.name, this.fmt.money(e.amount)]);
      rows.push(['إجمالي حقوق الملكية', this.fmt.money(this.s ? this.s.equityTotal : 0)]);
      this.openPrintPreview({
        title: 'الميزانية العمومية',
        sub: `${this.company.name} - السنة المالية ${this.info.active_fiscal_year ? this.info.active_fiscal_year.name : ''}`,
        cols: ['البند', 'المبلغ'],
        rows
      });
    },
    exportData() {
      const rows = [];
      for (const a of this.assetsRows) rows.push([a.code + ' - ' + a.name, this.fmt.num(a.amount), 'أصل']);
      for (const l of this.liabRows) rows.push([l.code + ' - ' + l.name, this.fmt.num(l.amount), 'خصم']);
      for (const e of this.equityRows) rows.push([e.code + ' - ' + e.name, this.fmt.num(e.amount), 'حقوق ملكية']);
      this.exportCsv(`balance-sheet-${this.company.id}`, ['item', 'amount', 'section'], rows);
    }
  },
  template: `
  <div class="statement-box">
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>
    <div class="statement-title">
      <h3>الميزانية العمومية</h3>
      <div class="company">{{ company.name }}</div>
      <div class="muted" v-if="s">السنة المالية {{ info.active_fiscal_year ? info.active_fiscal_year.name : '' }}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;" class="responsive-2">
      <div class="panel">
        <div class="statement-section-title" style="margin:0;border-radius:0;">الأصول</div>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr v-for="a in assetsRows" :key="a.id"><td>{{ a.code }} - {{ a.name }}</td><td class="num">{{ fmt.money(a.amount) }}</td></tr>
              <tr class="total-row"><td>إجمالي الأصول</td><td class="num">{{ fmt.money(s ? s.assetTotal : 0) }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="panel">
          <div class="statement-section-title" style="margin:0;border-radius:0;">الخصوم</div>
          <div class="table-wrap">
            <table>
              <tbody>
                <tr v-for="l in liabRows" :key="l.id"><td>{{ l.code }} - {{ l.name }}</td><td class="num">{{ fmt.money(l.amount) }}</td></tr>
                <tr class="total-row"><td>إجمالي الخصوم</td><td class="num">{{ fmt.money(s ? s.liabilityTotal : 0) }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="statement-section-title" style="margin:0;border-radius:0;">حقوق الملكية</div>
          <div class="table-wrap">
            <table>
              <tbody>
                <tr v-for="e in equityRows" :key="e.id"><td>{{ e.code }} - {{ e.name }}</td><td class="num">{{ fmt.money(e.amount) }}</td></tr>
                <tr v-if="s && s.netIncome" :style="s.netIncome < 0 ? 'color:var(--danger);' : ''">
                  <td>صافي الدخل (الخسارة) للفترة</td><td class="num">{{ fmt.money(s.netIncome) }}</td>
                </tr>
                <tr class="total-row"><td>إجمالي حقوق الملكية</td><td class="num">{{ fmt.money(s ? s.equityTotal : 0) }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="panel mt-2">
      <div class="panel-body">
        <div class="flex-between">
          <span>إجمالي الأصول</span><strong class="monospace">{{ fmt.money(s ? s.assetTotal : 0) }}</strong>
          <span>إجمالي الخصوم + حقوق الملكية</span><strong class="monospace">{{ fmt.money(s ? s.liabilityTotal + s.equityTotal : 0) }}</strong>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap" style="justify-content:flex-end;">
      <button v-if="can('balance-sheet', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ معاينة قبل الطباعة</button>
      <button v-if="can('balance-sheet', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ طباعة</button>
      <button v-if="can('balance-sheet', 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ تصدير CSV</button>
    </div>
  </div>
  `
};

// ==================== تقرير ضريبة القيمة المضافة ====================
const VatReportView = {
  name: 'VatReportView',
  mixins: [CommonMixin],
  data() { return { vat: null, loading: true, alert: null }; },
  async created() {
    try { this.vat = await this.api(`/api/companies/${this.company.id}/vat-report`); }
    catch (e) { this.toast(e.message, 'error'); }
    finally { this.loading = false; }
  },
  methods: {
    preview() {
      const rows = (this.vat && this.vat.details ? this.vat.details : []).map(d => [
        d.date, d.entry_no, d.description, d.code + ' - ' + d.account_name,
        d.vat_type === 'output' ? 'ضريبة مبيعات' : 'ضريبة مشتريات',
        this.fmt.money(d.vat_amount)
      ]);
      this.openPrintPreview({
        title: 'تقرير الضريبة (VAT)',
        sub: `${this.company.name} - السنة المالية ${this.info.active_fiscal_year ? this.info.active_fiscal_year.name : ''}`,
        cols: ['التاريخ', 'رقم القيد', 'البيان', 'الحساب', 'النوع', 'مبلغ الضريبة'],
        rows,
        footer: this.vat ? [
          `ضريبة المبيعات (خرج): ${this.fmt.money(this.vat.output)}`,
          `ضريبة المشتريات (دخل): ${this.fmt.money(this.vat.input)}`,
          `صافي الضريبة المستحقة للهيئة: ${this.fmt.money(this.vat.netDue)}`
        ] : []
      });
    },
    exportData() {
      const rows = (this.vat && this.vat.details ? this.vat.details : []).map(d => [
        d.date, d.entry_no, d.description, d.code + ' - ' + d.account_name,
        d.vat_type === 'output' ? 'output' : 'input', this.fmt.num(d.vat_amount)
      ]);
      this.exportCsv(`vat-report-${this.company.id}`, ['date', 'entry_no', 'description', 'account', 'type', 'amount'], rows);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="cards-grid" v-if="vat">
      <div class="stat-card">
        <div class="icon">📤</div>
        <div class="label">ضريبة المبيعات (خرج)</div>
        <div class="value pos">{{ fmt.money(vat.output) }}</div>
        <div class="sub">{{ vat.outputCount }} معاملة</div>
      </div>
      <div class="stat-card">
        <div class="icon">📥</div>
        <div class="label">ضريبة المشتريات (دخل)</div>
        <div class="value">{{ fmt.money(vat.input) }}</div>
        <div class="sub">{{ vat.inputCount }} معاملة</div>
      </div>
      <div class="stat-card" :style="vat.netDue >= 0 ? '' : 'border-color:#b8e0cd;'">
        <div class="icon">🏛️</div>
        <div class="label">صافي الضريبة المستحقة للهيئة</div>
        <div class="value" :class="vat.netDue >= 0 ? '' : 'neg'">{{ fmt.money(vat.netDue) }}</div>
        <div class="sub">تُسدد للهيئة العامة للزكاة والضريبة والجمارك (ZATCA)</div>
      </div>
    </div>

    <div class="panel" v-if="vat">
      <div class="panel-header"><h3>تفاصيل الحركات الضريبية</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>الحساب</th><th>النوع</th><th>مبلغ الضريبة</th></tr>
            </thead>
            <tbody>
              <tr v-for="d in vat.details" :key="d.entry_no + d.account_id + d.date">
                <td>{{ fmt.date(d.date) }}</td>
                <td class="monospace">{{ d.entry_no }}</td>
                <td style="white-space:normal;max-width:260px;">{{ d.description }}</td>
                <td>{{ d.code }} - {{ d.account_name }}</td>
                <td><span class="badge" :class="d.vat_type === 'output' ? 'yellow' : 'green'">{{ d.vat_type === 'output' ? 'ضريبة مبيعات' : 'ضريبة مشتريات' }}</span></td>
                <td class="num">{{ fmt.money(d.vat_amount) }}</td>
              </tr>
              <tr v-if="!vat || !vat.details.length"><td colspan="6" class="muted">لا توجد حركات ضريبية</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap" style="justify-content:flex-end;">
      <button v-if="can('vat', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ معاينة قبل الطباعة</button>
      <button v-if="can('vat', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ طباعة</button>
      <button v-if="can('vat', 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ تصدير CSV</button>
    </div>
  </div>
  `
};
