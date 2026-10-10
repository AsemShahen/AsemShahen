'use strict';

// ==================== الفواتير ====================
const InvoicesView = {
  name: 'InvoicesView',
  mixins: [CommonMixin, WaSendMixin],
  props: { kind: { type: String, required: true } },
  data() {
    return {
      invoices: [], parties: [], methods: [], products: [], warehouses: [], branches: [], currencies: [],
      loading: true, alert: null, filter: '', branchFilter: '', barcodeInput: '',
      showModal: false, saving: false, payModal: null, paying: false,
      detail: null, qrUrl: '', detailLoading: false, detailReq: 0,
      form: {}
    };
  },
  async created() { await this.load(); },
  watch: {
    'form.branch_id'(id) {
      const b = this.branches.find(x => Number(x.id) === Number(id));
      if (!b) return;
      if (b.tax_rate_effective !== undefined && b.tax_rate_effective !== null) this.form.vat_rate = Number(b.tax_rate_effective);
      const w = this.warehouses.find(w => Number(w.branch_id) === Number(id));
      if (w && !this.warehouses.some(x => Number(x.id) === Number(this.form.warehouse_id) && Number(x.branch_id) === Number(id))) {
        this.form.warehouse_id = w.id;
      }
      if (!this.form.currency) this.applyCurrency(b.currency || this.formTaxMeta.currency);
    },
    'form.currency'(code) { this.applyCurrency(code); }
  },
  computed: {
    isSale() { return this.kind === 'sale'; },
    title() { return this.isSale ? t('فواتير البيع') : t('فواتير الشراء'); },
    partyType() { return this.isSale ? 'customer' : 'supplier'; },
    win() { return this.isSale ? 'invoices-sale' : 'invoices-purchase'; },
    formBranch() { return this.branches.find(b => Number(b.id) === Number(this.form.branch_id)) || null; },
    formTaxMeta() { return taxCountryMeta(this.formBranch ? this.formBranch.tax_country : 'SA'); },
    formCurrency() { return this.form.currency || (this.formBranch ? (this.formBranch.currency || this.formTaxMeta.currency) : this.baseCurrency); },
    formRate() { return Number(this.form.exchange_rate) || 1; },
    baseTotal() { return this.total() * this.formRate; },
    branchWarehouses() {
      if (!this.form.branch_id) return this.warehouses;
      return this.warehouses.filter(w => Number(w.branch_id) === Number(this.form.branch_id));
    },
    filteredInvoices() {
      let list = this.invoices;
      if (this.branchFilter) list = list.filter(i => Number(i.branch_id) === Number(this.branchFilter));
      const f = this.filter.trim();
      if (!f) return list;
      return list.filter(i =>
        i.invoice_no.includes(f) ||
        (i.party && i.party.name.includes(f)) ||
        (i.party && i.party.tax_id && i.party.tax_id.includes(f)));
    }
  },
  methods: {
    branchName(id) {
      const b = this.branches.find(x => Number(x.id) === Number(id));
      return b ? b.name : '—';
    },
    einvoiceStatusOf(i) {
      const p = fmt.einvoiceProvider(i.tax_country);
      if (p === 'jofotara') return i.jo_status;
      if (p === 'egypt') return i.eg_status;
      if (p === 'zatca') return i.zatca_status;
      return null;
    },
    async load() {
      try {
        const [invoices, parties, methods, products, warehouses, branches, curr] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/invoices?kind=${this.kind}`),
          this.api(`/api/companies/${this.company.id}/parties?type=${this.partyType}`),
          this.api(`/api/companies/${this.company.id}/payment-methods`),
          this.api(`/api/companies/${this.company.id}/products`),
          this.api(`/api/companies/${this.company.id}/warehouses`),
          this.api(`/api/companies/${this.company.id}/branches`).catch(() => []),
          this.api(`/api/companies/${this.company.id}/currencies`).catch(() => null)
        ]);
        this.invoices = invoices;
        this.parties = parties;
        this.methods = methods;
        this.products = products;
        this.warehouses = warehouses;
        this.branches = branches || [];
        this.currencies = (curr && curr.currencies) ? curr.currencies.filter(c => c.is_active) : [];
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    rateFor(code) {
      const c = String(code || '').toUpperCase();
      if (c === this.baseCurrency) return 1;
      const row = this.currencies.find(x => x.code === c);
      return row ? Number(row.rate) || 1 : 1;
    },
    applyCurrency(code) {
      this.form.exchange_rate = this.rateFor(code);
    },
    async sendWhatsApp(i) {
      await this.askWhatsApp({ type: 'invoice', kind: this.kind, invoiceId: i.id });
    },
    openCreate() {
      const def = this.branches.find(b => b.is_default) || this.branches[0];
      const defRate = def && def.tax_rate_effective !== undefined && def.tax_rate_effective !== null
        ? Number(def.tax_rate_effective)
        : (Number(this.info.settings.vat_rate) || 15);
      this.form = {
        party_id: '', date: new Date().toISOString().slice(0, 10), vat_rate: defRate,
        payment_method: 'cash', paid_amount: null, discount: 0, notes: '',
        branch_id: def ? def.id : '',
        currency: def ? (def.currency || '') : this.baseCurrency,
        exchange_rate: def && def.currency ? this.rateFor(def.currency) : 1,
        warehouse_id: this.warehouses.length ? this.warehouses[0].id : '',
        lines: [this.emptyLine()]
      };
      this.barcodeInput = '';
      this.showModal = true;
      this.$nextTick(() => { const el = this.$refs.barcodeInput; if (el) el.focus(); });
    },
    emptyLine() { return { product_id: '', description: '', qty: 1, unit_price: null, discount: 0 }; },
    lineProduct(l) { return this.products.find(p => String(p.id) === String(l.product_id)); },
    selectProduct(l) {
      const p = this.lineProduct(l);
      if (!p) return;
      l.description = p.name;
      l.unit_price = this.isSale ? Number(p.sale_price) : Number(p.purchase_price);
    },
    async addByBarcode() {
      const code = this.barcodeInput.trim();
      if (!code) return;
      this.barcodeInput = '';
      let product = this.products.find(p => p.barcode && p.barcode === code);
      if (!product) {
        try { product = await this.api(`/api/companies/${this.company.id}/products/barcode/${encodeURIComponent(code)}`); }
        catch (e) { this.toast(t('لا يوجد منتج بهذا الباركود: {code}', { code }), 'error'); return; }
      }
      const line = this.emptyLine();
      line.product_id = product.id;
      line.description = product.name;
      line.unit_price = this.isSale ? Number(product.sale_price) : Number(product.purchase_price);
      this.form.lines.push(line);
    },
    addLine() { this.form.lines.push(this.emptyLine()); },
    removeLine(i) { this.form.lines.splice(i, 1); },
    subTotal() { return this.form.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0) - (Number(l.discount) || 0), 0); },
    taxable() { return Math.max(this.subTotal() - (Number(this.form.discount) || 0), 0); },
    vatAmount() { return this.taxable() * (Number(this.form.vat_rate) || 0) / 100; },
    total() { return this.taxable() + this.vatAmount(); },
    canSave() {
      return !!(this.form.party_id && this.form.lines.some(l => l.description && (Number(l.unit_price) || 0) > 0) && this.total() > 0);
    },
    async save() {
      if (this.saving) return;
      if (!this.canSave()) { this.toast(t('أكمل بيانات الفاتورة أولاً'), 'error'); return; }
      this.saving = true;
      try {
        const body = {
          kind: this.kind, party_id: Number(this.form.party_id), date: this.form.date,
          vat_rate: Number(this.form.vat_rate), discount: Number(this.form.discount) || 0,
          payment_method: this.form.payment_method,
          paid_amount: this.form.paid_amount !== null ? Number(this.form.paid_amount) : undefined,
          notes: this.form.notes,
          branch_id: this.form.branch_id ? Number(this.form.branch_id) : undefined,
          currency: this.formCurrency,
          exchange_rate: this.formRate,
          lines: this.form.lines.map(l => ({ product_id: l.product_id ? Number(l.product_id) : undefined, warehouse_id: this.form.warehouse_id ? Number(this.form.warehouse_id) : undefined, description: l.description, qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0, discount: Number(l.discount) || 0 }))
        };
        await this.api(`/api/companies/${this.company.id}/invoices`, { method: 'POST', body });
        this.toast(t('تم إنشاء الفاتورة وتسجيل القيد المحاسبي تلقائياً'));
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
        this.toast(t('تم تسجيل الدفعة'));
        this.payModal = null;
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.paying = false; }
    },
    remaining(inv) { return inv.total - inv.paid_amount; },
    async openDetail(inv) {
      const reqId = ++this.detailReq;
      this.detailLoading = true;
      this.detail = { ...inv, zatca: null, jo: null, eg: null };
      this.qrUrl = '';
      try {
        const provider = fmt.einvoiceProvider(inv.tax_country);
        if (provider === 'jofotara') {
          const j = await this.api(`/api/companies/${this.company.id}/invoices/${inv.id}/jofotara`);
          if (reqId !== this.detailReq) return;
          this.detail.jo = j;
          if (j.jo_qr && typeof QRCode !== 'undefined') {
            try { this.qrUrl = await QRCode.toDataURL(j.jo_qr, { width: 220, margin: 1 }); } catch (e) { /* QR اختياري */ }
          }
        } else if (provider === 'egypt') {
          const g = await this.api(`/api/companies/${this.company.id}/invoices/${inv.id}/egypt`);
          if (reqId !== this.detailReq) return;
          this.detail.eg = g;
          if (g.eg_qr && typeof QRCode !== 'undefined') {
            try { this.qrUrl = await QRCode.toDataURL(g.eg_qr, { width: 220, margin: 1 }); } catch (e) { /* QR اختياري */ }
          }
        } else if (provider === 'zatca') {
          const z = await this.api(`/api/companies/${this.company.id}/invoices/${inv.id}/zatca`);
          if (reqId !== this.detailReq) return;
          this.detail.zatca = z;
          if (z.qr_data && typeof QRCode !== 'undefined') {
            this.qrUrl = await QRCode.toDataURL(z.qr_data, { width: 220, margin: 1 });
          }
        }
      } catch (e) { if (reqId === this.detailReq) this.toast(e.message, 'error'); }
      finally { if (reqId === this.detailReq) this.detailLoading = false; }
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
    downloadJoPayload() {
      if (!this.detail || !this.detail.jo || !this.detail.jo.payload) return;
      const blob = new Blob([JSON.stringify(this.detail.jo.payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.detail.invoice_no}-jofotara.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    downloadEgPayload() {
      if (!this.detail || !this.detail.eg || !this.detail.eg.payload) return;
      const blob = new Blob([JSON.stringify(this.detail.eg.payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.detail.invoice_no}-eta.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    async resubmitZatca() {
      this.detailLoading = true;
      try {
        const inv = await this.api(`/api/companies/${this.company.id}/invoices/${this.detail.id}/resubmit`, { method: 'POST' });
        const provider = fmt.einvoiceProvider(this.detail.tax_country);
        if (provider === 'jofotara') {
          this.toast(inv.jo_status === 'failed' ? t('فشل الإرسال إلى JoFotara: {msg}', { msg: inv.jo_response || '' }) : t('تم إرسال الفاتورة إلى JoFotara'));
        } else if (provider === 'egypt') {
          this.toast(inv.eg_status === 'failed' ? t('فشل الإرسال إلى ETA: {msg}', { msg: inv.eg_response || '' }) : t('تم إرسال الفاتورة إلى ETA'));
        } else {
          this.toast(inv.zatca_status === 'failed' ? t('فشل الإرسال إلى هيئة الزكاة: {msg}', { msg: inv.zatca_response || '' }) : t('تم إرسال الفاتورة إلى هيئة الزكاة'));
        }
        this.detail = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.detailLoading = false; }
    },
    preview() {
      const rows = this.filteredInvoices.map(i => [
        i.invoice_no, i.party ? i.party.name : '—', i.date,
        this.fmt.money(i.total), this.fmt.money(i.vat),
        this.fmt.payMethod(i.payment_method, this.methods),
        this.fmt.money(i.paid_amount), this.fmt.invStatus(i.status).t
      ]);
      this.openPrintPreview({
        title: this.title,
        sub: `${this.company.name} - ${t('السنة المالية {fy}', { fy: this.info.active_fiscal_year ? this.info.active_fiscal_year.name : '' })}`,
        cols: [t('رقم الفاتورة'), t('الطرف'), t('التاريخ'), t('الإجمالي'), t('الضريبة'), t('طريقة الدفع'), t('المدفوع'), t('الحالة')],
        rows
      });
    },
    exportData() {
      const rows = this.filteredInvoices.map(i => [
        i.invoice_no, i.party ? i.party.name : '', i.date,
        this.fmt.num(i.total), this.fmt.num(i.vat), i.payment_method,
        this.fmt.num(i.paid_amount), i.status
      ]);
      this.exportCsv(`invoices-${this.kind}-${this.company.id}`, ['invoice_no', 'party', 'date', 'total', 'vat', 'payment_method', 'paid', 'status'], rows);
    },
    importData() {
      this.importJsonFile(async (data) => {
        const items = Array.isArray(data) ? data : (data.invoices || []);
        if (!items.length) return this.toast(t('لا توجد فواتير في الملف'), 'error');
        let ok = 0, fail = 0;
        for (const it of items) {
          try {
            let partyId = null;
            if (it.party_name) {
              const p = this.parties.find(x => x.name === it.party_name);
              if (!p) throw new Error(t('طرف غير موجود: {name}', { name: it.party_name }));
              partyId = p.id;
            }
            await this.api(`/api/companies/${this.company.id}/invoices`, {
              method: 'POST',
              body: {
                kind: it.kind || this.kind,
                party_id: partyId,
                date: it.date,
                vat_rate: Number(it.vat_rate) || Number(this.info.settings.vat_rate) || 15,
                discount: Number(it.discount) || 0,
                payment_method: it.payment_method || 'cash',
                paid_amount: it.paid_amount !== undefined ? Number(it.paid_amount) : undefined,
                notes: it.notes || '',
                lines: (it.lines || []).map(l => ({
                  description: l.description,
                  qty: Number(l.qty) || 1,
                  unit_price: Number(l.unit_price) || 0,
                  discount: Number(l.discount) || 0
                }))
              }
            });
            ok++;
          } catch (e) { fail++; }
        }
        this.toast(t('تم استيراد {ok} فاتورة، فشل {fail}', { ok, fail }));
        await this.load();
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input v-if="can(win, 'search')" :placeholder="t('بحث برقم الفاتورة أو الطرف أو الرقم الضريبي...')" v-model="filter" style="min-width:260px;">
        <select v-if="branches.length" v-model="branchFilter" style="min-width:160px;">
          <option value="">{{ t('كل الفروع') }}</option>
          <option v-for="b in branches" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
        <p class="muted">{{ t('عدد الفواتير: {n}', { n: filteredInvoices.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button v-if="can(win, 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button v-if="can(win, 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can(win, 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ {{ t('تصدير CSV') }}</button>
        <button v-if="can(win, 'import')" class="btn btn-sm btn-ghost" @click="importData">⬆️ {{ t('استيراد JSON') }}</button>
        <button v-if="can(win, 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('فاتورة') }} {{ isSale ? t('بيع') : t('شراء') }} {{ t('جديدة') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ title }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('رقم الفاتورة') }}</th><th>{{ isSale ? t('العميل') : t('المورد') }}</th><th>{{ t('الفرع') }}</th><th>{{ t('التاريخ') }}</th>
                <th>{{ t('الإجمالي') }}</th><th>{{ t('المعادل') }} ({{ baseSymbol }})</th><th>{{ t('الضريبة') }}</th><th>{{ t('طريقة الدفع') }}</th><th>{{ t('المدفوع') }}</th><th>{{ t('الحالة') }}</th>
                <th v-if="isSale">{{ t('الفاتورة الإلكترونية') }}</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in filteredInvoices" :key="i.id">
                <td class="monospace"><strong>{{ i.invoice_no }}</strong></td>
                <td>{{ i.party ? i.party.name : '—' }}</td>
                <td>{{ branchName(i.branch_id) }}</td>
                <td>{{ fmt.date(i.date) }}</td>
                <td class="num">{{ fmt.moneyFor(i.total, i.currency) }}</td>
                <td class="num">{{ fmt.money(i.base_total, baseSymbol) }}</td>
                <td class="num">{{ fmt.moneyFor(i.vat, i.currency) }}</td>
                <td>{{ fmt.payMethod(i.payment_method, methods) }}</td>
                <td class="num">{{ fmt.moneyFor(i.paid_amount, i.currency) }}</td>
                <td><span class="badge" :class="fmt.invStatus(i.status).c">{{ fmt.invStatus(i.status).t }}</span></td>
                <td v-if="isSale">
                  <span v-if="fmt.hasEinvoice(i.tax_country)" class="badge" :class="fmt.einvoiceStatus(i.tax_country, einvoiceStatusOf(i)).c">{{ fmt.einvoiceStatus(i.tax_country, einvoiceStatusOf(i)).t }}</span>
                  <span v-else class="muted">—</span>
                </td>
                <td>
                  <button v-if="i.status !== 'paid' && can(win, 'edit')" class="btn btn-sm btn-primary" @click="openPay(i)">{{ t('تحصيل / سداد') }}</button>
                  <button v-if="i.party && i.party.phone" class="btn btn-sm btn-ghost" @click="sendWhatsApp(i)">💬 {{ t('واتساب') }}</button>
                  <button v-if="isSale && fmt.hasEinvoice(i.tax_country)" class="btn btn-sm btn-ghost" @click="openDetail(i)">{{ t('تفاصيل') }}</button>
                </td>
              </tr>
              <tr v-if="!invoices.length"><td :colspan="isSale ? 12 : 11" class="muted">{{ t('لا توجد فواتير بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:920px;">
        <h3>{{ t('فاتورة') }} {{ isSale ? t('بيع') : t('شراء') }} {{ t('جديدة') }}</h3>
        <div class="form-grid">
          <label>{{ isSale ? t('العميل') : t('المورد') }}
            <select v-model="form.party_id">
              <option value="">{{ t('اختر...') }}</option>
              <option v-for="p in parties" :key="p.id" :value="p.id">{{ p.name }}{{ p.tax_id ? ' (' + p.tax_id + ')' : '' }}</option>
            </select>
          </label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="form.date"></label>
          <label v-if="branches.length">{{ t('الفرع') }}
            <select v-model="form.branch_id">
              <option value="">{{ t('الافتراضي') }}</option>
              <option v-for="b in branches" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </label>
          <label>{{ t('نسبة الضريبة (%)') }} <input type="number" v-model.number="form.vat_rate"></label>
          <label class="span2" v-if="formBranch">
            <span class="muted" style="font-size:12px;">{{ t('نظام الضريبة') }}: {{ t(formTaxMeta.label) }} ({{ form.vat_rate || 0 }}%)</span>
          </label>
          <label>{{ t('العملة') }}
            <select v-model="form.currency">
              <option v-if="!currencies.some(c => c.code === baseCurrency)" :value="baseCurrency">{{ baseCurrency }} - {{ t('أساسية') }}</option>
              <option v-for="c in currencies" :key="c.code" :value="c.code">{{ c.code }} - {{ c.name }}</option>
            </select>
          </label>
          <label>{{ t('سعر الصرف مقابل {x}', { x: baseCurrency }) }}
            <input type="number" step="0.000001" v-model.number="form.exchange_rate" :disabled="formCurrency === baseCurrency">
          </label>
          <label>{{ t('طريقة الدفع') }}
            <select v-model="form.payment_method">
              <option v-for="m in methods" :key="m.code" :value="m.code">{{ m.name }}</option>
            </select>
          </label>
          <label v-if="form.payment_method === 'credit' || form.payment_method === 'check'">{{ t('المبلغ المدفوع الآن') }}
            <input type="number" v-model.number="form.paid_amount" placeholder="0.00">
          </label>
          <label>{{ t('الخصم على الفاتورة') }}
            <input type="number" v-model.number="form.discount" placeholder="0.00">
          </label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="form.notes"></label>
        </div>

        <div v-if="warehouses.length" class="form-grid mt-2">
          <label class="span2">{{ t('المستودع') }}
            <select v-model="form.warehouse_id">
              <option v-for="w in branchWarehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </label>
        </div>

        <div class="barcode-add mt-2">
          <input ref="barcodeInput" v-model.trim="barcodeInput" @keyup.enter="addByBarcode" :placeholder="t('امسح الباركود لإضافة صنف تلقائياً...')" dir="ltr" style="flex:1;">
          <button class="btn btn-sm btn-primary" @click="addByBarcode">{{ t('إضافة بالباركود') }}</button>
        </div>

        <div class="entry-lines mt-2">
          <div class="line-row line-head" style="grid-template-columns:1.3fr 1.1fr 80px 110px 100px 100px 36px;">
            <span>{{ t('المنتج') }}</span><span>{{ t('الوصف') }}</span><span>{{ t('الكمية') }}</span><span>{{ t('سعر الوحدة') }}</span><span>{{ t('خصم السطر') }}</span><span>{{ t('الإجمالي') }}</span><span></span>
          </div>
          <div class="line-row" style="grid-template-columns:1.3fr 1.1fr 80px 110px 100px 100px 36px;" v-for="(l, idx) in form.lines" :key="idx">
            <select v-model="l.product_id" @change="selectProduct(l)">
              <option value="">{{ t('اختر...') }}</option>
              <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}{{ p.barcode ? ' (' + p.barcode + ')' : '' }}</option>
            </select>
            <input v-model.trim="l.description" :placeholder="t('وصف الصنف / الخدمة...')">
            <input type="number" v-model.number="l.qty" min="0">
            <input type="number" v-model.number="l.unit_price" min="0">
            <input type="number" v-model.number="l.discount" min="0">
            <span class="num">{{ fmt.moneyFor((Number(l.qty)||0) * (Number(l.unit_price)||0) - (Number(l.discount)||0), formCurrency) }}</span>
            <button class="btn btn-sm btn-danger" @click="removeLine(idx)" v-if="form.lines.length > 1">✕</button>
          </div>
        </div>

        <div class="flex-between mt-2">
          <button class="btn btn-ghost" @click="addLine">+ {{ t('إضافة صنف') }}</button>
          <div style="text-align:left;">
            <div>{{ t('الإجمالي قبل الضريبة:') }} <strong class="monospace">{{ fmt.moneyFor(taxable(), formCurrency) }}</strong></div>
            <div>{{ t('الضريبة ({rate}%):', { rate: form.vat_rate || 0 }) }} <strong class="monospace">{{ fmt.moneyFor(vatAmount(), formCurrency) }}</strong></div>
            <div style="font-size:16px;">{{ t('الإجمالي:') }} <strong class="monospace" style="color:var(--primary);">{{ fmt.moneyFor(total(), formCurrency) }}</strong></div>
            <div v-if="formCurrency !== baseCurrency" class="muted" style="font-size:12px;">{{ t('المعادل بالعملة الأساسية:') }} <strong class="monospace">{{ fmt.money(baseTotal, baseSymbol) }}</strong></div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="!canSave() || saving">{{ saving ? t('جارٍ الحفظ...') : t('حفظ الفاتورة') }}</button>
        </div>
      </div>
    </div>

    <div v-if="payModal" class="modal-overlay" @click.self="payModal = null">
      <div class="modal" style="max-width:420px;">
        <h3>{{ isSale ? t('تحصيل') : t('سداد') }} - {{ payModal.inv.invoice_no }}</h3>
        <div class="form-grid">
          <label>{{ t('المبلغ') }}
            <input type="number" v-model.number="payModal.amount" min="0" :max="remaining(payModal.inv)">
          </label>
          <label>{{ t('طريقة الدفع') }}
            <select v-model="payModal.method">
              <option v-for="m in methods" :key="m.code" :value="m.code">{{ m.name }}</option>
            </select>
          </label>
        </div>
        <p class="muted mt-2">{{ t('الرصيد المتبقي:') }} {{ fmt.money(remaining(payModal.inv)) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="payModal = null">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="doPay" :disabled="paying || Number(payModal.amount) <= 0">{{ t('تأكيد الدفع') }}</button>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-overlay" @click.self="detail = null">
      <div class="modal" style="max-width:680px;">
        <h3>{{ t('الفاتورة الإلكترونية - {no}', { no: detail.invoice_no }) }}</h3>
        <div v-if="detailLoading" class="muted">{{ t('جاري التحميل...') }}</div>
        <div v-else-if="detail.zatca">
          <div class="flex flex-wrap" style="gap:20px;align-items:flex-start;">
            <div style="text-align:center;">
              <img v-if="qrUrl" :src="qrUrl" alt="QR" style="border:1px solid #ddd;border-radius:8px;background:#fff;padding:6px;width:220px;height:220px;">
              <div v-else class="muted">{{ t('لا يمكن عرض QR') }}</div>
              <div class="muted" style="font-size:11px;max-width:220px;word-break:break-all;margin-top:6px;">{{ detail.zatca.qr_data }}</div>
            </div>
            <div style="flex:1;min-width:260px;">
              <table class="kv">
                <tr><td>{{ t('رقم الفاتورة') }}</td><td class="monospace">{{ detail.zatca.invoice_no }}</td></tr>
                <tr><td>{{ t('معرّف الفاتورة (UUID)') }}</td><td class="monospace" style="font-size:12px;">{{ detail.zatca.invoice_uuid || '—' }}</td></tr>
                <tr><td>{{ t('تاريخ/وقت الإصدار') }}</td><td class="monospace">{{ detail.zatca.issue_datetime || '—' }}</td></tr>
                <tr><td>{{ t('نوع الفاتورة') }}</td><td>{{ fmt.zatcaType(detail.zatca.invoice_type) }}</td></tr>
                <tr><td>{{ t('تجزئة الفاتورة') }}</td><td class="monospace" style="font-size:11px;word-break:break-all;">{{ detail.zatca.zatca_hash || '—' }}</td></tr>
                <tr><td>{{ t('حالة الإرسال') }}</td><td><span class="badge" :class="fmt.zatcaStatus(detail.zatca.zatca_status).c">{{ fmt.zatcaStatus(detail.zatca.zatca_status).t }}</span></td></tr>
                <tr v-if="detail.zatca.zatca_submitted_at"><td>{{ t('تاريخ الإرسال') }}</td><td class="monospace">{{ detail.zatca.zatca_submitted_at }}</td></tr>
                <tr v-if="detail.zatca.zatca_response && detail.zatca.zatca_status !== 'submitted' && detail.zatca.zatca_status !== 'cleared'">
                  <td>{{ t('ملاحظة النظام') }}</td><td class="muted" style="font-size:12px;">{{ detail.zatca.zatca_response }}</td>
                </tr>
              </table>
              <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-ghost" @click="downloadXml" :disabled="!detail.zatca.xml_data">{{ t('تحميل XML') }}</button>
                <button v-if="detail.party && detail.party.phone" class="btn btn-sm btn-ghost" @click="sendWhatsApp(detail)">💬 {{ t('إرسال عبر واتساب') }}</button>
                <button v-if="can('invoices-sale', 'edit')" class="btn btn-sm btn-primary" @click="resubmitZatca" :disabled="detailLoading">{{ detailLoading ? t('جارٍ الإرسال...') : t('إعادة الإرسال إلى ZATCA') }}</button>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="detail.jo">
          <div class="flex flex-wrap" style="gap:20px;align-items:flex-start;">
            <div style="text-align:center;">
              <img v-if="qrUrl" :src="qrUrl" alt="QR" style="border:1px solid #ddd;border-radius:8px;background:#fff;padding:6px;width:220px;height:220px;">
              <div v-else class="muted">{{ t('لا يمكن عرض QR (يُستلم من JoFotara بعد الإرسال)') }}</div>
            </div>
            <div style="flex:1;min-width:260px;">
              <table class="kv">
                <tr><td>{{ t('رقم الفاتورة') }}</td><td class="monospace">{{ detail.jo.invoice_no }}</td></tr>
                <tr><td>{{ t('نظام الضريبة') }}</td><td>{{ t('ضريبة المبيعات') }}</td></tr>
                <tr><td>{{ t('معرّف الفاتورة (UUID)') }}</td><td class="monospace" style="font-size:12px;">{{ detail.jo.jo_uuid || '—' }}</td></tr>
                <tr><td>{{ t('حالة الإرسال') }}</td><td><span class="badge" :class="fmt.joStatus(detail.jo.jo_status).c">{{ fmt.joStatus(detail.jo.jo_status).t }}</span></td></tr>
                <tr v-if="detail.jo.jo_submitted_at"><td>{{ t('تاريخ الإرسال') }}</td><td class="monospace">{{ detail.jo.jo_submitted_at }}</td></tr>
                <tr v-if="detail.jo.jo_response && detail.jo.jo_status !== 'submitted'">
                  <td>{{ t('ملاحظة النظام') }}</td><td class="muted" style="font-size:12px;">{{ detail.jo.jo_response }}</td>
                </tr>
              </table>
              <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-ghost" @click="downloadJoPayload" :disabled="!detail.jo.payload">{{ t('تحميل حمولة الفاتورة (JSON)') }}</button>
                <button v-if="detail.party && detail.party.phone" class="btn btn-sm btn-ghost" @click="sendWhatsApp(detail)">💬 {{ t('إرسال عبر واتساب') }}</button>
                <button v-if="can('invoices-sale', 'edit')" class="btn btn-sm btn-primary" @click="resubmitZatca" :disabled="detailLoading">{{ detailLoading ? t('جارٍ الإرسال...') : t('إعادة الإرسال إلى JoFotara') }}</button>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="detail.eg">
          <div class="flex flex-wrap" style="gap:20px;align-items:flex-start;">
            <div style="text-align:center;">
              <img v-if="qrUrl" :src="qrUrl" alt="QR" style="border:1px solid #ddd;border-radius:8px;background:#fff;padding:6px;width:220px;height:220px;">
              <div v-else class="muted">{{ t('لا يمكن عرض QR (يُستلم من ETA بعد الإرسال)') }}</div>
            </div>
            <div style="flex:1;min-width:260px;">
              <table class="kv">
                <tr><td>{{ t('رقم الفاتورة') }}</td><td class="monospace">{{ detail.eg.invoice_no }}</td></tr>
                <tr><td>{{ t('نظام الضريبة') }}</td><td>{{ t('ضريبة القيمة المضافة') }}</td></tr>
                <tr><td>{{ t('معرّف الفاتورة (UUID)') }}</td><td class="monospace" style="font-size:12px;">{{ detail.eg.eg_uuid || '—' }}</td></tr>
                <tr><td>{{ t('حالة الإرسال') }}</td><td><span class="badge" :class="fmt.egyptStatus(detail.eg.eg_status).c">{{ fmt.egyptStatus(detail.eg.eg_status).t }}</span></td></tr>
                <tr v-if="detail.eg.eg_submitted_at"><td>{{ t('تاريخ الإرسال') }}</td><td class="monospace">{{ detail.eg.eg_submitted_at }}</td></tr>
                <tr v-if="detail.eg.eg_response && detail.eg.eg_status !== 'submitted'">
                  <td>{{ t('ملاحظة النظام') }}</td><td class="muted" style="font-size:12px;">{{ detail.eg.eg_response }}</td>
                </tr>
              </table>
              <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-ghost" @click="downloadEgPayload" :disabled="!detail.eg.payload">{{ t('تحميل حمولة الفاتورة (JSON)') }}</button>
                <button v-if="detail.party && detail.party.phone" class="btn btn-sm btn-ghost" @click="sendWhatsApp(detail)">💬 {{ t('إرسال عبر واتساب') }}</button>
                <button v-if="can('invoices-sale', 'edit')" class="btn btn-sm btn-primary" @click="resubmitZatca" :disabled="detailLoading">{{ detailLoading ? t('جارٍ الإرسال...') : t('إعادة الإرسال إلى ETA') }}</button>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="detail = null">{{ t('إغلاق') }}</button>
        </div>
      </div>
    </div>

    <wa-preview-modal :preview="waPreview" :busy="waBusy" @close="waPreview = null" @confirm="confirmWhatsApp"></wa-preview-modal>
  </div>
  `
};

// ==================== العملاء والموردون ====================
const PartiesView = {
  name: 'PartiesView',
  mixins: [CommonMixin, WaSendMixin],
  data() {
    return {
      type: 'customer', parties: [], loading: true, alert: null, filter: '',
      showModal: false, editing: null, form: {}
    };
  },
  async created() { await this.load(); },
  computed: {
    title() { return this.type === 'customer' ? t('العملاء') : t('الموردون'); },
    filteredParties() {
      const f = this.filter.trim();
      if (!f) return this.parties;
      return this.parties.filter(p => p.name.includes(f) || (p.tax_id || '').includes(f) || (p.phone || '').includes(f));
    }
  },
  methods: {
    async load() {
      try { this.parties = await this.api(`/api/companies/${this.company.id}/parties?type=${this.type}`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    setType(t) { this.type = t; this.load(); },
    async sendStatement(p) {
      await this.askWhatsApp({ type: 'statement', partyId: p.id, kind: this.type });
    },
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
          this.toast(t('تم التحديث'));
        } else {
          await this.api(`/api/companies/${this.company.id}/parties`, { method: 'POST', body: this.form });
          this.toast(t('تمت الإضافة'));
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.filteredParties.map(p => [
        p.name, p.tax_id || '—', p.phone || '—', p.email || '—', this.fmt.money(p.outstanding || 0)
      ]);
      this.openPrintPreview({
        title: this.title,
        sub: `${this.company.name} - ${this.type === 'customer' ? t('العملاء') : t('الموردون')}`,
        cols: [t('الاسم'), t('الرقم الضريبي'), t('الهاتف'), t('البريد'), t('المستحقات')],
        rows
      });
    },
    exportData() {
      const rows = this.filteredParties.map(p => [
        p.name, p.tax_id || '', p.phone || '', p.email || '', this.fmt.num(p.outstanding || 0)
      ]);
      this.exportCsv(`parties-${this.type}-${this.company.id}`, ['name', 'tax_id', 'phone', 'email', 'outstanding'], rows);
    },
    importData() {
      this.importJsonFile(async (data) => {
        const items = Array.isArray(data) ? data : (data.parties || []);
        if (!items.length) return this.toast(t('لا توجد أطراف في الملف'), 'error');
        let ok = 0, fail = 0;
        for (const it of items) {
          try {
            await this.api(`/api/companies/${this.company.id}/parties`, {
              method: 'POST',
              body: {
                type: it.type || this.type, name: String(it.name || ''),
                tax_id: it.tax_id || '', phone: it.phone || '', email: it.email || '',
                address: it.address || '', opening_balance: it.opening_balance || 0
              }
            });
            ok++;
          } catch (e) { fail++; }
        }
        this.toast(t('تم استيراد {ok} {p}، فشل {fail}', { ok, p: t(this.type === 'customer' ? 'عميل' : 'مورد'), fail }));
        await this.load();
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <button class="btn" :class="type === 'customer' ? 'btn-primary' : 'btn-ghost'" @click="setType('customer')">👥 {{ t('العملاء') }}</button>
        <button class="btn" :class="type === 'supplier' ? 'btn-primary' : 'btn-ghost'" @click="setType('supplier')">🚚 {{ t('الموردون') }}</button>
        <input v-if="can('parties', 'search')" :placeholder="t('بحث بالاسم أو الرقم الضريبي أو الهاتف...')" v-model="filter" style="min-width:230px;">
      </div>
      <div class="flex flex-wrap">
        <button v-if="can('parties', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button v-if="can('parties', 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can('parties', 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ {{ t('تصدير CSV') }}</button>
        <button v-if="can('parties', 'import')" class="btn btn-sm btn-ghost" @click="importData">⬆️ {{ t('استيراد JSON') }}</button>
        <button v-if="can('parties', 'add')" class="btn btn-primary" @click="openCreate">+ {{ type === 'customer' ? t('عميل جديد') : t('مورد جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ title }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('الاسم') }}</th><th>{{ t('الرقم الضريبي') }}</th><th>{{ t('الهاتف') }}</th><th>{{ t('البريد') }}</th><th>{{ t('المستحقات') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="p in filteredParties" :key="p.id">
                <td><strong>{{ p.name }}</strong></td>
                <td class="monospace">{{ p.tax_id || '—' }}</td>
                <td dir="ltr" style="text-align:right;">{{ p.phone || '—' }}</td>
                <td dir="ltr" style="text-align:right;">{{ p.email || '—' }}</td>
                <td class="num">{{ fmt.money(p.outstanding || 0) }}</td>
                <td>
                  <button v-if="p.phone" class="btn btn-sm btn-ghost" @click="sendStatement(p)">💬 {{ t('كشف حساب') }}</button>
                  <button v-if="can('parties', 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(p)">{{ t('تعديل') }}</button>
                </td>
              </tr>
              <tr v-if="!parties.length"><td colspan="6" class="muted">{{ t('لا يوجد {x} بعد', { x: type === 'customer' ? t('عملاء') : t('موردون') }) }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal">
        <h3>{{ editing ? t('تعديل') : t('إضافة') }} {{ type === 'customer' ? t('عميل') : t('مورد') }}</h3>
        <div class="form-grid">
          <label class="span2">{{ t('الاسم') }} <input v-model.trim="form.name"></label>
          <label>{{ t('الرقم الضريبي') }} <input v-model.trim="form.tax_id" dir="ltr" :placeholder="t('رقم ضريبي للمنشأة')"></label>
          <label>{{ t('الهاتف') }} <input v-model.trim="form.phone" dir="ltr"></label>
          <label class="span2">{{ t('البريد الإلكتروني') }} <input v-model.trim="form.email" dir="ltr"></label>
          <label class="span2">{{ t('العنوان') }} <input v-model.trim="form.address"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="!form.name">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <wa-preview-modal :preview="waPreview" :busy="waBusy" @close="waPreview = null" @confirm="confirmWhatsApp"></wa-preview-modal>
  </div>
  `
};
