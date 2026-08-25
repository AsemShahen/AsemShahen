'use strict';

// ==================== نظام المشافي: مكونات الشاشات ====================
const hospitalUI = Vue.reactive({ patientFilter: null, tab: 'bills' });

const serviceCategories = {
  consultation: 'كشف واستشارات',
  lab: 'مختبر وأشعة',
  surgery: 'عمليات جراحية',
  inpatient: 'تنويم وإقامة',
  pharmacy: 'صيدلية',
  emergency: 'طوارئ',
  other: 'أخرى'
};
function serviceCategoryLabel(c) { return t((serviceCategories[c] || serviceCategories.other)); }

const appointmentStatuses = {
  scheduled: { t: 'مجدول', c: 'yellow' },
  checked_in: { t: 'تم الحضور', c: 'blue' },
  completed: { t: 'مكتمل', c: 'green' },
  cancelled: { t: 'ملغي', c: 'gray' },
  no_show: { t: 'لم يحضر', c: 'red' }
};
function appointmentStatus(s) { return appointmentStatuses[s] || { t: s, c: 'gray' }; }

const genders = ['ذكر', 'أنثى'];
const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// ==================== لوحة تحكم المشفى ====================
const HospitalDashboardView = {
  name: 'HospitalDashboardView',
  mixins: [CommonMixin],
  data() { return { loading: true, d: null, alert: null }; },
  async created() {
    try { this.d = await this.api(`/api/companies/${this.company.id}/hospital/dashboard`); }
    catch (e) { this.toast(e.message, 'error'); }
    finally { this.loading = false; }
  },
  computed: {
    maxRevenue() {
      if (!this.d || !this.d.revenue || !this.d.revenue.length) return 1;
      return Math.max(...this.d.revenue.map(r => Number(r.amount)), 1);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>
    <div v-if="!d" class="empty-state"><div class="icon">⏳</div><p>{{ t('جاري التحميل...') }}</p></div>
    <template v-if="d">
      <div class="cards-grid">
        <div class="stat-card">
          <div class="icon">🧑</div>
          <div class="label">{{ t('المرضى') }}</div>
          <div class="value">{{ d.patients }}</div>
          <div class="sub">{{ t('إجمالي المرضى المسجلين') }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">📅</div>
          <div class="label">{{ t('مواعيد اليوم') }}</div>
          <div class="value">{{ d.appointmentsToday }}</div>
          <div class="sub">{{ t('مواعيد مجدولة قادمة:') }} {{ d.appointmentsScheduled }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">🩺</div>
          <div class="label">{{ t('الأطباء') }}</div>
          <div class="value">{{ d.doctors }}</div>
          <div class="sub">{{ t('أطباء نشطون') }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">💊</div>
          <div class="label">{{ t('الخدمات الطبية') }}</div>
          <div class="value">{{ d.services }}</div>
          <div class="sub">{{ t('خدمات قابلة للفوترة') }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">🧾</div>
          <div class="label">{{ t('فواتير العلاج') }}</div>
          <div class="value">{{ d.bills.n }}</div>
          <div class="sub">{{ t('إجمالي الفوترة:') }} {{ fmt.money(d.bills.t) }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">📥</div>
          <div class="label">{{ t('مستحقات غير مسددة') }}</div>
          <div class="value">{{ fmt.money(d.outstanding) }}</div>
          <div class="sub">{{ t('ذمم مرضى وتأمين') }}</div>
        </div>
        <div class="stat-card">
          <div class="icon">💵</div>
          <div class="label">{{ t('إيرادات الخدمات الطبية') }}</div>
          <div class="value pos">{{ fmt.money(d.revenueTotal) }}</div>
          <div class="sub">{{ t('ضمن السنة المالية الحالية') }}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('الإيرادات حسب نوع الخدمة') }}</h3></div>
        <div class="panel-body">
          <div style="display:flex;align-items:flex-end;gap:10px;height:170px;padding:10px 0;">
            <div v-for="r in d.revenue" :key="r.code" style="flex:1;text-align:center;">
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">{{ fmt.num(r.amount) }}</div>
              <div :style="{ height: Math.max(Number(r.amount)/maxRevenue*130, 4) + 'px', background: 'linear-gradient(180deg, var(--primary), var(--primary-light))', borderRadius: '6px 6px 0 0', minWidth: '20px' }"></div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">{{ r.name }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
  `
};

// ==================== المرضى ====================
const HospitalPatientsView = {
  name: 'HospitalPatientsView',
  mixins: [CommonMixin],
  data() {
    return {
      patients: [], loading: true, alert: null, filter: '',
      showModal: false, editing: null, form: {}, deleting: null
    };
  },
  async created() { await this.load(); },
  computed: {
    win() { return 'hosp-patients'; },
    genders() { return genders; },
    bloodTypes() { return bloodTypes; },
    filtered() {
      const f = this.filter.trim();
      if (!f) return this.patients;
      return this.patients.filter(p =>
        p.name.includes(f) || p.patient_no.includes(f) || (p.phone || '').includes(f) ||
        (p.national_id || '').includes(f) || (p.insurance_company || '').includes(f));
    }
  },
  methods: {
    async load() {
      try { this.patients = await this.api(`/api/companies/${this.company.id}/hospital/patients`); }
      catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    openCreate() {
      this.editing = null;
      this.form = { name: '', national_id: '', gender: 'ذكر', birth_date: '', phone: '', email: '', address: '', blood_type: 'O+', insurance_company: '', notes: '' };
      this.showModal = true;
    },
    openEdit(p) {
      this.editing = p;
      this.form = { name: p.name, national_id: p.national_id, gender: p.gender, birth_date: p.birth_date, phone: p.phone, email: p.email, address: p.address, blood_type: p.blood_type, insurance_company: p.insurance_company, notes: p.notes };
      this.showModal = true;
    },
    async save() {
      try {
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/hospital/patients/${this.editing.id}`, { method: 'PUT', body: this.form });
          this.toast(t('تم تحديث بيانات المريض'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hospital/patients`, { method: 'POST', body: this.form });
          this.toast(t('تم تسجيل المريض'));
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    confirmDelete(p) { this.deleting = p; },
    async doDelete() {
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/patients/${this.deleting.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف المريض'));
        this.deleting = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    showRecords(p) {
      hospitalUI.patientFilter = p.id;
      this.$parent.navigate('hosp-records');
    },
    newAppointment(p) {
      hospitalUI.patientFilter = p.id;
      this.$parent.navigate('hosp-appointments');
    },
    preview() {
      const rows = this.filtered.map(p => [
        p.patient_no, p.name, p.gender || '—', p.phone || '—', p.insurance_company || '—', this.fmt.money(p.outstanding || 0)
      ]);
      this.openPrintPreview({
        title: t('المرضى'),
        sub: this.company.name,
        cols: [t('رقم المريض'), t('الاسم'), t('الجنس'), t('الهاتف'), t('شركة التأمين'), t('المستحق')],
        rows
      });
    },
    exportData() {
      const rows = this.filtered.map(p => [p.patient_no, p.name, p.gender || '', p.phone || '', p.insurance_company || '', this.fmt.num(p.outstanding || 0)]);
      this.exportCsv(`patients-${this.company.id}`, ['patient_no', 'name', 'gender', 'phone', 'insurance', 'outstanding'], rows);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <input v-if="can(win, 'search')" :placeholder="t('بحث بالاسم أو الرقم أو الهاتف...')" v-model="filter" style="min-width:250px;">
        <p class="muted">{{ t('عدد المرضى: {n}', { n: patients.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button v-if="can(win, 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button v-if="can(win, 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can(win, 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ {{ t('تصدير CSV') }}</button>
        <button v-if="can(win, 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('مريض جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('المرضى') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('رقم المريض') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('الجنس') }}</th><th>{{ t('الهاتف') }}</th><th>{{ t('شركة التأمين') }}</th><th>{{ t('الزيارات') }}</th><th>{{ t('المستحق') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="p in filtered" :key="p.id">
                <td class="monospace"><strong>{{ p.patient_no }}</strong></td>
                <td><strong>{{ p.name }}</strong>
                  <span v-if="p.blood_type" class="badge gray" style="margin-right:6px;">{{ p.blood_type }}</span>
                </td>
                <td>{{ p.gender ? t(p.gender) : '—' }}</td>
                <td dir="ltr" style="text-align:right;">{{ p.phone || '—' }}</td>
                <td>{{ p.insurance_company || '—' }}</td>
                <td>{{ p.visits_count || 0 }}</td>
                <td class="num">{{ fmt.money(p.outstanding || 0) }}</td>
                <td>
                  <button v-if="can(win, 'view')" class="btn btn-sm btn-ghost" @click="showRecords(p)">{{ t('السجل') }}</button>
                  <button v-if="can('hosp-appointments', 'add')" class="btn btn-sm btn-ghost" @click="newAppointment(p)">{{ t('موعد') }}</button>
                  <button v-if="can(win, 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(p)">{{ t('تعديل') }}</button>
                  <button v-if="can(win, 'delete')" class="btn btn-sm btn-danger" @click="confirmDelete(p)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!patients.length"><td colspan="8" class="muted">{{ t('لا يوجد مرضى بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:760px;">
        <h3>{{ editing ? t('تعديل بيانات مريض') : t('تسجيل مريض جديد') }}</h3>
        <div class="form-grid">
          <label class="span2">{{ t('الاسم الكامل') }} <input v-model.trim="form.name"></label>
          <label>{{ t('رقم الهوية') }} <input v-model.trim="form.national_id" dir="ltr"></label>
          <label>{{ t('الجنس') }}
            <select v-model="form.gender">
              <option v-for="g in genders" :key="g" :value="g">{{ t(g) }}</option>
            </select>
          </label>
          <label>{{ t('تاريخ الميلاد') }} <input type="date" v-model="form.birth_date"></label>
          <label>{{ t('الهاتف') }} <input v-model.trim="form.phone" dir="ltr"></label>
          <label>{{ t('فصيلة الدم') }}
            <select v-model="form.blood_type">
              <option v-for="b in bloodTypes" :key="b" :value="b">{{ b }}</option>
            </select>
          </label>
          <label>{{ t('شركة التأمين الصحي') }} <input v-model.trim="form.insurance_company"></label>
          <label class="span2">{{ t('البريد الإلكتروني') }} <input v-model.trim="form.email" dir="ltr"></label>
          <label class="span2">{{ t('العنوان') }} <input v-model.trim="form.address"></label>
          <label class="span2">{{ t('ملاحظات') }} <textarea v-model.trim="form.notes" rows="2"></textarea></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="!form.name">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="deleting" class="modal-overlay" @click.self="deleting = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد حذف المريض') }}</h3>
        <p>{{ t('هل أنت متأكد من حذف المريض {name}؟', { name: deleting.name }) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deleting = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDelete">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ==================== الأطباء والأقسام ====================
const HospitalDoctorsView = {
  name: 'HospitalDoctorsView',
  mixins: [CommonMixin],
  data() {
    return {
      doctors: [], departments: [], loading: true, alert: null, showAll: false,
      showDoctorModal: false, editingDoctor: null, doctorForm: {}, deletingDoctor: null,
      showDeptModal: false, editingDept: null, deptForm: {}, deletingDept: null
    };
  },
  async created() { await this.load(); },
  computed: {
    win() { return 'hosp-doctors'; },
    visibleDoctors() { return this.showAll ? this.doctors : this.doctors.filter(d => d.is_active); },
    activeDepartments() { return this.departments.filter(d => d.is_active); }
  },
  methods: {
    async load() {
      try {
        const [doctors, departments] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/hospital/doctors?all=1`),
          this.api(`/api/companies/${this.company.id}/hospital/departments`)
        ]);
        this.doctors = doctors;
        this.departments = departments;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    deptName(id) {
      const d = this.departments.find(x => x.id === id);
      return d ? d.name : '—';
    },
    openCreateDoctor() {
      this.editingDoctor = null;
      this.doctorForm = { name: '', specialty: '', department_id: null, qualification: '', phone: '', email: '', consultation_fee: 0, is_active: true };
      this.showDoctorModal = true;
    },
    openEditDoctor(d) {
      this.editingDoctor = d;
      this.doctorForm = { name: d.name, specialty: d.specialty, department_id: d.department_id, qualification: d.qualification, phone: d.phone, email: d.email, consultation_fee: d.consultation_fee, is_active: !!d.is_active };
      this.showDoctorModal = true;
    },
    async saveDoctor() {
      try {
        if (this.editingDoctor) {
          await this.api(`/api/companies/${this.company.id}/hospital/doctors/${this.editingDoctor.id}`, { method: 'PUT', body: this.doctorForm });
          this.toast(t('تم تحديث بيانات الطبيب'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hospital/doctors`, { method: 'POST', body: this.doctorForm });
          this.toast(t('تمت إضافة الطبيب'));
        }
        this.showDoctorModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    confirmDeleteDoctor(d) { this.deletingDoctor = d; },
    async doDeleteDoctor() {
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/doctors/${this.deletingDoctor.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف الطبيب'));
        this.deletingDoctor = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    openCreateDept() {
      this.editingDept = null;
      this.deptForm = { name: '', description: '', is_active: true };
      this.showDeptModal = true;
    },
    openEditDept(d) {
      this.editingDept = d;
      this.deptForm = { name: d.name, description: d.description, is_active: !!d.is_active };
      this.showDeptModal = true;
    },
    async saveDept() {
      try {
        if (this.editingDept) {
          await this.api(`/api/companies/${this.company.id}/hospital/departments/${this.editingDept.id}`, { method: 'PUT', body: this.deptForm });
          this.toast(t('تم تحديث القسم'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hospital/departments`, { method: 'POST', body: this.deptForm });
          this.toast(t('تمت إضافة القسم'));
        }
        this.showDeptModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    confirmDeleteDept(d) { this.deletingDept = d; },
    async doDeleteDept() {
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/departments/${this.deletingDept.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف القسم'));
        this.deletingDept = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.visibleDoctors.map(d => [d.name, d.specialty || '—', this.deptName(d.department_id), this.fmt.money(d.consultation_fee || 0), d.is_active ? t('نشط') : t('موقوف')]);
      this.openPrintPreview({
        title: t('الأطباء'),
        sub: this.company.name,
        cols: [t('الاسم'), t('التخصص'), t('القسم'), t('رسوم الكشف'), t('الحالة')],
        rows
      });
    },
    exportData() {
      const rows = this.visibleDoctors.map(d => [d.name, d.specialty || '', this.deptName(d.department_id), this.fmt.num(d.consultation_fee || 0), d.is_active ? 'active' : 'inactive']);
      this.exportCsv(`doctors-${this.company.id}`, ['name', 'specialty', 'department', 'consultation_fee', 'status'], rows);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <label class="flex" style="flex-direction:row;align-items:center;gap:6px;">
          <input type="checkbox" v-model="showAll" style="width:auto;"> {{ t('عرض الموقوفين') }}
        </label>
        <p class="muted">{{ t('عدد الأطباء: {n}', { n: doctors.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button v-if="can(win, 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button v-if="can(win, 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can(win, 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ {{ t('تصدير CSV') }}</button>
        <button v-if="can(win, 'add')" class="btn btn-primary" @click="openCreateDoctor">+ {{ t('طبيب جديد') }}</button>
        <button v-if="can(win, 'add')" class="btn btn-ghost" @click="openCreateDept">+ {{ t('قسم جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('الأطباء') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('الاسم') }}</th><th>{{ t('التخصص') }}</th><th>{{ t('القسم') }}</th><th>{{ t('المؤهل') }}</th><th>{{ t('الهاتف') }}</th><th>{{ t('رسوم الكشف') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="d in visibleDoctors" :key="d.id">
                <td><strong>{{ d.name }}</strong></td>
                <td>{{ d.specialty || '—' }}</td>
                <td>{{ deptName(d.department_id) }}</td>
                <td>{{ d.qualification || '—' }}</td>
                <td dir="ltr" style="text-align:right;">{{ d.phone || '—' }}</td>
                <td class="num">{{ fmt.money(d.consultation_fee || 0) }}</td>
                <td><span class="badge" :class="d.is_active ? 'green' : 'gray'">{{ d.is_active ? t('نشط') : t('موقوف') }}</span></td>
                <td>
                  <button v-if="can(win, 'edit')" class="btn btn-sm btn-ghost" @click="openEditDoctor(d)">{{ t('تعديل') }}</button>
                  <button v-if="can(win, 'delete')" class="btn btn-sm btn-danger" @click="confirmDeleteDoctor(d)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!visibleDoctors.length"><td colspan="8" class="muted">{{ t('لا يوجد أطباء بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('الأقسام') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ t('اسم القسم') }}</th><th>{{ t('الوصف') }}</th><th>{{ t('عدد الأطباء') }}</th><th>{{ t('الحالة') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="d in departments" :key="d.id">
                <td><strong>{{ d.name }}</strong></td>
                <td>{{ d.description || '—' }}</td>
                <td>{{ d.doctors_count || 0 }}</td>
                <td><span class="badge" :class="d.is_active ? 'green' : 'gray'">{{ d.is_active ? t('نشط') : t('موقوف') }}</span></td>
                <td>
                  <button v-if="can(win, 'edit')" class="btn btn-sm btn-ghost" @click="openEditDept(d)">{{ t('تعديل') }}</button>
                  <button v-if="can(win, 'delete')" class="btn btn-sm btn-danger" @click="confirmDeleteDept(d)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!departments.length"><td colspan="5" class="muted">{{ t('لا توجد أقسام بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showDoctorModal" class="modal-overlay" @click.self="showDoctorModal = false">
      <div class="modal" style="max-width:680px;">
        <h3>{{ editingDoctor ? t('تعديل بيانات طبيب') : t('إضافة طبيب جديد') }}</h3>
        <div class="form-grid">
          <label class="span2">{{ t('اسم الطبيب') }} <input v-model.trim="doctorForm.name"></label>
          <label>{{ t('التخصص') }} <input v-model.trim="doctorForm.specialty"></label>
          <label>{{ t('القسم') }}
            <select v-model="doctorForm.department_id">
              <option :value="null">{{ t('بدون قسم') }}</option>
              <option v-for="d in activeDepartments" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </label>
          <label>{{ t('المؤهل العلمي') }} <input v-model.trim="doctorForm.qualification"></label>
          <label>{{ t('الهاتف') }} <input v-model.trim="doctorForm.phone" dir="ltr"></label>
          <label>{{ t('رسوم الكشف (ر.س)') }} <input type="number" v-model.number="doctorForm.consultation_fee" min="0"></label>
          <label class="span2">{{ t('البريد الإلكتروني') }} <input v-model.trim="doctorForm.email" dir="ltr"></label>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="doctorForm.is_active" style="width:auto;"> {{ t('الطبيب نشط') }}
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showDoctorModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveDoctor" :disabled="!doctorForm.name">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showDeptModal" class="modal-overlay" @click.self="showDeptModal = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ editingDept ? t('تعديل قسم') : t('إضافة قسم جديد') }}</h3>
        <div class="form-grid">
          <label class="span2">{{ t('اسم القسم') }} <input v-model.trim="deptForm.name"></label>
          <label class="span2">{{ t('الوصف') }} <textarea v-model.trim="deptForm.description" rows="2"></textarea></label>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="deptForm.is_active" style="width:auto;"> {{ t('القسم نشط') }}
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showDeptModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveDept" :disabled="!deptForm.name">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="deletingDoctor" class="modal-overlay" @click.self="deletingDoctor = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد حذف الطبيب') }}</h3>
        <p>{{ t('هل أنت متأكد من حذف الطبيب {name}؟', { name: deletingDoctor.name }) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deletingDoctor = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDeleteDoctor">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>

    <div v-if="deletingDept" class="modal-overlay" @click.self="deletingDept = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد حذف القسم') }}</h3>
        <p>{{ t('هل أنت متأكد من حذف القسم {name}؟', { name: deletingDept.name }) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deletingDept = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDeleteDept">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ==================== المواعيد ====================
const HospitalAppointmentsView = {
  name: 'HospitalAppointmentsView',
  mixins: [CommonMixin],
  data() {
    return {
      appointments: [], patients: [], doctors: [], departments: [], loading: true, alert: null,
      statusFilter: '', showModal: false, editing: null, form: {}, deleting: null
    };
  },
  async created() {
    await this.load();
    if (hospitalUI.patientFilter) {
      this.formPatient = hospitalUI.patientFilter;
      hospitalUI.patientFilter = null;
    }
  },
  computed: {
    win() { return 'hosp-appointments'; },
    activeDepartments() { return this.departments.filter(d => d.is_active); },
    activeDoctors() { return this.doctors.filter(d => d.is_active); },
    filtered() {
      if (!this.statusFilter) return this.appointments;
      return this.appointments.filter(a => a.status === this.statusFilter);
    }
  },
  methods: {
    async load() {
      try {
        const [appointments, patients, doctors, departments] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/hospital/appointments`),
          this.api(`/api/companies/${this.company.id}/hospital/patients`),
          this.api(`/api/companies/${this.company.id}/hospital/doctors`),
          this.api(`/api/companies/${this.company.id}/hospital/departments`)
        ]);
        this.appointments = appointments;
        this.patients = patients;
        this.doctors = doctors;
        this.departments = departments;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    apptStatus(s) { return appointmentStatus(s); },
    patientName(id) {
      const p = this.patients.find(x => x.id === id);
      return p ? p.name : '—';
    },
    doctorName(id) {
      const d = this.doctors.find(x => x.id === id);
      return d ? d.name : '—';
    },
    openCreate() {
      this.editing = null;
      this.form = {
        patient_id: this.formPatient || '', doctor_id: null, department_id: null,
        date: new Date().toISOString().slice(0, 10), time: '', reason: '', status: 'scheduled', notes: ''
      };
      this.showModal = true;
    },
    openEdit(a) {
      this.editing = a;
      this.form = {
        patient_id: a.patient_id, doctor_id: a.doctor_id, department_id: a.department_id,
        date: a.date, time: a.time, reason: a.reason, status: a.status, notes: a.notes
      };
      this.showModal = true;
    },
    async save() {
      try {
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/hospital/appointments/${this.editing.id}`, { method: 'PUT', body: this.form });
          this.toast(t('تم تحديث الموعد'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hospital/appointments`, { method: 'POST', body: this.form });
          this.toast(t('تمت جدولة الموعد'));
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async setStatus(a, status) {
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/appointments/${a.id}`, {
          method: 'PUT', body: { ...a, status }
        });
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    confirmDelete(a) { this.deleting = a; },
    async doDelete() {
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/appointments/${this.deleting.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف الموعد'));
        this.deleting = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.filtered.map(a => [
        a.date, a.time || '—', this.patientName(a.patient_id), this.doctorName(a.doctor_id), a.reason || '—', appointmentStatus(a.status).t
      ]);
      this.openPrintPreview({
        title: t('المواعيد'),
        sub: this.company.name,
        cols: [t('التاريخ'), t('الوقت'), t('المريض'), t('الطبيب'), t('سبب الزيارة'), t('الحالة')],
        rows
      });
    },
    exportData() {
      const rows = this.filtered.map(a => [a.date, a.time || '', this.patientName(a.patient_id), this.doctorName(a.doctor_id), a.reason || '', a.status]);
      this.exportCsv(`appointments-${this.company.id}`, ['date', 'time', 'patient', 'doctor', 'reason', 'status'], rows);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <select v-model="statusFilter" style="min-width:160px;">
          <option value="">{{ t('كل الحالات') }}</option>
          <option value="scheduled">{{ t('مجدول') }}</option>
          <option value="checked_in">{{ t('تم الحضور') }}</option>
          <option value="completed">{{ t('مكتمل') }}</option>
          <option value="cancelled">{{ t('ملغي') }}</option>
          <option value="no_show">{{ t('لم يحضر') }}</option>
        </select>
        <p class="muted">{{ t('عدد المواعيد: {n}', { n: appointments.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button v-if="can(win, 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button v-if="can(win, 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can(win, 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ {{ t('تصدير CSV') }}</button>
        <button v-if="can(win, 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('موعد جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('المواعيد') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('التاريخ') }}</th><th>{{ t('الوقت') }}</th><th>{{ t('المريض') }}</th><th>{{ t('الطبيب') }}</th><th>{{ t('سبب الزيارة') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="a in filtered" :key="a.id">
                <td>{{ fmt.date(a.date) }}</td>
                <td class="monospace">{{ a.time || '—' }}</td>
                <td><strong>{{ patientName(a.patient_id) }}</strong></td>
                <td>{{ doctorName(a.doctor_id) }}</td>
                <td style="white-space:normal;max-width:200px;">{{ a.reason || '—' }}</td>
                <td><span class="badge" :class="apptStatus(a.status).c">{{ apptStatus(a.status).t }}</span></td>
                <td>
                  <button v-if="a.status === 'scheduled' && can(win, 'edit')" class="btn btn-sm btn-ghost" @click="setStatus(a, 'checked_in')">{{ t('حضور') }}</button>
                  <button v-if="a.status === 'checked_in' && can(win, 'edit')" class="btn btn-sm btn-ghost" @click="setStatus(a, 'completed')">{{ t('إكمال') }}</button>
                  <button v-if="a.status === 'scheduled' && can(win, 'edit')" class="btn btn-sm btn-ghost" @click="setStatus(a, 'no_show')">{{ t('لم يحضر') }}</button>
                  <button v-if="a.status === 'scheduled' && can(win, 'edit')" class="btn btn-sm btn-ghost" @click="setStatus(a, 'cancelled')">{{ t('إلغاء') }}</button>
                  <button v-if="can(win, 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(a)">{{ t('تعديل') }}</button>
                  <button v-if="can(win, 'delete')" class="btn btn-sm btn-danger" @click="confirmDelete(a)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!appointments.length"><td colspan="7" class="muted">{{ t('لا توجد مواعيد بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:680px;">
        <h3>{{ editing ? t('تعديل موعد') : t('موعد جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('المريض') }}
            <select v-model="form.patient_id">
              <option value="">{{ t('اختر...') }}</option>
              <option v-for="p in patients" :key="p.id" :value="p.id">{{ p.name }} ({{ p.patient_no }})</option>
            </select>
          </label>
          <label>{{ t('القسم') }}
            <select v-model="form.department_id">
              <option :value="null">{{ t('بدون قسم') }}</option>
              <option v-for="d in activeDepartments" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </label>
          <label>{{ t('الطبيب') }}
            <select v-model="form.doctor_id">
              <option :value="null">{{ t('بدون طبيب') }}</option>
              <option v-for="d in activeDoctors" :key="d.id" :value="d.id">{{ d.name }}{{ d.specialty ? ' - ' + d.specialty : '' }}</option>
            </select>
          </label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="form.date"></label>
          <label>{{ t('الوقت') }} <input type="time" v-model="form.time"></label>
          <label>{{ t('الحالة') }}
            <select v-model="form.status">
              <option value="scheduled">{{ t('مجدول') }}</option>
              <option value="checked_in">{{ t('تم الحضور') }}</option>
              <option value="completed">{{ t('مكتمل') }}</option>
              <option value="cancelled">{{ t('ملغي') }}</option>
              <option value="no_show">{{ t('لم يحضر') }}</option>
            </select>
          </label>
          <label class="span2">{{ t('سبب الزيارة') }} <input v-model.trim="form.reason"></label>
          <label class="span2">{{ t('ملاحظات') }} <textarea v-model.trim="form.notes" rows="2"></textarea></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="!form.patient_id || !form.date">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="deleting" class="modal-overlay" @click.self="deleting = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد حذف الموعد') }}</h3>
        <p>{{ t('هل أنت متأكد من حذف الموعد؟') }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deleting = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDelete">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ==================== السجلات الطبية ====================
const HospitalRecordsView = {
  name: 'HospitalRecordsView',
  mixins: [CommonMixin],
  data() {
    return {
      records: [], patients: [], doctors: [], appointments: [], loading: true, alert: null,
      patientFilter: null, showModal: false, editing: null, form: {}, deleting: null
    };
  },
  async created() {
    await this.load();
    if (hospitalUI.patientFilter) {
      this.patientFilter = hospitalUI.patientFilter;
      hospitalUI.patientFilter = null;
      await this.load();
    }
  },
  computed: {
    win() { return 'hosp-records'; },
    filtered() {
      if (!this.patientFilter) return this.records;
      return this.records.filter(r => r.patient_id === this.patientFilter);
    }
  },
  methods: {
    async load() {
      try {
        const [records, patients, doctors] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/hospital/records`),
          this.api(`/api/companies/${this.company.id}/hospital/patients`),
          this.api(`/api/companies/${this.company.id}/hospital/doctors`)
        ]);
        this.records = records;
        this.patients = patients;
        this.doctors = doctors;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    patientName(id) {
      const p = this.patients.find(x => x.id === id);
      return p ? p.name : '—';
    },
    doctorName(id) {
      const d = this.doctors.find(x => x.id === id);
      return d ? d.name : '—';
    },
    openCreate() {
      this.editing = null;
      this.form = { patient_id: this.patientFilter || '', doctor_id: null, appointment_id: null, date: new Date().toISOString().slice(0, 10), symptoms: '', diagnosis: '', treatment: '', notes: '' };
      this.showModal = true;
    },
    openEdit(r) {
      this.editing = r;
      this.form = { patient_id: r.patient_id, doctor_id: r.doctor_id, appointment_id: r.appointment_id, date: r.date, symptoms: r.symptoms, diagnosis: r.diagnosis, treatment: r.treatment, notes: r.notes };
      this.showModal = true;
    },
    async save() {
      try {
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/hospital/records/${this.editing.id}`, { method: 'PUT', body: this.form });
          this.toast(t('تم تحديث السجل الطبي'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hospital/records`, { method: 'POST', body: this.form });
          this.toast(t('تمت إضافة السجل الطبي'));
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    confirmDelete(r) { this.deleting = r; },
    async doDelete() {
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/records/${this.deleting.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف السجل'));
        this.deleting = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.filtered.map(r => [r.date, this.patientName(r.patient_id), this.doctorName(r.doctor_id), r.diagnosis || '—', r.treatment || '—']);
      this.openPrintPreview({
        title: t('السجلات الطبية'),
        sub: this.company.name,
        cols: [t('التاريخ'), t('المريض'), t('الطبيب'), t('التشخيص'), t('العلاج')],
        rows
      });
    },
    exportData() {
      const rows = this.filtered.map(r => [r.date, this.patientName(r.patient_id), this.doctorName(r.doctor_id), r.symptoms || '', r.diagnosis || '', r.treatment || '']);
      this.exportCsv(`medical-records-${this.company.id}`, ['date', 'patient', 'doctor', 'symptoms', 'diagnosis', 'treatment'], rows);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <div class="flex flex-wrap">
        <select v-model="patientFilter" style="min-width:220px;" @change="patientFilter = Number(patientFilter) || null">
          <option :value="null">{{ t('كل المرضى') }}</option>
          <option v-for="p in patients" :key="p.id" :value="p.id">{{ p.name }} ({{ p.patient_no }})</option>
        </select>
        <p class="muted">{{ t('عدد السجلات: {n}', { n: filtered.length }) }}</p>
      </div>
      <div class="flex flex-wrap">
        <button v-if="can(win, 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
        <button v-if="can(win, 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
        <button v-if="can(win, 'export')" class="btn btn-sm btn-ghost" @click="exportData">⬇️ {{ t('تصدير CSV') }}</button>
        <button v-if="can(win, 'add')" class="btn btn-primary" @click="openCreate">+ {{ t('سجل طبي جديد') }}</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('السجلات الطبية') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('التاريخ') }}</th><th>{{ t('المريض') }}</th><th>{{ t('الطبيب') }}</th><th>{{ t('الأعراض') }}</th><th>{{ t('التشخيص') }}</th><th>{{ t('العلاج') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="r in filtered" :key="r.id">
                <td>{{ fmt.date(r.date) }}</td>
                <td><strong>{{ patientName(r.patient_id) }}</strong></td>
                <td>{{ doctorName(r.doctor_id) }}</td>
                <td style="white-space:normal;max-width:180px;">{{ r.symptoms || '—' }}</td>
                <td style="white-space:normal;max-width:200px;">{{ r.diagnosis || '—' }}</td>
                <td style="white-space:normal;max-width:200px;">{{ r.treatment || '—' }}</td>
                <td>
                  <button v-if="can(win, 'edit')" class="btn btn-sm btn-ghost" @click="openEdit(r)">{{ t('تعديل') }}</button>
                  <button v-if="can(win, 'delete')" class="btn btn-sm btn-danger" @click="confirmDelete(r)">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!filtered.length"><td colspan="7" class="muted">{{ t('لا توجد سجلات طبية بعد') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:760px;">
        <h3>{{ editing ? t('تعديل سجل طبي') : t('سجل طبي جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('المريض') }}
            <select v-model="form.patient_id">
              <option value="">{{ t('اختر...') }}</option>
              <option v-for="p in patients" :key="p.id" :value="p.id">{{ p.name }} ({{ p.patient_no }})</option>
            </select>
          </label>
          <label>{{ t('الطبيب') }}
            <select v-model="form.doctor_id">
              <option :value="null">{{ t('بدون طبيب') }}</option>
              <option v-for="d in doctors.filter(d => d.is_active)" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="form.date"></label>
          <label class="span2">{{ t('الأعراض') }} <textarea v-model.trim="form.symptoms" rows="2"></textarea></label>
          <label class="span2">{{ t('التشخيص') }} <textarea v-model.trim="form.diagnosis" rows="2"></textarea></label>
          <label class="span2">{{ t('العلاج والوصفات') }} <textarea v-model.trim="form.treatment" rows="2"></textarea></label>
          <label class="span2">{{ t('ملاحظات') }} <textarea v-model.trim="form.notes" rows="2"></textarea></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="!form.patient_id || !form.date">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="deleting" class="modal-overlay" @click.self="deleting = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد حذف السجل') }}</h3>
        <p>{{ t('هل أنت متأكد من حذف هذا السجل الطبي؟') }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deleting = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDelete">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ==================== فوترة المرضى والخدمات ====================
const HospitalBillingView = {
  name: 'HospitalBillingView',
  mixins: [CommonMixin],
  data() {
    return {
      tab: hospitalUI.tab, bills: [], patients: [], services: [], methods: [], loading: true, alert: null,
      statusFilter: '',
      showBillModal: false, saving: false, billForm: {}, payModal: null, paying: false, detail: null,
      showServiceModal: false, editingService: null, serviceForm: {}, deletingService: null, deletingBill: null,
      addServiceId: null
    };
  },
  async created() { await this.load(); },
  computed: {
    win() { return 'hosp-billing'; },
    serviceCategories() { return serviceCategories; },
    activeServices() { return this.services.filter(s => s.is_active); },
    filteredBills() {
      if (!this.statusFilter) return this.bills;
      return this.bills.filter(b => b.status === this.statusFilter);
    }
  },
  methods: {
    serviceCatLabel(c) { return serviceCategoryLabel(c); },
    setTab(tab) { this.tab = tab; hospitalUI.tab = tab; },
    async load() {
      try {
        const [bills, patients, services, methods] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/hospital/bills`),
          this.api(`/api/companies/${this.company.id}/hospital/patients`),
          this.api(`/api/companies/${this.company.id}/hospital/services`),
          this.api(`/api/companies/${this.company.id}/payment-methods`)
        ]);
        this.bills = bills;
        this.patients = patients;
        this.services = services;
        this.methods = methods;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    patientName(id) {
      const p = this.patients.find(x => x.id === id);
      return p ? p.name : '—';
    },
    // ---------- فواتير ----------
    openCreateBill() {
      this.billForm = {
        patient_id: '', payer: 'patient', date: new Date().toISOString().slice(0, 10),
        vat_rate: Number(this.info.settings.vat_rate) || 15, discount: 0, payment_method: 'cash',
        paid_amount: null, notes: '', lines: []
      };
      this.showBillModal = true;
    },
    emptyBillLine(svc) {
      return { service_id: svc ? svc.id : null, description: svc ? svc.name : '', qty: 1, unit_price: svc ? svc.price : null, discount: 0, account_code: svc ? svc.account_code : '' };
    },
    addServiceLine() {
      const svc = this.activeServices.find(s => s.id === this.addServiceId);
      if (!svc) return this.toast(t('اختر خدمة لإضافتها'), 'error');
      this.billForm.lines.push(this.emptyBillLine(svc));
      this.addServiceId = null;
    },
    removeBillLine(i) { this.billForm.lines.splice(i, 1); },
    billSubTotal() { return this.billForm.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0) - (Number(l.discount) || 0), 0); },
    billTaxable() { return Math.max(this.billSubTotal() - (Number(this.billForm.discount) || 0), 0); },
    billVatAmount() { return this.billTaxable() * (Number(this.billForm.vat_rate) || 0) / 100; },
    billTotal() { return this.billTaxable() + this.billVatAmount(); },
    canSaveBill() {
      return this.billForm.patient_id && this.billForm.lines.length && this.billTotal() > 0;
    },
    async saveBill() {
      this.saving = true;
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/bills`, {
          method: 'POST',
          body: {
            patient_id: Number(this.billForm.patient_id), payer: this.billForm.payer, date: this.billForm.date,
            vat_rate: Number(this.billForm.vat_rate), discount: Number(this.billForm.discount) || 0,
            payment_method: this.billForm.payment_method,
            paid_amount: this.billForm.paid_amount !== null ? Number(this.billForm.paid_amount) : undefined,
            notes: this.billForm.notes,
            lines: this.billForm.lines.map(l => ({
              service_id: l.service_id, description: l.description, qty: Number(l.qty) || 1,
              unit_price: Number(l.unit_price) || 0, discount: Number(l.discount) || 0, account_code: l.account_code
            }))
          }
        });
        this.toast(t('تم إنشاء فاتورة العلاج وتسجيل القيد المحاسبي تلقائياً'));
        this.showBillModal = false;
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    openPay(bill) {
      this.payModal = { bill, amount: (bill.total - bill.paid_amount).toFixed(2), method: 'cash' };
    },
    async doPay() {
      this.paying = true;
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/bills/${this.payModal.bill.id}/pay`, {
          method: 'POST', body: { amount: Number(this.payModal.amount), method: this.payModal.method, date: new Date().toISOString().slice(0, 10) }
        });
        this.toast(t('تم تسجيل الدفعة'));
        this.payModal = null;
        await this.load();
        this.$emit('refresh');
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.paying = false; }
    },
    remaining(bill) { return bill.total - bill.paid_amount; },
    async openDetail(bill) {
      try { this.detail = await this.api(`/api/companies/${this.company.id}/hospital/bills/${bill.id}`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    confirmDeleteBill(b) { this.deletingBill = b; },
    async doDeleteBill() {
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/bills/${this.deletingBill.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف فاتورة العلاج مع قيدها المحاسبي'));
        this.deletingBill = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    previewBills() {
      const rows = this.filteredBills.map(b => [
        b.bill_no, this.patientName(b.patient_id), b.date, this.fmt.money(b.total), this.fmt.money(b.vat),
        this.fmt.payMethod(b.payment_method, this.methods), this.fmt.money(b.paid_amount), this.fmt.invStatus(b.status).t
      ]);
      this.openPrintPreview({
        title: t('فواتير العلاج'),
        sub: `${this.company.name} - ${t('السنة المالية {fy}', { fy: this.info.active_fiscal_year ? this.info.active_fiscal_year.name : '' })}`,
        cols: [t('رقم الفاتورة'), t('المريض'), t('التاريخ'), t('الإجمالي'), t('الضريبة'), t('طريقة الدفع'), t('المدفوع'), t('الحالة')],
        rows
      });
    },
    exportBills() {
      const rows = this.filteredBills.map(b => [
        b.bill_no, this.patientName(b.patient_id), b.date, this.fmt.num(b.total), this.fmt.num(b.vat),
        b.payment_method, this.fmt.num(b.paid_amount), b.status, b.payer
      ]);
      this.exportCsv(`hospital-bills-${this.company.id}`, ['bill_no', 'patient', 'date', 'total', 'vat', 'payment_method', 'paid', 'status', 'payer'], rows);
    },
    previewBillDetail(bill) {
      const b = bill;
      const rows = (b.lines || []).map(l => [l.description, l.qty, this.fmt.money(l.unit_price), this.fmt.money(l.line_total)]);
      this.openPrintPreview({
        title: `${t('فاتورة علاج')} ${b.bill_no}`,
        sub: `${this.patientName(b.patient_id)} - ${b.date}`,
        cols: [t('الوصف'), t('الكمية'), t('سعر الوحدة'), t('الإجمالي')],
        rows,
        footer: [
          `${t('الإجمالي قبل الضريبة:')} ${this.fmt.money(b.sub_total - b.discount)}`,
          `${t('الضريبة:')} ${this.fmt.money(b.vat)}`,
          `${t('الإجمالي:')} ${this.fmt.money(b.total)}`,
          `${t('المدفوع:')} ${this.fmt.money(b.paid_amount)}`
        ]
      });
    },
    // ---------- الخدمات ----------
    openCreateService() {
      this.editingService = null;
      this.serviceForm = { code: '', name: '', category: 'consultation', price: 0, cost: 0, account_code: '', vat_applicable: true, is_active: true };
      this.showServiceModal = true;
    },
    openEditService(s) {
      this.editingService = s;
      this.serviceForm = { code: s.code, name: s.name, category: s.category, price: s.price, cost: s.cost, account_code: s.account_code, vat_applicable: !!s.vat_applicable, is_active: !!s.is_active };
      this.showServiceModal = true;
    },
    async saveService() {
      try {
        if (this.editingService) {
          await this.api(`/api/companies/${this.company.id}/hospital/services/${this.editingService.id}`, { method: 'PUT', body: this.serviceForm });
          this.toast(t('تم تحديث الخدمة'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hospital/services`, { method: 'POST', body: this.serviceForm });
          this.toast(t('تمت إضافة الخدمة'));
        }
        this.showServiceModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    confirmDeleteService(s) { this.deletingService = s; },
    async doDeleteService() {
      try {
        await this.api(`/api/companies/${this.company.id}/hospital/services/${this.deletingService.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف الخدمة'));
        this.deletingService = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    exportServices() {
      const rows = this.services.map(s => [s.code, s.name, this.serviceCatLabel(s.category), this.fmt.num(s.price), this.fmt.num(s.cost), s.is_active ? 'active' : 'inactive']);
      this.exportCsv(`hospital-services-${this.company.id}`, ['code', 'name', 'category', 'price', 'cost', 'status'], rows);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex mb-2" style="gap:8px;">
      <button class="btn" :class="tab === 'bills' ? 'btn-primary' : 'btn-ghost'" @click="setTab('bills')">🧾 {{ t('فواتير العلاج') }}</button>
      <button class="btn" :class="tab === 'services' ? 'btn-primary' : 'btn-ghost'" @click="setTab('services')">💊 {{ t('الخدمات الطبية') }}</button>
    </div>

    <div v-if="tab === 'bills'">
      <div class="flex-between flex-wrap mb-2">
        <div class="flex flex-wrap">
          <select v-model="statusFilter" style="min-width:150px;">
            <option value="">{{ t('كل الحالات') }}</option>
            <option value="paid">{{ t('مدفوعة') }}</option>
            <option value="partial">{{ t('مدفوعة جزئياً') }}</option>
            <option value="unpaid">{{ t('غير مدفوعة') }}</option>
          </select>
          <p class="muted">{{ t('عدد الفواتير: {n}', { n: bills.length }) }}</p>
        </div>
        <div class="flex flex-wrap">
          <button v-if="can(win, 'print_preview')" class="btn btn-sm btn-ghost" @click="previewBills">👁️ {{ t('معاينة قبل الطباعة') }}</button>
          <button v-if="can(win, 'print')" class="btn btn-sm btn-ghost" @click="doPrint">🖨️ {{ t('طباعة') }}</button>
          <button v-if="can(win, 'export')" class="btn btn-sm btn-ghost" @click="exportBills">⬇️ {{ t('تصدير CSV') }}</button>
          <button v-if="can(win, 'add')" class="btn btn-primary" @click="openCreateBill">+ {{ t('فاتورة علاج') }}</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('فواتير العلاج') }}</h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ t('رقم الفاتورة') }}</th><th>{{ t('المريض') }}</th><th>{{ t('التاريخ') }}</th><th>{{ t('الإجمالي') }}</th><th>{{ t('الضريبة') }}</th><th>{{ t('طريقة الدفع') }}</th><th>{{ t('المدفوع') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="b in filteredBills" :key="b.id">
                  <td class="monospace"><strong>{{ b.bill_no }}</strong></td>
                  <td>{{ patientName(b.patient_id) }}</td>
                  <td>{{ fmt.date(b.date) }}</td>
                  <td class="num">{{ fmt.money(b.total) }}</td>
                  <td class="num">{{ fmt.money(b.vat) }}</td>
                  <td>{{ fmt.payMethod(b.payment_method, methods) }}</td>
                  <td class="num">{{ fmt.money(b.paid_amount) }}</td>
                  <td><span class="badge" :class="fmt.invStatus(b.status).c">{{ fmt.invStatus(b.status).t }}</span></td>
                  <td>
                    <button v-if="can(win, 'view')" class="btn btn-sm btn-ghost" @click="openDetail(b)">{{ t('تفاصيل') }}</button>
                    <button v-if="b.status !== 'paid' && can(win, 'edit')" class="btn btn-sm btn-primary" @click="openPay(b)">{{ t('تحصيل') }}</button>
                    <button v-if="can(win, 'delete')" class="btn btn-sm btn-danger" @click="confirmDeleteBill(b)">{{ t('حذف') }}</button>
                  </td>
                </tr>
                <tr v-if="!bills.length"><td colspan="9" class="muted">{{ t('لا توجد فواتير علاج بعد') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div v-else>
      <div class="flex-between flex-wrap mb-2">
        <p class="muted">{{ t('عدد الخدمات: {n}', { n: services.length }) }}</p>
        <div class="flex flex-wrap">
          <button v-if="can(win, 'export')" class="btn btn-sm btn-ghost" @click="exportServices">⬇️ {{ t('تصدير CSV') }}</button>
          <button v-if="can(win, 'add')" class="btn btn-primary" @click="openCreateService">+ {{ t('خدمة جديدة') }}</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('الخدمات الطبية القابلة للفوترة') }}</h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ t('الرمز') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('التصنيف') }}</th><th>{{ t('السعر (ر.س)') }}</th><th>{{ t('التكلفة (ر.س)') }}</th><th>{{ t('ضريبة') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="s in services" :key="s.id">
                  <td class="monospace">{{ s.code }}</td>
                  <td><strong>{{ s.name }}</strong></td>
                  <td>{{ serviceCatLabel(s.category) }}</td>
                  <td class="num">{{ fmt.money(s.price) }}</td>
                  <td class="num">{{ fmt.money(s.cost) }}</td>
                  <td><span class="badge" :class="s.vat_applicable ? 'yellow' : 'gray'">{{ s.vat_applicable ? t('خاضع') : t('معفى') }}</span></td>
                  <td><span class="badge" :class="s.is_active ? 'green' : 'gray'">{{ s.is_active ? t('نشط') : t('موقوف') }}</span></td>
                  <td>
                    <button v-if="can(win, 'edit')" class="btn btn-sm btn-ghost" @click="openEditService(s)">{{ t('تعديل') }}</button>
                    <button v-if="can(win, 'delete')" class="btn btn-sm btn-danger" @click="confirmDeleteService(s)">{{ t('حذف') }}</button>
                  </td>
                </tr>
                <tr v-if="!services.length"><td colspan="8" class="muted">{{ t('لا توجد خدمات بعد') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showBillModal" class="modal-overlay" @click.self="showBillModal = false">
      <div class="modal" style="max-width:900px;">
        <h3>{{ t('فاتورة علاج جديدة') }}</h3>
        <div class="form-grid">
          <label>{{ t('المريض') }}
            <select v-model="billForm.patient_id">
              <option value="">{{ t('اختر...') }}</option>
              <option v-for="p in patients" :key="p.id" :value="p.id">{{ p.name }} ({{ p.patient_no }})</option>
            </select>
          </label>
          <label>{{ t('المسؤول عن السداد') }}
            <select v-model="billForm.payer">
              <option value="patient">{{ t('المريض') }}</option>
              <option value="insurance">{{ t('شركة التأمين') }}</option>
            </select>
          </label>
          <label>{{ t('التاريخ') }} <input type="date" v-model="billForm.date"></label>
          <label>{{ t('نسبة الضريبة (%)') }} <input type="number" v-model.number="billForm.vat_rate"></label>
          <label>{{ t('طريقة الدفع') }}
            <select v-model="billForm.payment_method">
              <option v-for="m in methods" :key="m.code" :value="m.code">{{ m.name }}</option>
            </select>
          </label>
          <label v-if="billForm.payment_method === 'credit' || billForm.payment_method === 'check'">{{ t('المبلغ المدفوع الآن') }}
            <input type="number" v-model.number="billForm.paid_amount" placeholder="0.00">
          </label>
          <label>{{ t('الخصم على الفاتورة') }}
            <input type="number" v-model.number="billForm.discount" placeholder="0.00">
          </label>
          <label class="span2">{{ t('ملاحظات') }} <input v-model.trim="billForm.notes"></label>
        </div>

        <div class="flex mt-2" style="gap:8px;align-items:center;">
          <select v-model="addServiceId" style="flex:1;min-width:200px;">
            <option :value="null">{{ t('اختر خدمة لإضافتها للفاتورة...') }}</option>
            <option v-for="s in activeServices" :key="s.id" :value="s.id">{{ s.name }} - {{ fmt.money(s.price) }}</option>
          </select>
          <button class="btn btn-ghost" @click="addServiceLine">+ {{ t('إضافة') }}</button>
        </div>

        <div class="entry-lines mt-2">
          <div class="line-row line-head" style="grid-template-columns:1.4fr 90px 120px 100px 40px;">
            <span>{{ t('الخدمة / الوصف') }}</span><span>{{ t('الكمية') }}</span><span>{{ t('سعر الوحدة') }}</span><span>{{ t('الإجمالي') }}</span><span></span>
          </div>
          <div class="line-row" style="grid-template-columns:1.4fr 90px 120px 100px 40px;" v-for="(l, idx) in billForm.lines" :key="idx">
            <input v-model.trim="l.description">
            <input type="number" v-model.number="l.qty" min="0">
            <input type="number" v-model.number="l.unit_price" min="0">
            <span class="num">{{ fmt.money((Number(l.qty)||0) * (Number(l.unit_price)||0) - (Number(l.discount)||0)) }}</span>
            <button class="btn btn-sm btn-danger" @click="removeBillLine(idx)">✕</button>
          </div>
        </div>

        <div class="flex-between mt-2">
          <div></div>
          <div style="text-align:left;">
            <div>{{ t('الإجمالي قبل الضريبة:') }} <strong class="monospace">{{ fmt.money(billTaxable()) }}</strong></div>
            <div>{{ t('الضريبة ({rate}%):', { rate: billForm.vat_rate || 0 }) }} <strong class="monospace">{{ fmt.money(billVatAmount()) }}</strong></div>
            <div style="font-size:16px;">{{ t('الإجمالي:') }} <strong class="monospace" style="color:var(--primary);">{{ fmt.money(billTotal()) }}</strong></div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showBillModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveBill" :disabled="!canSaveBill || saving">{{ saving ? t('جارٍ الحفظ...') : t('حفظ الفاتورة') }}</button>
        </div>
      </div>
    </div>

    <div v-if="payModal" class="modal-overlay" @click.self="payModal = null">
      <div class="modal" style="max-width:420px;">
        <h3>{{ t('تحصيل') }} - {{ payModal.bill.bill_no }}</h3>
        <div class="form-grid">
          <label>{{ t('المبلغ') }}
            <input type="number" v-model.number="payModal.amount" min="0" :max="remaining(payModal.bill)">
          </label>
          <label>{{ t('طريقة الدفع') }}
            <select v-model="payModal.method">
              <option v-for="m in methods" :key="m.code" :value="m.code">{{ m.name }}</option>
            </select>
          </label>
        </div>
        <p class="muted mt-2">{{ t('الرصيد المتبقي:') }} {{ fmt.money(remaining(payModal.bill)) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="payModal = null">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="doPay" :disabled="paying || Number(payModal.amount) <= 0">{{ t('تأكيد الدفع') }}</button>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-overlay" @click.self="detail = null">
      <div class="modal" style="max-width:720px;">
        <h3>{{ t('فاتورة علاج - {no}', { no: detail.bill_no }) }}</h3>
        <div class="flex-between">
          <div class="muted">{{ patientName(detail.patient_id) }} - {{ detail.date }}</div>
          <div class="muted">{{ t('المسؤول عن السداد:') }} {{ detail.payer === 'insurance' ? t('شركة التأمين') : t('المريض') }}</div>
        </div>
        <div class="table-wrap mt-2">
          <table>
            <thead><tr><th>{{ t('الخدمة') }}</th><th>{{ t('الكمية') }}</th><th>{{ t('سعر الوحدة') }}</th><th>{{ t('الإجمالي') }}</th></tr></thead>
            <tbody>
              <tr v-for="l in detail.lines" :key="l.id">
                <td>{{ l.description }}</td>
                <td class="num">{{ l.qty }}</td>
                <td class="num">{{ fmt.money(l.unit_price) }}</td>
                <td class="num">{{ fmt.money(l.line_total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex-between mt-2">
          <div class="muted">{{ detail.notes || '' }}</div>
          <div style="text-align:left;">
            <div>{{ t('الإجمالي قبل الضريبة:') }} <strong class="monospace">{{ fmt.money(detail.sub_total - detail.discount) }}</strong></div>
            <div>{{ t('الضريبة:') }} <strong class="monospace">{{ fmt.money(detail.vat) }}</strong></div>
            <div style="font-size:16px;">{{ t('الإجمالي:') }} <strong class="monospace" style="color:var(--primary);">{{ fmt.money(detail.total) }}</strong></div>
            <div>{{ t('المدفوع:') }} <strong class="monospace">{{ fmt.money(detail.paid_amount) }}</strong></div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="previewBillDetail(detail)">🖨️ {{ t('طباعة') }}</button>
          <button class="btn btn-primary" @click="detail = null">{{ t('إغلاق') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showServiceModal" class="modal-overlay" @click.self="showServiceModal = false">
      <div class="modal" style="max-width:680px;">
        <h3>{{ editingService ? t('تعديل خدمة') : t('إضافة خدمة جديدة') }}</h3>
        <div class="form-grid">
          <label>{{ t('الرمز') }} <input v-model.trim="serviceForm.code" dir="ltr" :placeholder="t('اختياري')"></label>
          <label>{{ t('التصنيف') }}
            <select v-model="serviceForm.category">
              <option v-for="(label, key) in serviceCategories" :key="key" :value="key">{{ t(label) }}</option>
            </select>
          </label>
          <label class="span2">{{ t('اسم الخدمة') }} <input v-model.trim="serviceForm.name"></label>
          <label>{{ t('السعر (ر.س)') }} <input type="number" v-model.number="serviceForm.price" min="0"></label>
          <label>{{ t('التكلفة (ر.س)') }} <input type="number" v-model.number="serviceForm.cost" min="0"></label>
          <label>{{ t('حساب الإيراد (رمز الحساب)') }} <input v-model.trim="serviceForm.account_code" dir="ltr" placeholder="4114"></label>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="serviceForm.vat_applicable" style="width:auto;"> {{ t('خاضعة لضريبة القيمة المضافة') }}
          </label>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="serviceForm.is_active" style="width:auto;"> {{ t('الخدمة نشطة') }}
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showServiceModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveService" :disabled="!serviceForm.name">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <div v-if="deletingService" class="modal-overlay" @click.self="deletingService = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد حذف الخدمة') }}</h3>
        <p>{{ t('هل أنت متأكد من حذف الخدمة {name}؟', { name: deletingService.name }) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deletingService = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDeleteService">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>

    <div v-if="deletingBill" class="modal-overlay" @click.self="deletingBill = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد حذف فاتورة العلاج') }}</h3>
        <p>{{ t('سيتم حذف الفاتورة والقيد المحاسبي المرتبط بها. متابعة؟') }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deletingBill = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDeleteBill">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};
