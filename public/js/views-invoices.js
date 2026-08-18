'use strict';

// ==================== الفواتير ====================
const InvoicesView = {
  name: 'InvoicesView',
  mixins: [CommonMixin],
  props: { kind: { type: String, required: true } },
  data() {
    return {
      invoices: [], parties: [], methods: [], loading: true, alert: null,
      showModal: false, saving: false, payModal: null, paying: false,
      detail: null, qrUrl: '', detailLoading: false,
      form: {}
    };
  },
  async created() { await this.load(); },
  computed: {
    isSale() { return this.kind === 'sale'; },
    title() { return this.isSale ? 'فواتير البيع' : 'فواتير الشراء'; },
    partyType() { return this.isSale ? 'customer' : 'supplier'; }
  },
  methods: {
    async load() {
      try {
        const [invoices, parties, methods] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/invoices?kind=${this.kind}`),
          this.api(`/api/companies/${this.company.id}/parties?type=${this.partyType}`),
          this.api(`/api/companies/${this.company.id}/payment-methods`)
        ]);
        this.invoices = invoices;
        this.parties = parties;
        this.methods = methods;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    openCreate() {
      this.form = {
        party_id: '', date: new Date().toISOString().slice(0, 10), vat_rate: Number(this.info.settings.vat_rate) || 15,
        payment_method: 'cash', paid_amount: null, discount: 0, notes: '',
        lines: [this.emptyLine()]
      };
      this.showModal = true;
    },
    emptyLine() { return { description: '', qty: 1, unit_price: null, discount: 0 }; },
    addLine() { this.form.lines.push(this.emptyLine()); },
    removeLine(i) { this.form.lines.splice(i, 1); },
    subTotal() { return this.form.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0) - (Number(l.discount) || 0), 0); },
    taxable() { return Math.max(this.subTotal() - (Number(this.form.discount) || 0), 0); },
    vatAmount() { return this.taxable() * (Number(this.form.vat_rate) || 0) / 100; },
    total() { return this.taxable() + this.vatAmount(); },
    canSave() {
      return this.form.party_id && this.form.lines.some(l => l.description && (Number(l.unit_price) || 0) > 0) && this.total() > 0;
    },
    async save() {
      this.saving = true;
      try {
        const body = {
          kind: this.kind, party_id: Number(this.form.party_id), date: this.form.date,
          vat_rate: Number(this.form.vat_rate), discount: Number(this.form.discount) || 0,
          payment_method: this.form.payment_method,
          paid_amount: this.form.paid_amount !== null ? Number(this.form.paid_amount) : undefined,
          notes: this.form.notes,
          lines: this.form.lines.map(l => ({ description: l.description, qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0, discount: Number(l.discount) || 0 }))
        };
        await this.api(`/api/companies/${this.company.id}/invoices`, { method: 'POST', body });
        this.toast('تم إنشاء الفاتورة وتسجيل القيد المحاسبي تلقائياً');
        this.showModal = false;
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    openPay(inv) {
      this.payModal = { inv, amount: (inv.total - inv.paid_amount).toFixed(2), method: 'cash' };
    },
    async doPay() {
      this.paying = true;
      try {
        await this.api(`/api/companies/${this.company.id}/invoices/${this.payModal.inv.id}/pay`, {
          method: 'POST', body: { amount: Number(this.payModal.amount), method: this.payModal.method, date: new Date().toISOString().slice(0, 10) }
        });
        this.toast('تم تسجيل الدفعة');
        this.payModal = null;
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.paying = false; }
    },
    remaining(inv) { return inv.total - inv.paid_amount; },
    async openDetail(inv) {
      this.detailLoading = true;
      this.detail = { ...inv, zatca: null };
      this.qrUrl = '';
      try {
        const z = await this.api(`/api/companies/${this.company.id}/invoices/${inv.id}/zatca`);
        this.detail.zatca = z;
        if (z.qr_data && typeof QRCode !== 'undefined') {
          this.qrUrl = await QRCode.toDataURL(z.qr_data, { width: 220, margin: 1 });
        }
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.detailLoading = false; }
    },
    downloadXml() {
      if (!this.detail || !this.detail.zatca || !this.detail.zatca.xml_data) return;
      const blob = new Blob([this.detail.zatca.xml_data], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.detail.invoice_no}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    },
    async resubmitZatca() {
      this.detailLoading = true;
      try {
        const inv = await this.api(`/api/companies/${this.company.id}/invoices/${this.detail.id}/resubmit`, { method: 'POST' });
        this.toast(inv.zatca_status === 'failed' ? 'فشل الإرسال إلى هيئة الزكاة: ' + (inv.zatca_response || '') : 'تم إرسال الفاتورة إلى هيئة الزكاة');
        this.detail = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.detailLoading = false; }
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between mb-2">
      <p class="muted">عدد الفواتير: {{ invoices.length }}</p>
      <button class="btn btn-primary" @click="openCreate">+ فاتورة {{ isSale ? 'بيع' : 'شراء' }} جديدة</button>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ title }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>رقم الفاتورة</th><th>{{ isSale ? 'العميل' : 'المورد' }}</th><th>التاريخ</th>
                <th>الإجمالي</th><th>الضريبة</th><th>طريقة الدفع</th><th>المدفوع</th><th>الحالة</th>
                <th v-if="isSale">الفاتورة الإلكترونية (ZATCA)</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in invoices" :key="i.id">
                <td class="monospace"><strong>{{ i.invoice_no }}</strong></td>
                <td>{{ i.party ? i.party.name : '—' }}</td>
                <td>{{ fmt.date(i.date) }}</td>
                <td class="num">{{ fmt.money(i.total) }}</td>
                <td class="num">{{ fmt.money(i.vat) }}</td>
                <td>{{ fmt.payMethod(i.payment_method, methods) }}</td>
                <td class="num">{{ fmt.money(i.paid_amount) }}</td>
                <td><span class="badge" :class="fmt.invStatus(i.status).c">{{ fmt.invStatus(i.status).t }}</span></td>
                <td v-if="isSale">
                  <span class="badge" :class="fmt.zatcaStatus(i.zatca_status).c">{{ fmt.zatcaStatus(i.zatca_status).t }}</span>
                </td>
                <td>
                  <button v-if="i.status !== 'paid'" class="btn btn-sm btn-primary" @click="openPay(i)">تحصيل / سداد</button>
                  <button v-if="isSale" class="btn btn-sm btn-ghost" @click="openDetail(i)">تفاصيل</button>
                </td>
              </tr>
              <tr v-if="!invoices.length"><td :colspan="isSale ? 10 : 9" class="muted">لا توجد فواتير بعد</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:920px;">
        <h3>فاتورة {{ isSale ? 'بيع' : 'شراء' }} جديدة</h3>
        <div class="form-grid">
          <label>{{ isSale ? 'العميل' : 'المورد' }}
            <select v-model="form.party_id">
              <option value="">اختر...</option>
              <option v-for="p in parties" :key="p.id" :value="p.id">{{ p.name }}{{ p.tax_id ? ' (' + p.tax_id + ')' : '' }}</option>
            </select>
          </label>
          <label>التاريخ <input type="date" v-model="form.date"></label>
          <label>نسبة الضريبة (%) <input type="number" v-model.number="form.vat_rate"></label>
          <label>طريقة الدفع
            <select v-model="form.payment_method">
              <option v-for="m in methods" :key="m.code" :value="m.code">{{ m.name }}</option>
            </select>
          </label>
          <label v-if="form.payment_method === 'credit' || form.payment_method === 'check'">المبلغ المدفوع الآن
            <input type="number" v-model.number="form.paid_amount" placeholder="0.00">
          </label>
          <label>الخصم على الفاتورة
            <input type="number" v-model.number="form.discount" placeholder="0.00">
          </label>
          <label class="span2">ملاحظات <input v-model.trim="form.notes"></label>
        </div>

        <div class="entry-lines mt-2">
          <div class="line-row line-head" style="grid-template-columns:1.6fr 90px 120px 120px 110px 40px;">
            <span>الوصف</span><span>الكمية</span><span>سعر الوحدة</span><span>خصم السطر</span><span>الإجمالي</span><span></span>
          </div>
          <div class="line-row" style="grid-template-columns:1.6fr 90px 120px 120px 110px 40px;" v-for="(l, idx) in form.lines" :key="idx">
            <input v-model.trim="l.description" placeholder="وصف الصنف / الخدمة...">
            <input type="number" v-model.number="l.qty" min="0">
            <input type="number" v-model.number="l.unit_price" min="0">
            <input type="number" v-model.number="l.discount" min="0">
            <span class="num">{{ fmt.money((Number(l.qty)||0) * (Number(l.unit_price)||0) - (Number(l.discount)||0)) }}</span>
            <button class="btn btn-sm btn-danger" @click="removeLine(idx)" v-if="form.lines.length > 1">✕</button>
          </div>
        </div>

        <div class="flex-between mt-2">
          <button class="btn btn-ghost" @click="addLine">+ إضافة صنف</button>
          <div style="text-align:left;">
            <div>الإجمالي قبل الضريبة: <strong class="monospace">{{ fmt.money(taxable()) }}</strong></div>
            <div>الضريبة ({{ form.vat_rate || 0 }}%): <strong class="monospace">{{ fmt.money(vatAmount()) }}</strong></div>
            <div style="font-size:16px;">الإجمالي: <strong class="monospace" style="color:var(--primary);">{{ fmt.money(total()) }}</strong></div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">إلغاء</button>
          <button class="btn btn-primary" @click="save" :disabled="!canSave || saving">{{ saving ? 'جارٍ الحفظ...' : 'حفظ الفاتورة' }}</button>
        </div>
      </div>
    </div>

    <div v-if="payModal" class="modal-overlay" @click.self="payModal = null">
      <div class="modal" style="max-width:420px;">
        <h3>{{ isSale ? 'تحصيل' : 'سداد' }} - {{ payModal.inv.invoice_no }}</h3>
        <div class="form-grid">
          <label>المبلغ
            <input type="number" v-model.number="payModal.amount" min="0" :max="remaining(payModal.inv)">
          </label>
          <label>طريقة الدفع
            <select v-model="payModal.method">
              <option v-for="m in methods" :key="m.code" :value="m.code">{{ m.name }}</option>
            </select>
          </label>
        </div>
        <p class="muted mt-2">الرصيد المتبقي: {{ fmt.money(remaining(payModal.inv)) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="payModal = null">إلغاء</button>
          <button class="btn btn-primary" @click="doPay" :disabled="paying || Number(payModal.amount) <= 0">تأكيد الدفع</button>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-overlay" @click.self="detail = null">
      <div class="modal" style="max-width:680px;">
        <h3>الفاتورة الإلكترونية - {{ detail.invoice_no }}</h3>
        <div v-if="detailLoading" class="muted">جارٍ التحميل...</div>
        <div v-else-if="detail.zatca">
          <div class="flex flex-wrap" style="gap:20px;align-items:flex-start;">
            <div style="text-align:center;">
              <img v-if="qrUrl" :src="qrUrl" alt="QR" style="border:1px solid #ddd;border-radius:8px;background:#fff;padding:6px;width:220px;height:220px;">
              <div v-else class="muted">لا يمكن عرض QR</div>
              <div class="muted" style="font-size:11px;max-width:220px;word-break:break-all;margin-top:6px;">{{ detail.zatca.qr_data }}</div>
            </div>
            <div style="flex:1;min-width:260px;">
              <table class="kv">
                <tr><td>رقم الفاتورة</td><td class="monospace">{{ detail.zatca.invoice_no }}</td></tr>
                <tr><td>معرّف الفاتورة (UUID)</td><td class="monospace" style="font-size:12px;">{{ detail.zatca.invoice_uuid || '—' }}</td></tr>
                <tr><td>تاريخ/وقت الإصدار</td><td class="monospace">{{ detail.zatca.issue_datetime || '—' }}</td></tr>
                <tr><td>نوع الفاتورة</td><td>{{ fmt.zatcaType(detail.zatca.invoice_type) }}</td></tr>
                <tr><td>تجزئة الفاتورة</td><td class="monospace" style="font-size:11px;word-break:break-all;">{{ detail.zatca.zatca_hash || '—' }}</td></tr>
                <tr><td>حالة الإرسال</td><td><span class="badge" :class="fmt.zatcaStatus(detail.zatca.zatca_status).c">{{ fmt.zatcaStatus(detail.zatca.zatca_status).t }}</span></td></tr>
                <tr v-if="detail.zatca.zatca_submitted_at"><td>تاريخ الإرسال</td><td class="monospace">{{ detail.zatca.zatca_submitted_at }}</td></tr>
                <tr v-if="detail.zatca.zatca_response && detail.zatca.zatca_status !== 'submitted' && detail.zatca.zatca_status !== 'cleared'">
                  <td>ملاحظة النظام</td><td class="muted" style="font-size:12px;">{{ detail.zatca.zatca_response }}</td>
                </tr>
              </table>
              <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-ghost" @click="downloadXml" :disabled="!detail.zatca.xml_data">تحميل XML</button>
                <button class="btn btn-sm btn-primary" @click="resubmitZatca" :disabled="detailLoading">{{ detailLoading ? 'جارٍ الإرسال...' : 'إعادة الإرسال إلى ZATCA' }}</button>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="detail = null">إغلاق</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ==================== العملاء والموردون ====================
const PartiesView = {
  name: 'PartiesView',
  mixins: [CommonMixin],
  data() {
    return {
      type: 'customer', parties: [], loading: true, alert: null,
      showModal: false, editing: null, form: {}
    };
  },
  async created() { await this.load(); },
  methods: {
    async load() {
      try { this.parties = await this.api(`/api/companies/${this.company.id}/parties?type=${this.type}`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    setType(t) { this.type = t; this.load(); },
    openCreate() {
      this.editing = null;
      this.form = { type: this.type, name: '', tax_id: '', phone: '', email: '', address: '', opening_balance: 0 };
      this.showModal = true;
    },
    openEdit(p) {
      this.editing = p;
      this.form = { type: this.type, name: p.name, tax_id: p.tax_id, phone: p.phone, email: p.email, address: p.address, opening_balance: p.opening_balance };
      this.showModal = true;
    },
    async save() {
      try {
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/parties/${this.editing.id}`, { method: 'PUT', body: this.form });
          this.toast('تم التحديث');
        } else {
          await this.api(`/api/companies/${this.company.id}/parties`, { method: 'POST', body: this.form });
          this.toast('تمت الإضافة');
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    }
  },
  computed: {
    title() { return this.type === 'customer' ? 'العملاء' : 'الموردون'; }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex">
        <button class="btn" :class="type === 'customer' ? 'btn-primary' : 'btn-ghost'" @click="setType('customer')">👥 العملاء</button>
        <button class="btn" :class="type === 'supplier' ? 'btn-primary' : 'btn-ghost'" @click="setType('supplier')">🚚 الموردون</button>
      </div>
      <button class="btn btn-primary" @click="openCreate">+ {{ type === 'customer' ? 'عميل' : 'مورد' }} جديد</button>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ title }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>الاسم</th><th>الرقم الضريبي</th><th>الهاتف</th><th>البريد</th><th>المستحقات</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="p in parties" :key="p.id">
                <td><strong>{{ p.name }}</strong></td>
                <td class="monospace">{{ p.tax_id || '—' }}</td>
                <td dir="ltr" style="text-align:right;">{{ p.phone || '—' }}</td>
                <td dir="ltr" style="text-align:right;">{{ p.email || '—' }}</td>
                <td class="num">{{ fmt.money(p.outstanding || 0) }}</td>
                <td><button class="btn btn-sm btn-ghost" @click="openEdit(p)">تعديل</button></td>
              </tr>
              <tr v-if="!parties.length"><td colspan="6" class="muted">لا يوجد {{ type === 'customer' ? 'عملاء' : 'موردون' }} بعد</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal">
        <h3>{{ editing ? 'تعديل' : 'إضافة' }} {{ type === 'customer' ? 'عميل' : 'مورد' }}</h3>
        <div class="form-grid">
          <label class="span2">الاسم <input v-model.trim="form.name"></label>
          <label>الرقم الضريبي <input v-model.trim="form.tax_id" dir="ltr" placeholder="رقم ضريبي للمنشأة"></label>
          <label>الهاتف <input v-model.trim="form.phone" dir="ltr"></label>
          <label class="span2">البريد الإلكتروني <input v-model.trim="form.email" dir="ltr"></label>
          <label class="span2">العنوان <input v-model.trim="form.address"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">إلغاء</button>
          <button class="btn btn-primary" @click="save" :disabled="!form.name">حفظ</button>
        </div>
      </div>
    </div>
  </div>
  `
};
