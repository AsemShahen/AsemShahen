'use strict';

// ==================== نظام المطاعم والكفيهات: الوصفات والتكاليف والتصنيع ====================
// الوصفة (Recipe / BOM) تربط الوجبة النهائية بموادها الأولية بكميات محددة.
// التصنيع يخصم المواد الأولية من المستودع ويضيف الوجبة الجاهزة ويحدّث تكلفتها،
// كما يتم التصنيع تلقائياً عند بيع وجبة لا يكفي رصيدها الجاهز.

const RestaurantHelpers = {
  methods: {
    rNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; },
    rMoney(v) { return fmt.money(this.rNum(v)); }
  }
};

// ---------- شاشة الوصفات والتكاليف ----------
const RecipesView = {
  name: 'RecipesView',
  mixins: [CommonMixin, RestaurantHelpers],
  data() {
    return {
      recipes: [], products: [], loading: true, alert: null, search: '',
      showModal: false, editing: null, saving: false,
      form: { product_id: '', name: '', yield_qty: 1, overhead_cost: 0, notes: '', is_active: true, lines: [] }
    };
  },
  async created() { await Promise.all([this.loadRecipes(), this.loadProducts()]); },
  computed: {
    filtered() {
      const f = this.search.trim();
      if (!f) return this.recipes;
      return this.recipes.filter(r =>
        (r.product_name || '').includes(f) || (r.product_code || '').includes(f) || (r.name || '').includes(f));
    },
    productMap() {
      const m = {};
      for (const p of this.products) m[p.id] = p;
      return m;
    },
    mealOptions() {
      const used = new Set(this.recipes.map(r => r.product_id));
      return this.products.filter(p => this.editing ? true : !used.has(p.id));
    },
    ingredientOptions() {
      if (!this.form.product_id) return this.products;
      return this.products.filter(p => Number(p.id) !== Number(this.form.product_id));
    },
    formBatchCost() {
      return this.form.lines.reduce((s, l) => s + this.lineCost(l), 0);
    },
    formUnitCost() {
      const y = this.rNum(this.form.yield_qty) > 0 ? this.rNum(this.form.yield_qty) : 1;
      return this.formBatchCost / y + this.rNum(this.form.overhead_cost);
    }
  },
  methods: {
    async loadRecipes() {
      try { this.recipes = await this.api(`/api/companies/${this.company.id}/restaurant/recipes`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async loadProducts() {
      try { this.products = await this.api(`/api/companies/${this.company.id}/restaurant/products`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    productName(id) { const p = this.productMap[id]; return p ? p.name : `#${id}`; },
    productUnit(id) { const p = this.productMap[id]; return p ? (p.unit || '') : ''; },
    ingredientPrice(id) { const p = this.productMap[id]; return p ? this.rNum(p.purchase_price) : 0; },
    lineCost(l) {
      const qty = this.rNum(l.qty) * (1 + this.rNum(l.wastage_pct) / 100);
      return qty * this.ingredientPrice(l.ingredient_product_id);
    },
    openCreate() {
      this.editing = null;
      this.form = { product_id: '', name: '', yield_qty: 1, overhead_cost: 0, notes: '', is_active: true, lines: [] };
      this.addLine();
      this.showModal = true;
    },
    openEdit(r) {
      this.editing = r;
      this.form = {
        product_id: r.product_id, name: r.name || '', yield_qty: r.yield_qty || 1,
        overhead_cost: r.overhead_cost || 0, notes: r.notes || '', is_active: r.is_active !== 0,
        lines: []
      };
      this.api(`/api/companies/${this.company.id}/restaurant/recipes/${r.id}`)
        .then(full => {
          this.form.lines = (full.lines || []).map(l => ({
            ingredient_product_id: l.ingredient_product_id, qty: l.qty,
            wastage_pct: l.wastage_pct || 0, notes: l.notes || ''
          }));
          if (!this.form.lines.length) this.addLine();
        })
        .catch(e => this.toast(e.message, 'error'));
      this.showModal = true;
    },
    addLine() {
      this.form.lines.push({ ingredient_product_id: '', qty: 1, wastage_pct: 0, notes: '' });
    },
    removeLine(i) { this.form.lines.splice(i, 1); },
    async save() {
      this.saving = true;
      try {
        const body = {
          product_id: Number(this.form.product_id), name: this.form.name,
          yield_qty: this.rNum(this.form.yield_qty) || 1, overhead_cost: this.rNum(this.form.overhead_cost),
          notes: this.form.notes, is_active: this.form.is_active,
          lines: this.form.lines.filter(l => l.ingredient_product_id)
            .map(l => ({ ingredient_product_id: Number(l.ingredient_product_id), qty: this.rNum(l.qty), wastage_pct: this.rNum(l.wastage_pct), notes: l.notes }))
        };
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/restaurant/recipes/${this.editing.id}`, { method: 'PUT', body });
          this.toast(t('تم تحديث الوصفة'));
        } else {
          await this.api(`/api/companies/${this.company.id}/restaurant/recipes`, { method: 'POST', body });
          this.toast(t('تمت إضافة الوصفة'));
        }
        this.showModal = false;
        await this.loadRecipes();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async remove(r) {
      if (!confirm(t('هل أنت متأكد من حذف هذه الوصفة؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/restaurant/recipes/${r.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف الوصفة'));
        await this.loadRecipes();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.filtered.map(r => [
        r.product_code || '—', r.product_name, r.lines_count || 0,
        this.rMoney(r.unit_cost), this.rMoney(r.sale_price),
        this.rMoney(this.rNum(r.sale_price) - this.rNum(r.unit_cost))
      ]);
      this.openPrintPreview({
        title: t('الوصفات والتكاليف'), sub: this.company.name,
        cols: [t('الرمز'), t('الوجبة'), t('عدد المكوّنات'), t('تكلفة الحصة'), t('سعر البيع'), t('هامش الربح')],
        rows
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input :placeholder="t('بحث عن وجبة...')" v-model="search" style="min-width:220px;">
        <p class="muted">{{ t('عدد الوصفات: {n}', { n: recipes.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can('recipes', 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('وصفة جديدة') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('الوصفات وتكلفة الوجبات') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('الرمز') }}</th><th>{{ t('الوجبة') }}</th><th>{{ t('المكوّنات') }}</th>
                <th>{{ t('تكلفة الحصة') }}</th><th>{{ t('سعر البيع') }}</th><th>{{ t('هامش الربح') }}</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in filtered" :key="r.id">
                <td class="monospace">{{ r.product_code || '—' }}</td>
                <td><strong>{{ r.product_name }}</strong><div class="muted" v-if="r.name && r.name !== r.product_name">{{ r.name }}</div></td>
                <td>{{ r.lines_count }}</td>
                <td class="num">{{ rMoney(r.unit_cost) }}</td>
                <td class="num">{{ rMoney(r.sale_price) }}</td>
                <td class="num" :style="{ color: (r.sale_price - r.unit_cost) < 0 ? 'var(--danger)' : 'inherit' }">{{ rMoney(r.sale_price - r.unit_cost) }}</td>
                <td>
                  <button v-if="can('recipes', 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(r)">{{ t('تعديل') }}</button>
                  <button v-if="can('recipes', 'delete')" class="btn btn-sm btn-ghost" @click="remove(r)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!filtered.length"><td colspan="7" class="muted">{{ t('لا توجد وصفات بعد — أنشئ وصفة تربط الوجبة بموادها الأولية') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:760px;">
        <h3>{{ editing ? t('تعديل وصفة') : t('وصفة جديدة') }}</h3>
        <div class="form-grid">
          <label>{{ t('الوجبة / المشروب النهائي') }}
            <select v-model="form.product_id" :disabled="!!editing">
              <option value="">{{ t('اختر الوجبة...') }}</option>
              <option v-for="p in mealOptions" :key="p.id" :value="p.id">{{ p.name }} <template v-if="p.code">({{ p.code }})</template></option>
            </select>
          </label>
          <label>{{ t('اسم الوصفة (اختياري)') }} <input v-model.trim="form.name"></label>
          <label>{{ t('عدد الحصص الناتجة') }} <input type="number" min="0.001" step="any" v-model.number="form.yield_qty"></label>
          <label>{{ t('تكاليف إضافية لكل حصة (تغليف...)') }} <input type="number" min="0" step="any" v-model.number="form.overhead_cost"></label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="form.notes"></label>
        </div>

        <h4 class="mt-2">{{ t('المواد الأولية (المكوّنات)') }}</h4>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('المكوّن') }}</th><th>{{ t('الكمية للحصة') }}</th><th>{{ t('الهدر %') }}</th><th>{{ t('تكلفة المكوّن') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in form.lines" :key="i">
                <td>
                  <select v-model="l.ingredient_product_id">
                    <option value="">{{ t('اختر المكوّن...') }}</option>
                    <option v-for="p in ingredientOptions" :key="p.id" :value="p.id">{{ p.name }} <template v-if="p.unit">· {{ p.unit }}</template> · {{ fmt.money(p.purchase_price) }}</option>
                  </select>
                </td>
                <td><input type="number" min="0" step="any" v-model.number="l.qty" style="width:110px;"></td>
                <td><input type="number" min="0" step="any" v-model.number="l.wastage_pct" style="width:90px;"></td>
                <td class="num">{{ rMoney(lineCost(l)) }}</td>
                <td><button class="btn btn-sm btn-ghost" @click="removeLine(i)">✕</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <button class="btn btn-sm btn-ghost mt-1" @click="addLine">+ {{ t('إضافة مكوّن') }}</button>

        <div class="flex-between mt-2">
          <span class="muted">{{ t('تكلفة الدفعة') }}: <strong>{{ rMoney(formBatchCost) }}</strong></span>
          <span>{{ t('تكلفة الحصة') }}: <strong>{{ rMoney(formUnitCost) }}</strong></span>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="saving || !form.product_id || !form.lines.filter(l => l.ingredient_product_id).length">
            {{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- شاشة التصنيع والإنتاج ----------
const ProductionView = {
  name: 'ProductionView',
  mixins: [CommonMixin, RestaurantHelpers],
  data() {
    return {
      orders: [], recipes: [], warehouses: [], summary: {}, loading: true, alert: null,
      showModal: false, saving: false, detail: null,
      form: { recipe_id: '', qty: 1, warehouse_id: '', date: new Date().toISOString().slice(0, 10), notes: '' }
    };
  },
  async created() { await this.load(); },
  computed: {
    selectedRecipe() { return this.recipes.find(r => Number(r.id) === Number(this.form.recipe_id)) || null; },
    estimatedCost() {
      const r = this.selectedRecipe;
      if (!r) return 0;
      return this.rNum(r.unit_cost) * (this.rNum(this.form.qty) || 0);
    }
  },
  methods: {
    async load() {
      this.loading = true;
      try {
        const [orders, recipes, warehouses, summary] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/restaurant/production`),
          this.api(`/api/companies/${this.company.id}/restaurant/recipes`),
          this.api(`/api/companies/${this.company.id}/restaurant/warehouses`),
          this.api(`/api/companies/${this.company.id}/restaurant/summary`)
        ]);
        this.orders = orders; this.recipes = recipes; this.warehouses = warehouses; this.summary = summary;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    openCreate() {
      const def = this.warehouses.find(w => w.is_default) || this.warehouses[0];
      this.form = {
        recipe_id: this.recipes.length ? this.recipes[0].id : '',
        qty: 1, warehouse_id: def ? def.id : '',
        date: new Date().toISOString().slice(0, 10), notes: ''
      };
      this.showModal = true;
    },
    async produce() {
      this.saving = true;
      try {
        const body = {
          recipe_id: Number(this.form.recipe_id), qty: this.rNum(this.form.qty) || 1,
          warehouse_id: Number(this.form.warehouse_id) || null, date: this.form.date, notes: this.form.notes
        };
        await this.api(`/api/companies/${this.company.id}/restaurant/production`, { method: 'POST', body });
        this.toast(t('تم تصنيع الكمية وخصم المواد من المستودع'));
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async viewDetail(o) {
      try { this.detail = await this.api(`/api/companies/${this.company.id}/restaurant/production/${o.id}`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    async cancel(o) {
      if (!confirm(t('هل أنت متأكد من إلغاء أمر التصنيع وإرجاع المواد؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/restaurant/production/${o.id}/cancel`, { method: 'POST' });
        this.toast(t('تم إلغاء أمر التصنيع'));
        this.detail = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.orders.map(o => [
        o.order_no, o.date, o.product_name, o.qty, o.warehouse_name,
        this.rMoney(o.unit_cost), this.rMoney(o.total_cost), o.auto ? t('تلقائي') : t('يدوي')
      ]);
      this.openPrintPreview({
        title: t('أوامر التصنيع'), sub: this.company.name,
        cols: [t('رقم الأمر'), t('التاريخ'), t('الوجبة'), t('الكمية'), t('المستودع'), t('تكلفة الحصة'), t('الإجمالي'), t('النوع')],
        rows
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="cards-grid mb-2">
      <div class="stat-card"><div class="icon">🍽️</div><div class="label">{{ t('أوامر اليوم') }}</div><div class="value">{{ summary.today_orders || 0 }}</div></div>
      <div class="stat-card"><div class="icon">💵</div><div class="label">{{ t('تكلفة إنتاج اليوم') }}</div><div class="value">{{ rMoney(summary.today_cost) }}</div></div>
      <div class="stat-card"><div class="icon">🏭</div><div class="label">{{ t('إجمالي أوامر التصنيع') }}</div><div class="value">{{ summary.orders_count || 0 }}</div></div>
      <div class="stat-card"><div class="icon">📖</div><div class="label">{{ t('عدد الوصفات') }}</div><div class="value">{{ summary.recipes_count || 0 }}</div></div>
    </div>

    <div class="flex-between flex-wrap mb-2">
      <p class="muted">{{ t('عند التصنيع تُخصم المواد الأولية من المستودع وتُضاف الوجبة الجاهزة برصيدها وتُحدّث تكلفتها') }}</p>
      <div class="flex flex-wrap">
        <button class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can('production', 'add')" class="btn btn-primary" @click="openCreate" :disabled="!recipes.length">+ {{ t('تصنيع جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('أوامر التصنيع') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('رقم الأمر') }}</th><th>{{ t('التاريخ') }}</th><th>{{ t('الوجبة') }}</th>
                <th>{{ t('الكمية') }}</th><th>{{ t('المستودع') }}</th><th>{{ t('تكلفة الحصة') }}</th>
                <th>{{ t('الإجمالي') }}</th><th>{{ t('النوع') }}</th><th>{{ t('الحالة') }}</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in orders" :key="o.id">
                <td class="monospace">{{ o.order_no }}</td>
                <td dir="ltr">{{ o.date }}</td>
                <td>{{ o.product_name }}</td>
                <td class="num">{{ o.qty }}</td>
                <td>{{ o.warehouse_name }}</td>
                <td class="num">{{ rMoney(o.unit_cost) }}</td>
                <td class="num">{{ rMoney(o.total_cost) }}</td>
                <td><span class="badge" :class="o.auto ? 'gray' : 'blue'">{{ o.auto ? t('تلقائي') : t('يدوي') }}</span></td>
                <td><span class="badge" :class="o.status === 'completed' ? 'green' : 'gray'">{{ o.status === 'completed' ? t('مكتمل') : t('ملغى') }}</span></td>
                <td>
                  <button class="btn btn-sm btn-ghost" @click="viewDetail(o)">{{ t('تفاصيل') }}</button>
                  <button v-if="can('production', 'edit') && o.status === 'completed'" class="btn btn-sm btn-ghost" @click="cancel(o)">{{ t('إلغاء') }}</button>
                </td>
              </tr>
              <tr v-if="!orders.length"><td colspan="10" class="muted">{{ t('لا توجد أوامر تصنيع بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel mt-2" v-if="(summary.low_ingredients || []).length">
      <div class="panel-header"><h3>{{ t('مواد أولية تحت الحد الأدنى') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('الرمز') }}</th><th>{{ t('المكوّن') }}</th><th>{{ t('الرصيد') }}</th><th>{{ t('الحد الأدنى') }}</th></tr></thead>
            <tbody>
              <tr v-for="p in summary.low_ingredients" :key="p.id">
                <td class="monospace">{{ p.code }}</td><td>{{ p.name }}</td>
                <td class="num">{{ p.qty }} {{ p.unit }}</td><td class="num">{{ p.min_stock }} {{ p.unit }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:560px;">
        <h3>{{ t('تصنيع كمية من وجبة') }}</h3>
        <div class="form-grid">
          <label class="span2">{{ t('الوصفة / الوجبة') }}
            <select v-model="form.recipe_id">
              <option value="">{{ t('اختر الوجبة...') }}</option>
              <option v-for="r in recipes" :key="r.id" :value="r.id">{{ r.product_name }} — {{ t('تكلفة الحصة') }} {{ fmt.money(r.unit_cost) }}</option>
            </select>
          </label>
          <label>{{ t('الكمية (عدد الحصص)') }} <input type="number" min="0.001" step="any" v-model.number="form.qty"></label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="form.date" dir="ltr"></label>
          <label>{{ t('المستودع') }}
            <select v-model="form.warehouse_id">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </label>
          <label>{{ t('ملاحظات') }} <input v-model.trim="form.notes"></label>
        </div>
        <p class="muted mt-1" v-if="selectedRecipe">{{ t('التكلفة المتوقعة') }}: <strong>{{ rMoney(estimatedCost) }}</strong></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="produce" :disabled="saving || !form.recipe_id">
            {{ saving ? t('جارٍ التصنيع...') : t('تصنيع وخصم المواد') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-overlay" @click.self="detail = null">
      <div class="modal" style="max-width:680px;">
        <h3>{{ detail.order_no }} — {{ detail.product_name }}</h3>
        <p class="muted">{{ detail.date }} · {{ detail.warehouse_name }} · {{ t('الكمية') }}: {{ detail.qty }}</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('المكوّن') }}</th><th>{{ t('الكمية المصروفة') }}</th><th>{{ t('سعر الوحدة') }}</th><th>{{ t('التكلفة') }}</th></tr></thead>
            <tbody>
              <tr v-for="l in detail.lines" :key="l.id">
                <td>{{ l.ingredient_name }}</td>
                <td class="num">{{ l.qty }} {{ l.ingredient_unit }}</td>
                <td class="num">{{ rMoney(l.unit_cost) }}</td>
                <td class="num">{{ rMoney(l.line_cost) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="detail = null">{{ t('إغلاق') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};
