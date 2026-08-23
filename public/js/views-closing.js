'use strict';

// ==================== الإقفال السنوي والترحيل ====================
const ClosingView = {
  name: 'ClosingView',
  mixins: [CommonMixin],
  data() {
    return { years: [], loading: true, alert: null, closing: false, confirmClose: false, newYearDate: '' };
  },
  async created() { await this.load(); },
  methods: {
    async load() {
      try { this.years = await this.api(`/api/companies/${this.company.id}/fiscal-years`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async doClose() {
      this.closing = true;
      try {
        const r = await this.api(`/api/companies/${this.company.id}/close-year`, {
          method: 'POST', body: { new_year_start_date: this.newYearDate || undefined }
        });
        this.toast(t('تم إقفال السنة بنجاح. صافي النتيجة: {x}. تم فتح السنة {y}', { x: this.fmt.money(r.netIncome), y: r.nextName }));
        this.confirmClose = false;
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.closing = false; }
    },
    exportYears() {
      const rows = this.years.map(y => [
        y.name, y.start_date, y.end_date,
        y.status === 'open' ? t('مفتوحة') : t('مقفلة'),
        y.closed_at ? y.closed_at.slice(0, 10) : ''
      ]);
      this.exportCsv(`fiscal-years-${this.company.id}`, ['year', 'start', 'end', 'status', 'closed_at'], rows);
    }
  },
  computed: {
    activeYear() { return this.years.find(y => y.status === 'open'); },
    suggestedDate() {
      if (!this.activeYear) return '';
      const y = Number(this.activeYear.name) + 1;
      return `${y}-01-01`;
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div v-if="activeYear" class="panel" style="border-color:var(--primary);">
      <div class="panel-header"><h3>{{ t('إقفال السنة المالية {y} وترحيل الأرصدة', { y: activeYear.name }) }}</h3></div>
      <div class="panel-body">
        <div class="cards-grid" style="margin-bottom:0;">
          <div class="stat-card">
            <div class="label">{{ t('بداية السنة') }}</div>
            <div class="value" style="font-size:18px;">{{ activeYear.start_date }}</div>
          </div>
          <div class="stat-card">
            <div class="label">{{ t('نهاية السنة') }}</div>
            <div class="value" style="font-size:18px;">{{ activeYear.end_date }}</div>
          </div>
          <div class="stat-card">
            <div class="label">{{ t('الحالة') }}</div>
            <div class="value" style="font-size:18px;"><span class="badge green">{{ t('مفتوحة') }}</span></div>
          </div>
        </div>

        <div class="alert info">
          {{ t('عند إقفال السنة يقوم النظام تلقائياً بما يلي:') }}
          <ul style="margin-top:8px;padding-right:18px;">
            <li>{{ t('إقفال حسابات الإيرادات والمصروفات وترحيل صافي النتيجة إلى الأرباح المحتجزة.') }}</li>
            <li>{{ t('فتح سنة مالية جديدة ({y}).', { y: Number(activeYear.name) + 1 }) }}</li>
            <li>{{ t('ترحيل أرصدة حسابات الميزانية (أصول، خصوم، حقوق ملكية) كأرصدة افتتاحية للسنة الجديدة.') }}</li>
            <li>{{ t('تصفير حسابات الإيرادات والمصروفات للسنة الجديدة.') }}</li>
          </ul>
        </div>

        <div class="flex flex-wrap mt-2">
          <label style="display:flex;align-items:center;gap:8px;">
            {{ t('تاريخ بداية السنة الجديدة (اختياري):') }}
            <input type="date" v-model="newYearDate" :placeholder="suggestedDate">
          </label>
          <button v-if="can('closing', 'edit')" class="btn btn-danger" @click="confirmClose = true" :disabled="closing">🔒 {{ t('إقفال سنة {y} وترحيل الحسابات', { y: activeYear.name }) }}</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h3>{{ t('السنوات المالية') }}</h3>
        <button v-if="can('closing', 'export')" class="btn btn-sm btn-ghost" @click="exportYears">⬇️ {{ t('تصدير CSV') }}</button>
      </div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('السنة') }}</th><th>{{ t('البداية') }}</th><th>{{ t('النهاية') }}</th><th>{{ t('الحالة') }}</th><th>{{ t('تاريخ الإقفال') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="y in years" :key="y.id">
                <td><strong>{{ y.name }}</strong></td>
                <td class="monospace">{{ y.start_date }}</td>
                <td class="monospace">{{ y.end_date }}</td>
                <td>
                  <span class="badge" :class="y.status === 'open' ? 'green' : 'gray'">
                    {{ y.status === 'open' ? t('مفتوحة (الحالية)') : t('مقفلة') }}
                  </span>
                </td>
                <td class="monospace">{{ y.closed_at ? fmt.date(y.closed_at.slice(0, 10)) : '—' }}</td>
              </tr>
              <tr v-if="!years.length"><td colspan="5" class="muted">{{ t('لا توجد سنوات مالية') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="confirmClose" class="modal-overlay" @click.self="confirmClose = false">
      <div class="modal" style="max-width:460px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد إقفال السنة {y}', { y: activeYear.name }) }}</h3>
        <p>{{ t('سيتم تنفيذ قيود الإقفال والترحيل بشكل نهائي ولا يمكن التراجع بعد الإقفال. هل أنت متأكد؟') }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="confirmClose = false">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doClose" :disabled="closing">{{ closing ? t('جارٍ الإقفال...') : t('نعم، إقفال وترحيل') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ==================== إعدادات الشركة ====================
const SettingsView = {
  name: 'SettingsView',
  mixins: [CommonMixin],
  data() {
    return { form: {}, saving: false, alert: null, zatca: null, zatcaForm: {}, savingZatca: false };
  },
  created() {
    this.form = {
      name: this.company.name,
      business_type: this.company.business_type,
      cr_number: this.company.cr_number,
      vat_number: this.company.vat_number,
      vat_rate: Number(this.info.settings.vat_rate) || 15,
      currency: this.company.currency || 'SAR',
      fiscal_year_start_month: Number(this.company.fiscal_year_start_month) || 1,
      address: this.company.address,
      phone: this.company.phone,
      email: this.company.email
    };
    this.loadZatca();
  },
  methods: {
    async save() {
      this.saving = true;
      try {
        await this.api(`/api/companies/${this.company.id}`, { method: 'PUT', body: this.form });
        this.toast(t('تم حفظ الإعدادات'));
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async loadZatca() {
      try {
        const z = await this.api(`/api/companies/${this.company.id}/zatca-settings`);
        this.zatca = z;
        this.zatcaForm = {
          active: !!z.active,
          mode: z.mode,
          baseUrl: z.baseUrl,
          csid: '', privateKeyPem: '', certB64: '', otp: '',
          deviceSerialNumber: z.deviceSerialNumber
        };
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async saveZatca() {
      this.savingZatca = true;
      try {
        const body = {
          active: this.zatcaForm.active,
          mode: this.zatcaForm.mode,
          baseUrl: this.zatcaForm.baseUrl,
          deviceSerialNumber: this.zatcaForm.deviceSerialNumber
        };
        if (this.zatcaForm.csid) body.csid = this.zatcaForm.csid;
        if (this.zatcaForm.privateKeyPem) body.privateKeyPem = this.zatcaForm.privateKeyPem;
        if (this.zatcaForm.certB64) body.certB64 = this.zatcaForm.certB64;
        if (this.zatcaForm.otp) body.otp = this.zatcaForm.otp;
        const saved = await this.api(`/api/companies/${this.company.id}/zatca-settings`, { method: 'PUT', body });
        this.toast(saved.configured ? t('تم حفظ بيانات ZATCA وسيتم إرسال الفواتير تلقائياً عند الحفظ') : t('تم الحفظ. أضف بيانات الاعتماد (CSID) لتفعيل الإرسال التلقائي'));
        await this.loadZatca();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.savingZatca = false; }
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>
    <div v-if="!can('settings', 'edit')" class="alert info">{{ t('أنت تملك صلاحية العرض فقط لهذه النافذة — لا يمكنك تعديل البيانات أو إعدادات ZATCA.') }}</div>
    <div class="panel" style="max-width:800px;">
      <div class="panel-header"><h3>{{ t('بيانات الشركة والإعدادات') }}</h3></div>
      <div class="panel-body">
        <div class="form-grid">
          <label class="span2">{{ t('اسم الشركة / المنشأة') }} <input v-model.trim="form.name"></label>
          <label>{{ t('نوع النشاط') }}
            <select v-model="form.business_type" disabled>
              <option v-for="bt in [['corporate','شركة'],['supermarket','سوبر ماركت'],['factory','مصنع'],['medical_lab','مخبر طبي']]" :key="bt[0]" :value="bt[0]">{{ t(bt[1]) }}</option>
            </select>
          </label>
          <label>{{ t('نسبة ضريبة القيمة المضافة (%)') }} <input type="number" v-model.number="form.vat_rate" min="0" max="100"></label>
          <label>{{ t('رقم السجل التجاري') }} <input v-model.trim="form.cr_number" dir="ltr"></label>
          <label>{{ t('الرقم الضريبي') }} <input v-model.trim="form.vat_number" dir="ltr"></label>
          <label>{{ t('العملة') }} <input v-model.trim="form.currency"></label>
          <label>{{ t('شهر بداية السنة المالية') }}
            <select v-model.number="form.fiscal_year_start_month">
              <option :value="1">{{ t('يناير') }}</option><option :value="4">{{ t('أبريل') }}</option>
              <option :value="7">{{ t('يوليو') }}</option><option :value="10">{{ t('أكتوبر') }}</option>
            </select>
          </label>
          <label class="span2">{{ t('العنوان') }} <input v-model.trim="form.address"></label>
          <label>{{ t('الهاتف') }} <input v-model.trim="form.phone" dir="ltr"></label>
          <label>{{ t('البريد الإلكتروني') }} <input v-model.trim="form.email" dir="ltr"></label>
        </div>
        <div class="modal-actions">
          <button v-if="can('settings', 'edit')" class="btn btn-primary" @click="save" :disabled="saving">{{ saving ? t('جارٍ الحفظ...') : t('حفظ الإعدادات') }}</button>
        </div>
      </div>
    </div>

    <div class="panel" style="max-width:800px;border-top:4px solid var(--primary);">
      <div class="panel-header"><h3>{{ t('الفاتورة الإلكترونية والربط مع هيئة الزكاة (ZATCA)') }}</h3></div>
      <div class="panel-body">
        <div class="alert info">
          {{ t('عند تفعيل هذه الإعدادات تُنشأ فاتورة إلكترونية متوافقة (QR + XML بصيغة UBL 2.1) وتُرسل تلقائياً إلى منظومة فاتورة الإلكترونية عند حفظ أي فاتورة بيع.') }}
          {{ t('للحصول على بيانات الاعتماد (CSID) يلزم التسجيل في بوابة هيئة الزكاة (Sandbox للتجربة ثم Production بعد اعتماد المنشأة).') }}
          <ul style="margin-top:8px;padding-right:18px;">
            <li>{{ t('وضع Sandbox: للاختبار والتجربة (عنوان افتراضي sandbox.zatca.gov.sa).') }}</li>
            <li>{{ t('وضع Production: للإنتاج الفعلي بعد الحصول على CSID الإنتاجي (عنوان افتراضي einvoice.zatca.gov.sa).') }}</li>
            <li>{{ t('مفتاح التشفير الخاص والشهادة (ECDSA P-256) يولّدان داخل المنشأة عند إنشاء شهادة CSID.') }}</li>
          </ul>
        </div>

        <div v-if="zatca" class="flex flex-wrap" style="gap:8px;margin-bottom:14px;">
          <span class="badge" :class="zatca.active ? 'green' : 'gray'">{{ zatca.active ? t('التفعيل مفعّل') : t('غير مفعّل') }}</span>
          <span class="badge" :class="zatca.configured ? 'green' : 'yellow'">{{ zatca.configured ? t('جاهز للإرسال') : t('ينقص بيانات الاعتماد') }}</span>
          <span class="badge gray">{{ zatca.mode === 'production' ? t('وضع الإنتاج') : t('وضع التجربة (Sandbox)') }}</span>
        </div>

        <div class="form-grid">
          <label class="span2 flex" style="flex-direction:row;gap:8px;">
            <input type="checkbox" v-model="zatcaForm.active" style="width:auto;"> {{ t('تفعيل الإرسال التلقائي إلى ZATCA') }}
          </label>
          <label>{{ t('الوضع') }}
            <select v-model="zatcaForm.mode">
              <option value="sandbox">{{ t('Sandbox (تجربة)') }}</option>
              <option value="production">{{ t('Production (إنتاج)') }}</option>
            </select>
          </label>
          <label>{{ t('عنوان منظومة فاتورة (اختياري)') }}
            <input v-model.trim="zatcaForm.baseUrl" dir="ltr" placeholder="sandbox.zatca.gov.sa">
          </label>
          <label class="span2">{{ t('رقم CSID (بيانات الاعتماد)') }}
            <input v-model.trim="zatcaForm.csid" dir="ltr" :placeholder="t('ألصق قيمة CSID (تُترك فارغة للاحتفاظ بالموجود)')">
          </label>
          <label class="span2">{{ t('المفتاح الخاص (PEM)') }}
            <textarea v-model.trim="zatcaForm.privateKeyPem" dir="ltr" rows="3" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
          </label>
          <label class="span2">{{ t('الشهادة (base64)') }}
            <textarea v-model.trim="zatcaForm.certB64" dir="ltr" rows="2" :placeholder="t('شهادة X.509 بصيغة base64')"></textarea>
          </label>
          <label>{{ t('رقم الجهاز (اختياري)') }}
            <input v-model.trim="zatcaForm.deviceSerialNumber" dir="ltr" placeholder="Device Serial Number">
          </label>
          <label>{{ t('OTP (للحصول على CSID امتثال في Sandbox)') }}
            <input v-model.trim="zatcaForm.otp" dir="ltr" :placeholder="t('رمز التحقق')">
          </label>
        </div>

        <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;">
          <button v-if="can('settings', 'edit')" class="btn btn-primary" @click="saveZatca" :disabled="savingZatca">{{ savingZatca ? t('جارٍ الحفظ...') : t('حفظ إعدادات ZATCA') }}</button>
          <span class="muted" v-if="zatca && !zatca.csidSet">{{ t('الرقم الضريبي للمنشأة يُقرأ من "بيانات الشركة" أعلاه.') }}</span>
        </div>
      </div>
    </div>
  </div>
  `
};
