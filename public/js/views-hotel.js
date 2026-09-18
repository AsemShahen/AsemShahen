'use strict';

// ==================== نظام الفنادق والضيافة (فندق / شقق مفروشة) ====================
// أنواع الوحدات، الغرف/الوحدات، النزلاء، الحجوزات، الخدمات الفندقية،
// وحساب النزيل (Folio): بنود + دفعات + تسجيل خروج مع ترحيل الإيراد.

const HOTEL_ROOM_STATUS = {
  available: { label: 'متاحة', color: 'green' },
  occupied: { label: 'مشغولة', color: 'red' },
  cleaning: { label: 'قيد التنظيف', color: 'yellow' },
  maintenance: { label: 'صيانة', color: 'gray' },
  out_of_service: { label: 'خارج الخدمة', color: 'gray' }
};

const HOTEL_BOOKING_STATUS = {
  reserved: { label: 'محجوز', color: 'blue' },
  checked_in: { label: 'دخول مسجّل', color: 'green' },
  checked_out: { label: 'خروج مسجّل', color: 'gray' },
  cancelled: { label: 'ملغى', color: 'red' },
  no_show: { label: 'لم يحضر', color: 'gray' }
};

const HotelHelpers = {
  methods: {
    hNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; },
    hMoney(v) { return fmt.money(this.hNum(v)); },
    hToday() { return new Date().toISOString().slice(0, 10); },
    roomStatusKeys() { return Object.keys(HOTEL_ROOM_STATUS); },
    roomStatusLabel(s) { return t((HOTEL_ROOM_STATUS[s] || {}).label || s); },
    roomStatusColor(s) { return (HOTEL_ROOM_STATUS[s] || {}).color || 'gray'; },
    bookingStatusLabel(s) { return t((HOTEL_BOOKING_STATUS[s] || {}).label || s); },
    bookingStatusColor(s) { return (HOTEL_BOOKING_STATUS[s] || {}).color || 'gray'; },
    payMethodLabel(code) { return fmt.payMethod(code, this.info.payment_methods); }
  }
};

