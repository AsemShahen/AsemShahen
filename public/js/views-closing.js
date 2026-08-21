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
        this.toast(`تم إقفال السنة بنجاح. صافي النتيجة: ${this.fmt.money(r.netIncome)}. تم فتح السنة ${r.nextName}`);
        this.confirmClose = false;
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.closing = false; }
    },
    exportYears() {
      const rows = this.years.map(y => [
        y.name, y.start_date, y.end_date,
        y.status === 'open' ? 'مفتوحة' : 'مقفلة',
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
      <div class="panel-header"><h3>إقفال السنة المالية {{ activeYear.name }} وترحيل الأرصدة</h3></div>
      <div class="panel-body">
        <div class="cards-grid" style="margin-bottom:0;">
          <div class="stat-card">
            <div class="label">بداية السنة</div>
            <div class="value" style="font-size:18px;">{{ activeYear.start_date }}</div>
          </div>
          <div class="stat-card">
            <div class="label">نهاية السنة</div>
            <div class="value" style="font-size:18px;">{{ activeYear.end_date }}</div>
          </div>
          <div class="stat-card">
            <div class="label">الحالة</div>
            <div class="value" style="font-size:18px;"><span class="badge green">مفتوحة</span></div>
          </div>
        </div>

        <div class="alert info">
          عند إقفال السنة يقوم النظام تلقائياً بما يلي:
          <ul style="margin-top:8px;padding-right:18px;">
            <li>إقفال حسابات الإيرادات والمصروفات وترحيل صافي النتيجة إلى <strong>الأرباح المحتجزة</strong>.</li>
            <li>فتح سنة مالية جديدة ({{ Number(activeYear.name) + 1 }}).</li>
            <li>ترحيل أرصدة حسابات الميزانية (أصول، خصوم، حقوق ملكية) كأرصدة افتتاحية للسنة الجديدة.</li>
            <li>تصفير حسابات الإيرادات والمصروفات للسنة الجديدة.</li>
          </ul>
        </div>

        <div class="flex flex-wrap mt-2">
          <label style="display:flex;align-items:center;gap:8px;">
            تاريخ بداية السنة الجديدة (اختياري):
            <input type="date" v-model="newYearDate" :placeholder="suggestedDate">
          </label>
          <button v-if="can('closing', 'edit')" class="btn btn-danger" @click="confirmClose = true" :disabled="closing">🔒 إقفال سنة {{ activeYear.name }} وترحيل الحسابات</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h3>السنوات المالية</h3>
        <button v-if="can('closing', 'export')" class="btn btn-sm btn-ghost" @click="exportYears">⬇️ تصدير CSV</button>
      </div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>السنة</th><th>البداية</th><th>النهاية</th><th>الحالة</th><th>تاريخ الإقفال</th></tr>
            </thead>
            <tbody>
              <tr v-for="y in years" :key="y.id">
                <td><strong>{{ y.name }}</strong></td>
                <td class="monospace">{{ y.start_date }}</td>
                <td class="monospace">{{ y.end_date }}</td>
                <td>
                  <span class="badge" :class="y.status === 'open' ? 'green' : 'gray'">
                    {{ y.status === 'open' ? 'مفتوحة (الحالية)' : 'مقفلة' }}
                  </span>
                </td>
                <td class="monospace">{{ y.closed_at ? fmt.date(y.closed_at.slice(0, 10)) : '—' }}</td>
              </tr>
              <tr v-if="!years.length"><td colspan="5" class="muted">لا توجد سنوات مالية</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="confirmClose" class="modal-overlay" @click.self="confirmClose = false">
      <div class="modal" style="max-width:460px;border-top:4px solid var(--danger);">
        <h3>تأكيد إقفال السنة {{ activeYear.name }}</h3>
        <p>سيتم تنفيذ قيود الإقفال والترحيل بشكل نهائي ولا يمكن التراجع بعد الإقفال. هل أنت متأكد؟</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="confirmClose = false">تراجع</button>
          <button class="btn btn-danger" @click="doClose" :disabled="closing">{{ closing ? 'جارٍ الإقفال...' : 'نعم، إقفال وترحيل' }}</button>
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
        this.toast('تم حفظ الإعدادات');
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
        this.toast(saved.configured ? 'تم حفظ بيانات ZATCA وسيتم إرسال الفواتير تلقائياً عند الحفظ' : 'تم الحفظ. أضف بيانات الاعتماد (CSID) لتفعيل الإرسال التلقائي');
        await this.loadZatca();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.savingZatca = false; }
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>
    <div v-if="!can('settings', 'edit')" class="alert info">أنت تملك صلاحية العرض فقط لهذه النافذة — لا يمكنك تعديل البيانات أو إعدادات ZATCA.</div>
    <div class="panel" style="max-width:800px;">
      <div class="panel-header"><h3>بيانات الشركة والإعدادات</h3></div>
      <div class="panel-body">
        <div class="form-grid">
          <label class="span2">اسم الشركة / المنشأة <input v-model.trim="form.name"></label>
          <label>نوع النشاط
            <select v-model="form.business_type" disabled>
              <option v-for="t in [['corporate','شركة'],['supermarket','سوبر ماركت'],['factory','مصنع'],['medical_lab','مخبر طبي']]" :key="t[0]" :value="t[0]">{{ t[1] }}</option>
            </select>
          </label>
          <label>نسبة ضريبة القيمة المضافة (%) <input type="number" v-model.number="form.vat_rate" min="0" max="100"></label>
          <label>رقم السجل التجاري <input v-model.trim="form.cr_number" dir="ltr"></label>
          <label>الرقم الضريبي <input v-model.trim="form.vat_number" dir="ltr"></label>
          <label>العملة <input v-model.trim="form.currency"></label>
          <label>شهر بداية السنة المالية
            <select v-model.number="form.fiscal_year_start_month">
              <option :value="1">يناير</option><option :value="4">أبريل</option>
              <option :value="7">يوليو</option><option :value="10">أكتوبر</option>
            </select>
          </label>
          <label class="span2">العنوان <input v-model.trim="form.address"></label>
          <label>الهاتف <input v-model.trim="form.phone" dir="ltr"></label>
          <label>البريد الإلكتروني <input v-model.trim="form.email" dir="ltr"></label>
        </div>
        <div class="modal-actions">
          <button v-if="can('settings', 'edit')" class="btn btn-primary" @click="save" :disabled="saving">{{ saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات' }}</button>
        </div>
      </div>
    </div>

    <div class="panel" style="max-width:800px;border-top:4px solid var(--primary);">
      <div class="panel-header"><h3>الفاتورة الإلكترونية والربط مع هيئة الزكاة (ZATCA)</h3></div>
      <div class="panel-body">
        <div class="alert info">
          عند تفعيل هذه الإعدادات تُنشأ فاتورة إلكترونية متوافقة (QR + XML بصيغة UBL 2.1) وتُرسل تلقائياً إلى منظومة فاتورة الإلكترونية عند حفظ أي فاتورة بيع.
          للحصول على بيانات الاعتماد (CSID) يلزم التسجيل في بوابة هيئة الزكاة (Sandbox للتجربة ثم Production بعد اعتماد المنشأة).
          <ul style="margin-top:8px;padding-right:18px;">
            <li><strong>وضع Sandbox:</strong> للاختبار والتجربة (عنوان افتراضي sandbox.zatca.gov.sa).</li>
            <li><strong>وضع Production:</strong> للإنتاج الفعلي بعد الحصول على CSID الإنتاجي (عنوان افتراضي einvoice.zatca.gov.sa).</li>
            <li>مفتاح التشفير الخاص والشهادة (ECDSA P-256) يولّدان داخل المنشأة عند إنشاء شهادة CSID.</li>
          </ul>
        </div>

        <div v-if="zatca" class="flex flex-wrap" style="gap:8px;margin-bottom:14px;">
          <span class="badge" :class="zatca.active ? 'green' : 'gray'">{{ zatca.active ? 'التفعيل مفعّل' : 'غير مفعّل' }}</span>
          <span class="badge" :class="zatca.configured ? 'green' : 'yellow'">{{ zatca.configured ? 'جاهز للإرسال' : 'ينقص بيانات الاعتماد' }}</span>
          <span class="badge gray">{{ zatca.mode === 'production' ? 'وضع الإنتاج' : 'وضع التجربة (Sandbox)' }}</span>
        </div>

        <div class="form-grid">
          <label class="span2 flex" style="flex-direction:row;gap:8px;">
            <input type="checkbox" v-model="zatcaForm.active" style="width:auto;"> تفعيل الإرسال التلقائي إلى ZATCA
          </label>
          <label>الوضع
            <select v-model="zatcaForm.mode">
              <option value="sandbox">Sandbox (تجربة)</option>
              <option value="production">Production (إنتاج)</option>
            </select>
          </label>
          <label>عنوان منظومة فاتورة (اختياري)
            <input v-model.trim="zatcaForm.baseUrl" dir="ltr" placeholder="sandbox.zatca.gov.sa">
          </label>
          <label class="span2">رقم CSID (بيانات الاعتماد)
            <input v-model.trim="zatcaForm.csid" dir="ltr" placeholder="ألصق قيمة CSID (تُترك فارغة للاحتفاظ بالموجود)">
          </label>
          <label class="span2">المفتاح الخاص (PEM)
            <textarea v-model.trim="zatcaForm.privateKeyPem" dir="ltr" rows="3" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
          </label>
          <label class="span2">الشهادة (base64)
            <textarea v-model.trim="zatcaForm.certB64" dir="ltr" rows="2" placeholder="شهادة X.509 بصيغة base64"></textarea>
          </label>
          <label>رقم الجهاز (اختياري)
            <input v-model.trim="zatcaForm.deviceSerialNumber" dir="ltr" placeholder="Device Serial Number">
          </label>
          <label>OTP (للحصول على CSID امتثال في Sandbox)
            <input v-model.trim="zatcaForm.otp" dir="ltr" placeholder="رمز التحقق">
          </label>
        </div>

        <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;">
          <button v-if="can('settings', 'edit')" class="btn btn-primary" @click="saveZatca" :disabled="savingZatca">{{ savingZatca ? 'جارٍ الحفظ...' : 'حفظ إعدادات ZATCA' }}</button>
          <span class="muted" v-if="zatca && !zatca.csidSet">الرقم الضريبي للمنشأة يُقرأ من "بيانات الشركة" أعلاه.</span>
        </div>
      </div>
    </div>
  </div>
  `
};
