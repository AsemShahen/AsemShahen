'use strict';

// ==================== نظام التصنيع للمصانع ====================
// قوائم التصنيع BOM -> أوامر التصنيع -> صرف المواد -> مصروفات مباشرة/غير مباشرة -> إتمام الإنتاج.
// التكامل المحاسبي يجري في الخلفية (lib/manufacturing.js).

const MfgHelpers = {
  methods: {
    mNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; },
    mMoney(v) { return fmt.money(this.mNum(v)); },
    mStatusLabel(s) {
      return {
        draft: t('مسودة'), in_progress: t('قيد التنفيذ'),
        completed: t('مكتمل'), cancelled: t('ملغي')
      }[s] || s;
    },
    mStatusColor(s) {
      return { draft: 'gray', in_progress: 'yellow', completed: 'green', cancelled: 'red' }[s] || 'gray';
    },
    mExpenseTypeLabel(x) { return x === 'indirect' ? t('غير مباشر') : t('مباشر'); },
    mCategoryLabel(key) {
      const found = (this.meta.categories || []).find(c => c.key === key);
      return found ? t(found.label) : key;
    }
  }
};

// ---------- لوحة التصنيع ----------
const ManufacturingDashboardView = {
  name: 'ManufacturingDashboardView',
  mixins: [CommonMixin, MfgHelpers],
  data() {
    return { dash: null, loading: true, alert: null };
  },
  async created() { await this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try { this.dash = await this.api(`/api/companies/${this.company.id}/manufacturing/summary`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    statusCount(s) { return (this.dash && this.dash.orders_by_status && this.dash.orders_by_status[s]) || 0; }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>
    <div v-if="loading" class="muted">{{ t('جارٍ التحميل...') }}</div>
    <template v-else-if="dash">
      <div class="cards-grid mb-2">
        <div class="stat-card"><div class="icon">🏭</div><div class="label">{{ t('قوائم التصنيع المفعّلة') }}</div><div class="value">{{ dash.boms_count }}</div></div>
        <div class="stat-card"><div class="icon">📋</div><div class="label">{{ t('أوامر قيد التنفيذ') }}</div><div class="value">{{ statusCount('in_progress') }}</div></div>
        <div class="stat-card"><div class="icon">✅</div><div class="label">{{ t('أوامر مكتملة') }}</div><div class="value">{{ dash.completed_orders }}</div></div>
        <div class="stat-card"><div class="icon">⚙️</div><div class="label">{{ t('تكلفة الإنتاج التام') }}</div><div class="value">{{ mMoney(dash.completed_cost) }}</div></div>
      </div>

      <div class="cards-grid mb-2">
        <div class="stat-card"><div class="label">{{ t('إنتاج تحت التشغيل') }}</div><div class="value">{{ mMoney(dash.wip_cost) }}</div></div>
        <div class="stat-card"><div class="label">{{ t('مصروفات مباشرة') }}</div><div class="value">{{ mMoney(dash.direct_cost) }}</div></div>
        <div class="stat-card"><div class="label">{{ t('مصروفات غير مباشرة') }}</div><div class="value">{{ mMoney(dash.indirect_cost) }}</div></div>
        <div class="stat-card"><div class="label">{{ t('الكمية المنتجة') }}</div><div class="value">{{ fmt.num(dash.completed_qty) }}</div></div>
      </div>

      <div class="cards-grid mb-2">
        <div class="stat-card" v-for="s in ['draft','in_progress','completed','cancelled']" :key="s">
          <div class="label">{{ mStatusLabel(s) }}</div>
          <div class="value">{{ statusCount(s) }}</div>
        </div>
      </div>

      <div class="panel mb-2">
        <div class="panel-header"><h3>{{ t('أحدث أوامر التصنيع') }}</h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap">
            <table>
              <thead><tr><th>{{ t('الرقم') }}</th><th>{{ t('المنتج') }}</th><th>{{ t('المخطّط') }}</th><th>{{ t('المنتج فعلاً') }}</th><th>{{ t('التكلفة') }}</th><th>{{ t('الحالة') }}</th></tr></thead>
              <tbody>
                <tr v-for="o in dash.recent_orders" :key="o.id">
                  <td class="monospace">{{ o.order_no }}</td>
                  <td>{{ o.product_name || '—' }}</td>
                  <td class="num">{{ fmt.num(o.planned_qty) }}</td>
                  <td class="num">{{ fmt.num(o.produced_qty) }}</td>
                  <td class="num">{{ mMoney(o.total_cost) }}</td>
                  <td><span class="badge" :class="mStatusColor(o.status)">{{ mStatusLabel(o.status) }}</span></td>
                </tr>
                <tr v-if="!dash.recent_orders.length"><td colspan="6" class="muted">{{ t('لا توجد أوامر تصنيع بعد') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <div class="panel" style="flex:1;min-width:320px;">
          <div class="panel-header"><h3>{{ t('أعلى المنتجات تكلفة') }}</h3></div>
          <div class="panel-body pad-0">
            <table>
              <thead><tr><th>{{ t('المنتج') }}</th><th>{{ t('أوامر') }}</th><th>{{ t('التكلفة') }}</th></tr></thead>
              <tbody>
                <tr v-for="p in dash.top_products" :key="p.name"><td>{{ p.name }}</td><td class="num">{{ p.orders }}</td><td class="num">{{ mMoney(p.cost) }}</td></tr>
                <tr v-if="!dash.top_products.length"><td colspan="3" class="muted">{{ t('لا توجد بيانات') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel" style="flex:1;min-width:320px;">
          <div class="panel-header"><h3>{{ t('مواد أولية تحت الحد الأدنى') }}</h3></div>
          <div class="panel-body pad-0">
            <table>
              <thead><tr><th>{{ t('المنتج') }}</th><th>{{ t('الرصيد') }}</th><th>{{ t('الحد الأدنى') }}</th></tr></thead>
              <tbody>
                <tr v-for="m in dash.low_materials" :key="m.id"><td>{{ m.name }}</td><td class="num">{{ fmt.num(m.qty) }}</td><td class="num">{{ fmt.num(m.min_stock) }}</td></tr>
                <tr v-if="!dash.low_materials.length"><td colspan="3" class="muted">{{ t('لا توجد مواد تحت الحد الأدنى') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
  `
};

// ---------- قوائم التصنيع (BOM) ----------
const ManufacturingBomsView = {
  name: 'ManufacturingBomsView',
  mixins: [CommonMixin, MfgHelpers],
  data() {
    return {
      boms: [], products: [], warehouses: [], meta: {}, loading: true, alert: null, search: '',
      showModal: false, editing: null, saving: false, costPreview: null,
      form: { code: '', name: '', product_id: '', warehouse_id: '', yield_qty: 1, version: '1', notes: '', is_active: true, lines: [] }
    };
  },
  async created() { await Promise.all([this.loadBoms(), this.loadProducts(), this.loadWarehouses(), this.loadMeta()]); },
  computed: {
    productMap() {
      const m = {};
      for (const p of this.products) m[p.id] = p;
      return m;
    },
    filtered() {
      const f = this.search.trim();
      if (!f) return this.boms;
      return this.boms.filter(b =>
        (b.code || '').includes(f) || (b.name || '').includes(f) ||
        (b.product_name || '').includes(f) || (b.product_code || '').includes(f));
    },
    componentOptions() {
      if (!this.form.product_id) return this.products;
      return this.products.filter(p => Number(p.id) !== Number(this.form.product_id));
    },
    formBatchCost() { return this.form.lines.reduce((s, l) => s + this.lineCost(l), 0); },
    formUnitCost() {
      const y = this.mNum(this.form.yield_qty) > 0 ? this.mNum(this.form.yield_qty) : 1;
      return this.formBatchCost / y;
    }
  },
  methods: {
    async loadBoms() {
      try { this.boms = await this.api(`/api/companies/${this.company.id}/manufacturing/boms`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async loadProducts() {
      try { this.products = await this.api(`/api/companies/${this.company.id}/manufacturing/products`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    async loadWarehouses() {
      try { this.warehouses = await this.api(`/api/companies/${this.company.id}/manufacturing/warehouses`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    async loadMeta() {
      try { this.meta = await this.api(`/api/companies/${this.company.id}/manufacturing/meta`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    productName(id) { const p = this.productMap[id]; return p ? p.name : `#${id}`; },
    productUnit(id) { const p = this.productMap[id]; return p ? (p.unit || '') : ''; },
    productPrice(id) { const p = this.productMap[id]; return p ? this.mNum(p.purchase_price) : 0; },
    lineCost(l) {
      const qty = this.mNum(l.qty) * (1 + this.mNum(l.wastage_pct) / 100);
      return qty * this.productPrice(l.component_product_id);
    },
    openCreate() {
      this.editing = null;
      this.form = { code: '', name: '', product_id: '', warehouse_id: '', yield_qty: 1, version: '1', notes: '', is_active: true, lines: [] };
      if (this.warehouses.length) this.form.warehouse_id = this.warehouses[0].id;
      this.addLine();
      this.showModal = true;
    },
    openEdit(b) {
      this.editing = b;
      this.form = {
        code: b.code, name: b.name, product_id: b.product_id, warehouse_id: b.warehouse_id || '',
        yield_qty: b.yield_qty, version: b.version || '1', notes: b.notes || '',
        is_active: !!b.is_active, lines: []
      };
      this.api(`/api/companies/${this.company.id}/manufacturing/boms/${b.id}`).then(full => {
        this.form.lines = (full.lines || []).map(l => ({
          component_product_id: l.component_product_id, qty: l.qty, wastage_pct: l.wastage_pct, notes: l.notes || ''
        }));
        if (!this.form.lines.length) this.addLine();
      }).catch(e => this.toast(e.message, 'error'));
      this.showModal = true;
    },
    addLine() { this.form.lines.push({ component_product_id: '', qty: 1, wastage_pct: 0, notes: '' }); },
    removeLine(i) { this.form.lines.splice(i, 1); },
    async save() {
      this.saving = true;
      try {
        const payload = { ...this.form, lines: this.form.lines.filter(l => l.component_product_id) };
        if (this.editing) await this.api(`/api/companies/${this.company.id}/manufacturing/boms/${this.editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await this.api(`/api/companies/${this.company.id}/manufacturing/boms`, { method: 'POST', body: JSON.stringify(payload) });
        this.toast(t('تم حفظ قائمة التصنيع'));
        this.showModal = false;
        await this.loadBoms();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async remove(b) {
      if (!confirm(t('حذف قائمة التصنيع {name}؟', { name: b.name }))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/manufacturing/boms/${b.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.loadBoms();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async showCost(b) {
      try { this.costPreview = await this.api(`/api/companies/${this.company.id}/manufacturing/boms/${b.id}/cost`); }
      catch (e) { this.toast(e.message, 'error'); }
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input :placeholder="t('بحث في قوائم التصنيع...')" v-model="search" style="min-width:220px;">
        <p class="muted">{{ t('عدد القوائم: {n}', { n: boms.length }) }}</p>
      </div>
      <button v-if="can('mfg-boms', 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('قائمة تصنيع جديدة') }}</button>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('قوائم التصنيع (BOM)') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('الرمز') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('المنتج التام') }}</th><th>{{ t('المكوّنات') }}</th><th>{{ t('كمية الناتج') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="b in filtered" :key="b.id">
                <td class="monospace">{{ b.code }}</td>
                <td><strong>{{ b.name }}</strong></td>
                <td>{{ b.product_name || '—' }}</td>
                <td>{{ b.lines_count }}</td>
                <td class="num">{{ fmt.num(b.yield_qty) }} {{ b.product_unit || '' }}</td>
                <td><span class="badge" :class="b.is_active ? 'green' : 'gray'">{{ b.is_active ? t('مفعّلة') : t('موقوفة') }}</span></td>
                <td>
                  <button class="btn btn-sm btn-ghost" @click="showCost(b)">{{ t('التكلفة') }}</button>
                  <button v-if="can('mfg-boms', 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(b)">{{ t('تعديل') }}</button>
                  <button v-if="can('mfg-boms', 'delete')" class="btn btn-sm btn-ghost" @click="remove(b)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!filtered.length"><td colspan="7" class="muted">{{ t('لا توجد قوائم تصنيع بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="costPreview" class="modal-overlay" @click.self="costPreview = null">
      <div class="modal" style="max-width:640px;">
        <h3>{{ t('تكلفة القائمة') }}: {{ costPreview.bom.name }}</h3>
        <table>
          <thead><tr><th>{{ t('المكوّن') }}</th><th>{{ t('الكمية الفعلية') }}</th><th>{{ t('تكلفة الوحدة') }}</th><th>{{ t('الإجمالي') }}</th></tr></thead>
          <tbody>
            <tr v-for="l in costPreview.lines" :key="l.id">
              <td>{{ l.name }}</td><td class="num">{{ fmt.num(l.eff_qty) }}</td>
              <td class="num">{{ mMoney(l.eff_unit_cost) }}</td><td class="num">{{ mMoney(l.line_cost) }}</td>
            </tr>
          </tbody>
        </table>
        <div class="flex-between mt-2">
          <span>{{ t('تكلفة الدفعة') }}: <strong>{{ mMoney(costPreview.batch_cost) }}</strong></span>
          <span>{{ t('تكلفة الوحدة') }}: <strong>{{ mMoney(costPreview.unit_cost) }}</strong></span>
        </div>
        <div class="modal-actions"><button class="btn btn-ghost" @click="costPreview = null">{{ t('إغلاق') }}</button></div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:820px;">
        <h3>{{ editing ? t('تعديل قائمة تصنيع') : t('قائمة تصنيع جديدة') }}</h3>
        <div class="form-grid">
          <label>{{ t('المنتج التام') }}
            <select v-model="form.product_id">
              <option value="">{{ t('اختر المنتج...') }}</option>
              <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }} <template v-if="p.code">({{ p.code }})</template></option>
            </select>
          </label>
          <label>{{ t('اسم القائمة') }} <input v-model.trim="form.name" :placeholder="t('اختياري')"></label>
          <label>{{ t('الرمز') }} <input v-model.trim="form.code" :placeholder="t('تلقائي إن تُرك فارغاً')"></label>
          <label>{{ t('المستودع') }}
            <select v-model="form.warehouse_id">
              <option value="">{{ t('الافتراضي') }}</option>
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </label>
          <label>{{ t('كمية الناتج') }} <input type="number" min="0.001" step="any" v-model.number="form.yield_qty"></label>
          <label>{{ t('الإصدار') }} <input v-model.trim="form.version"></label>
          <label>{{ t('الحالة') }}
            <select v-model="form.is_active"><option :value="true">{{ t('مفعّلة') }}</option><option :value="false">{{ t('موقوفة') }}</option></select>
          </label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="form.notes"></label>
        </div>

        <h4 class="mt-2">{{ t('المكوّنات') }}</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('المكوّن') }}</th><th>{{ t('الكمية') }}</th><th>{{ t('الهدر %') }}</th><th>{{ t('تكلفة المكوّن') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(l, i) in form.lines" :key="i">
                <td>
                  <select v-model="l.component_product_id">
                    <option value="">{{ t('اختر المكوّن...') }}</option>
                    <option v-for="p in componentOptions" :key="p.id" :value="p.id">{{ p.name }} <template v-if="p.unit">· {{ p.unit }}</template> · {{ fmt.money(p.purchase_price) }}</option>
                  </select>
                </td>
                <td><input type="number" min="0" step="any" v-model.number="l.qty" style="width:110px;"></td>
                <td><input type="number" min="0" step="any" v-model.number="l.wastage_pct" style="width:90px;"></td>
                <td class="num">{{ mMoney(lineCost(l)) }}</td>
                <td><button class="btn btn-sm btn-ghost" @click="removeLine(i)">✕</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <button class="btn btn-sm btn-ghost mt-1" @click="addLine">+ {{ t('إضافة مكوّن') }}</button>

        <div class="flex-between mt-2">
          <span class="muted">{{ t('تكلفة الدفعة') }}: <strong>{{ mMoney(formBatchCost) }}</strong></span>
          <span>{{ t('تكلفة الوحدة') }}: <strong>{{ mMoney(formUnitCost) }}</strong></span>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="saving || !form.product_id || !form.lines.filter(l => l.component_product_id).length">
            {{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- أوامر التصنيع ----------
const ManufacturingOrdersView = {
  name: 'ManufacturingOrdersView',
  mixins: [CommonMixin, MfgHelpers],
  data() {
    return {
      orders: [], boms: [], products: [], warehouses: [], meta: {}, loading: true, alert: null,
      search: '', statusFilter: '',
      showCreate: false, saving: false,
      form: { bom_id: '', planned_qty: 1, warehouse_id: '', start_date: new Date().toISOString().slice(0, 10), due_date: '', notes: '' },
      detail: null, detailLoading: false,
      showIssue: false, issueLines: [],
      showExpense: false,
      expenseForm: { type: 'direct', category: 'labor', description: '', amount: 0, date: new Date().toISOString().slice(0, 10), payment_account: '1101', notes: '' },
      showComplete: false, completeForm: { produced_qty: 0, date: new Date().toISOString().slice(0, 10) }
    };
  },
  async created() { await Promise.all([this.loadOrders(), this.loadBoms(), this.loadWarehouses(), this.loadMeta()]); },
  computed: {
    selectedBom() { return this.boms.find(b => Number(b.id) === Number(this.form.bom_id)) || null; },
    bomProduct() { return this.selectedBom ? this.selectedBom.product_name : ''; },
    expenseCategories() {
      const type = this.expenseForm.type;
      return (this.meta.categories || []).filter(c => c.type === type);
    }
  },
  methods: {
    async loadOrders() {
      this.loading = true;
      try {
        const q = this.statusFilter ? `?status=${this.statusFilter}` : '';
        this.orders = await this.api(`/api/companies/${this.company.id}/manufacturing/orders${q}`);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async loadBoms() {
      try { this.boms = await this.api(`/api/companies/${this.company.id}/manufacturing/boms`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    async loadWarehouses() {
      try { this.warehouses = await this.api(`/api/companies/${this.company.id}/manufacturing/warehouses`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    async loadMeta() {
      try { this.meta = await this.api(`/api/companies/${this.company.id}/manufacturing/meta`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    openCreate() {
      this.form = { bom_id: '', planned_qty: 1, warehouse_id: this.warehouses[0] ? this.warehouses[0].id : '', start_date: new Date().toISOString().slice(0, 10), due_date: '', notes: '' };
      this.showCreate = true;
    },
    onBomChange() {
      const b = this.selectedBom;
      if (b) {
        this.form.planned_qty = this.mNum(b.yield_qty) || 1;
        if (b.warehouse_id) this.form.warehouse_id = b.warehouse_id;
      }
    },
    async createOrder() {
      this.saving = true;
      try {
        const order = await this.api(`/api/companies/${this.company.id}/manufacturing/orders`, { method: 'POST', body: JSON.stringify(this.form) });
        this.toast(t('تم إنشاء أمر التصنيع {no}', { no: order.order_no }));
        this.showCreate = false;
        await this.loadOrders();
        await this.openDetail(order);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async openDetail(o) {
      this.detailLoading = true;
      try {
        this.detail = await this.api(`/api/companies/${this.company.id}/manufacturing/orders/${o.id}`);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.detailLoading = false; }
    },
    async refreshDetail() {
      if (!this.detail) return;
      try { this.detail = await this.api(`/api/companies/${this.company.id}/manufacturing/orders/${this.detail.id}`); await this.loadOrders(); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    remaining(l) { return Math.max(this.mNum(l.planned_qty) - this.mNum(l.issued_qty), 0); },
    openIssue() {
      if (!this.detail) return;
      this.issueLines = this.detail.lines.filter(l => this.remaining(l) > 0.0001)
        .map(l => ({ id: l.id, name: l.name, unit: l.unit, remaining: this.remaining(l), qty: this.remaining(l) }));
      if (!this.issueLines.length) { this.toast(t('لا توجد كميات متبقية للصرف'), 'error'); return; }
      this.showIssue = true;
    },
    async submitIssue() {
      try {
        const lines = this.issueLines.filter(l => this.mNum(l.qty) > 0).map(l => ({ id: l.id, qty: this.mNum(l.qty) }));
        if (!lines.length) { this.toast(t('حدّد كمية للصرف'), 'error'); return; }
        await this.api(`/api/companies/${this.company.id}/manufacturing/orders/${this.detail.id}/issue`, { method: 'POST', body: JSON.stringify({ lines }) });
        this.toast(t('تم صرف المواد'));
        this.showIssue = false;
        await this.refreshDetail();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    openExpense() {
      this.expenseForm = { type: 'direct', category: 'labor', description: '', amount: 0, date: new Date().toISOString().slice(0, 10), payment_account: '1101', notes: '' };
      this.showExpense = true;
    },
    async submitExpense() {
      try {
        await this.api(`/api/companies/${this.company.id}/manufacturing/orders/${this.detail.id}/expenses`, { method: 'POST', body: JSON.stringify(this.expenseForm) });
        this.toast(t('تمت إضافة المصروف'));
        this.showExpense = false;
        await this.refreshDetail();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async deleteExpense(exp) {
      if (!confirm(t('حذف المصروف؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/manufacturing/expenses/${exp.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.refreshDetail();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    openComplete() {
      this.completeForm = { produced_qty: this.mNum(this.detail.planned_qty), date: new Date().toISOString().slice(0, 10) };
      this.showComplete = true;
    },
    async submitComplete() {
      try {
        await this.api(`/api/companies/${this.company.id}/manufacturing/orders/${this.detail.id}/complete`, { method: 'POST', body: JSON.stringify(this.completeForm) });
        this.toast(t('تم إتمام أمر التصنيع'));
        this.showComplete = false;
        await this.refreshDetail();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async cancelOrder() {
      if (!this.detail || !confirm(t('إلغاء أمر التصنيع {no}؟ سيتم عكس القيود والحركات.', { no: this.detail.order_no }))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/manufacturing/orders/${this.detail.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
        this.toast(t('تم إلغاء الأمر'));
        await this.refreshDetail();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    detailTotals() {
      if (!this.detail) return { material: 0, direct: 0, indirect: 0, total: 0 };
      return {
        material: this.mNum(this.detail.material_cost),
        direct: this.mNum(this.detail.direct_cost),
        indirect: this.mNum(this.detail.indirect_cost),
        total: this.mNum(this.detail.total_cost)
      };
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input :placeholder="t('بحث برقم الأمر أو المنتج...')" v-model="search" style="min-width:220px;">
        <select v-model="statusFilter" @change="loadOrders">
          <option value="">{{ t('كل الحالات') }}</option>
          <option value="draft">{{ t('مسودة') }}</option>
          <option value="in_progress">{{ t('قيد التنفيذ') }}</option>
          <option value="completed">{{ t('مكتمل') }}</option>
          <option value="cancelled">{{ t('ملغي') }}</option>
        </select>
      </div>
      <button v-if="can('mfg-orders', 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('أمر تصنيع جديد') }}</button>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('أوامر التصنيع') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('الرقم') }}</th><th>{{ t('المنتج') }}</th><th>{{ t('قائمة') }}</th><th>{{ t('المخطّط') }}</th><th>{{ t('المنتج فعلاً') }}</th><th>{{ t('التكلفة') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="o in orders" :key="o.id">
                <td class="monospace">{{ o.order_no }}</td>
                <td>{{ o.product_name || '—' }}</td>
                <td class="monospace">{{ o.bom_code || '—' }}</td>
                <td class="num">{{ fmt.num(o.planned_qty) }}</td>
                <td class="num">{{ fmt.num(o.produced_qty) }}</td>
                <td class="num">{{ mMoney(o.total_cost) }}</td>
                <td><span class="badge" :class="mStatusColor(o.status)">{{ mStatusLabel(o.status) }}</span></td>
                <td><button class="btn btn-sm btn-ghost" @click="openDetail(o)">{{ t('عرض') }}</button></td>
              </tr>
              <tr v-if="!orders.length"><td colspan="8" class="muted">{{ t('لا توجد أوامر تصنيع') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal" style="max-width:640px;">
        <h3>{{ t('أمر تصنيع جديد') }}</h3>
        <div class="form-grid">
          <label class="span2">{{ t('قائمة التصنيع') }}
            <select v-model="form.bom_id" @change="onBomChange">
              <option value="">{{ t('اختر القائمة...') }}</option>
              <option v-for="b in boms" :key="b.id" :value="b.id">{{ b.code }} - {{ b.name }} <template v-if="b.product_name">({{ b.product_name }})</template></option>
            </select>
          </label>
          <label>{{ t('الكمية المخطّطة') }} <input type="number" min="0.001" step="any" v-model.number="form.planned_qty"></label>
          <label>{{ t('المستودع') }}
            <select v-model="form.warehouse_id">
              <option value="">{{ t('الافتراضي') }}</option>
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </label>
          <label>{{ t('تاريخ البدء') }} <input type="date" v-model="form.start_date"></label>
          <label>{{ t('تاريخ الاستحقاق') }} <input type="date" v-model="form.due_date"></label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="form.notes"></label>
        </div>
        <p v-if="bomProduct" class="muted">{{ t('المنتج التام') }}: <strong>{{ bomProduct }}</strong></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showCreate = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="createOrder" :disabled="saving || !form.bom_id || !form.planned_qty">
            {{ saving ? t('جارٍ الحفظ...') : t('إنشاء الأمر') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-overlay" @click.self="detail = null">
      <div class="modal" style="max-width:900px;">
        <div class="flex-between">
          <h3>{{ t('أمر التصنيع') }} {{ detail.order_no }} <span class="badge" :class="mStatusColor(detail.status)">{{ mStatusLabel(detail.status) }}</span></h3>
        </div>
        <div class="cards-grid mb-2">
          <div class="stat-card"><div class="label">{{ t('المنتج') }}</div><div class="value" style="font-size:16px;">{{ detail.product_name }}</div></div>
          <div class="stat-card"><div class="label">{{ t('المخطّط / المنتج فعلاً') }}</div><div class="value">{{ fmt.num(detail.planned_qty) }} / {{ fmt.num(detail.produced_qty) }}</div></div>
          <div class="stat-card"><div class="label">{{ t('تكلفة المواد') }}</div><div class="value">{{ mMoney(detail.material_cost) }}</div></div>
          <div class="stat-card"><div class="label">{{ t('الإجمالي') }}</div><div class="value">{{ mMoney(detail.total_cost) }}</div></div>
        </div>

        <h4>{{ t('المواد المخطّطة والمصروفة') }}</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('المكوّن') }}</th><th>{{ t('المخطّط') }}</th><th>{{ t('المصروف') }}</th><th>{{ t('تكلفة الوحدة') }}</th><th>{{ t('تكلفة المصروف') }}</th><th>{{ t('الحالة') }}</th></tr></thead>
            <tbody>
              <tr v-for="l in detail.lines" :key="l.id">
                <td>{{ l.name }}</td>
                <td class="num">{{ fmt.num(l.planned_qty) }}</td>
                <td class="num">{{ fmt.num(l.issued_qty) }}</td>
                <td class="num">{{ mMoney(l.unit_cost) }}</td>
                <td class="num">{{ mMoney(l.line_cost) }}</td>
                <td><span class="badge" :class="l.issued ? 'green' : (remaining(l) > 0.0001 ? 'yellow' : 'gray')">{{ l.issued ? t('مصروف') : t('متبقٍ') }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex-between mt-2">
          <h4>{{ t('المصروفات المباشرة وغير المباشرة') }}</h4>
          <button v-if="detail.status !== 'completed' && detail.status !== 'cancelled' && can('mfg-expenses', 'add')" class="btn btn-sm btn-ghost" @click="openExpense">+ {{ t('إضافة مصروف') }}</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('النوع') }}</th><th>{{ t('البند') }}</th><th>{{ t('الوصف') }}</th><th>{{ t('القيمة') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="x in detail.expenses" :key="x.id">
                <td><span class="badge" :class="x.type === 'direct' ? 'green' : 'yellow'">{{ mExpenseTypeLabel(x.type) }}</span></td>
                <td>{{ mCategoryLabel(x.category) }}</td>
                <td>{{ x.description || '—' }}</td>
                <td class="num">{{ mMoney(x.amount) }}</td>
                <td><button v-if="detail.status !== 'completed' && detail.status !== 'cancelled' && can('mfg-expenses', 'delete')" class="btn btn-sm btn-ghost" @click="deleteExpense(x)">✕</button></td>
              </tr>
              <tr v-if="!detail.expenses.length"><td colspan="5" class="muted">{{ t('لا توجد مصروفات على الأمر') }}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="flex-between mt-2">
          <span class="muted">{{ t('مواد') }}: <strong>{{ mMoney(detailTotals().material) }}</strong></span>
          <span class="muted">{{ t('مباشر') }}: <strong>{{ mMoney(detailTotals().direct) }}</strong></span>
          <span class="muted">{{ t('غير مباشر') }}: <strong>{{ mMoney(detailTotals().indirect) }}</strong></span>
          <span>{{ t('الإجمالي') }}: <strong>{{ mMoney(detailTotals().total) }}</strong></span>
        </div>

        <div class="modal-actions">
          <button v-if="detail.status !== 'completed' && detail.status !== 'cancelled' && can('mfg-orders', 'edit')" class="btn btn-ghost" @click="openIssue">{{ t('صرف المواد') }}</button>
          <button v-if="detail.status !== 'completed' && detail.status !== 'cancelled' && can('mfg-orders', 'edit')" class="btn btn-primary" @click="openComplete">{{ t('إتمام الإنتاج') }}</button>
          <button v-if="detail.status !== 'cancelled' && can('mfg-orders', 'edit')" class="btn btn-ghost" style="color:var(--danger)" @click="cancelOrder">{{ t('إلغاء الأمر') }}</button>
          <button class="btn btn-ghost" @click="detail = null">{{ t('إغلاق') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showIssue" class="modal-overlay" @click.self="showIssue = false">
      <div class="modal" style="max-width:640px;">
        <h3>{{ t('صرف مواد لأمر التصنيع') }}</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('المكوّن') }}</th><th>{{ t('المتبقي') }}</th><th>{{ t('الكمية للصرف') }}</th></tr></thead>
            <tbody>
              <tr v-for="l in issueLines" :key="l.id">
                <td>{{ l.name }}</td>
                <td class="num">{{ fmt.num(l.remaining) }} {{ l.unit || '' }}</td>
                <td><input type="number" min="0" step="any" v-model.number="l.qty" style="width:130px;"></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showIssue = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="submitIssue">{{ t('صرف') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showExpense" class="modal-overlay" @click.self="showExpense = false">
      <div class="modal" style="max-width:560px;">
        <h3>{{ t('إضافة مصروف تصنيع') }}</h3>
        <div class="form-grid">
          <label>{{ t('النوع') }}
            <select v-model="expenseForm.type" @change="expenseForm.category = expenseCategories.length ? expenseCategories[0].key : 'other'">
              <option value="direct">{{ t('مباشر') }}</option>
              <option value="indirect">{{ t('غير مباشر') }}</option>
            </select>
          </label>
          <label>{{ t('البند') }}
            <select v-model="expenseForm.category">
              <option v-for="c in expenseCategories" :key="c.key" :value="c.key">{{ t(c.label) }}</option>
            </select>
          </label>
          <label class="span2">{{ t('الوصف') }} <input v-model.trim="expenseForm.description"></label>
          <label>{{ t('القيمة') }} <input type="number" min="0" step="any" v-model.number="expenseForm.amount"></label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="expenseForm.date"></label>
          <label class="span2">{{ t('طريقة الدفع / الحساب الدائن') }}
            <select v-model="expenseForm.payment_account">
              <option v-for="p in meta.payment_accounts" :key="p.code" :value="p.code">{{ p.code }} - {{ p.name }}</option>
            </select>
          </label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="expenseForm.notes"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showExpense = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="submitExpense" :disabled="!expenseForm.amount">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showComplete" class="modal-overlay" @click.self="showComplete = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ t('إتمام أمر التصنيع') }}</h3>
        <p class="muted">{{ t('سيتم صرف أي مواد متبقية تلقائياً ونقل التكلفة إلى مخزون الإنتاج التام.') }}</p>
        <div class="form-grid">
          <label>{{ t('الكمية المنتجة') }} <input type="number" min="0.001" step="any" v-model.number="completeForm.produced_qty"></label>
          <label>{{ t('تاريخ الإتمام') }} <input type="date" v-model="completeForm.date"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showComplete = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="submitComplete" :disabled="!completeForm.produced_qty">{{ t('إتمام') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- مصروفات التصنيع ----------
const ManufacturingExpensesView = {
  name: 'ManufacturingExpensesView',
  mixins: [CommonMixin, MfgHelpers],
  data() {
    return {
      expenses: [], orders: [], meta: {}, loading: true, alert: null,
      filters: { type: '', order_id: '', from: '', to: '' }
    };
  },
  async created() { await Promise.all([this.loadExpenses(), this.loadOrders(), this.loadMeta()]); },
  computed: {
    totals() {
      return this.expenses.reduce((s, e) => {
        if (e.type === 'direct') s.direct += this.mNum(e.amount);
        else s.indirect += this.mNum(e.amount);
        s.total += this.mNum(e.amount);
        return s;
      }, { direct: 0, indirect: 0, total: 0 });
    }
  },
  methods: {
    async loadExpenses() {
      this.loading = true;
      try {
        const p = new URLSearchParams();
        if (this.filters.type) p.set('type', this.filters.type);
        if (this.filters.order_id) p.set('order_id', this.filters.order_id);
        if (this.filters.from) p.set('from', this.filters.from);
        if (this.filters.to) p.set('to', this.filters.to);
        const q = p.toString();
        this.expenses = await this.api(`/api/companies/${this.company.id}/manufacturing/expenses${q ? '?' + q : ''}`);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async loadOrders() {
      try { this.orders = await this.api(`/api/companies/${this.company.id}/manufacturing/orders`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    async loadMeta() {
      try { this.meta = await this.api(`/api/companies/${this.company.id}/manufacturing/meta`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    async remove(e) {
      if (!confirm(t('حذف المصروف؟ سيتم عكس قيده.'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/manufacturing/expenses/${e.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.loadExpenses();
      } catch (err) { this.toast(err.message, 'error'); }
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <select v-model="filters.type" @change="loadExpenses">
          <option value="">{{ t('كل الأنواع') }}</option>
          <option value="direct">{{ t('مباشر') }}</option>
          <option value="indirect">{{ t('غير مباشر') }}</option>
        </select>
        <select v-model="filters.order_id" @change="loadExpenses">
          <option value="">{{ t('كل الأوامر') }}</option>
          <option v-for="o in orders" :key="o.id" :value="o.id">{{ o.order_no }} - {{ o.product_name }}</option>
        </select>
        <input type="date" v-model="filters.from" @change="loadExpenses">
        <input type="date" v-model="filters.to" @change="loadExpenses">
      </div>
    </div>

    <div class="cards-grid mb-2">
      <div class="stat-card"><div class="label">{{ t('إجمالي المصروفات') }}</div><div class="value">{{ mMoney(totals.total) }}</div></div>
      <div class="stat-card"><div class="label">{{ t('المباشرة') }}</div><div class="value">{{ mMoney(totals.direct) }}</div></div>
      <div class="stat-card"><div class="label">{{ t('غير المباشرة') }}</div><div class="value">{{ mMoney(totals.indirect) }}</div></div>
      <div class="stat-card"><div class="label">{{ t('عدد البنود') }}</div><div class="value">{{ expenses.length }}</div></div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('مصروفات التصنيع') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('التاريخ') }}</th><th>{{ t('أمر التصنيع') }}</th><th>{{ t('النوع') }}</th><th>{{ t('البند') }}</th><th>{{ t('الوصف') }}</th><th>{{ t('حساب الدفع') }}</th><th>{{ t('القيمة') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="e in expenses" :key="e.id">
                <td>{{ fmt.date(e.date) }}</td>
                <td class="monospace">{{ e.order_no || '—' }}</td>
                <td><span class="badge" :class="e.type === 'direct' ? 'green' : 'yellow'">{{ mExpenseTypeLabel(e.type) }}</span></td>
                <td>{{ mCategoryLabel(e.category) }}</td>
                <td>{{ e.description || '—' }}</td>
                <td class="monospace">{{ e.payment_account }}</td>
                <td class="num">{{ mMoney(e.amount) }}</td>
                <td><button v-if="can('mfg-expenses', 'delete')" class="btn btn-sm btn-ghost" @click="remove(e)">{{ t('حذف') }}</button></td>
              </tr>
              <tr v-if="!expenses.length"><td colspan="8" class="muted">{{ t('لا توجد مصروفات تصنيع') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- تقارير التصنيع ----------
const ManufacturingReportsView = {
  name: 'ManufacturingReportsView',
  mixins: [CommonMixin, MfgHelpers],
  data() {
    return {
      report: null, products: [], loading: true, alert: null,
      filters: { from: '', to: '', product_id: '' }
    };
  },
  async created() { await Promise.all([this.load(), this.loadProducts()]); },
  methods: {
    async load() {
      this.loading = true;
      try {
        const p = new URLSearchParams();
        if (this.filters.from) p.set('from', this.filters.from);
        if (this.filters.to) p.set('to', this.filters.to);
        if (this.filters.product_id) p.set('product_id', this.filters.product_id);
        const q = p.toString();
        this.report = await this.api(`/api/companies/${this.company.id}/manufacturing/reports${q ? '?' + q : ''}`);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async loadProducts() {
      try { this.products = await this.api(`/api/companies/${this.company.id}/manufacturing/products`); }
      catch (e) { this.toast(e.message, 'error'); }
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input type="date" v-model="filters.from" @change="load">
        <input type="date" v-model="filters.to" @change="load">
        <select v-model="filters.product_id" @change="load">
          <option value="">{{ t('كل المنتجات') }}</option>
          <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <button class="btn btn-sm btn-ghost" @click="load">{{ t('تحديث') }}</button>
    </div>

    <div v-if="report">
      <div class="cards-grid mb-2">
        <div class="stat-card"><div class="label">{{ t('كمية الإنتاج') }}</div><div class="value">{{ fmt.num(report.totals.qty) }}</div></div>
        <div class="stat-card"><div class="label">{{ t('تكلفة المواد') }}</div><div class="value">{{ mMoney(report.totals.material) }}</div></div>
        <div class="stat-card"><div class="label">{{ t('المصروفات المباشرة') }}</div><div class="value">{{ mMoney(report.totals.direct) }}</div></div>
        <div class="stat-card"><div class="label">{{ t('المصروفات غير المباشرة') }}</div><div class="value">{{ mMoney(report.totals.indirect) }}</div></div>
        <div class="stat-card"><div class="label">{{ t('إجمالي تكلفة الإنتاج') }}</div><div class="value">{{ mMoney(report.totals.total) }}</div></div>
      </div>

      <div class="panel mb-2">
        <div class="panel-header"><h3>{{ t('تكلفة أوامر الإنتاج المكتملة') }}</h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap">
            <table>
              <thead><tr><th>{{ t('الرقم') }}</th><th>{{ t('التاريخ') }}</th><th>{{ t('المنتج') }}</th><th>{{ t('الكمية') }}</th><th>{{ t('مواد') }}</th><th>{{ t('مباشر') }}</th><th>{{ t('غير مباشر') }}</th><th>{{ t('الإجمالي') }}</th><th>{{ t('تكلفة الوحدة') }}</th></tr></thead>
              <tbody>
                <tr v-for="o in report.orders" :key="o.id">
                  <td class="monospace">{{ o.order_no }}</td>
                  <td>{{ fmt.date(o.date) }}</td>
                  <td>{{ o.product_name || '—' }}</td>
                  <td class="num">{{ fmt.num(o.produced_qty) }}</td>
                  <td class="num">{{ mMoney(o.material_cost) }}</td>
                  <td class="num">{{ mMoney(o.direct_cost) }}</td>
                  <td class="num">{{ mMoney(o.indirect_cost) }}</td>
                  <td class="num">{{ mMoney(o.total_cost) }}</td>
                  <td class="num">{{ mMoney(o.unit_cost) }}</td>
                </tr>
                <tr v-if="!report.orders.length"><td colspan="9" class="muted">{{ t('لا توجد أوامر مكتملة في الفترة') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <div class="panel" style="flex:1;min-width:320px;">
          <div class="panel-header"><h3>{{ t('ملخص المصروفات حسب البند') }}</h3></div>
          <div class="panel-body pad-0">
            <table>
              <thead><tr><th>{{ t('النوع') }}</th><th>{{ t('البند') }}</th><th>{{ t('العدد') }}</th><th>{{ t('القيمة') }}</th></tr></thead>
              <tbody>
                <tr v-for="c in report.by_category" :key="c.type + c.cost_account">
                  <td>{{ mExpenseTypeLabel(c.type) }}</td>
                  <td>{{ mCategoryLabel(c.category) }}</td>
                  <td class="num">{{ c.cnt }}</td>
                  <td class="num">{{ mMoney(c.amount) }}</td>
                </tr>
                <tr v-if="!report.by_category.length"><td colspan="4" class="muted">{{ t('لا توجد بيانات') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel" style="flex:1;min-width:320px;">
          <div class="panel-header"><h3>{{ t('الإنتاج الشهري') }}</h3></div>
          <div class="panel-body pad-0">
            <table>
              <thead><tr><th>{{ t('الشهر') }}</th><th>{{ t('أوامر') }}</th><th>{{ t('الكمية') }}</th><th>{{ t('التكلفة') }}</th></tr></thead>
              <tbody>
                <tr v-for="m in report.monthly" :key="m.month"><td>{{ m.month }}</td><td class="num">{{ m.orders }}</td><td class="num">{{ fmt.num(m.qty) }}</td><td class="num">{{ mMoney(m.cost) }}</td></tr>
                <tr v-if="!report.monthly.length"><td colspan="4" class="muted">{{ t('لا توجد بيانات') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
  `
};
