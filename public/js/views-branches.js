'use strict';

// ==================== فروع الشركة ====================
const BranchesView = {
  name: 'BranchesView',
  mixins: [CommonMixin],
  data() {
    return {
      branches: [], loading: true, alert: null,
      showModal: false, editing: null, saving: false, deleting: null,
      form: {}
    };
  },
  async created() { await this.load(); },
  computed: {
    isAdmin() { return isCompanyAdminUser(getAuthUser(), this.company.id); },
    formTaxMeta() { return taxCountryMeta(this.form.tax_country); }
  },
  watch: {
    'form.tax_country'(code) {
      const meta = taxCountryMeta(code);
      this.form.currency = meta.currency;
      this.form.currency_symbol = meta.symbol;
      if (this.form.tax_rate === null || this.form.tax_rate === undefined || this.form.tax_rate === '') {
        this.form.tax_rate = meta.rate;
      }
    }
  },
  methods: {
    async load() {
      try {
        this.branches = await this.api(`/api/companies/${this.company.id}/branches`);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    emptyForm() {
      return {
        code: '', name: '', address: '', phone: '', manager: '', notes: '',
        tax_country: 'SA', tax_rate: taxCountryMeta('SA').rate,
        currency: 'SAR', currency_symbol: 'ر.س', tax_number: '',
        jofotara_activity_number: '', jofotara_income_source_sequence: '',
        is_default: false, is_active: true
      };
    },
    openCreate() {
      this.editing = null;
      this.form = this.emptyForm();
      this.showModal = true;
    },
    openEdit(b) {
      this.editing = b;
      this.form = {
        code: b.code, name: b.name, address: b.address || '', phone: b.phone || '',
        manager: b.manager || '', notes: b.notes || '',
        tax_country: b.tax_country || 'SA',
        tax_rate: b.tax_rate_effective !== undefined && b.tax_rate_effective !== null ? Number(b.tax_rate_effective) : taxCountryMeta(b.tax_country).rate,
        currency: b.currency || taxCountryMeta(b.tax_country).currency,
        currency_symbol: b.currency_symbol || taxCountryMeta(b.tax_country).symbol,
        tax_number: b.tax_number || '',
        jofotara_activity_number: b.jofotara_activity_number || '',
        jofotara_income_source_sequence: b.jofotara_income_source_sequence || '',
        is_default: !!b.is_default, is_active: !!b.is_active
      };
      this.showModal = true;
    },
    async save() {
      if (!this.form.name) { this.toast(t('اسم الفرع مطلوب'), 'error'); return; }
      this.saving = true;
      try {
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/branches/${this.editing.id}`, { method: 'PUT', body: this.form });
          this.toast(t('تم تحديث الفرع'));
        } else {
          await this.api(`/api/companies/${this.company.id}/branches`, { method: 'POST', body: this.form });
          this.toast(t('تم إنشاء الفرع'));
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    confirmDelete(b) { this.deleting = b; },
    async doDelete() {
      try {
        await this.api(`/api/companies/${this.company.id}/branches/${this.deleting.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف الفرع'));
        this.deleting = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    exportList() {
      exportCsv('branches', [t('الرمز'), t('الاسم'), t('المدير'), t('الهاتف'), t('العنوان'), t('مستودعات'), t('فواتير')],
        this.branches.map(b => [b.code, b.name, b.manager, b.phone, b.address, b.warehouses_count, b.invoices_count]));
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <p class="muted">{{ t('عدد الفروع: {n}', { n: branches.length }) }}</p>
      <div class="flex">
        <button class="btn btn-ghost" @click="exportList">{{ t('تصدير CSV') }}</button>
        <button v-if="isAdmin" class="btn btn-primary" @click="openCreate">+ {{ t('فرع جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('فروع {company}', { company: company.name }) }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('الرمز') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('المدير') }}</th>
                <th>{{ t('الضريبة') }}</th><th>{{ t('العملة') }}</th>
                <th>{{ t('الهاتف') }}</th><th>{{ t('مستودعات') }}</th><th>{{ t('فواتير') }}</th>
                <th>{{ t('الحالة') }}</th><th v-if="isAdmin"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in branches" :key="b.id">
                <td class="monospace" dir="ltr">{{ b.code }}</td>
                <td><strong>{{ b.name }}</strong>
                  <span v-if="b.is_default" class="badge green" style="margin-right:6px;">{{ t('افتراضي') }}</span>
                </td>
                <td>{{ b.manager || '—' }}</td>
                <td>
                  <span class="badge" :class="b.tax_country === 'JO' ? 'blue' : 'green'">{{ t(b.tax_label) }}</span>
                  <span class="muted" style="font-size:12px;"> {{ b.tax_rate_effective }}%</span>
                </td>
                <td dir="ltr">{{ b.currency }} <span class="muted">{{ b.currency_symbol }}</span></td>
                <td dir="ltr">{{ b.phone || '—' }}</td>
                <td>{{ b.warehouses_count }}</td>
                <td>{{ b.invoices_count }}</td>
                <td><span class="badge" :class="b.is_active ? 'green' : 'red'">{{ b.is_active ? t('نشط') : t('موقوف') }}</span></td>
                <td v-if="isAdmin">
                  <button class="btn btn-sm btn-ghost" @click="openEdit(b)">{{ t('تعديل') }}</button>
                  <button class="btn btn-sm btn-danger" @click="confirmDelete(b)" v-if="!b.is_default">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!branches.length"><td :colspan="isAdmin ? 10 : 9" class="muted">{{ t('لا توجد فروع') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:640px;">
        <h3>{{ editing ? t('تعديل فرع') : t('إضافة فرع جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('رمز الفرع') }}
            <input v-model.trim="form.code" dir="ltr" :placeholder="t('تلقائي إن تُرك فارغاً')">
          </label>
          <label>{{ t('اسم الفرع') }}
            <input v-model.trim="form.name">
          </label>
          <label>{{ t('مدير الفرع') }}
            <input v-model.trim="form.manager">
          </label>
          <label>{{ t('الهاتف') }}
            <input v-model.trim="form.phone" dir="ltr">
          </label>
          <label>{{ t('العنوان') }}
            <input v-model.trim="form.address">
          </label>
          <label>{{ t('ملاحظات') }}
            <input v-model.trim="form.notes">
          </label>
          <label>{{ t('نظام الضريبة') }}
            <select v-model="form.tax_country">
              <option value="SA">{{ t('السعودية — ضريبة القيمة المضافة') }}</option>
              <option value="JO">{{ t('الأردن — ضريبة المبيعات') }}</option>
            </select>
          </label>
          <label>{{ t('نسبة الضريبة (%)') }} <input type="number" v-model.number="form.tax_rate" min="0" max="100"></label>
          <label>{{ t('العملة') }} <input v-model.trim="form.currency" dir="ltr" placeholder="SAR / JOD"></label>
          <label>{{ t('رمز العملة') }} <input v-model.trim="form.currency_symbol"></label>
          <label>{{ t('الرقم الضريبي للفرع (اختياري)') }} <input v-model.trim="form.tax_number" dir="ltr"></label>
          <template v-if="form.tax_country === 'JO'">
            <label>{{ t('رقم النشاط (JoFotara)') }} <input v-model.trim="form.jofotara_activity_number" dir="ltr"></label>
            <label>{{ t('تسلسل مصدر الدخل (JoFotara)') }} <input v-model.trim="form.jofotara_income_source_sequence" dir="ltr"></label>
          </template>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="form.is_default" style="width:auto;"> {{ t('الفرع الافتراضي') }}
          </label>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="form.is_active" style="width:auto;"> {{ t('الفرع نشط') }}
          </label>
        </div>
        <p class="muted" style="font-size:12px;margin-top:6px;">{{ t('الفرع الافتراضي يُستخدم تلقائياً عند عدم اختيار فرع.') }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="saving || !form.name">
            {{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleting" class="modal-overlay" @click.self="deleting = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد حذف الفرع') }}</h3>
        <p>{{ t('هل أنت متأكد من حذف الفرع {name}؟', { name: deleting.name }) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deleting = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDelete">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};
