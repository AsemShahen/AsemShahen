'use strict';

const DashboardView = {
  name: 'DashboardView',
  mixins: [CommonMixin],
  data() {
    return { loading: true, d: null, alert: null };
  },
  async created() {
    try {
      this.d = await this.api(`/api/companies/${this.company.id}/dashboard`);
    } catch (e) {
      this.toast(e.message, 'error');
    } finally {
      this.loading = false;
    }
  },
  computed: {
    maxMonth() {
      if (!this.d || !this.d.salesByMonth || !this.d.salesByMonth.length) return 1;
      return Math.max(...this.d.salesByMonth.map(m => Number(m.t)), 1);
    },
    monthNames() {
      return ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'].map(n => n ? t(n) : n);
    }
  },
  methods: {
    exportData() {
      const d = this.d;
      if (!d) return;
      const rows = [
        [t('صافي الدخل'), this.fmt.num(d.stmt.netIncome)],
        [t('إجمالي المبيعات'), this.fmt.num(d.sales)],
        [t('إجمالي المشتريات'), this.fmt.num(d.purchases)],
        [t('النقدية'), this.fmt.num(d.cash)],
        [t('البنك'), this.fmt.num(d.bank)],
        [t('ذمم مدينة (عملاء)'), this.fmt.num(d.receivables)],
        [t('ذمم دائنة (موردون)'), this.fmt.num(d.payables)],
        [t('ضريبة القيمة المضافة'), this.fmt.num(this.info.vat ? this.info.vat.netDue : 0)]
      ];
      this.exportCsv(`dashboard-${this.company.id}`, ['kpi', 'value'], rows);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>
    <div class="flex" style="justify-content:flex-end;margin-bottom:12px;">
      <button v-if="can('dashboard', 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ {{ t('تصدير CSV') }}</button>
    </div>
    <div v-if="!d" class="empty-state"><div class="icon">⏳</div><p>{{ t('جاري التحميل...') }}</p></div>

    <template v-if="d">
      <div class="cards-grid">
        <div class="stat-card">
          <div class="icon">💵</div>
          <div class="label">{{ t('صافي الدخل') }}</div>
          <div class="value" :class="d.stmt.netIncome >= 0 ? 'pos' : 'neg'">{{ fmt.money(d.stmt.netIncome) }}</div>
          <div class="sub">{{ t('إيرادات:') }} {{ fmt.money(d.stmt.revenueTotal) }} - {{ t('مصروفات:') }} {{ fmt.money(d.stmt.expenseTotal) }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">🛍️</div>
          <div class="label">{{ t('إجمالي المبيعات') }}</div>
          <div class="value pos">{{ fmt.money(d.sales) }}</div>
          <div class="sub">{{ t('عدد فواتير البيع ضمن السنة الحالية') }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">📦</div>
          <div class="label">{{ t('إجمالي المشتريات') }}</div>
          <div class="value">{{ fmt.money(d.purchases) }}</div>
          <div class="sub">{{ t('فواتير الشراء خلال السنة الحالية') }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">💳</div>
          <div class="label">{{ t('النقدية') }}</div>
          <div class="value">{{ fmt.money(d.cash) }}</div>
          <div class="sub">{{ t('الصندوق:') }} {{ fmt.money(d.cash) }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">🏦</div>
          <div class="label">{{ t('البنك') }}</div>
          <div class="value">{{ fmt.money(d.bank) }}</div>
          <div class="sub">{{ t('رصيد البنك الرئيسي') }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">📥</div>
          <div class="label">{{ t('ذمم مدينة (عملاء)') }}</div>
          <div class="value">{{ fmt.money(d.receivables) }}</div>
          <div class="sub">{{ t('مبالغ مستحقة على العملاء') }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">📤</div>
          <div class="label">{{ t('ذمم دائنة (موردون)') }}</div>
          <div class="value">{{ fmt.money(d.payables) }}</div>
          <div class="sub">{{ t('مبالغ مستحقة للموردين') }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">🧾</div>
          <div class="label">{{ t('ضريبة القيمة المضافة') }}</div>
          <div class="value">{{ fmt.money(info.vat ? info.vat.netDue : 0) }}</div>
          <div class="sub">{{ t('صافي الضريبة المستحقة للهيئة') }}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('المبيعات الشهرية - سنة {fy}', { fy: d.fy.name }) }}</h3></div>
        <div class="panel-body">
          <div style="display:flex;align-items:flex-end;gap:10px;height:180px;padding:10px 0;">
            <div v-for="m in d.salesByMonth" :key="m.m" style="flex:1;text-align:center;">
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">{{ fmt.num(m.t) }}</div>
              <div :style="{ height: Math.max(Number(m.t)/maxMonth*140, 4) + 'px', background: 'linear-gradient(180deg, var(--primary), var(--primary-light))', borderRadius: '6px 6px 0 0', minWidth: '20px' }"></div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">{{ monthNames[Number(m.m)] }}</div>
            </div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;" class="responsive-2">
        <div class="panel">
          <div class="panel-header"><h3>{{ t('أحدث القيود اليومية') }}</h3></div>
          <div class="panel-body pad-0">
            <div class="table-wrap">
              <table>
                <thead><tr><th>{{ t('رقم القيد') }}</th><th>{{ t('التاريخ') }}</th><th>{{ t('البيان') }}</th></tr></thead>
                <tbody>
                  <tr v-for="e in d.recentEntries" :key="e.id">
                    <td class="monospace">{{ e.entry_no }}</td>
                    <td>{{ fmt.date(e.date) }}</td>
                    <td style="white-space:normal;max-width:220px;">{{ e.description }}</td>
                  </tr>
                  <tr v-if="!d.recentEntries.length"><td colspan="3" class="muted">{{ t('لا توجد قيود بعد') }}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h3>{{ t('أحدث الفواتير') }}</h3></div>
          <div class="panel-body pad-0">
            <div class="table-wrap">
              <table>
                <thead><tr><th>{{ t('رقم الفاتورة') }}</th><th>{{ t('النوع') }}</th><th>{{ t('التاريخ') }}</th><th>{{ t('الإجمالي') }}</th><th>{{ t('الحالة') }}</th></tr></thead>
                <tbody>
                  <tr v-for="i in d.recentInvoices" :key="i.id">
                    <td class="monospace">{{ i.invoice_no }}</td>
                    <td>{{ i.kind === 'sale' ? t('بيع') : t('شراء') }}</td>
                    <td>{{ fmt.date(i.date) }}</td>
                    <td class="num">{{ fmt.money(i.total) }}</td>
                    <td><span class="badge" :class="fmt.invStatus(i.status).c">{{ fmt.invStatus(i.status).t }}</span></td>
                  </tr>
                  <tr v-if="!d.recentInvoices.length"><td colspan="5" class="muted">{{ t('لا توجد فواتير بعد') }}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
  `
};
