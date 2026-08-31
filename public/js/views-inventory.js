'use strict';

// ==================== نظام المستودعات والمخزون: مكونات الشاشات ====================

// ---------- المستودعات ----------
const WarehousesView = {
  name: 'WarehousesView',
  mixins: [CommonMixin],
  data() {
    return { warehouses: [], loading: true, alert: null, filter: '', showModal: false, editing: null, form: {} };
  },
  async created() { await this.load(); },
  computed: {
    filtered() {
      const f = this.filter.trim();
      if (!f) return this.warehouses;
      return this.warehouses.filter(w => w.name.includes(f) || (w.code || '').includes(f));
    }
  },
  methods: {
    async load() {
      try { this.warehouses = await this.api(`/api/companies/${this.company.id}/warehouses`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    openCreate() {
      this.editing = null;
      this.form = { name: '', code: '', address: '' };
      this.showModal = true;
    },
    openEdit(w) {
      this.editing = w;
      this.form = { name: w.name, code: w.code, address: w.address || '' };
      this.showModal = true;
    },
    async save() {
      try {
        const body = { name: this.form.name, code: this.form.code, address: this.form.address };
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/warehouses/${this.editing.id}`, { method: 'PUT', body });
          this.toast(t('تم التحديث'));
        } else {
          await this.api(`/api/companies/${this.company.id}/warehouses`, { method: 'POST', body });
          this.toast(t('تمت الإضافة'));
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async remove(w) {
      if (!confirm(t('هل أنت متأكد من حذف هذا المستودع؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/warehouses/${w.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.filtered.map(w => [w.code || '—', w.name, w.address || '—', this.fmt.money(w.value || 0)]);
      this.openPrintPreview({
        title: t('المستودعات'),
        sub: this.company.name,
        cols: [t('الرمز'), t('الاسم'), t('العنوان'), t('قيمة المخزون')],
        rows
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input v-if="can('warehouses', 'search')" :placeholder="t('بحث بالاسم أو الرمز...')" v-model="filter" style="min-width:220px;">
        <p class="muted">{{ t('عدد المستودعات: {n}', { n: warehouses.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button v-if="can('warehouses', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button v-if="can('warehouses', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can('warehouses', 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('مستودع جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('المستودعات') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('الرمز') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('العنوان') }}</th><th>{{ t('قيمة المخزون') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="w in filtered" :key="w.id">
                <td class="monospace"><strong>{{ w.code || '—' }}</strong></td>
                <td>{{ w.name }} <span v-if="w.is_default" class="badge green">{{ t('الافتراضي') }}</span></td>
                <td>{{ w.address || '—' }}</td>
                <td class="num">{{ fmt.money(w.value || 0) }}</td>
                <td>
                  <button v-if="can('warehouses', 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(w)">{{ t('تعديل') }}</button>
                  <button v-if="!w.is_default && can('warehouses', 'delete')" class="btn btn-sm btn-ghost" @click="remove(w)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!warehouses.length"><td colspan="5" class="muted">{{ t('لا توجد مستودعات بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal">
        <h3>{{ editing ? t('تعديل مستودع') : t('إضافة مستودع') }}</h3>
        <div class="form-grid">
          <label>{{ t('الاسم') }} <input v-model.trim="form.name"></label>
          <label>{{ t('الرمز') }} <input v-model.trim="form.code" :placeholder="t('مثال: WH-002')" dir="ltr"></label>
          <label class="span2">{{ t('العنوان') }} <input v-model.trim="form.address"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="!form.name">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- المنتجات ----------
const ProductsView = {
  name: 'ProductsView',
  mixins: [CommonMixin],
  data() {
    return {
      products: [], loading: true, alert: null, filter: '',
      showModal: false, editing: null, form: {},
      showInactive: false
    };
  },
  async created() { await this.load(); },
  computed: {
    filtered() {
      const f = this.filter.trim();
      if (!f) return this.products;
      return this.products.filter(p =>
        p.name.includes(f) || (p.barcode || '').includes(f) || (p.category || '').includes(f) || (p.code || '').includes(f));
    }
  },
  methods: {
    async load() {
      try {
        this.products = await this.api(`/api/companies/${this.company.id}/products?all=${this.showInactive ? 1 : 0}`);
      }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    toggleInactive() { this.showInactive = !this.showInactive; this.load(); },
    openCreate() {
      this.editing = null;
      this.form = {
        name: '', barcode: '', category: '', unit: '', image: '', purchase_price: 0, sale_price: 0,
        min_stock: 0, vat_applicable: true, active: true,
        sale_account: '4101', purchase_account: '5101', cogs_account: '5104', inventory_account: '1301'
      };
      this.showModal = true;
    },
    openEdit(p) {
      this.editing = p;
      this.form = {
        name: p.name, barcode: p.barcode || '', category: p.category || '', unit: p.unit || '',
        image: p.image || '', description: p.description || '',
        purchase_price: p.purchase_price, sale_price: p.sale_price, min_stock: p.min_stock || 0,
        vat_applicable: !!p.vat_applicable, active: !!p.active,
        sale_account: p.sale_account, purchase_account: p.purchase_account,
        cogs_account: p.cogs_account, inventory_account: p.inventory_account
      };
      this.showModal = true;
    },
    onImageFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { this.toast(t('يرجى اختيار ملف صورة'), 'error'); e.target.value = ''; return; }
      if (file.size > 1024 * 1024) { this.toast(t('حجم الصورة كبير، الحد الأقصى 1 ميغابايت'), 'error'); e.target.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => { this.form.image = reader.result; };
      reader.readAsDataURL(file);
    },
    clearImage() { this.form.image = ''; },
    async save() {
      try {
        const body = { ...this.form, active: this.form.active ? 1 : 0, vat_applicable: this.form.vat_applicable ? 1 : 0 };
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/products/${this.editing.id}`, { method: 'PUT', body });
          this.toast(t('تم التحديث'));
        } else {
          await this.api(`/api/companies/${this.company.id}/products`, { method: 'POST', body });
          this.toast(t('تمت الإضافة'));
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async remove(p) {
      if (!confirm(t('هل أنت متأكد من حذف هذا المنتج؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/products/${p.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async setActive(p) {
      await this.api(`/api/companies/${this.company.id}/products/${p.id}`, { method: 'PUT', body: { active: p.active ? 0 : 1 } });
      await this.load();
    },
    preview() {
      const rows = this.filtered.map(p => [
        p.code || '—', p.name, p.barcode || '—', p.category || '—', p.unit || '—',
        this.fmt.money(p.purchase_price), this.fmt.money(p.sale_price), p.active ? t('نشط') : t('موقوف')
      ]);
      this.openPrintPreview({
        title: t('المنتجات'),
        sub: this.company.name,
        cols: [t('الرمز'), t('الاسم'), t('الباركود'), t('الفئة'), t('الوحدة'), t('سعر الشراء'), t('سعر البيع'), t('الحالة')],
        rows
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input v-if="can('products', 'search')" :placeholder="t('بحث بالاسم أو الباركود أو الفئة...')" v-model="filter" style="min-width:260px;">
        <button class="btn btn-sm btn-ghost" @click="toggleInactive">{{ showInactive ? t('إخفاء الموقوفة') : t('عرض الموقوفة') }}</button>
        <p class="muted">{{ t('عدد المنتجات: {n}', { n: products.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button v-if="can('products', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button v-if="can('products', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can('products', 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('منتج جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('المنتجات') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('الصورة') }}</th><th>{{ t('الرمز') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('الباركود') }}</th><th>{{ t('الفئة') }}</th><th>{{ t('الوحدة') }}</th>
                <th>{{ t('سعر الشراء') }}</th><th>{{ t('سعر البيع') }}</th><th>{{ t('الحد الأدنى') }}</th><th>{{ t('الحالة') }}</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in filtered" :key="p.id">
                <td><img v-if="p.image" :src="p.image" class="prod-thumb" alt=""><span v-else class="muted">—</span></td>
                <td class="monospace">{{ p.code || '—' }}</td>
                <td><strong>{{ p.name }}</strong></td>
                <td class="monospace" dir="ltr">{{ p.barcode || '—' }}</td>
                <td>{{ p.category || '—' }}</td>
                <td>{{ p.unit || '—' }}</td>
                <td class="num">{{ fmt.money(p.purchase_price) }}</td>
                <td class="num">{{ fmt.money(p.sale_price) }}</td>
                <td class="num">{{ p.min_stock || 0 }}</td>
                <td><span class="badge" :class="p.active ? 'green' : 'gray'">{{ p.active ? t('نشط') : t('موقوف') }}</span></td>
                <td>
                  <button v-if="can('products', 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(p)">{{ t('تعديل') }}</button>
                  <button v-if="can('products', 'edit')" class="btn btn-sm btn-ghost" @click="setActive(p)">{{ p.active ? t('إيقاف') : t('تفعيل') }}</button>
                  <button v-if="can('products', 'delete')" class="btn btn-sm btn-ghost" @click="remove(p)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!products.length"><td colspan="11" class="muted">{{ t('لا توجد منتجات بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:760px;">
        <h3>{{ editing ? t('تعديل منتج') : t('إضافة منتج') }}</h3>
        <div class="form-grid">
          <label class="span2">{{ t('الاسم') }} <input v-model.trim="form.name"></label>
          <label class="span2">
            {{ t('الصورة') }}
            <div class="flex" style="gap:8px;align-items:center;">
              <input v-model.trim="form.image" dir="ltr" :placeholder="t('رابط الصورة أو ارفع ملفاً...')">
              <label class="btn btn-sm btn-ghost" style="white-space:nowrap;">📷 {{ t('رفع') }}
                <input type="file" accept="image/*" style="display:none;" @change="onImageFile">
              </label>
              <button v-if="form.image" type="button" class="btn btn-sm btn-ghost" @click="clearImage">✕</button>
            </div>
            <img v-if="form.image" :src="form.image" class="prod-preview" alt="">
          </label>
          <label>{{ t('الباركود') }} <input v-model.trim="form.barcode" dir="ltr" :placeholder="t('مثال: 6258118000016')"></label>
          <label>{{ t('الفئة') }} <input v-model.trim="form.category" :placeholder="t('مثال: مواد غذائية')"></label>
          <label>{{ t('الوحدة') }} <input v-model.trim="form.unit" :placeholder="t('مثال: كرتون / كيس')"></label>
          <label>{{ t('سعر الشراء') }} <input type="number" v-model.number="form.purchase_price" min="0"></label>
          <label>{{ t('سعر البيع') }} <input type="number" v-model.number="form.sale_price" min="0"></label>
          <label>{{ t('الحد الأدنى للمخزون') }} <input type="number" v-model.number="form.min_stock" min="0"></label>
          <label class="check-inline"><input type="checkbox" v-model="form.vat_applicable"> {{ t('يخضع للضريبة') }}</label>
          <label class="check-inline"><input type="checkbox" v-model="form.active"> {{ t('نشط') }}</label>
          <label>{{ t('حساب المبيعات') }} <input v-model.trim="form.sale_account" dir="ltr" placeholder="4101"></label>
          <label>{{ t('حساب المشتريات') }} <input v-model.trim="form.purchase_account" dir="ltr" placeholder="5101"></label>
          <label>{{ t('حساب تكلفة المبيعات') }} <input v-model.trim="form.cogs_account" dir="ltr" placeholder="5104"></label>
          <label>{{ t('حساب المخزون') }} <input v-model.trim="form.inventory_account" dir="ltr" placeholder="1301"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="!form.name">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- المخزون والأرصدة ----------
const StockView = {
  name: 'StockView',
  mixins: [CommonMixin],
  data() {
    return {
      warehouses: [], summary: null, balances: [], movements: [], loading: true, alert: null,
      filter: '', warehouseFilter: '', tab: 'balances'
    };
  },
  async created() { await this.load(); },
  computed: {
    filteredBalances() {
      const f = this.filter.trim();
      if (!f) return this.balances;
      return this.balances.filter(r => r.name.includes(f) || (r.barcode || '').includes(f));
    },
    filteredMovements() {
      const f = this.filter.trim();
      if (!f) return this.movements;
      return this.movements.filter(m => (m.product_name || '').includes(f) || (m.notes || '').includes(f));
    }
  },
  methods: {
    async load() {
      try {
        const [warehouses, summary, balances, movements] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/warehouses`),
          this.api(`/api/companies/${this.company.id}/stock/summary`),
          this.api(`/api/companies/${this.company.id}/stock${this.warehouseFilter ? '?warehouse_id=' + this.warehouseFilter : ''}`),
          this.api(`/api/companies/${this.company.id}/stock/movements`)
        ]);
        this.warehouses = warehouses;
        this.summary = summary;
        this.balances = balances;
        this.movements = movements;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async changeWarehouse() {
      this.balances = await this.api(`/api/companies/${this.company.id}/stock${this.warehouseFilter ? '?warehouse_id=' + this.warehouseFilter : ''}`);
    },
    movementType(m) {
      return {
        initial: { t: t('رصيد افتتاحي'), c: 'gray' },
        purchase: { t: t('شراء'), c: 'green' },
        sale: { t: t('بيع'), c: 'red' },
        adjustment: { t: t('تسوية'), c: 'yellow' },
        count: { t: t('جرد'), c: 'blue' }
      }[m.type] || { t: m.type, c: 'gray' };
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="cards-row mb-2">
      <div class="card-sm"><div class="card-label">{{ t('عدد المنتجات') }}</div><div class="card-value">{{ summary ? summary.products : '—' }}</div></div>
      <div class="card-sm"><div class="card-label">{{ t('عدد المستودعات') }}</div><div class="card-value">{{ summary ? summary.warehouses : '—' }}</div></div>
      <div class="card-sm"><div class="card-label">{{ t('قيمة المخزون') }}</div><div class="card-value">{{ summary ? fmt.money(summary.value) : '—' }}</div></div>
      <div class="card-sm"><div class="card-label">{{ t('منتجات منخفضة') }}</div><div class="card-value" :style="summary && summary.low > 0 ? 'color:var(--danger);' : ''">{{ summary ? summary.low : '—' }}</div></div>
    </div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap" style="gap:8px;">
        <button class="btn btn-sm" :class="tab === 'balances' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'balances'">{{ t('الأرصدة') }}</button>
        <button class="btn btn-sm" :class="tab === 'movements' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'movements'">{{ t('حركات المخزون') }}</button>
        <input v-if="can('inventory', 'search')" :placeholder="t('بحث...')" v-model="filter" style="min-width:200px;">
        <select v-if="tab === 'balances'" v-model="warehouseFilter" @change="changeWarehouse" style="min-width:160px;">
          <option value="">{{ t('كل المستودعات') }}</option>
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
    </div>

    <div v-if="tab === 'balances'" class="panel">
      <div class="panel-header"><h3>{{ t('أرصدة المخزون') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('المنتج') }}</th><th>{{ t('الباركود') }}</th><th>{{ t('المستودع') }}</th><th>{{ t('الكمية') }}</th><th>{{ t('القيمة') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in filteredBalances" :key="r.product_id + '-' + r.warehouse_id">
                <td><strong>{{ r.name }}</strong></td>
                <td class="monospace" dir="ltr">{{ r.barcode || '—' }}</td>
                <td>{{ r.warehouse || '—' }}</td>
                <td class="num">{{ fmt.num(r.qty) }}</td>
                <td class="num">{{ fmt.money(r.value) }}</td>
              </tr>
              <tr v-if="!balances.length"><td colspan="5" class="muted">{{ t('لا توجد أرصدة بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-else class="panel">
      <div class="panel-header"><h3>{{ t('حركات المخزون') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('التاريخ') }}</th><th>{{ t('المنتج') }}</th><th>{{ t('المستودع') }}</th><th>{{ t('النوع') }}</th><th>{{ t('الكمية') }}</th><th>{{ t('المرجع') }}</th><th>{{ t('ملاحظات') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in filteredMovements" :key="m.id">
                <td>{{ fmt.date(m.date) }}</td>
                <td><strong>{{ m.product_name || '—' }}</strong></td>
                <td>{{ m.warehouse || '—' }}</td>
                <td><span class="badge" :class="movementType(m).c">{{ movementType(m).t }}</span></td>
                <td class="num" :style="m.delta < 0 ? 'color:var(--danger);' : ''">{{ m.delta > 0 ? '+' : '' }}{{ fmt.num(m.delta) }}</td>
                <td class="monospace">{{ m.ref_type || '—' }}{{ m.ref_id ? ' #' + m.ref_id : '' }}</td>
                <td class="muted">{{ m.notes || '—' }}</td>
              </tr>
              <tr v-if="!movements.length"><td colspan="7" class="muted">{{ t('لا توجد حركات بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- الجرد ----------
const StockCountsView = {
  name: 'StockCountsView',
  mixins: [CommonMixin],
  data() {
    return {
      counts: [], warehouses: [], loading: true, alert: null,
      showCreate: false, createForm: { warehouse_id: '', date: '' },
      open: null, saving: false
    };
  },
  async created() { await this.load(); },
  computed: {
    statusMeta() {
      return {
        open: { t: t('مسودة'), c: 'yellow' },
        completed: { t: t('مكتمل'), c: 'green' },
        cancelled: { t: t('ملغي'), c: 'gray' }
      };
    },
    differences() {
      if (!this.open) return [];
      return this.open.lines.filter(l => Number(l.diff) !== 0);
    }
  },
  methods: {
    async load() {
      try {
        const [counts, warehouses] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/counts`),
          this.api(`/api/companies/${this.company.id}/warehouses`)
        ]);
        this.counts = counts;
        this.warehouses = warehouses;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    statusOf(s) { return this.statusMeta[s] || { t: s, c: 'gray' }; },
    openCreate() {
      this.createForm = { warehouse_id: this.warehouses.length ? this.warehouses[0].id : '', date: new Date().toISOString().slice(0, 10) };
      this.showCreate = true;
    },
    async createCount() {
      this.saving = true;
      try {
        const c = await this.api(`/api/companies/${this.company.id}/counts`, { method: 'POST', body: this.createForm });
        this.toast(t('تم إنشاء جرد جديد'));
        this.showCreate = false;
        this.open = c;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async openCount(c) {
      this.open = await this.api(`/api/companies/${this.company.id}/counts/${c.id}`);
    },
    async saveLine(l) {
      try {
        await this.api(`/api/companies/${this.company.id}/counts/${this.open.id}/lines/${l.id}`, { method: 'PUT', body: { count_qty: Number(l.count_qty) || 0 } });
        const c = await this.api(`/api/companies/${this.company.id}/counts/${this.open.id}`);
        this.open.lines = c.lines;
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async finalize() {
      if (!confirm(t('هل أنت متأكد من اعتماد الجرد؟ سيتم تسجيل القيود المحاسبية وتحديث الأرصدة.'))) return;
      this.saving = true;
      try {
        await this.api(`/api/companies/${this.company.id}/counts/${this.open.id}/finalize`, { method: 'POST' });
        this.toast(t('تم اعتماد الجرد وتسجيل القيود'));
        this.open = null;
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async cancel() {
      if (!confirm(t('هل أنت متأكد من إلغاء الجرد؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/counts/${this.open.id}/cancel`, { method: 'POST' });
        this.toast(t('تم الإلغاء'));
        this.open = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.counts.map(c => [c.count_no, c.warehouse || '—', c.date, this.statusOf(c.status).t]);
      this.openPrintPreview({
        title: t('جرد المخزون'),
        sub: this.company.name,
        cols: [t('الرقم'), t('المستودع'), t('التاريخ'), t('الحالة')],
        rows
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <p class="muted">{{ t('عدد الجردات: {n}', { n: counts.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button v-if="can('inventory', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button v-if="can('inventory', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can('inventory', 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('جرد جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('الجرد') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('الرقم') }}</th><th>{{ t('المستودع') }}</th><th>{{ t('التاريخ') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="c in counts" :key="c.id">
                <td class="monospace"><strong>{{ c.count_no }}</strong></td>
                <td>{{ c.warehouse || '—' }}</td>
                <td>{{ fmt.date(c.date) }}</td>
                <td><span class="badge" :class="statusOf(c.status).c">{{ statusOf(c.status).t }}</span></td>
                <td><button class="btn btn-sm btn-ghost" @click="openCount(c)">{{ t('فتح') }}</button></td>
              </tr>
              <tr v-if="!counts.length"><td colspan="5" class="muted">{{ t('لا توجد جردات بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <h3>{{ t('جرد جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('المستودع') }}
            <select v-model="createForm.warehouse_id">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="createForm.date"></label>
        </div>
        <p class="muted">{{ t('سيتم إنشاء سطر جرد لكل منتج لديه رصيد في المستودع.') }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showCreate = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="createCount" :disabled="!createForm.warehouse_id || saving">{{ t('إنشاء') }}</button>
        </div>
      </div>
    </div>

    <div v-if="open" class="modal-overlay" @click.self="open = null">
      <div class="modal" style="max-width:860px;">
        <h3>{{ t('جرد') }} {{ open.count_no }} - {{ open.warehouse || '—' }}</h3>
        <p class="muted mb-2">
          {{ t('التاريخ:') }} {{ open.date }}
          <span v-if="differences.length" class="badge yellow">{{ t('اختلافات: {n}', { n: differences.length }) }}</span>
        </p>
        <div class="table-wrap" style="max-height:60vh;overflow:auto;">
          <table>
            <thead>
              <tr><th>{{ t('المنتج') }}</th><th>{{ t('الباركود') }}</th><th>{{ t('رصيد النظام') }}</th><th>{{ t('الكمية الفعلية') }}</th><th>{{ t('الفرق') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in open.lines" :key="l.id">
                <td><strong>{{ l.name }}</strong></td>
                <td class="monospace" dir="ltr">{{ l.barcode || '—' }}</td>
                <td class="num">{{ fmt.num(l.system_qty) }}</td>
                <td><input type="number" v-model.number="l.count_qty" min="0" @change="saveLine(l)" style="width:110px;" :disabled="open.status !== 'open'"></td>
                <td class="num" :style="Number(l.diff) < 0 ? 'color:var(--danger);' : (Number(l.diff) > 0 ? 'color:var(--success);' : '')">{{ Number(l.diff) > 0 ? '+' : '' }}{{ fmt.num(l.diff) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="open = null">{{ t('إغلاق') }}</button>
          <button v-if="open.status === 'open'" class="btn btn-ghost" @click="cancel">{{ t('إلغاء الجرد') }}</button>
          <button v-if="open.status === 'open'" class="btn btn-primary" @click="finalize" :disabled="saving">{{ t('اعتماد الجرد') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- نقطة البيع ----------
const PosView = {
  name: 'PosView',
  mixins: [CommonMixin],
  data() {
    return {
      warehouses: [], products: [], methods: [], cart: [], barcodeInput: '', qtyInput: 1,
      loading: true, alert: null, saving: false,
      form: { warehouse_id: '', date: '', vat_rate: 0, discount: 0, payment_method: 'cash', notes: '' },
      receipt: null, searchText: ''
    };
  },
  async created() {
    await this.load();
    this.focusBarcode();
  },
  computed: {
    filteredProducts() {
      const f = this.searchText.trim();
      if (!f) return this.products;
      return this.products.filter(p => p.name.includes(f) || (p.barcode || '').includes(f) || (p.category || '').includes(f));
    },
    cartTotal() {
      return this.cart.reduce((s, l) => s + l.line_total, 0);
    },
    taxable() { return Math.max(this.cartTotal - (Number(this.form.discount) || 0), 0); },
    vatAmount() { return this.taxable * (Number(this.form.vat_rate) || 0) / 100; },
    total() { return this.taxable + this.vatAmount; },
    cartCount() { return this.cart.reduce((s, l) => s + l.qty, 0); }
  },
  methods: {
    async load() {
      try {
        const [warehouses, products, methods] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/warehouses`),
          this.api(`/api/companies/${this.company.id}/products`),
          this.api(`/api/companies/${this.company.id}/payment-methods`)
        ]);
        this.warehouses = warehouses;
        this.products = products;
        this.methods = methods;
        this.form.vat_rate = Number(this.info.settings.vat_rate) || 15;
        if (!this.form.warehouse_id && warehouses.length) this.form.warehouse_id = warehouses[0].id;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    focusBarcode() {
      this.$nextTick(() => {
        const el = this.$refs.barcode;
        if (el) el.focus();
      });
    },
    async scan() {
      const code = this.barcodeInput.trim();
      if (!code) return;
      this.barcodeInput = '';
      let product = this.products.find(p => p.barcode && p.barcode === code);
      if (!product) {
        try { product = await this.api(`/api/companies/${this.company.id}/products/barcode/${encodeURIComponent(code)}`); }
        catch (e) { this.toast(t('لا يوجد منتج بهذا الباركود: {code}', { code }), 'error'); return; }
      }
      this.addToCart(product);
      this.focusBarcode();
    },
    addToCart(product, qty = 1) {
      const existing = this.cart.find(l => l.product_id === product.id);
      if (existing) {
        existing.qty += Number(qty) || 1;
        existing.line_total = existing.qty * existing.unit_price - (Number(existing.discount) || 0);
      } else {
        this.cart.push({
          product_id: product.id,
          name: product.name,
          barcode: product.barcode || '',
          unit_price: Number(product.sale_price) || 0,
          qty: Number(qty) || 1,
          discount: 0,
          available: Number(product.stock_qty || product.stock || 0)
        });
        this.recalc(this.cart[this.cart.length - 1]);
      }
      this.qtyInput = 1;
      this.searchText = '';
    },
    recalc(l) {
      l.line_total = (Number(l.qty) || 0) * (Number(l.unit_price) || 0) - (Number(l.discount) || 0);
    },
    removeLine(i) { this.cart.splice(i, 1); },
    clearCart() { this.cart = []; },
    async checkout() {
      if (!this.cart.length) return this.toast(t('السلة فارغة'), 'error');
      this.saving = true;
      try {
        const body = {
          date: this.form.date || new Date().toISOString().slice(0, 10),
          vat_rate: Number(this.form.vat_rate),
          discount: Number(this.form.discount) || 0,
          payment_method: this.form.payment_method,
          warehouse_id: this.form.warehouse_id || undefined,
          notes: t('مبيعات نقطة البيع') + (this.form.notes ? ' - ' + this.form.notes : ''),
          lines: this.cart.map(l => ({ product_id: l.product_id, qty: l.qty, discount: Number(l.discount) || 0 }))
        };
        const inv = await this.api(`/api/companies/${this.company.id}/pos/sell`, { method: 'POST', body });
        this.receipt = {
          invoice_no: inv.invoice_no,
          date: inv.date,
          lines: inv.lines,
          sub_total: inv.sub_total,
          discount: inv.discount,
          vat: inv.vat,
          total: inv.total,
          payment_method: this.form.payment_method,
          zatca_status: inv.zatca_status
        };
        this.cart = [];
        this.form.discount = 0;
        this.form.notes = '';
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    paymentLabel(code) {
      const m = this.methods.find(x => x.code === code);
      return m ? (m.icon ? m.icon + ' ' : '') + m.name : code;
    },
    printReceipt() {
      if (!this.receipt) return;
      const rows = this.receipt.lines.map(l => [l.description || l.product_name || '', String(l.qty), this.fmt.money(l.unit_price), this.fmt.money(l.line_total)]);
      this.openPrintPreview({
        title: t('إيصال') + ' ' + this.receipt.invoice_no,
        sub: this.company.name,
        cols: [t('الصنف'), t('الكمية'), t('السعر'), t('الإجمالي')],
        rows,
        footer: [t('الإجمالي:') + ' ' + this.fmt.money(this.receipt.total), t('طريقة الدفع:') + ' ' + this.paymentLabel(this.receipt.payment_method)]
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="pos-header mb-2">
      <input ref="barcode" v-model.trim="barcodeInput" @keyup.enter="scan" :placeholder="t('امسح الباركود أو اكتبه ثم Enter...')" class="pos-barcode" dir="ltr">
      <select v-model="form.warehouse_id" class="pos-wh">
        <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
      </select>
      <select v-model="form.payment_method" class="pos-pm">
        <option v-for="m in methods" :key="m.code" :value="m.code">{{ m.name }}</option>
      </select>
    </div>

    <div class="pos-grid">
      <div class="panel">
        <div class="panel-header"><h3>{{ t('المنتجات') }}</h3></div>
        <div class="panel-body">
          <input :placeholder="t('بحث عن منتج...')" v-model="searchText" style="margin-bottom:8px;width:100%;">
          <div class="pos-products">
            <div v-for="p in filteredProducts" :key="p.id" class="pos-product" @click="addToCart(p)">
              <img v-if="p.image" :src="p.image" class="pos-product-img" alt="">
              <div class="pos-product-name">{{ p.name }}</div>
              <div class="pos-product-meta">
                <span class="monospace" dir="ltr">{{ p.barcode || '—' }}</span>
                <span>{{ fmt.money(p.sale_price) }}</span>
                <span class="pos-product-stock" v-if="p.stock_qty !== undefined">{{ t('المتوفر: {n}', { n: p.stock_qty }) }}</span>
              </div>
            </div>
            <div v-if="!products.length" class="muted">{{ t('لا توجد منتجات. أضف منتجات من شاشة المنتجات.') }}</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('السلة') }} <span class="badge blue">{{ cartCount }}</span></h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap" style="max-height:44vh;overflow:auto;">
            <table>
              <thead>
                <tr><th>{{ t('الصنف') }}</th><th>{{ t('الكمية') }}</th><th>{{ t('السعر') }}</th><th>{{ t('خصم') }}</th><th>{{ t('الإجمالي') }}</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="(l, i) in cart" :key="l.product_id">
                  <td><strong>{{ l.name }}</strong><div class="muted monospace" dir="ltr" style="font-size:11px;">{{ l.barcode }}</div></td>
                  <td><input type="number" v-model.number="l.qty" min="1" @change="recalc(l)" style="width:64px;"></td>
                  <td class="num">{{ fmt.money(l.unit_price) }}</td>
                  <td><input type="number" v-model.number="l.discount" min="0" @change="recalc(l)" style="width:64px;"></td>
                  <td class="num">{{ fmt.money(l.line_total) }}</td>
                  <td><button class="btn btn-sm btn-ghost" @click="removeLine(i)">✕</button></td>
                </tr>
                <tr v-if="!cart.length"><td colspan="6" class="muted">{{ t('السلة فارغة') }}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="pos-totals">
            <div class="flex-between"><span>{{ t('الإجمالي قبل الضريبة:') }}</span><strong class="monospace">{{ fmt.money(taxable) }}</strong></div>
            <div class="flex-between"><span>{{ t('الضريبة ({rate}%):', { rate: form.vat_rate || 0 }) }}</span><strong class="monospace">{{ fmt.money(vatAmount) }}</strong></div>
            <div class="flex-between pos-grand"><span>{{ t('الإجمالي:') }}</span><strong class="monospace" style="color:var(--primary);font-size:20px;">{{ fmt.money(total) }}</strong></div>
            <label class="mt-2">{{ t('خصم على الفاتورة') }} <input type="number" v-model.number="form.discount" min="0" style="width:110px;"></label>
          </div>
        </div>
        <div class="panel-footer">
          <button class="btn btn-ghost" @click="clearCart">{{ t('تفريغ السلة') }}</button>
          <button class="btn btn-primary btn-lg" @click="checkout" :disabled="!cart.length || saving" style="flex:1;">
            {{ saving ? t('جارٍ الحفظ...') : t('إتمام البيع') + ' · ' + fmt.money(total) }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="receipt" class="modal-overlay" @click.self="receipt = null">
      <div class="modal" style="max-width:460px;">
        <h3>{{ t('تم البيع بنجاح') }}</h3>
        <div class="receipt-box">
          <div style="text-align:center;" class="mb-2">
            <strong>{{ company.name }}</strong>
            <div class="muted">{{ t('فاتورة') }} <span class="monospace">{{ receipt.invoice_no }}</span></div>
            <div class="muted">{{ receipt.date }}</div>
          </div>
          <table class="kv">
            <tr v-for="(l, i) in receipt.lines" :key="i">
              <td>{{ l.description || l.product_name }}</td>
              <td class="num">{{ l.qty }} × {{ fmt.money(l.unit_price) }}</td>
              <td class="num">{{ fmt.money(l.line_total) }}</td>
            </tr>
            <tr><td>{{ t('الإجمالي قبل الضريبة:') }}</td><td></td><td class="num">{{ fmt.money(receipt.sub_total - receipt.discount) }}</td></tr>
            <tr v-if="receipt.vat > 0.01"><td>{{ t('الضريبة:') }}</td><td></td><td class="num">{{ fmt.money(receipt.vat) }}</td></tr>
            <tr><td><strong>{{ t('الإجمالي:') }}</strong></td><td></td><td class="num"><strong>{{ fmt.money(receipt.total) }}</strong></td></tr>
            <tr><td>{{ t('طريقة الدفع:') }}</td><td></td><td class="num">{{ paymentLabel(receipt.payment_method) }}</td></tr>
            <tr v-if="receipt.zatca_status"><td>{{ t('الفاتورة الإلكترونية:') }}</td><td></td><td><span class="badge" :class="fmt.zatcaStatus(receipt.zatca_status).c">{{ fmt.zatcaStatus(receipt.zatca_status).t }}</span></td></tr>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="receipt = null">{{ t('إغلاق') }}</button>
          <button class="btn btn-primary" @click="printReceipt">{{ t('🖨️ طباعة الإيصال') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};
