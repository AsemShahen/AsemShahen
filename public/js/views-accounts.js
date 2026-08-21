'use strict';

// ==================== المخطط المحاسبي ====================
const AccountsView = {
  name: 'AccountsView',
  mixins: [CommonMixin],
  data() {
    return {
      accounts: [], loading: true, alert: null,
      showModal: false, editing: null,
      form: { code: '', name: '', type: 'asset', category: 'cash', normal_side: 'debit', vat_applicable: 1, parent_code: '', opening_balance: 0 },
      filter: ''
    };
  },
  async created() { await this.load(); },
  methods: {
    async load() {
      try {
        this.accounts = await this.api(`/api/companies/${this.company.id}/accounts`);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    openCreate() {
      this.editing = null;
      this.form = { code: '', name: '', type: 'asset', category: 'cash', normal_side: 'debit', vat_applicable: 1, parent_code: '', opening_balance: 0 };
      this.showModal = true;
    },
    openEdit(acc) {
      this.editing = acc;
      this.form = { code: acc.code, name: acc.name, type: acc.type, category: acc.category, normal_side: acc.normal_side, vat_applicable: acc.vat_applicable, parent_code: acc.parent_code || '', opening_balance: 0 };
      this.showModal = true;
    },
    async save() {
      try {
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/accounts/${this.editing.id}`, { method: 'PUT', body: this.form });
          this.toast('تم تحديث الحساب بنجاح');
        } else {
          await this.api(`/api/companies/${this.company.id}/accounts`, { method: 'POST', body: this.form });
          this.toast('تم إنشاء الحساب بنجاح');
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    filtered() {
      const f = this.filter.trim();
      if (!f) return this.accounts;
      return this.accounts.filter(a => a.code.includes(f) || a.name.includes(f));
    },
    preview() {
      const rows = this.filtered().map(a => [a.code, a.name, accountTypeLabels[a.type] || a.type, a.normal_side === 'debit' ? 'مدين' : 'دائن', this.fmt.num(a.balance) + ' ر.س', a.vat_applicable ? 'نعم' : 'لا']);
      this.openPrintPreview({
        title: 'المخطط المحاسبي',
        sub: `${this.company.name} - السنة المالية ${this.info.active_fiscal_year ? this.info.active_fiscal_year.name : '—'}`,
        cols: ['الرمز', 'اسم الحساب', 'التصنيف', 'طبيعة الرصيد', 'الرصيد', 'ضريبة'],
        rows
      });
    },
    exportData() {
      const rows = this.filtered().map(a => [a.code, a.name, accountTypeLabels[a.type] || a.type, a.normal_side === 'debit' ? 'مدين' : 'دائن', this.fmt.num(a.balance), a.vat_applicable ? 'نعم' : 'لا']);
      this.exportCsv(`accounts-${this.company.id}`, ['code', 'name', 'type', 'side', 'balance', 'vat'], rows);
    },
    importData() {
      this.importJsonFile(async (data) => {
        const items = Array.isArray(data) ? data : (data.accounts || []);
        if (!items.length) return this.toast('لا توجد حسابات في الملف', 'error');
        let ok = 0, fail = 0;
        for (const it of items) {
          try {
            await this.api(`/api/companies/${this.company.id}/accounts`, {
              method: 'POST',
              body: {
                code: String(it.code), name: String(it.name || ''), type: it.type || 'asset',
                category: it.category || 'other', parent_code: it.parent_code,
                normal_side: it.normal_side,
                vat_applicable: it.vat_applicable !== undefined ? it.vat_applicable : 1,
                opening_balance: it.opening_balance || 0
              }
            });
            ok++;
          } catch (e) { fail++; }
        }
        this.toast(`تم استيراد ${ok} حساب، فشل ${fail}`);
        await this.load();
      });
    }
  },
  computed: {
    categories() {
      return Object.entries(accountCategoryLabels).map(([k, v]) => ({ code: k, label: v }));
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex">
        <input v-if="can('accounts', 'search')" placeholder="بحث برقم الحساب أو الاسم..." v-model="filter" style="min-width:260px;">
      </div>
      <div class="flex flex-wrap">
        <button v-if="can('accounts', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ معاينة قبل الطباعة</button>
        <button v-if="can('accounts', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ طباعة</button>
        <button v-if="can('accounts', 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ تصدير CSV</button>
        <button v-if="can('accounts', 'import')" class="btn btn-sm btn-ghost" @click="importData">⬆️ استيراد JSON</button>
        <button v-if="can('accounts', 'add')" class="btn btn-primary" @click="openCreate">+ حساب جديد</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>المخطط المحاسبي ({{ accounts.length }} حساب)</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الرمز</th><th>اسم الحساب</th><th>التصنيف</th><th>طبيعة الرصيد</th><th>الرصيد الحالي</th><th>ضريبة</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in filtered()" :key="a.id" :style="a.is_header ? 'background:#f0f5f2;font-weight:700;' : ''">
                <td class="monospace" :style="a.is_header ? '' : 'padding-right:24px;'">{{ a.code }}</td>
                <td :style="a.is_header ? '' : 'padding-right:8px;'">{{ a.name }}</td>
                <td><span class="badge" :class="fmt.sideColor(a.type)">{{ accountTypeLabels[a.type] }}</span></td>
                <td class="muted">{{ a.normal_side === 'debit' ? 'مدين' : 'دائن' }}</td>
                <td class="num" :class="a.balance < 0 ? 'neg' : ''">{{ fmt.money(a.balance) }}</td>
                <td>{{ a.vat_applicable ? '✓' : '—' }}</td>
                <td>
                  <button v-if="!a.is_system && can('accounts', 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(a)">تعديل</button>
                </td>
              </tr>
              <tr v-if="!filtered().length"><td colspan="7" class="muted">لا توجد حسابات</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal">
        <h3>{{ editing ? 'تعديل حساب' : 'إضافة حساب جديد' }}</h3>
        <div class="form-grid">
          <label>رمز الحساب <input v-model.trim="form.code" dir="ltr" :disabled="!!editing"></label>
          <label>اسم الحساب <input v-model.trim="form.name"></label>
          <label>التصنيف الرئيسي
            <select v-model="form.type" @change="form.normal_side = (form.type === 'asset' || form.type === 'expense') ? 'debit' : 'credit'">
              <option value="asset">أصل</option>
              <option value="liability">خصم / التزام</option>
              <option value="equity">حقوق ملكية</option>
              <option value="revenue">إيراد</option>
              <option value="expense">مصروف</option>
            </select>
          </label>
          <label>الفئة الفرعية
            <select v-model="form.category">
              <option v-for="c in categories" :key="c.code" :value="c.code">{{ c.label }}</option>
            </select>
          </label>
          <label>طبيعة الرصيد
            <select v-model="form.normal_side">
              <option value="debit">مدين</option>
              <option value="credit">دائن</option>
            </select>
          </label>
          <label>الرقم الأب (اختياري)
            <input v-model.trim="form.parent_code" placeholder="مثال: 11" dir="ltr">
          </label>
          <label>يخضع للضريبة
            <select v-model.number="form.vat_applicable">
              <option :value="1">نعم</option>
              <option :value="0">لا</option>
            </select>
          </label>
          <label v-if="!editing">رصيد افتتاحي
            <input type="number" v-model.number="form.opening_balance">
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">إلغاء</button>
          <button class="btn btn-primary" @click="save" :disabled="!form.name || !form.code">حفظ</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ==================== قيود اليومية ====================
const JournalView = {
  name: 'JournalView',
  mixins: [CommonMixin],
  data() {
    return {
      entries: [], accounts: [], loading: true, alert: null, filter: '',
      showModal: false, saving: false,
      form: { date: new Date().toISOString().slice(0, 10), description: '', lines: [] }
    };
  },
  async created() { await this.load(); },
  methods: {
    async load() {
      try {
        const [entries, accounts] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/journal`),
          this.api(`/api/companies/${this.company.id}/accounts`)
        ]);
        this.entries = entries;
        this.accounts = accounts.filter(a => !a.is_header);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    openCreate() {
      this.form = { date: new Date().toISOString().slice(0, 10), description: '', lines: [this.emptyLine(), this.emptyLine()] };
      this.showModal = true;
    },
    emptyLine() {
      return { account_id: '', debit: null, credit: null, detail: '' };
    },
    clearCredit(l) { if (Number(l.debit) > 0) l.credit = null; },
    clearDebit(l) { if (Number(l.credit) > 0) l.debit = null; },
    addLine() { this.form.lines.push(this.emptyLine()); },
    removeLine(idx) { this.form.lines.splice(idx, 1); },
    totalDebit() { return this.form.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0); },
    totalCredit() { return this.form.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0); },
    getBalance() { return this.totalDebit() - this.totalCredit(); },
    async save() {
      this.saving = true;
      try {
        await this.api(`/api/companies/${this.company.id}/journal`, {
          method: 'POST',
          body: {
            date: this.form.date,
            description: this.form.description,
            lines: this.form.lines.map(l => ({ account_id: Number(l.account_id), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, detail: l.detail }))
          }
        });
        this.toast('تم تسجيل القيد بنجاح');
        this.showModal = false;
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async del(entry) {
      if (!confirm(`هل أنت متأكد من حذف القيد ${entry.entry_no}؟`)) return;
      try {
        await this.api(`/api/companies/${this.company.id}/journal/${entry.id}`, { method: 'DELETE' });
        this.toast('تم حذف القيد');
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
    },
    entryBalanced(entry) {
      let d = 0, c = 0;
      for (const l of entry.lines) { d += Number(l.debit); c += Number(l.credit); }
      return Math.abs(d - c) < 0.01;
    },
    filteredEntries() {
      const f = this.filter.trim();
      if (!f) return this.entries;
      return this.entries.filter(e =>
        e.entry_no.includes(f) || e.description.includes(f) ||
        e.lines.some(l => (l.code || '').includes(f) || (l.account_name || l.name || '').includes(f)));
    },
    preview() {
      const rows = this.filteredEntries().map(e => [
        e.entry_no, e.date, e.description,
        this.fmt.num(e.lines.reduce((s, l) => s + l.debit, 0)),
        this.fmt.num(e.lines.reduce((s, l) => s + l.credit, 0)),
        e.is_closing ? 'إقفال' : (e.is_opening ? 'افتتاحي' : 'يومي')
      ]);
      this.openPrintPreview({
        title: 'قيود اليومية',
        sub: `${this.company.name} - السنة المالية الحالية`,
        cols: ['رقم القيد', 'التاريخ', 'البيان', 'مدين', 'دائن', 'النوع'],
        rows
      });
    },
    exportData() {
      const rows = this.filteredEntries().map(e => [
        e.entry_no, e.date, e.description,
        this.fmt.num(e.lines.reduce((s, l) => s + l.debit, 0)),
        this.fmt.num(e.lines.reduce((s, l) => s + l.credit, 0)),
        e.is_closing ? 'إقفال' : (e.is_opening ? 'افتتاحي' : 'يومي')
      ]);
      this.exportCsv(`journal-${this.company.id}`, ['entry_no', 'date', 'description', 'debit', 'credit', 'type'], rows);
    },
    importData() {
      this.importJsonFile(async (data) => {
        const items = Array.isArray(data) ? data : (data.entries || []);
        if (!items.length) return this.toast('لا توجد قيود في الملف', 'error');
        let ok = 0, fail = 0;
        for (const it of items) {
          try {
            const lines = (it.lines || []).map(l => {
              const acc = this.accounts.find(a => a.code === String(l.account_code));
              return { account_id: acc ? acc.id : null, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, detail: l.detail || '' };
            });
            if (lines.some(l => !l.account_id)) throw new Error('رمز حساب غير موجود');
            await this.api(`/api/companies/${this.company.id}/journal`, {
              method: 'POST',
              body: { date: it.date, description: it.description || '', lines }
            });
            ok++;
          } catch (e) { fail++; }
        }
        this.toast(`تم استيراد ${ok} قيد، فشل ${fail}`);
        await this.load();
      });
    }
  },
  computed: {
    canSave() {
      const hasAccount = this.form.lines.some(l => l.account_id);
      return hasAccount && Math.abs(this.getBalance()) < 0.01 && this.form.lines.some(l => (Number(l.debit) || 0) + (Number(l.credit) || 0) > 0);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input v-if="can('journal', 'search')" placeholder="بحث برقم القيد أو البيان أو الحساب..." v-model="filter" style="min-width:260px;">
        <p class="muted">عدد القيود: {{ entries.length }}</p>
      </div>
      <div class="flex flex-wrap">
        <button v-if="can('journal', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ معاينة قبل الطباعة</button>
        <button v-if="can('journal', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ طباعة</button>
        <button v-if="can('journal', 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ تصدير CSV</button>
        <button v-if="can('journal', 'import')" class="btn btn-sm btn-ghost" @click="importData">⬆️ استيراد JSON</button>
        <button v-if="can('journal', 'add')" class="btn btn-primary" @click="openCreate">+ قيد جديد</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>قيود اليومية - السنة المالية الحالية</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>الحسابات</th><th>مدين</th><th>دائن</th><th>النوع</th><th></th></tr>
            </thead>
            <tbody>
              <template v-for="e in filteredEntries()" :key="e.id">
                <tr :style="e.is_closing ? 'background:#fff8e6;' : (e.is_opening ? 'background:#e9f5ff;' : '')">
                  <td class="monospace"><strong>{{ e.entry_no }}</strong></td>
                  <td>{{ fmt.date(e.date) }}</td>
                  <td style="white-space:normal;max-width:260px;">{{ e.description }}</td>
                  <td style="max-width:220px;white-space:normal;">
                    <div v-for="l in e.lines" :key="l.id" style="font-size:12px;">
                      <span class="muted">{{ l.code }}</span> {{ l.account_name || l.name }}
                    </div>
                  </td>
                  <td class="num">{{ fmt.num(e.lines.reduce((s,l)=>s+l.debit,0)) }}</td>
                  <td class="num">{{ fmt.num(e.lines.reduce((s,l)=>s+l.credit,0)) }}</td>
                  <td>
                    <span class="badge" :class="e.is_closing ? 'yellow' : (e.is_opening ? 'gray' : 'green')">
                      {{ e.is_closing ? 'إقفال' : (e.is_opening ? 'افتتاحي' : 'يومي') }}
                    </span>
                  </td>
                  <td>
                    <button v-if="!e.is_closing && !e.is_opening && can('journal', 'delete')" class="btn btn-sm btn-ghost" @click="del(e)">حذف</button>
                  </td>
                </tr>
              </template>
              <tr v-if="!entries.length"><td colspan="8" class="muted">لا توجد قيود بعد - أضف أول قيد</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:900px;">
        <h3>قيد يومية جديد</h3>
        <div class="form-grid">
          <label>التاريخ <input type="date" v-model="form.date"></label>
          <label class="span2">البيان <input v-model.trim="form.description" placeholder="شرح القيد..."></label>
        </div>

        <div class="entry-lines mt-2">
          <div class="line-row line-head">
            <span>الحساب</span><span>مدين</span><span>دائن</span><span>المبلغ</span><span>تفاصيل</span><span></span>
          </div>
          <div class="line-row" v-for="(l, idx) in form.lines" :key="idx">
            <select v-model="l.account_id">
              <option value="">اختر الحساب...</option>
              <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} - {{ a.name }}</option>
            </select>
            <input type="number" v-model.number="l.debit" placeholder="0.00" @input="clearCredit(l)">
            <input type="number" v-model.number="l.credit" placeholder="0.00" @input="clearDebit(l)">
            <span class="num">{{ fmt.num((Number(l.debit)||0) + (Number(l.credit)||0)) }}</span>
            <input v-model.trim="l.detail" placeholder="تفاصيل">
            <button class="btn btn-sm btn-danger" @click="removeLine(idx)" v-if="form.lines.length > 2">✕</button>
          </div>
        </div>

        <div class="flex-between mt-2">
          <button class="btn btn-ghost" @click="addLine">+ إضافة سطر</button>
          <div class="flex">
            <span>المجاميع: مدين <strong class="monospace">{{ fmt.num(totalDebit()) }}</strong> / دائن <strong class="monospace">{{ fmt.num(totalCredit()) }}</strong></span>
            <span v-if="Math.abs(getBalance()) > 0.01" class="badge red">الفرق: {{ fmt.num(getBalance()) }} - القيد غير متوازن</span>
            <span v-else class="badge green">متوازن ✓</span>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">إلغاء</button>
          <button class="btn btn-primary" @click="save" :disabled="!canSave || saving">{{ saving ? 'جارٍ الحفظ...' : 'حفظ القيد' }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ==================== دفتر الأستاذ ====================
const LedgerView = {
  name: 'LedgerView',
  mixins: [CommonMixin],
  data() {
    return { accounts: [], accountId: null, ledger: null, loading: true, alert: null };
  },
  async created() {
    try {
      this.accounts = (await this.api(`/api/companies/${this.company.id}/accounts`)).filter(a => !a.is_header);
    } catch (e) { this.toast(e.message, 'error'); }
    finally { this.loading = false; }
  },
  methods: {
    async loadLedger() {
      if (!this.accountId) return;
      try {
        this.ledger = await this.api(`/api/companies/${this.company.id}/ledger/${this.accountId}`);
      } catch (e) { this.toast(e.message, 'error'); }
    },
    previewLedger() {
      if (!this.ledger) return;
      const rows = this.ledger.lines.map((l, i) => [
        l.date, l.entry_no, l.detail || l.description,
        l.debit ? this.fmt.num(l.debit) : '—',
        l.credit ? this.fmt.num(l.credit) : '—',
        this.fmt.num(this.runningTotals[i])
      ]);
      this.openPrintPreview({
        title: `دفتر الأستاذ - ${this.ledger.account.code} ${this.ledger.account.name}`,
        sub: `${this.company.name} - رصيد الحساب: ${this.fmt.money(this.ledger.balance.balance)}`,
        cols: ['التاريخ', 'رقم القيد', 'البيان', 'مدين', 'دائن', 'الرصيد'],
        rows
      });
    },
    exportLedger() {
      if (!this.ledger) return;
      const rows = this.ledger.lines.map((l, i) => [
        l.date, l.entry_no, l.detail || l.description,
        this.fmt.num(l.debit), this.fmt.num(l.credit), this.fmt.num(this.runningTotals[i])
      ]);
      this.exportCsv(`ledger-${this.ledger.account.code}-${this.company.id}`, ['date', 'entry_no', 'description', 'debit', 'credit', 'balance'], rows);
    }
  },
  computed: {
    runningTotals() {
      if (!this.ledger) return [];
      let bal = this.ledger.balance.balance - this.ledger.lines.reduce((s, l) => s + (this.ledger.account.normal_side === 'credit' ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit)), 0);
      return this.ledger.lines.map(l => {
        const delta = this.ledger.account.normal_side === 'credit' ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
        bal += delta;
        return bal;
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="panel">
      <div class="panel-header"><h3>دفتر الأستاذ</h3></div>
      <div class="panel-body">
        <div class="flex flex-wrap">
          <select v-model="accountId" style="min-width:320px;" @change="loadLedger">
            <option value="">اختر الحساب لعرض حركاته...</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} - {{ a.name }}</option>
          </select>
          <span v-if="ledger" class="chip">رصيد الحساب: {{ fmt.money(ledger.balance.balance) }}</span>
        </div>
      </div>
    </div>

    <div v-if="ledger" class="panel">
      <div class="panel-header">
        <h3>{{ ledger.account.code }} - {{ ledger.account.name }}</h3>
        <div class="flex flex-wrap">
          <span class="chip">الرصيد الافتتاحي: {{ fmt.money(ledger.balance.balance - ledger.lines.reduce((s,l)=>s+(ledger.account.normal_side==='credit'?Number(l.credit)-Number(l.debit):Number(l.debit)-Number(l.credit)),0)) }}</span>
          <button v-if="can('ledger', 'print_preview')" class="btn btn-sm btn-ghost" @click="previewLedger">👁️ معاينة قبل الطباعة</button>
          <button v-if="can('ledger', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ طباعة</button>
          <button v-if="can('ledger', 'export')" class="btn btn-sm btn-ghost" @click="exportLedger">⬇️ تصدير CSV</button>
        </div>
      </div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in ledger.lines" :key="l.id">
                <td>{{ fmt.date(l.date) }}</td>
                <td class="monospace">{{ l.entry_no }}</td>
                <td style="white-space:normal;max-width:260px;">{{ l.detail || l.description }}</td>
                <td class="num">{{ l.debit ? fmt.num(l.debit) : '—' }}</td>
                <td class="num">{{ l.credit ? fmt.num(l.credit) : '—' }}</td>
                <td class="num"><strong>{{ fmt.num(runningTotals[i]) }}</strong></td>
              </tr>
              <tr v-if="!ledger.lines.length"><td colspan="6" class="muted">لا توجد حركات على هذا الحساب</td></tr>
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td colspan="3">الإجمالي</td>
                <td class="num">{{ fmt.num(ledger.balance.debit) }}</td>
                <td class="num">{{ fmt.num(ledger.balance.credit) }}</td>
                <td class="num">{{ fmt.num(ledger.balance.balance) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  </div>
  `
};