// منطق حساب النزيل المشترك بين الحجوزات والفوترة
const HotelFolioMixin = {
  data() {
    return {
      services: [],
      detail: null,
      detailLoading: false,
      showCharge: false,
      chargeForm: { service_id: '', description: '', qty: 1, unit_price: 0, date: '' },
      showPayment: false,
      paymentForm: { amount: '', method: 'cash', date: '', notes: '' },
      showCheckout: false,
      checkoutForm: { date: '', discount: 0, payment_method: 'cash', paid_amount: 0, notes: '' },
      folioBusy: false
    };
  },
  methods: {
    async loadHotelServices() {
      try { this.services = await this.api(`/api/companies/${this.company.id}/hotel/services`); }
      catch (e) { /* تجاهل */ }
    },
    async openBookingDetail(row) {
      this.detailLoading = true;
      try {
        const d = await this.api(`/api/companies/${this.company.id}/hotel/bookings/${row.id}`);
        this.detail = d;
        const bal = this.hNum(d.folio.balance);
        this.chargeForm = { service_id: '', description: '', qty: 1, unit_price: 0, date: this.hToday() };
        this.paymentForm = { amount: bal > 0 ? bal : '', method: 'cash', date: this.hToday(), notes: '' };
        this.checkoutForm = {
          date: this.hToday() < d.check_out_date ? d.check_out_date : this.hToday(),
          discount: this.hNum(d.discount), payment_method: 'cash', paid_amount: bal > 0 ? bal : 0, notes: ''
        };
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.detailLoading = false; }
    },
    async refreshDetail() {
      if (!this.detail) return;
      const id = this.detail.id;
      await this.openBookingDetail({ id });
      if (typeof this.afterFolioChange === 'function') await this.afterFolioChange();
    },
    servicePicked() {
      const s = this.services.find(x => Number(x.id) === Number(this.chargeForm.service_id));
      if (s) { this.chargeForm.description = s.name; this.chargeForm.unit_price = this.hNum(s.price); }
    },
    async saveCharge() {
      if (!this.detail) return;
      if (!this.chargeForm.description) { this.toast(t('وصف البند مطلوب'), 'error'); return; }
      this.folioBusy = true;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/bookings/${this.detail.id}/charges`, {
          method: 'POST',
          body: {
            service_id: this.chargeForm.service_id || null,
            description: this.chargeForm.description,
            qty: this.hNum(this.chargeForm.qty) || 1,
            unit_price: this.hNum(this.chargeForm.unit_price),
            date: this.chargeForm.date || this.hToday()
          }
        });
        this.showCharge = false;
        this.toast(t('تمت إضافة البند إلى الحساب'));
        await this.refreshDetail();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.folioBusy = false; }
    },
    async removeCharge(c) {
      if (!confirm(t('هل أنت متأكد من حذف هذا البند؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/bookings/${this.detail.id}/charges/${c.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف البند'));
        await this.refreshDetail();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async savePayment() {
      if (!this.detail) return;
      this.folioBusy = true;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/bookings/${this.detail.id}/payments`, {
          method: 'POST',
          body: {
            amount: this.hNum(this.paymentForm.amount), method: this.paymentForm.method,
            date: this.paymentForm.date || this.hToday(), notes: this.paymentForm.notes
          }
        });
        this.showPayment = false;
        this.toast(t('تم تسجيل الدفعة'));
        await this.refreshDetail();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.folioBusy = false; }
    },
    async doCheckout() {
      if (!this.detail) return;
      this.folioBusy = true;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/bookings/${this.detail.id}/check-out`, {
          method: 'POST',
          body: {
            date: this.checkoutForm.date, discount: this.hNum(this.checkoutForm.discount),
            payment_method: this.checkoutForm.payment_method, paid_amount: this.hNum(this.checkoutForm.paid_amount),
            notes: this.checkoutForm.notes
          }
        });
        this.showCheckout = false;
        this.toast(t('تم تسجيل الخروج وترحيل الإيراد'));
        await this.refreshDetail();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.folioBusy = false; }
    },
    previewFolio() {
      const d = this.detail;
      if (!d) return;
      const rows = (d.charges || []).map(c => [
        c.date, c.description, this.hNum(c.qty), this.hMoney(c.unit_price), this.hMoney(c.amount)
      ]);
      rows.push([d.check_in_date, t('إجمالي البنود'), '', '', this.hMoney(d.folio.sub_total)]);
      rows.push(['', t('الخصم'), '', '', this.hMoney(d.folio.discount)]);
      rows.push(['', t('ضريبة القيمة المضافة'), '', '', this.hMoney(d.folio.vat)]);
      rows.push(['', t('الإجمالي'), '', '', this.hMoney(d.folio.total)]);
      rows.push(['', t('المدفوع'), '', '', this.hMoney(d.folio.paid_amount)]);
      rows.push(['', t('المتبقي'), '', '', this.hMoney(d.folio.balance)]);
      this.openPrintPreview({
        title: t('حساب نزيل'), sub: `${d.booking_no} — ${d.guest_name || ''} — ${d.room_no || ''}`,
        cols: [t('التاريخ'), t('البيان'), t('الكمية'), t('السعر'), t('المبلغ')], rows
      });
    }
  }
};

// ---------- لوحة الفندق ----------
const HotelDashboardView = {
  name: 'HotelDashboardView',
  mixins: [CommonMixin, HotelHelpers],
  data() { return { dash: null, loading: true, alert: null }; },
  async created() { await this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try { this.dash = await this.api(`/api/companies/${this.company.id}/hotel/dashboard`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    }
  },
  template: `
  <div v-if="dash">
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="cards-grid mb-2">
      <div class="stat-card"><div class="icon">🏨</div><div class="label">{{ t('نسبة الإشغال') }}</div><div class="value">{{ dash.occupancy }}%</div></div>
      <div class="stat-card"><div class="icon">🛏️</div><div class="label">{{ t('نزلاء داخل الفندق') }}</div><div class="value">{{ dash.in_house }}</div></div>
      <div class="stat-card"><div class="icon">📅</div><div class="label">{{ t('وصول اليوم') }}</div><div class="value">{{ dash.arrivals }}</div></div>
      <div class="stat-card"><div class="icon">🚪</div><div class="label">{{ t('مغادرة اليوم') }}</div><div class="value">{{ dash.departures }}</div></div>
    </div>

    <div class="cards-grid mb-2">
      <div class="stat-card"><div class="icon">💵</div><div class="label">{{ t('إيراد الإقامة (السنة)') }}</div><div class="value">{{ hMoney(dash.revenue) }}</div></div>
      <div class="stat-card"><div class="icon">✅</div><div class="label">{{ t('المحصّل') }}</div><div class="value">{{ hMoney(dash.collected) }}</div></div>
      <div class="stat-card"><div class="icon">📋</div><div class="label">{{ t('ذمم النزلاء') }}</div><div class="value">{{ hMoney(dash.receivable) }}</div></div>
      <div class="stat-card"><div class="icon">👥</div><div class="label">{{ t('عدد النزلاء المسجّلين') }}</div><div class="value">{{ dash.guests_count }}</div></div>
    </div>

    <div class="cards-grid mb-2">
      <div class="stat-card" v-for="s in roomStatusKeys()" :key="s">
        <div class="icon">🛎️</div>
        <div class="label">{{ roomStatusLabel(s) }}</div>
        <div class="value">{{ (dash.rooms && dash.rooms[s]) || 0 }}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('نزلاء داخل الفندق') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('رقم الحجز') }}</th><th>{{ t('النزيل') }}</th><th>{{ t('الغرفة/الوحدة') }}</th><th>{{ t('الوصول') }}</th><th>{{ t('المغادرة') }}</th></tr></thead>
            <tbody>
              <tr v-for="b in dash.in_house_list" :key="b.id">
                <td class="monospace">{{ b.booking_no }}</td>
                <td>{{ b.guest_name }}</td>
                <td>{{ b.room_no }} <span class="muted" v-if="b.room_type_name">· {{ b.room_type_name }}</span></td>
                <td dir="ltr">{{ b.check_in_date }}</td>
                <td dir="ltr">{{ b.check_out_date }}</td>
              </tr>
              <tr v-if="!dash.in_house_list.length"><td colspan="5" class="muted">{{ t('لا يوجد نزلاء داخل الفندق حالياً') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel mt-2">
      <div class="panel-header"><h3>{{ t('وصول اليوم') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('رقم الحجز') }}</th><th>{{ t('النزيل') }}</th><th>{{ t('الغرفة/الوحدة') }}</th><th>{{ t('عدد الليالي') }}</th><th>{{ t('السعر/الليلة') }}</th></tr></thead>
            <tbody>
              <tr v-for="b in dash.arrivals_list" :key="b.id">
                <td class="monospace">{{ b.booking_no }}</td>
                <td>{{ b.guest_name }}</td>
                <td>{{ b.room_no }}</td>
                <td class="num">{{ b.nights }}</td>
                <td class="num">{{ hMoney(b.rate) }}</td>
              </tr>
              <tr v-if="!dash.arrivals_list.length"><td colspan="5" class="muted">{{ t('لا يوجد وصول متوقع اليوم') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- الغرف والوحدات وأنواعها ----------
const HotelRoomsView = {
  name: 'HotelRoomsView',
  mixins: [CommonMixin, HotelHelpers],
  data() {
    return {
      roomTypes: [], rooms: [], loading: true, alert: null,
      filters: { status: '', search: '' },
      showTypeModal: false, editingType: null, savingType: false,
      typeForm: { code: '', name: '', capacity: 1, base_price: 0, description: '', is_active: true },
      showRoomModal: false, editingRoom: null, savingRoom: false,
      roomForm: { room_no: '', room_type_id: '', floor: '', status: 'available', notes: '', is_active: true }
    };
  },
  async created() { await Promise.all([this.loadRoomTypes(), this.loadRooms()]); },
  computed: {
    roomTypeMap() { const m = {}; for (const t of this.roomTypes) m[t.id] = t; return m; }
  },
  methods: {
    async loadRoomTypes() {
      try { this.roomTypes = await this.api(`/api/companies/${this.company.id}/hotel/room-types`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    async loadRooms() {
      this.loading = true;
      try {
        const q = [];
        if (this.filters.status) q.push('status=' + encodeURIComponent(this.filters.status));
        if (this.filters.search) q.push('search=' + encodeURIComponent(this.filters.search));
        this.rooms = await this.api(`/api/companies/${this.company.id}/hotel/rooms${q.length ? '?' + q.join('&') : ''}`);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    typeName(id) { const t2 = this.roomTypeMap[id]; return t2 ? t2.name : '—'; },
    openCreateType() { this.editingType = null; this.typeForm = { code: '', name: '', capacity: 1, base_price: 0, description: '', is_active: true }; this.showTypeModal = true; },
    openEditType(r) { this.editingType = r; this.typeForm = { code: r.code, name: r.name, capacity: r.capacity, base_price: r.base_price, description: r.description || '', is_active: r.is_active !== 0 }; this.showTypeModal = true; },
    async saveType() {
      this.savingType = true;
      try {
        const body = { ...this.typeForm, capacity: this.hNum(this.typeForm.capacity) || 1, base_price: this.hNum(this.typeForm.base_price) };
        if (this.editingType) await this.api(`/api/companies/${this.company.id}/hotel/room-types/${this.editingType.id}`, { method: 'PUT', body });
        else await this.api(`/api/companies/${this.company.id}/hotel/room-types`, { method: 'POST', body });
        this.showTypeModal = false;
        this.toast(t('تم حفظ نوع الوحدة'));
        await this.loadRoomTypes();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.savingType = false; }
    },
    async removeType(r) {
      if (!confirm(t('هل أنت متأكد من حذف نوع الوحدة؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/room-types/${r.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف نوع الوحدة'));
        await this.loadRoomTypes();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    openCreateRoom() { this.editingRoom = null; this.roomForm = { room_no: '', room_type_id: '', floor: '', status: 'available', notes: '', is_active: true }; this.showRoomModal = true; },
    openEditRoom(r) { this.editingRoom = r; this.roomForm = { room_no: r.room_no, room_type_id: r.room_type_id || '', floor: r.floor || '', status: r.status, notes: r.notes || '', is_active: r.is_active !== 0 }; this.showRoomModal = true; },
    async saveRoom() {
      this.savingRoom = true;
      try {
        const body = { ...this.roomForm, room_type_id: this.roomForm.room_type_id || null };
        if (this.editingRoom) await this.api(`/api/companies/${this.company.id}/hotel/rooms/${this.editingRoom.id}`, { method: 'PUT', body });
        else await this.api(`/api/companies/${this.company.id}/hotel/rooms`, { method: 'POST', body });
        this.showRoomModal = false;
        this.toast(t('تم حفظ الغرفة/الوحدة'));
        await this.loadRooms();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.savingRoom = false; }
    },
    async removeRoom(r) {
      if (!confirm(t('هل أنت متأكد من حذف الغرفة/الوحدة؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/rooms/${r.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.loadRooms();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async setStatus(r, status) {
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/rooms/${r.id}/status`, { method: 'POST', body: { status } });
        await this.loadRooms();
      } catch (e) { this.toast(e.message, 'error'); }
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="panel">
      <div class="panel-header flex-between">
        <h3>{{ t('أنواع الوحدات') }}</h3>
        <button v-if="can('hotel-rooms', 'add')" class="btn btn-sm btn-primary" @click="openCreateType">+ {{ t('نوع وحدة') }}</button>
      </div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('الرمز') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('السعة') }}</th><th>{{ t('سعر الليلة') }}</th><th>{{ t('عدد الوحدات') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in roomTypes" :key="r.id">
                <td class="monospace">{{ r.code }}</td>
                <td>{{ r.name }}</td>
                <td class="num">{{ r.capacity }}</td>
                <td class="num">{{ hMoney(r.base_price) }}</td>
                <td class="num">{{ r.rooms_count }}</td>
                <td>
                  <button v-if="can('hotel-rooms', 'edit')" class="btn btn-sm btn-ghost" @click="openEditType(r)">{{ t('تعديل') }}</button>
                  <button v-if="can('hotel-rooms', 'delete')" class="btn btn-sm btn-ghost" @click="removeType(r)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!roomTypes.length"><td colspan="6" class="muted">{{ t('لا توجد أنواع وحدات بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel mt-2">
      <div class="panel-header flex-between">
        <h3>{{ t('الغرف والوحدات') }}</h3>
        <div class="flex flex-wrap">
          <select v-model="filters.status" @change="loadRooms">
            <option value="">{{ t('كل الحالات') }}</option>
            <option v-for="s in roomStatusKeys()" :key="s" :value="s">{{ roomStatusLabel(s) }}</option>
          </select>
          <input :placeholder="t('بحث برقم الوحدة...')" v-model="filters.search" @keyup.enter="loadRooms">
          <button class="btn btn-sm btn-ghost" @click="loadRooms">{{ t('بحث') }}</button>
          <button v-if="can('hotel-rooms', 'add')" class="btn btn-sm btn-primary" @click="openCreateRoom">+ {{ t('غرفة/وحدة') }}</button>
        </div>
      </div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('رقم الوحدة') }}</th><th>{{ t('النوع') }}</th><th>{{ t('الطابق') }}</th><th>{{ t('الحالة') }}</th><th>{{ t('النزيل الحالي') }}</th><th>{{ t('مغادرة متوقعة') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in rooms" :key="r.id">
                <td><strong>{{ r.room_no }}</strong></td>
                <td>{{ r.room_type_name || '—' }}</td>
                <td>{{ r.floor || '—' }}</td>
                <td><span class="badge" :class="roomStatusColor(r.status)">{{ roomStatusLabel(r.status) }}</span></td>
                <td>{{ r.current_guest || '—' }}</td>
                <td dir="ltr">{{ r.current_checkout || '—' }}</td>
                <td>
                  <select v-if="can('hotel-rooms', 'edit')" :value="r.status" @change="setStatus(r, $event.target.value)" style="width:auto;">
                    <option v-for="s in roomStatusKeys()" :key="s" :value="s">{{ roomStatusLabel(s) }}</option>
                  </select>
                  <button v-if="can('hotel-rooms', 'edit')" class="btn btn-sm btn-ghost" @click="openEditRoom(r)">{{ t('تعديل') }}</button>
                  <button v-if="can('hotel-rooms', 'delete')" class="btn btn-sm btn-ghost" @click="removeRoom(r)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!rooms.length"><td colspan="7" class="muted">{{ t('لا توجد غرف/وحدات بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showTypeModal" class="modal-overlay" @click.self="showTypeModal = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ editingType ? t('تعديل نوع وحدة') : t('نوع وحدة جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('الرمز') }} <input v-model.trim="typeForm.code" dir="ltr"></label>
          <label>{{ t('الاسم') }} <input v-model.trim="typeForm.name"></label>
          <label>{{ t('السعة (عدد الأشخاص)') }} <input type="number" min="1" v-model.number="typeForm.capacity"></label>
          <label>{{ t('سعر الليلة') }} <input type="number" min="0" step="any" v-model.number="typeForm.base_price"></label>
          <label class="span2">{{ t('الوصف') }} <input v-model.trim="typeForm.description"></label>
          <label class="flex-row"><input type="checkbox" v-model="typeForm.is_active"> {{ t('مفعّل') }}</label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showTypeModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveType" :disabled="savingType || !typeForm.code || !typeForm.name">{{ savingType ? t('جارٍ الحفظ...') : t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showRoomModal" class="modal-overlay" @click.self="showRoomModal = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ editingRoom ? t('تعديل غرفة/وحدة') : t('غرفة/وحدة جديدة') }}</h3>
        <div class="form-grid">
          <label>{{ t('رقم الوحدة') }} <input v-model.trim="roomForm.room_no" dir="ltr"></label>
          <label>{{ t('النوع') }}
            <select v-model="roomForm.room_type_id">
              <option value="">{{ t('بدون نوع') }}</option>
              <option v-for="r in roomTypes" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </label>
          <label>{{ t('الطابق') }} <input v-model.trim="roomForm.floor" dir="ltr"></label>
          <label>{{ t('الحالة') }}
            <select v-model="roomForm.status">
              <option v-for="s in roomStatusKeys()" :key="s" :value="s">{{ roomStatusLabel(s) }}</option>
            </select>
          </label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="roomForm.notes"></label>
          <label class="flex-row"><input type="checkbox" v-model="roomForm.is_active"> {{ t('مفعّل') }}</label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showRoomModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveRoom" :disabled="savingRoom || !roomForm.room_no">{{ savingRoom ? t('جارٍ الحفظ...') : t('حفظ') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- النزلاء ----------
const HotelGuestsView = {
  name: 'HotelGuestsView',
  mixins: [CommonMixin, HotelHelpers],
  data() {
    return {
      guests: [], search: '', loading: true, alert: null,
      showModal: false, editing: null, saving: false,
      form: { name: '', national_id: '', phone: '', email: '', nationality: '', address: '', notes: '' },
      historyGuest: null
    };
  },
  async created() { await this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try {
        const q = this.search ? '?search=' + encodeURIComponent(this.search) : '';
        this.guests = await this.api(`/api/companies/${this.company.id}/hotel/guests${q}`);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    openCreate() { this.editing = null; this.form = { name: '', national_id: '', phone: '', email: '', nationality: '', address: '', notes: '' }; this.showModal = true; },
    openEdit(g) { this.editing = g; this.form = { name: g.name, national_id: g.national_id || '', phone: g.phone || '', email: g.email || '', nationality: g.nationality || '', address: g.address || '', notes: g.notes || '' }; this.showModal = true; },
    async save() {
      this.saving = true;
      try {
        if (this.editing) await this.api(`/api/companies/${this.company.id}/hotel/guests/${this.editing.id}`, { method: 'PUT', body: this.form });
        else await this.api(`/api/companies/${this.company.id}/hotel/guests`, { method: 'POST', body: this.form });
        this.showModal = false;
        this.toast(t('تم حفظ بيانات النزيل'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async remove(g) {
      if (!confirm(t('هل أنت متأكد من حذف هذا النزيل؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/guests/${g.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async viewHistory(g) {
      try { this.historyGuest = await this.api(`/api/companies/${this.company.id}/hotel/guests/${g.id}`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.guests.map(g => [g.guest_no, g.name, g.national_id || '—', g.phone || '—', g.nationality || '—', g.bookings_count]);
      this.openPrintPreview({
        title: t('النزلاء'), sub: this.company.name,
        cols: [t('رقم النزيل'), t('الاسم'), t('الهوية'), t('الهاتف'), t('الجنسية'), t('عدد الحجوزات')], rows
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input :placeholder="t('بحث بالاسم أو الهاتف أو الهوية...')" v-model="search" @keyup.enter="load" style="min-width:240px;">
        <button class="btn btn-sm btn-ghost" @click="load">{{ t('بحث') }}</button>
        <p class="muted">{{ t('عدد النزلاء: {n}', { n: guests.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can('hotel-guests', 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('نزيل جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('سجل النزلاء') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('رقم النزيل') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('الهوية') }}</th><th>{{ t('الهاتف') }}</th><th>{{ t('الجنسية') }}</th><th>{{ t('عدد الحجوزات') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="g in guests" :key="g.id">
                <td class="monospace">{{ g.guest_no }}</td>
                <td><strong>{{ g.name }}</strong></td>
                <td dir="ltr">{{ g.national_id || '—' }}</td>
                <td dir="ltr">{{ g.phone || '—' }}</td>
                <td>{{ g.nationality || '—' }}</td>
                <td class="num">{{ g.bookings_count }}</td>
                <td>
                  <button class="btn btn-sm btn-ghost" @click="viewHistory(g)">{{ t('السجل') }}</button>
                  <button v-if="can('hotel-guests', 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(g)">{{ t('تعديل') }}</button>
                  <button v-if="can('hotel-guests', 'delete')" class="btn btn-sm btn-ghost" @click="remove(g)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!guests.length"><td colspan="7" class="muted">{{ t('لا يوجد نزلاء مسجّلون بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:640px;">
        <h3>{{ editing ? t('تعديل بيانات نزيل') : t('نزيل جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('الاسم') }} <input v-model.trim="form.name"></label>
          <label>{{ t('رقم الهوية / الإقامة') }} <input v-model.trim="form.national_id" dir="ltr"></label>
          <label>{{ t('الهاتف') }} <input v-model.trim="form.phone" dir="ltr"></label>
          <label>{{ t('البريد الإلكتروني') }} <input v-model.trim="form.email" dir="ltr"></label>
          <label>{{ t('الجنسية') }} <input v-model.trim="form.nationality"></label>
          <label>{{ t('العنوان') }} <input v-model.trim="form.address"></label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="form.notes"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="saving || !form.name">{{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="historyGuest" class="modal-overlay" @click.self="historyGuest = null">
      <div class="modal" style="max-width:680px;">
        <h3>{{ historyGuest.name }} — {{ historyGuest.guest_no }}</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('رقم الحجز') }}</th><th>{{ t('الغرفة') }}</th><th>{{ t('الوصول') }}</th><th>{{ t('المغادرة') }}</th><th>{{ t('الليالي') }}</th><th>{{ t('الحالة') }}</th></tr></thead>
            <tbody>
              <tr v-for="b in historyGuest.bookings" :key="b.id">
                <td class="monospace">{{ b.booking_no }}</td>
                <td>{{ b.room_no || '—' }}</td>
                <td dir="ltr">{{ b.check_in_date }}</td>
                <td dir="ltr">{{ b.check_out_date }}</td>
                <td class="num">{{ b.nights }}</td>
                <td><span class="badge" :class="bookingStatusColor(b.status)">{{ bookingStatusLabel(b.status) }}</span></td>
              </tr>
              <tr v-if="!historyGuest.bookings.length"><td colspan="6" class="muted">{{ t('لا توجد حجوزات لهذا النزيل') }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="modal-actions"><button class="btn btn-ghost" @click="historyGuest = null">{{ t('إغلاق') }}</button></div>
      </div>
    </div>
  </div>
  `
};

// ---------- الخدمات الفندقية ----------
const HotelServicesView = {
  name: 'HotelServicesView',
  mixins: [CommonMixin, HotelHelpers],
  data() {
    return {
      services: [], loading: true, alert: null,
      showModal: false, editing: null, saving: false,
      form: { code: '', name: '', category: 'other', price: 0, cost: 0, account_code: '4131', vat_applicable: true, is_active: true }
    };
  },
  async created() { await this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try { this.services = await this.api(`/api/companies/${this.company.id}/hotel/services?all=1`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    openCreate() { this.editing = null; this.form = { code: '', name: '', category: 'other', price: 0, cost: 0, account_code: '4131', vat_applicable: true, is_active: true }; this.showModal = true; },
    openEdit(s) { this.editing = s; this.form = { code: s.code, name: s.name, category: s.category || 'other', price: s.price, cost: s.cost, account_code: s.account_code || '4131', vat_applicable: s.vat_applicable !== 0, is_active: s.is_active !== 0 }; this.showModal = true; },
    async save() {
      this.saving = true;
      try {
        const body = { ...this.form, price: this.hNum(this.form.price), cost: this.hNum(this.form.cost) };
        if (this.editing) await this.api(`/api/companies/${this.company.id}/hotel/services/${this.editing.id}`, { method: 'PUT', body });
        else await this.api(`/api/companies/${this.company.id}/hotel/services`, { method: 'POST', body });
        this.showModal = false;
        this.toast(t('تم حفظ الخدمة'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async remove(s) {
      if (!confirm(t('هل أنت متأكد من حذف هذه الخدمة؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/services/${s.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <p class="muted">{{ t('الخدمات الإضافية التي تُضاف إلى حساب النزيل (مغسلة، خدمة الغرف، إفطار، توصيل...)') }}</p>
      <button v-if="can('hotel-services', 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('خدمة جديدة') }}</button>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('الخدمات الفندقية') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('الرمز') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('التصنيف') }}</th><th>{{ t('السعر') }}</th><th>{{ t('ضريبة') }}</th><th>{{ t('الحالة') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in services" :key="s.id">
                <td class="monospace">{{ s.code }}</td>
                <td>{{ s.name }}</td>
                <td>{{ s.category || '—' }}</td>
                <td class="num">{{ hMoney(s.price) }}</td>
                <td>{{ s.vat_applicable ? t('خاضعة') : t('معفاة') }}</td>
                <td><span class="badge" :class="s.is_active ? 'green' : 'gray'">{{ s.is_active ? t('مفعّلة') : t('موقوفة') }}</span></td>
                <td>
                  <button v-if="can('hotel-services', 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(s)">{{ t('تعديل') }}</button>
                  <button v-if="can('hotel-services', 'delete')" class="btn btn-sm btn-ghost" @click="remove(s)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!services.length"><td colspan="7" class="muted">{{ t('لا توجد خدمات بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ editing ? t('تعديل خدمة') : t('خدمة جديدة') }}</h3>
        <div class="form-grid">
          <label>{{ t('الرمز') }} <input v-model.trim="form.code" dir="ltr"></label>
          <label>{{ t('الاسم') }} <input v-model.trim="form.name"></label>
          <label>{{ t('التصنيف') }} <input v-model.trim="form.category"></label>
          <label>{{ t('السعر') }} <input type="number" min="0" step="any" v-model.number="form.price"></label>
          <label>{{ t('التكلفة') }} <input type="number" min="0" step="any" v-model.number="form.cost"></label>
          <label>{{ t('حساب الإيراد') }} <input v-model.trim="form.account_code" dir="ltr"></label>
          <label class="flex-row"><input type="checkbox" v-model="form.vat_applicable"> {{ t('خاضعة للضريبة') }}</label>
          <label class="flex-row"><input type="checkbox" v-model="form.is_active"> {{ t('مفعّلة') }}</label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="saving || !form.code || !form.name">{{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- الحجوزات ----------
const HotelBookingsView = {
  name: 'HotelBookingsView',
  mixins: [CommonMixin, HotelHelpers, HotelFolioMixin],
  data() {
    return {
      bookings: [], rooms: [], guests: [], loading: true, alert: null,
      filters: { status: '', search: '', from: '', to: '' },
      showModal: false, editing: null, saving: false,
      form: {
        guest_id: '', room_id: '', check_in_date: '', check_out_date: '',
        adults: 1, children: 0, rate: '', discount: 0, deposit: 0, payment_method: 'cash', notes: ''
      }
    };
  },
  async created() {
    await Promise.all([this.load(), this.loadRooms(), this.loadGuests(), this.loadHotelServices()]);
  },
  computed: {
    roomMap() { const m = {}; for (const r of this.rooms) m[r.id] = r; return m; },
    selectedRoom() { return this.roomMap[this.form.room_id] || null; },
    formNights() {
      if (!this.form.check_in_date || !this.form.check_out_date) return 0;
      const a = new Date(this.form.check_in_date + 'T00:00:00Z');
      const b = new Date(this.form.check_out_date + 'T00:00:00Z');
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
      return Math.max(0, Math.round((b - a) / 86400000));
    },
    formExpected() {
      const rate = this.hNum(this.form.rate) || this.hNum(this.selectedRoom && this.selectedRoom.base_price);
      return rate * this.formNights;
    }
  },
  methods: {
    async load() {
      this.loading = true;
      try {
        const q = [];
        if (this.filters.status) q.push('status=' + encodeURIComponent(this.filters.status));
        if (this.filters.search) q.push('search=' + encodeURIComponent(this.filters.search));
        if (this.filters.from) q.push('from=' + this.filters.from);
        if (this.filters.to) q.push('to=' + this.filters.to);
        this.bookings = await this.api(`/api/companies/${this.company.id}/hotel/bookings${q.length ? '?' + q.join('&') : ''}`);
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async loadRooms() {
      try { this.rooms = await this.api(`/api/companies/${this.company.id}/hotel/rooms`); }
      catch (e) { /* تجاهل */ }
    },
    async loadGuests() {
      try { this.guests = await this.api(`/api/companies/${this.company.id}/hotel/guests`); }
      catch (e) { /* تجاهل */ }
    },
    async afterFolioChange() { await this.load(); },
    openCreate() {
      this.editing = null;
      const today = this.hToday();
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      this.form = { guest_id: '', room_id: '', check_in_date: today, check_out_date: tomorrow, adults: 1, children: 0, rate: '', discount: 0, deposit: 0, payment_method: 'cash', notes: '' };
      this.showModal = true;
    },
    openEdit(b) {
      this.editing = b;
      this.form = {
        guest_id: b.guest_id, room_id: b.room_id, check_in_date: b.check_in_date, check_out_date: b.check_out_date,
        adults: b.adults, children: b.children, rate: b.rate, discount: b.discount, deposit: b.deposit,
        payment_method: b.payment_method || 'cash', notes: b.notes || ''
      };
      this.showModal = true;
    },
    onRoomChange() {
      const r = this.selectedRoom;
      if (r) this.form.rate = this.hNum(r.base_price);
    },
    async save() {
      this.saving = true;
      try {
        const body = {
          guest_id: Number(this.form.guest_id), room_id: Number(this.form.room_id),
          check_in_date: this.form.check_in_date, check_out_date: this.form.check_out_date,
          adults: this.hNum(this.form.adults) || 1, children: this.hNum(this.form.children),
          rate: this.form.rate === '' ? undefined : this.hNum(this.form.rate),
          discount: this.hNum(this.form.discount), deposit: this.hNum(this.form.deposit),
          payment_method: this.form.payment_method, notes: this.form.notes
        };
        if (this.editing) await this.api(`/api/companies/${this.company.id}/hotel/bookings/${this.editing.id}`, { method: 'PUT', body });
        else await this.api(`/api/companies/${this.company.id}/hotel/bookings`, { method: 'POST', body });
        this.showModal = false;
        this.toast(t('تم حفظ الحجز'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async checkIn(b) {
      if (!confirm(t('تسجيل دخول النزيل إلى الغرفة؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/bookings/${b.id}/check-in`, { method: 'POST', body: {} });
        this.toast(t('تم تسجيل دخول النزيل'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async cancel(b) {
      if (!confirm(t('هل أنت متأكد من إلغاء هذا الحجز؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/bookings/${b.id}/cancel`, { method: 'POST' });
        this.toast(t('تم إلغاء الحجز'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async remove(b) {
      if (!confirm(t('هل أنت متأكد من حذف الحجز نهائياً؟ سيتم حذف بنوده ودفعاته وقيوده.'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hotel/bookings/${b.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف الحجز'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.bookings.map(b => [
        b.booking_no, b.guest_name, b.room_no || '—', b.check_in_date, b.check_out_date, b.nights,
        this.hMoney(b.rate), this.bookingStatusLabel(b.status)
      ]);
      this.openPrintPreview({
        title: t('الحجوزات'), sub: this.company.name,
        cols: [t('رقم الحجز'), t('النزيل'), t('الغرفة'), t('الوصول'), t('المغادرة'), t('الليالي'), t('السعر/الليلة'), t('الحالة')], rows
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <select v-model="filters.status" @change="load">
          <option value="">{{ t('كل الحالات') }}</option>
          <option v-for="(m, k) in { reserved: 1, checked_in: 1, checked_out: 1, cancelled: 1, no_show: 1 }" :key="k" :value="k">{{ bookingStatusLabel(k) }}</option>
        </select>
        <input :placeholder="t('بحث برقم الحجز أو النزيل...')" v-model="filters.search" @keyup.enter="load" style="min-width:200px;">
        <input type="date" v-model="filters.from" @change="load" dir="ltr">
        <input type="date" v-model="filters.to" @change="load" dir="ltr">
        <button class="btn btn-sm btn-ghost" @click="load">{{ t('بحث') }}</button>
      </div>
      <div class="flex flex-wrap">
        <button class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can('hotel-bookings', 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('حجز جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('الحجوزات') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('رقم الحجز') }}</th><th>{{ t('النزيل') }}</th><th>{{ t('الغرفة/الوحدة') }}</th><th>{{ t('الوصول') }}</th><th>{{ t('المغادرة') }}</th><th>{{ t('الليالي') }}</th><th>{{ t('الحالة') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="b in bookings" :key="b.id">
                <td class="monospace">{{ b.booking_no }}</td>
                <td>{{ b.guest_name }}</td>
                <td>{{ b.room_no || '—' }} <span class="muted" v-if="b.room_type_name">· {{ b.room_type_name }}</span></td>
                <td dir="ltr">{{ b.check_in_date }}</td>
                <td dir="ltr">{{ b.check_out_date }}</td>
                <td class="num">{{ b.nights }}</td>
                <td><span class="badge" :class="bookingStatusColor(b.status)">{{ bookingStatusLabel(b.status) }}</span></td>
                <td>
                  <button class="btn btn-sm btn-ghost" @click="openBookingDetail(b)">{{ t('الحساب') }}</button>
                  <button v-if="can('hotel-bookings', 'edit') && b.status === 'reserved'" class="btn btn-sm btn-primary" @click="checkIn(b)">{{ t('دخول') }}</button>
                  <button v-if="can('hotel-bookings', 'edit') && b.status === 'reserved'" class="btn btn-sm btn-ghost" @click="openEdit(b)">{{ t('تعديل') }}</button>
                  <button v-if="can('hotel-bookings', 'edit') && (b.status === 'reserved' || b.status === 'checked_in')" class="btn btn-sm btn-ghost" @click="cancel(b)">{{ t('إلغاء') }}</button>
                  <button v-if="can('hotel-bookings', 'delete')" class="btn btn-sm btn-ghost" @click="remove(b)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!bookings.length"><td colspan="8" class="muted">{{ t('لا توجد حجوزات مطابقة') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:680px;">
        <h3>{{ editing ? t('تعديل حجز') : t('حجز جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('النزيل') }}
            <select v-model="form.guest_id">
              <option value="">{{ t('اختر النزيل...') }}</option>
              <option v-for="g in guests" :key="g.id" :value="g.id">{{ g.name }} <template v-if="g.phone">· {{ g.phone }}</template></option>
            </select>
          </label>
          <label>{{ t('الغرفة/الوحدة') }}
            <select v-model="form.room_id" @change="onRoomChange">
              <option value="">{{ t('اختر الغرفة...') }}</option>
              <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.room_no }} <template v-if="r.room_type_name">· {{ r.room_type_name }}</template> · {{ hMoney(r.base_price) }}</option>
            </select>
          </label>
          <label>{{ t('تاريخ الوصول') }} <input type="date" v-model="form.check_in_date" dir="ltr"></label>
          <label>{{ t('تاريخ المغادرة') }} <input type="date" v-model="form.check_out_date" dir="ltr"></label>
          <label>{{ t('عدد الليالي') }} <input type="number" :value="formNights" disabled></label>
          <label>{{ t('السعر/الليلة') }} <input type="number" min="0" step="any" v-model.number="form.rate" :placeholder="selectedRoom ? String(selectedRoom.base_price) : ''"></label>
          <label>{{ t('عدد البالغين') }} <input type="number" min="1" v-model.number="form.adults"></label>
          <label>{{ t('عدد الأطفال') }} <input type="number" min="0" v-model.number="form.children"></label>
          <label>{{ t('الخصم') }} <input type="number" min="0" step="any" v-model.number="form.discount"></label>
          <label>{{ t('عربون / دفعة مقدمة') }} <input type="number" min="0" step="any" v-model.number="form.deposit"></label>
          <label>{{ t('طريقة الدفع') }}
            <select v-model="form.payment_method">
              <option v-for="m in (info.payment_methods || [])" :key="m.code" :value="m.code">{{ (m.icon ? m.icon + ' ' : '') + m.name }}</option>
            </select>
          </label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="form.notes"></label>
        </div>
        <p class="muted mt-1">{{ t('القيمة المتوقعة للإقامة') }}: <strong>{{ hMoney(formExpected) }}</strong></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="saving || !form.guest_id || !form.room_id">{{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-overlay" @click.self="detail = null">
      <div class="modal" style="max-width:820px;">
        <h3>{{ t('حساب نزيل') }} — {{ detail.booking_no }}</h3>
        <p class="muted">
          {{ detail.guest_name }} · {{ detail.room_no || '—' }} · {{ detail.check_in_date }} → {{ detail.check_out_date }}
          · <span class="badge" :class="bookingStatusColor(detail.status)">{{ bookingStatusLabel(detail.status) }}</span>
        </p>

        <div class="cards-grid mb-2">
          <div class="stat-card"><div class="label">{{ t('إجمالي البنود') }}</div><div class="value">{{ hMoney(detail.folio.sub_total) }}</div></div>
          <div class="stat-card"><div class="label">{{ t('ضريبة القيمة المضافة') }}</div><div class="value">{{ hMoney(detail.folio.vat) }}</div></div>
          <div class="stat-card"><div class="label">{{ t('الإجمالي') }}</div><div class="value">{{ hMoney(detail.folio.total) }}</div></div>
          <div class="stat-card"><div class="label">{{ t('المتبقي') }}</div><div class="value">{{ hMoney(detail.folio.balance) }}</div></div>
        </div>

        <h4 class="mt-2">{{ t('بنود الحساب') }}</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('التاريخ') }}</th><th>{{ t('البيان') }}</th><th>{{ t('الكمية') }}</th><th>{{ t('السعر') }}</th><th>{{ t('المبلغ') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="c in detail.charges" :key="c.id">
                <td dir="ltr">{{ c.date }}</td>
                <td>{{ c.description }}</td>
                <td class="num">{{ c.qty }}</td>
                <td class="num">{{ hMoney(c.unit_price) }}</td>
                <td class="num">{{ hMoney(c.amount) }}</td>
                <td>
                  <button v-if="can('hotel-billing', 'delete') && c.charge_type !== 'room'" class="btn btn-sm btn-ghost" @click="removeCharge(c)">✕</button>
                </td>
              </tr>
              <tr v-if="!detail.charges.length"><td colspan="6" class="muted">{{ t('لا توجد بنود بعد') }}</td></tr>
            </tbody>
          </table>
        </div>

        <h4 class="mt-2">{{ t('الدفعات') }}</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('التاريخ') }}</th><th>{{ t('المبلغ') }}</th><th>{{ t('الطريقة') }}</th><th>{{ t('ملاحظات') }}</th></tr></thead>
            <tbody>
              <tr v-for="p in detail.payments" :key="p.id">
                <td dir="ltr">{{ p.date }}</td>
                <td class="num">{{ hMoney(p.amount) }}</td>
                <td>{{ payMethodLabel(p.method) }}</td>
                <td>{{ p.notes || '—' }}</td>
              </tr>
              <tr v-if="!detail.payments.length"><td colspan="4" class="muted">{{ t('لا توجد دفعات بعد') }}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" @click="previewFolio">👁️ {{ t('معاينة الحساب') }}</button>
          <button v-if="can('hotel-billing', 'add') && detail.status !== 'checked_out' && detail.status !== 'cancelled'" class="btn btn-ghost" @click="showCharge = true">{{ t('+ بند') }}</button>
          <button v-if="can('hotel-billing', 'add') && detail.status !== 'checked_out' && detail.status !== 'cancelled'" class="btn btn-ghost" @click="showPayment = true">{{ t('+ دفعة') }}</button>
          <button v-if="can('hotel-billing', 'edit') && detail.status === 'checked_in'" class="btn btn-primary" @click="showCheckout = true">{{ t('تسجيل خروج وتحصيل') }}</button>
          <button class="btn btn-ghost" @click="detail = null">{{ t('إغلاق') }}</button>
        </div>
      </div>
    </div>

    <!-- إضافة بند -->
    <div v-if="showCharge" class="modal-overlay" @click.self="showCharge = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ t('إضافة بند للحساب') }}</h3>
        <div class="form-grid">
          <label class="span2">{{ t('الخدمة') }}
            <select v-model="chargeForm.service_id" @change="servicePicked">
              <option value="">{{ t('بند يدوي (بدون خدمة)') }}</option>
              <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }} · {{ hMoney(s.price) }}</option>
            </select>
          </label>
          <label class="span2">{{ t('البيان') }} <input v-model.trim="chargeForm.description"></label>
          <label>{{ t('الكمية') }} <input type="number" min="0.001" step="any" v-model.number="chargeForm.qty"></label>
          <label>{{ t('سعر الوحدة') }} <input type="number" min="0" step="any" v-model.number="chargeForm.unit_price"></label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="chargeForm.date" dir="ltr"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showCharge = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveCharge" :disabled="folioBusy || !chargeForm.description">{{ t('إضافة') }}</button>
        </div>
      </div>
    </div>

    <!-- تسجيل دفعة -->
    <div v-if="showPayment" class="modal-overlay" @click.self="showPayment = false">
      <div class="modal" style="max-width:480px;">
        <h3>{{ t('تسجيل دفعة') }}</h3>
        <div class="form-grid">
          <label>{{ t('المبلغ') }} <input type="number" min="0.01" step="any" v-model.number="paymentForm.amount"></label>
          <label>{{ t('طريقة الدفع') }}
            <select v-model="paymentForm.method">
              <option v-for="m in (info.payment_methods || [])" :key="m.code" :value="m.code">{{ (m.icon ? m.icon + ' ' : '') + m.name }}</option>
            </select>
          </label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="paymentForm.date" dir="ltr"></label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="paymentForm.notes"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showPayment = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="savePayment" :disabled="folioBusy || !(hNum(paymentForm.amount) > 0)">{{ t('تسجيل الدفعة') }}</button>
        </div>
      </div>
    </div>

    <!-- تسجيل الخروج -->
    <div v-if="showCheckout" class="modal-overlay" @click.self="showCheckout = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ t('تسجيل الخروج وتحصيل الحساب') }}</h3>
        <div class="form-grid">
          <label>{{ t('تاريخ الخروج') }} <input type="date" v-model="checkoutForm.date" dir="ltr"></label>
          <label>{{ t('الخصم') }} <input type="number" min="0" step="any" v-model.number="checkoutForm.discount"></label>
          <label>{{ t('طريقة الدفع') }}
            <select v-model="checkoutForm.payment_method">
              <option v-for="m in (info.payment_methods || [])" :key="m.code" :value="m.code">{{ (m.icon ? m.icon + ' ' : '') + m.name }}</option>
            </select>
          </label>
          <label>{{ t('المبلغ المحصّل الآن') }} <input type="number" min="0" step="any" v-model.number="checkoutForm.paid_amount"></label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="checkoutForm.notes"></label>
        </div>
        <p class="muted mt-1">{{ t('سيتم ترحيل الإيراد وضريبة القيمة المضافة إلى القيود، وأي رصيد متبقٍ يُسجَّل على ذمم النزلاء.') }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showCheckout = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="doCheckout" :disabled="folioBusy">{{ folioBusy ? t('جارٍ التنفيذ...') : t('تأكيد الخروج') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- حساب النزيل والفوترة ----------
const HotelBillingView = {
  name: 'HotelBillingView',
  mixins: [CommonMixin, HotelHelpers, HotelFolioMixin],
  data() {
    return {
      bookings: [], loading: true, alert: null, search: '', statusFilter: ''
    };
  },
  async created() { await Promise.all([this.load(), this.loadHotelServices()]); },
  computed: {
    filtered() {
      const f = this.search.trim();
      if (!f) return this.bookings;
      return this.bookings.filter(b =>
        (b.booking_no || '').includes(f) || (b.guest_name || '').includes(f) || (b.room_no || '').includes(f));
    },
    totals() {
      return {
        active: this.filtered.length,
        roomNights: this.filtered.reduce((s, b) => s + this.hNum(b.nights), 0),
        expected: this.filtered.reduce((s, b) => s + this.hNum(b.rate) * this.hNum(b.nights), 0)
      };
    }
  },
  methods: {
    async load() {
      this.loading = true;
      try { this.bookings = await this.api(`/api/companies/${this.company.id}/hotel/bookings?status=reserved&status=checked_in`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async afterFolioChange() { await this.load(); }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="cards-grid mb-2">
      <div class="stat-card"><div class="icon">🧾</div><div class="label">{{ t('حسابات مفتوحة') }}</div><div class="value">{{ totals.active }}</div></div>
      <div class="stat-card"><div class="icon">🛏️</div><div class="label">{{ t('ليالٍ محجوزة') }}</div><div class="value">{{ totals.roomNights }}</div></div>
      <div class="stat-card"><div class="icon">💵</div><div class="label">{{ t('القيمة المتوقعة') }}</div><div class="value">{{ hMoney(totals.expected) }}</div></div>
    </div>

    <div class="flex-between flex-wrap mb-2">
      <p class="muted">{{ t('تابع الحسابات المفتوحة، أضف البنود والدفعات، وسجّل الخروج مع ترحيل الإيراد.') }}</p>
      <div class="flex flex-wrap">
        <input :placeholder="t('بحث برقم الحجز أو النزيل...')" v-model="search" style="min-width:220px;">
        <button class="btn btn-sm btn-ghost" @click="load">🔄 {{ t('تحديث') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('الحسابات المفتوحة') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('رقم الحجز') }}</th><th>{{ t('النزيل') }}</th><th>{{ t('الغرفة') }}</th><th>{{ t('الوصول') }}</th><th>{{ t('المغادرة') }}</th><th>{{ t('الليالي') }}</th><th>{{ t('الحالة') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="b in filtered" :key="b.id">
                <td class="monospace">{{ b.booking_no }}</td>
                <td>{{ b.guest_name }}</td>
                <td>{{ b.room_no || '—' }}</td>
                <td dir="ltr">{{ b.check_in_date }}</td>
                <td dir="ltr">{{ b.check_out_date }}</td>
                <td class="num">{{ b.nights }}</td>
                <td><span class="badge" :class="bookingStatusColor(b.status)">{{ bookingStatusLabel(b.status) }}</span></td>
                <td><button class="btn btn-sm btn-primary" @click="openBookingDetail(b)">{{ t('فتح الحساب') }}</button></td>
              </tr>
              <tr v-if="!filtered.length"><td colspan="8" class="muted">{{ t('لا توجد حسابات مفتوحة') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-overlay" @click.self="detail = null">
      <div class="modal" style="max-width:820px;">
        <h3>{{ t('حساب نزيل') }} — {{ detail.booking_no }}</h3>
        <p class="muted">
          {{ detail.guest_name }} · {{ detail.room_no || '—' }} · {{ detail.check_in_date }} → {{ detail.check_out_date }}
          · <span class="badge" :class="bookingStatusColor(detail.status)">{{ bookingStatusLabel(detail.status) }}</span>
        </p>
        <div class="cards-grid mb-2">
          <div class="stat-card"><div class="label">{{ t('إجمالي البنود') }}</div><div class="value">{{ hMoney(detail.folio.sub_total) }}</div></div>
          <div class="stat-card"><div class="label">{{ t('ضريبة القيمة المضافة') }}</div><div class="value">{{ hMoney(detail.folio.vat) }}</div></div>
          <div class="stat-card"><div class="label">{{ t('الإجمالي') }}</div><div class="value">{{ hMoney(detail.folio.total) }}</div></div>
          <div class="stat-card"><div class="label">{{ t('المتبقي') }}</div><div class="value">{{ hMoney(detail.folio.balance) }}</div></div>
        </div>
        <h4 class="mt-2">{{ t('بنود الحساب') }}</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('التاريخ') }}</th><th>{{ t('البيان') }}</th><th>{{ t('الكمية') }}</th><th>{{ t('السعر') }}</th><th>{{ t('المبلغ') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="c in detail.charges" :key="c.id">
                <td dir="ltr">{{ c.date }}</td>
                <td>{{ c.description }}</td>
                <td class="num">{{ c.qty }}</td>
                <td class="num">{{ hMoney(c.unit_price) }}</td>
                <td class="num">{{ hMoney(c.amount) }}</td>
                <td><button v-if="can('hotel-billing', 'delete') && c.charge_type !== 'room'" class="btn btn-sm btn-ghost" @click="removeCharge(c)">✕</button></td>
              </tr>
              <tr v-if="!detail.charges.length"><td colspan="6" class="muted">{{ t('لا توجد بنود بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
        <h4 class="mt-2">{{ t('الدفعات') }}</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('التاريخ') }}</th><th>{{ t('المبلغ') }}</th><th>{{ t('الطريقة') }}</th><th>{{ t('ملاحظات') }}</th></tr></thead>
            <tbody>
              <tr v-for="p in detail.payments" :key="p.id">
                <td dir="ltr">{{ p.date }}</td>
                <td class="num">{{ hMoney(p.amount) }}</td>
                <td>{{ payMethodLabel(p.method) }}</td>
                <td>{{ p.notes || '—' }}</td>
              </tr>
              <tr v-if="!detail.payments.length"><td colspan="4" class="muted">{{ t('لا توجد دفعات بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="previewFolio">👁️ {{ t('معاينة الحساب') }}</button>
          <button v-if="can('hotel-billing', 'add') && detail.status !== 'checked_out' && detail.status !== 'cancelled'" class="btn btn-ghost" @click="showCharge = true">{{ t('+ بند') }}</button>
          <button v-if="can('hotel-billing', 'add') && detail.status !== 'checked_out' && detail.status !== 'cancelled'" class="btn btn-ghost" @click="showPayment = true">{{ t('+ دفعة') }}</button>
          <button v-if="can('hotel-billing', 'edit') && detail.status === 'checked_in'" class="btn btn-primary" @click="showCheckout = true">{{ t('تسجيل خروج وتحصيل') }}</button>
          <button class="btn btn-ghost" @click="detail = null">{{ t('إغلاق') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showCharge" class="modal-overlay" @click.self="showCharge = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ t('إضافة بند للحساب') }}</h3>
        <div class="form-grid">
          <label class="span2">{{ t('الخدمة') }}
            <select v-model="chargeForm.service_id" @change="servicePicked">
              <option value="">{{ t('بند يدوي (بدون خدمة)') }}</option>
              <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }} · {{ hMoney(s.price) }}</option>
            </select>
          </label>
          <label class="span2">{{ t('البيان') }} <input v-model.trim="chargeForm.description"></label>
          <label>{{ t('الكمية') }} <input type="number" min="0.001" step="any" v-model.number="chargeForm.qty"></label>
          <label>{{ t('سعر الوحدة') }} <input type="number" min="0" step="any" v-model.number="chargeForm.unit_price"></label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="chargeForm.date" dir="ltr"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showCharge = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveCharge" :disabled="folioBusy || !chargeForm.description">{{ t('إضافة') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showPayment" class="modal-overlay" @click.self="showPayment = false">
      <div class="modal" style="max-width:480px;">
        <h3>{{ t('تسجيل دفعة') }}</h3>
        <div class="form-grid">
          <label>{{ t('المبلغ') }} <input type="number" min="0.01" step="any" v-model.number="paymentForm.amount"></label>
          <label>{{ t('طريقة الدفع') }}
            <select v-model="paymentForm.method">
              <option v-for="m in (info.payment_methods || [])" :key="m.code" :value="m.code">{{ (m.icon ? m.icon + ' ' : '') + m.name }}</option>
            </select>
          </label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="paymentForm.date" dir="ltr"></label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="paymentForm.notes"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showPayment = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="savePayment" :disabled="folioBusy || !(hNum(paymentForm.amount) > 0)">{{ t('تسجيل الدفعة') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showCheckout" class="modal-overlay" @click.self="showCheckout = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ t('تسجيل الخروج وتحصيل الحساب') }}</h3>
        <div class="form-grid">
          <label>{{ t('تاريخ الخروج') }} <input type="date" v-model="checkoutForm.date" dir="ltr"></label>
          <label>{{ t('الخصم') }} <input type="number" min="0" step="any" v-model.number="checkoutForm.discount"></label>
          <label>{{ t('طريقة الدفع') }}
            <select v-model="checkoutForm.payment_method">
              <option v-for="m in (info.payment_methods || [])" :key="m.code" :value="m.code">{{ (m.icon ? m.icon + ' ' : '') + m.name }}</option>
            </select>
          </label>
          <label>{{ t('المبلغ المحصّل الآن') }} <input type="number" min="0" step="any" v-model.number="checkoutForm.paid_amount"></label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="checkoutForm.notes"></label>
        </div>
        <p class="muted mt-1">{{ t('سيتم ترحيل الإيراد وضريبة القيمة المضافة إلى القيود، وأي رصيد متبقٍ يُسجَّل على ذمم النزلاء.') }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showCheckout = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="doCheckout" :disabled="folioBusy">{{ folioBusy ? t('جارٍ التنفيذ...') : t('تأكيد الخروج') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};
