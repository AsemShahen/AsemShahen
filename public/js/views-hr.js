'use strict';

// ==================== نظام الموارد البشرية ====================

// ---------- الموظفون والأقسام والحضور ----------
const HrEmployeesView = {
  name: 'HrEmployeesView',
  mixins: [CommonMixin],
  data() {
    return {
      tab: 'employees',
      employees: [], departments: [], attendance: [],
      loading: true, alert: null,
      empFilter: '', showInactive: false,
      month: new Date().toISOString().slice(0, 7),
      showEmpModal: false, editingEmp: null, empForm: {}, saving: false,
      showDeptModal: false, editingDept: null, deptForm: {}, deletingDept: null
    };
  },
  async created() { await this.loadAll(); },
  computed: {
    filteredEmployees() {
      const f = this.empFilter.trim();
      return this.employees.filter(e =>
        (!f || e.name.includes(f) || (e.emp_no || '').includes(f) || (e.job_title || '').includes(f)));
    }
  },
  methods: {
    async loadAll() {
      try {
        const [emps, depts] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/hr/employees?all=${this.showInactive ? 1 : 0}`),
          this.api(`/api/companies/${this.company.id}/hr/departments`)
        ]);
        this.employees = emps; this.departments = depts;
        if (this.tab === 'attendance') await this.loadAttendance();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async loadAttendance() {
      try {
        this.attendance = await this.api(`/api/companies/${this.company.id}/hr/attendance?month=${this.month}`);
        const map = Object.fromEntries(this.attendance.map(a => [a.employee_id, a]));
        for (const e of this.employees) {
          const a = map[e.id] || {};
          e._wd = a.working_days || 0; e._pd = a.present_days || 0; e._ad = a.absent_days || 0;
          e._ld = a.late_days || 0; e._ot = a.overtime_hours || 0; e._notes = a.notes || '';
        }
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async switchTab(t) {
      this.tab = t;
      if (t === 'attendance') await this.loadAttendance();
    },
    deptName(id) {
      const d = this.departments.find(x => x.id === id);
      return d ? d.name : '—';
    },
    // ---- الموظفون ----
    openEmpCreate() {
      this.editingEmp = null;
      this.empForm = { name: '', emp_no: '', national_id: '', gender: '', birth_date: '', phone: '', email: '', address: '', department_id: '', job_title: '', hire_date: new Date().toISOString().slice(0, 10), basic_salary: 0, allowances: 0, bank_account: '', status: 'active', notes: '' };
      this.showEmpModal = true;
    },
    openEmpEdit(e) {
      this.editingEmp = e;
      this.empForm = { ...e, department_id: e.department_id || '' };
      this.showEmpModal = true;
    },
    async saveEmp() {
      this.saving = true;
      try {
        const body = { ...this.empForm, department_id: this.empForm.department_id || null };
        if (this.editingEmp) {
          await this.api(`/api/companies/${this.company.id}/hr/employees/${this.editingEmp.id}`, { method: 'PUT', body });
          this.toast(t('تم تحديث بيانات الموظف'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hr/employees`, { method: 'POST', body });
          this.toast(t('تمت إضافة الموظف'));
        }
        this.showEmpModal = false;
        await this.loadAll();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async removeEmp(e) {
      if (!confirm(t('هل أنت متأكد من حذف هذا الموظف؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hr/employees/${e.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.loadAll();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    // ---- الأقسام ----
    openDeptCreate() {
      this.editingDept = null;
      this.deptForm = { name: '', code: '', parent_id: '', manager_employee_id: '', description: '' };
      this.showDeptModal = true;
    },
    openDeptEdit(d) {
      this.editingDept = d;
      this.deptForm = { name: d.name, code: d.code, parent_id: d.parent_id || '', manager_employee_id: d.manager_employee_id || '', description: d.description || '' };
      this.showDeptModal = true;
    },
    async saveDept() {
      this.saving = true;
      try {
        const body = { ...this.deptForm, parent_id: this.deptForm.parent_id || null, manager_employee_id: this.deptForm.manager_employee_id || null };
        if (this.editingDept) {
          await this.api(`/api/companies/${this.company.id}/hr/departments/${this.editingDept.id}`, { method: 'PUT', body });
          this.toast(t('تم تحديث القسم'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hr/departments`, { method: 'POST', body });
          this.toast(t('تمت إضافة القسم'));
        }
        this.showDeptModal = false;
        await this.loadAll();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async confirmDeptDelete(d) {
      if (!confirm(t('هل أنت متأكد من حذف هذا القسم؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hr/departments/${d.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.loadAll();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    // ---- الحضور ----
    async saveAtt(e) {
      try {
        await this.api(`/api/companies/${this.company.id}/hr/attendance`, {
          method: 'PUT',
          body: {
            employee_id: e.id, month: this.month,
            working_days: Number(e._wd) || 0, present_days: Number(e._pd) || 0,
            absent_days: Number(e._ad) || 0, late_days: Number(e._ld) || 0,
            overtime_hours: Number(e._ot) || 0, notes: e._notes || ''
          }
        });
        this.toast(t('تم حفظ الحضور'));
        await this.loadAttendance();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    allActiveEmployees() {
      return this.employees.filter(e => e.status === 'active');
    },
    preview() {
      const rows = this.filteredEmployees.map(e => [e.emp_no, e.name, this.deptName(e.department_id), e.job_title || '—', this.fmt.money(e.basic_salary)]);
      this.openPrintPreview({
        title: t('الموظفون'),
        sub: this.company.name,
        cols: [t('رقم الموظف'), t('الاسم'), t('القسم'), t('المسمى الوظيفي'), t('الراتب الأساسي')],
        rows
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex mb-2">
      <button class="btn btn-sm" :class="tab === 'employees' ? 'btn-primary' : 'btn-ghost'" @click="switchTab('employees')">{{ t('الموظفون') }}</button>
      <button class="btn btn-sm" :class="tab === 'departments' ? 'btn-primary' : 'btn-ghost'" @click="switchTab('departments')">{{ t('الأقسام') }}</button>
      <button class="btn btn-sm" :class="tab === 'attendance' ? 'btn-primary' : 'btn-ghost'" @click="switchTab('attendance')">{{ t('الحضور والانصراف') }}</button>
    </div>

    <!-- ===== الموظفون ===== -->
    <template v-if="tab === 'employees'">
      <div class="flex-between flex-wrap mb-2">
        <div class="flex flex-wrap">
          <input v-if="can('hr-employees', 'search')" :placeholder="t('بحث بالاسم أو الرقم...')" v-model="empFilter" style="min-width:220px;">
          <label class="flex" style="flex-direction:row;align-items:center;gap:6px;font-size:13px;">
            <input type="checkbox" v-model="showInactive" @change="loadAll" style="width:auto;"> {{ t('إظهار الموقوفين') }}
          </label>
          <p class="muted">{{ t('عدد الموظفين: {n}', { n: employees.length }) }}</p>
        </div>
        <div class="flex flex-wrap">
          <button v-if="can('hr-employees', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
          <button v-if="can('hr-employees', 'add')" class="btn btn-primary" @click="openEmpCreate">+ {{ t('موظف جديد') }}</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('الموظفون') }}</h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ t('رقم الموظف') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('القسم') }}</th><th>{{ t('المسمى الوظيفي') }}</th><th>{{ t('الراتب الأساسي') }}</th><th>{{ t('البدلات') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="e in filteredEmployees" :key="e.id">
                  <td class="monospace"><strong>{{ e.emp_no }}</strong></td>
                  <td>{{ e.name }}</td>
                  <td>{{ deptName(e.department_id) }}</td>
                  <td>{{ e.job_title || '—' }}</td>
                  <td class="num">{{ fmt.money(e.basic_salary) }}</td>
                  <td class="num">{{ fmt.money(e.allowances) }}</td>
                  <td><span class="badge" :class="e.status === 'active' ? 'green' : 'red'">{{ e.status === 'active' ? t('نشط') : t('موقوف') }}</span></td>
                  <td>
                    <button v-if="can('hr-employees', 'edit')" class="btn btn-sm btn-ghost" @click="openEmpEdit(e)">{{ t('تعديل') }}</button>
                    <button v-if="can('hr-employees', 'delete')" class="btn btn-sm btn-ghost" @click="removeEmp(e)">{{ t('حذف') }}</button>
                  </td>
                </tr>
                <tr v-if="!filteredEmployees.length"><td colspan="8" class="muted">{{ t('لا يوجد موظفون') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- ===== الأقسام ===== -->
    <template v-if="tab === 'departments'">
      <div class="flex-between flex-wrap mb-2">
        <p class="muted">{{ t('عدد الأقسام: {n}', { n: departments.length }) }}</p>
        <button v-if="can('hr-employees', 'add')" class="btn btn-primary" @click="openDeptCreate">+ {{ t('قسم جديد') }}</button>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('الأقسام') }}</h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ t('رمز القسم') }}</th><th>{{ t('اسم القسم') }}</th><th>{{ t('الوصف') }}</th><th>{{ t('عدد الموظفين') }}</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="d in departments" :key="d.id">
                  <td class="monospace"><strong>{{ d.code }}</strong></td>
                  <td>{{ d.name }}</td>
                  <td>{{ d.description || '—' }}</td>
                  <td>{{ d.employees_count }}</td>
                  <td>
                    <button v-if="can('hr-employees', 'edit')" class="btn btn-sm btn-ghost" @click="openDeptEdit(d)">{{ t('تعديل') }}</button>
                    <button v-if="can('hr-employees', 'delete')" class="btn btn-sm btn-ghost" @click="confirmDeptDelete(d)">{{ t('حذف') }}</button>
                  </td>
                </tr>
                <tr v-if="!departments.length"><td colspan="5" class="muted">{{ t('لا توجد أقسام') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- ===== الحضور والانصراف ===== -->
    <template v-if="tab === 'attendance'">
      <div class="flex-between flex-wrap mb-2">
        <div class="flex flex-wrap">
          <input type="month" v-model="month" style="min-width:180px;" @change="loadAttendance">
          <p class="muted">{{ t('عدد الموظفين: {n}', { n: allActiveEmployees().length }) }}</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('الحضور والانصراف — {month}', { month }) }}</h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ t('الموظف') }}</th><th>{{ t('القسم') }}</th><th style="min-width:70px;">{{ t('أيام العمل') }}</th><th style="min-width:70px;">{{ t('أيام الحضور') }}</th>
                  <th style="min-width:70px;">{{ t('أيام الغياب') }}</th><th style="min-width:70px;">{{ t('أيام التأخير') }}</th><th style="min-width:70px;">{{ t('ساعات إضافية') }}</th><th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in allActiveEmployees()" :key="e.id">
                  <td><strong>{{ e.name }}</strong> <span class="muted" dir="ltr">{{ e.emp_no }}</span></td>
                  <td>{{ deptName(e.department_id) }}</td>
                  <td><input type="number" min="0" step="0.5" v-model.number="e._wd"></td>
                  <td><input type="number" min="0" step="0.5" v-model.number="e._pd"></td>
                  <td><input type="number" min="0" step="0.5" v-model.number="e._ad"></td>
                  <td><input type="number" min="0" step="0.5" v-model.number="e._ld"></td>
                  <td><input type="number" min="0" step="0.5" v-model.number="e._ot"></td>
                  <td><button class="btn btn-sm btn-primary" @click="saveAtt(e)">{{ t('حفظ') }}</button></td>
                </tr>
                <tr v-if="!allActiveEmployees().length"><td colspan="8" class="muted">{{ t('لا يوجد موظفون') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- نافذة موظف -->
    <div v-if="showEmpModal" class="modal-overlay" @click.self="showEmpModal = false">
      <div class="modal" style="max-width:680px;">
        <h3>{{ editingEmp ? t('تعديل موظف') : t('إضافة موظف جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('الاسم') }} <input v-model.trim="empForm.name" required></label>
          <label>{{ t('رقم الموظف') }} <input v-model.trim="empForm.emp_no" dir="ltr" :placeholder="t('تلقائي')"></label>
          <label>{{ t('رقم الهوية') }} <input v-model.trim="empForm.national_id" dir="ltr"></label>
          <label>{{ t('الجنس') }}
            <select v-model="empForm.gender">
              <option value=""></option><option value="ذكر">{{ t('ذكر') }}</option><option value="أنثى">{{ t('أنثى') }}</option>
            </select>
          </label>
          <label>{{ t('تاريخ الميلاد') }} <input type="date" v-model="empForm.birth_date"></label>
          <label>{{ t('الهاتف') }} <input v-model.trim="empForm.phone" dir="ltr"></label>
          <label>{{ t('البريد الإلكتروني') }} <input v-model.trim="empForm.email" dir="ltr"></label>
          <label>{{ t('القسم') }}
            <select v-model="empForm.department_id">
              <option value="">—</option>
              <option v-for="d in departments" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
            </select>
          </label>
          <label>{{ t('المسمى الوظيفي') }} <input v-model.trim="empForm.job_title"></label>
          <label>{{ t('تاريخ التعيين') }} <input type="date" v-model="empForm.hire_date" required></label>
          <label>{{ t('الراتب الأساسي') }} <input type="number" min="0" step="0.01" v-model.number="empForm.basic_salary"></label>
          <label>{{ t('البدلات') }} <input type="number" min="0" step="0.01" v-model.number="empForm.allowances"></label>
          <label>{{ t('رقم الحساب البنكي') }} <input v-model.trim="empForm.bank_account" dir="ltr"></label>
          <label>{{ t('الحالة') }}
            <select v-model="empForm.status">
              <option value="active">{{ t('نشط') }}</option><option value="terminated">{{ t('موقوف') }}</option>
            </select>
          </label>
          <label class="span-2">{{ t('العنوان') }} <input v-model.trim="empForm.address"></label>
          <label class="span-2">{{ t('ملاحظات') }} <textarea v-model="empForm.notes" rows="2"></textarea></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showEmpModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveEmp" :disabled="saving || !empForm.name">{{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <!-- نافذة قسم -->
    <div v-if="showDeptModal" class="modal-overlay" @click.self="showDeptModal = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ editingDept ? t('تعديل قسم') : t('إضافة قسم جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('اسم القسم') }} <input v-model.trim="deptForm.name" required></label>
          <label>{{ t('رمز القسم') }} <input v-model.trim="deptForm.code" dir="ltr" :placeholder="t('تلقائي')"></label>
          <label>{{ t('القسم الأب') }}
            <select v-model="deptForm.parent_id">
              <option value="">—</option>
              <option v-for="d in departments.filter(x => !editingDept || x.id !== editingDept.id)" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
            </select>
          </label>
          <label>{{ t('مدير القسم') }}
            <select v-model="deptForm.manager_employee_id">
              <option value="">—</option>
              <option v-for="e in employees" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
            </select>
          </label>
          <label class="span-2">{{ t('الوصف') }} <textarea v-model="deptForm.description" rows="2"></textarea></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showDeptModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveDept" :disabled="saving || !deptForm.name">{{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- الإجازات ----------
const HrLeavesView = {
  name: 'HrLeavesView',
  mixins: [CommonMixin],
  data() {
    return {
      tab: 'leaves',
      leaves: [], leaveTypes: [], employees: [],
      loading: true, alert: null,
      leaveFilter: '', statusFilter: '',
      showLeaveModal: false, editingLeave: null, leaveForm: {}, saving: false,
      showTypeModal: false, editingType: null, typeForm: {}
    };
  },
  async created() { await this.loadAll(); },
  computed: {
    filteredLeaves() {
      const f = this.leaveFilter.trim();
      return this.leaves.filter(l =>
        (!this.statusFilter || l.status === this.statusFilter) &&
        (!f || l.employee_name.includes(f) || (l.emp_no || '').includes(f) || (l.leave_no || '').includes(f)));
    }
  },
  methods: {
    async loadAll() {
      try {
        const [leaves, types, emps] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/hr/leaves`),
          this.api(`/api/companies/${this.company.id}/hr/leave-types`),
          this.api(`/api/companies/${this.company.id}/hr/employees`)
        ]);
        this.leaves = leaves; this.leaveTypes = types; this.employees = emps;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async switchTab(t) { this.tab = t; },
    typeName(id) {
      const x = this.leaveTypes.find(t => t.id === id);
      return x ? x.name : '—';
    },
    statusLabel(s) {
      return { pending: t('قيد المعالجة'), approved: t('معتمدة'), rejected: t('مرفوضة'), cancelled: t('ملغاة') }[s] || s;
    },
    statusClass(s) {
      return { pending: 'yellow', approved: 'green', rejected: 'red', cancelled: 'gray' }[s] || 'gray';
    },
    openLeaveCreate() {
      this.editingLeave = null;
      this.leaveForm = { employee_id: '', leave_type_id: '', start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), notes: '' };
      this.showLeaveModal = true;
    },
    openLeaveEdit(l) {
      this.editingLeave = l;
      this.leaveForm = { employee_id: String(l.employee_id), leave_type_id: String(l.leave_type_id), start_date: l.start_date, end_date: l.end_date, notes: l.notes || '' };
      this.showLeaveModal = true;
    },
    async saveLeave() {
      this.saving = true;
      try {
        const body = { ...this.leaveForm, employee_id: Number(this.leaveForm.employee_id), leave_type_id: Number(this.leaveForm.leave_type_id) };
        if (this.editingLeave) {
          await this.api(`/api/companies/${this.company.id}/hr/leaves/${this.editingLeave.id}`, { method: 'PUT', body });
          this.toast(t('تم تحديث الإجازة'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hr/leaves`, { method: 'POST', body });
          this.toast(t('تمت إضافة الإجازة'));
        }
        this.showLeaveModal = false;
        await this.loadAll();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async setStatus(l, status) {
      try {
        await this.api(`/api/companies/${this.company.id}/hr/leaves/${l.id}/status`, { method: 'PUT', body: { status } });
        this.toast(t('تم تحديث الحالة'));
        await this.loadAll();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async removeLeave(l) {
      if (!confirm(t('هل أنت متأكد من حذف هذه الإجازة؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hr/leaves/${l.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.loadAll();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    openTypeCreate() {
      this.editingType = null;
      this.typeForm = { name: '', code: '', days_per_year: 21, is_paid: true };
      this.showTypeModal = true;
    },
    openTypeEdit(t) {
      this.editingType = t;
      this.typeForm = { name: t.name, code: t.code, days_per_year: t.days_per_year, is_paid: !!t.is_paid };
      this.showTypeModal = true;
    },
    async saveType() {
      this.saving = true;
      try {
        if (this.editingType) {
          await this.api(`/api/companies/${this.company.id}/hr/leave-types/${this.editingType.id}`, { method: 'PUT', body: this.typeForm });
          this.toast(t('تم تحديث نوع الإجازة'));
        } else {
          await this.api(`/api/companies/${this.company.id}/hr/leave-types`, { method: 'POST', body: this.typeForm });
          this.toast(t('تمت إضافة نوع الإجازة'));
        }
        this.showTypeModal = false;
        await this.loadAll();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async removeType(t) {
      if (!confirm(t('هل أنت متأكد من حذف نوع الإجازة؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hr/leave-types/${t.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.loadAll();
      } catch (e) { this.toast(e.message, 'error'); }
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex mb-2">
      <button class="btn btn-sm" :class="tab === 'leaves' ? 'btn-primary' : 'btn-ghost'" @click="switchTab('leaves')">{{ t('طلبات الإجازات') }}</button>
      <button class="btn btn-sm" :class="tab === 'types' ? 'btn-primary' : 'btn-ghost'" @click="switchTab('types')">{{ t('أنواع الإجازات') }}</button>
    </div>

    <template v-if="tab === 'leaves'">
      <div class="flex-between flex-wrap mb-2">
        <div class="flex flex-wrap">
          <input v-if="can('hr-leaves', 'search')" :placeholder="t('بحث بالاسم أو رقم الإجازة...')" v-model="leaveFilter" style="min-width:220px;">
          <select v-model="statusFilter" style="min-width:150px;">
            <option value="">{{ t('كل الحالات') }}</option>
            <option value="pending">{{ t('قيد المعالجة') }}</option>
            <option value="approved">{{ t('معتمدة') }}</option>
            <option value="rejected">{{ t('مرفوضة') }}</option>
            <option value="cancelled">{{ t('ملغاة') }}</option>
          </select>
          <p class="muted">{{ t('عدد الإجازات: {n}', { n: leaves.length }) }}</p>
        </div>
        <button v-if="can('hr-leaves', 'add')" class="btn btn-primary" @click="openLeaveCreate">+ {{ t('إجازة جديدة') }}</button>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('طلبات الإجازات') }}</h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ t('رقم الإجازة') }}</th><th>{{ t('الموظف') }}</th><th>{{ t('نوع الإجازة') }}</th><th>{{ t('البداية') }}</th><th>{{ t('النهاية') }}</th><th>{{ t('الأيام') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="l in filteredLeaves" :key="l.id">
                  <td class="monospace"><strong>{{ l.leave_no }}</strong></td>
                  <td>{{ l.employee_name }} <span class="muted" dir="ltr">{{ l.emp_no }}</span></td>
                  <td>{{ l.leave_type_name }} <span v-if="!l.is_paid" class="badge gray">{{ t('غير مدفوعة') }}</span></td>
                  <td class="monospace">{{ l.start_date }}</td>
                  <td class="monospace">{{ l.end_date }}</td>
                  <td class="num"><strong>{{ l.days }}</strong></td>
                  <td><span class="badge" :class="statusClass(l.status)">{{ statusLabel(l.status) }}</span></td>
                  <td>
                    <template v-if="l.status === 'pending' && can('hr-leaves', 'edit')">
                      <button class="btn btn-sm btn-ghost" @click="setStatus(l, 'approved')">{{ t('اعتماد') }}</button>
                      <button class="btn btn-sm btn-ghost" @click="setStatus(l, 'rejected')">{{ t('رفض') }}</button>
                    </template>
                    <button v-if="l.status === 'pending' && can('hr-leaves', 'edit')" class="btn btn-sm btn-ghost" @click="openLeaveEdit(l)">{{ t('تعديل') }}</button>
                    <button v-if="l.status === 'pending' && can('hr-leaves', 'delete')" class="btn btn-sm btn-ghost" @click="removeLeave(l)">{{ t('حذف') }}</button>
                  </td>
                </tr>
                <tr v-if="!filteredLeaves.length"><td colspan="8" class="muted">{{ t('لا توجد إجازات') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <template v-if="tab === 'types'">
      <div class="flex-between flex-wrap mb-2">
        <p class="muted">{{ t('عدد الأنواع: {n}', { n: leaveTypes.length }) }}</p>
        <button v-if="can('hr-leaves', 'add')" class="btn btn-primary" @click="openTypeCreate">+ {{ t('نوع إجازة جديد') }}</button>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>{{ t('أنواع الإجازات') }}</h3></div>
        <div class="panel-body pad-0">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ t('الرمز') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('أيام بالسنة') }}</th><th>{{ t('النوع') }}</th><th>{{ t('الحالة') }}</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="t in leaveTypes" :key="t.id">
                  <td class="monospace"><strong>{{ t.code }}</strong></td>
                  <td>{{ t.name }}</td>
                  <td class="num">{{ t.days_per_year }}</td>
                  <td>{{ t.is_paid ? t('مدفوعة') : t('غير مدفوعة') }}</td>
                  <td><span class="badge" :class="t.is_active ? 'green' : 'gray'">{{ t.is_active ? t('نشط') : t('موقوف') }}</span></td>
                  <td>
                    <button v-if="can('hr-leaves', 'edit')" class="btn btn-sm btn-ghost" @click="openTypeEdit(t)">{{ t('تعديل') }}</button>
                    <button v-if="can('hr-leaves', 'delete')" class="btn btn-sm btn-ghost" @click="removeType(t)">{{ t('حذف') }}</button>
                  </td>
                </tr>
                <tr v-if="!leaveTypes.length"><td colspan="6" class="muted">{{ t('لا توجد أنواع إجازات') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- نافذة إجازة -->
    <div v-if="showLeaveModal" class="modal-overlay" @click.self="showLeaveModal = false">
      <div class="modal" style="max-width:520px;">
        <h3>{{ editingLeave ? t('تعديل إجازة') : t('إضافة إجازة جديدة') }}</h3>
        <div class="form-grid">
          <label class="span-2">{{ t('الموظف') }}
            <select v-model="leaveForm.employee_id" required>
              <option value="">—</option>
              <option v-for="e in employees" :key="e.id" :value="String(e.id)">{{ e.name }} ({{ e.emp_no }})</option>
            </select>
          </label>
          <label class="span-2">{{ t('نوع الإجازة') }}
            <select v-model="leaveForm.leave_type_id" required>
              <option value="">—</option>
              <option v-for="t in leaveTypes.filter(x => x.is_active)" :key="t.id" :value="String(t.id)">{{ t.name }}</option>
            </select>
          </label>
          <label>{{ t('تاريخ البداية') }} <input type="date" v-model="leaveForm.start_date" required></label>
          <label>{{ t('تاريخ النهاية') }} <input type="date" v-model="leaveForm.end_date" required></label>
          <label class="span-2">{{ t('ملاحظات') }} <textarea v-model="leaveForm.notes" rows="2"></textarea></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showLeaveModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveLeave" :disabled="saving || !leaveForm.employee_id || !leaveForm.leave_type_id">{{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <!-- نافذة نوع إجازة -->
    <div v-if="showTypeModal" class="modal-overlay" @click.self="showTypeModal = false">
      <div class="modal" style="max-width:460px;">
        <h3>{{ editingType ? t('تعديل نوع إجازة') : t('إضافة نوع إجازة') }}</h3>
        <div class="form-grid">
          <label>{{ t('الاسم') }} <input v-model.trim="typeForm.name" required></label>
          <label>{{ t('الرمز') }} <input v-model.trim="typeForm.code" dir="ltr" :placeholder="t('تلقائي')"></label>
          <label>{{ t('أيام بالسنة') }} <input type="number" min="0" step="0.5" v-model.number="typeForm.days_per_year"></label>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="typeForm.is_paid" style="width:auto;"> {{ t('إجازة مدفوعة') }}
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showTypeModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveType" :disabled="saving || !typeForm.name">{{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};

// ---------- الرواتب والأجور ----------
const HrPayrollView = {
  name: 'HrPayrollView',
  mixins: [CommonMixin],
  data() {
    return {
      rows: [], totals: { basic: 0, allowances: 0, overtime: 0, absences: 0, deductions: 0, net: 0, posted: false },
      month: new Date().toISOString().slice(0, 7),
      accounts: { salary: '5201', payable: '2104' },
      loading: true, alert: null, saving: false, posting: false
    };
  },
  async created() { await this.load(); },
  methods: {
    async load() {
      try {
        const [d, acc] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/hr/payroll?month=${this.month}`),
          this.api(`/api/companies/${this.company.id}/hr/payroll/accounts`)
        ]);
        this.rows = d.rows; this.totals = d.totals; this.accounts = acc;
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    async generate() {
      this.saving = true;
      try {
        const d = await this.api(`/api/companies/${this.company.id}/hr/payroll/generate`, { method: 'POST', body: { month: this.month } });
        this.rows = d.rows; this.totals = d.totals;
        this.toast(t('تم توليد الرواتب'));
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async updateRow(r) {
      try {
        const updated = await this.api(`/api/companies/${this.company.id}/hr/payroll/${r.id}`, {
          method: 'PUT',
          body: { basic_salary: r.basic_salary, allowances: r.allowances, overtime: r.overtime, absences: r.absences, deductions: r.deductions }
        });
        r.net_salary = updated.net_salary;
        this.totals = {
          basic: this.rows.reduce((s, x) => s + (x.basic_salary || 0), 0),
          allowances: this.rows.reduce((s, x) => s + (x.allowances || 0), 0),
          overtime: this.rows.reduce((s, x) => s + (x.overtime || 0), 0),
          absences: this.rows.reduce((s, x) => s + (x.absences || 0), 0),
          deductions: this.rows.reduce((s, x) => s + (x.deductions || 0), 0),
          net: this.rows.reduce((s, x) => s + (x.net_salary || 0), 0),
          posted: this.totals.posted
        };
        this.toast(t('تم الحفظ'));
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async removeRow(r) {
      if (!confirm(t('هل أنت متأكد من حذف سطر الرواتب هذا؟'))) return;
      try {
        await this.api(`/api/companies/${this.company.id}/hr/payroll/${r.id}`, { method: 'DELETE' });
        this.toast(t('تم الحذف'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async post() {
      if (!confirm(t('سيتم ترحيل قيد الرواتب الشهرية إلى دفتر اليومية. هل تريد المتابعة؟'))) return;
      this.posting = true;
      try {
        await this.api(`/api/companies/${this.company.id}/hr/payroll/post`, { method: 'POST', body: { month: this.month } });
        this.toast(t('تم ترحيل الرواتب إلى القيود'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.posting = false; }
    },
    async reverse() {
      if (!confirm(t('سيتم حذف قيد الرواتب المرحّل وإعادة الحالة إلى مسودة. هل تريد المتابعة؟'))) return;
      this.posting = true;
      try {
        await this.api(`/api/companies/${this.company.id}/hr/payroll/reverse`, { method: 'POST', body: { month: this.month } });
        this.toast(t('تم عكس الترحيل'));
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.posting = false; }
    },
    async saveAccounts() {
      try {
        this.accounts = await this.api(`/api/companies/${this.company.id}/hr/payroll/accounts`, { method: 'PUT', body: this.accounts });
        this.toast(t('تم حفظ الحسابات'));
      } catch (e) { this.toast(e.message, 'error'); }
    },
    preview() {
      const rows = this.rows.map(r => [r.emp_no, r.employee_name, r.department_name || '—', this.fmt.money(r.basic_salary), this.fmt.money(r.allowances), this.fmt.money(r.overtime), this.fmt.money(r.absences), this.fmt.money(r.deductions), this.fmt.money(r.net_salary)]);
      this.openPrintPreview({
        title: `${t('الرواتب والأجور')} — ${this.month}`,
        sub: this.company.name,
        cols: [t('رقم الموظف'), t('الاسم'), t('القسم'), t('الراتب الأساسي'), t('البدلات'), t('الإضافي'), t('الغياب'), t('الخصومات'), t('الصافي')],
        rows
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="panel mb-2">
      <div class="panel-body">
        <div class="flex-between flex-wrap">
          <div class="flex flex-wrap">
            <label style="margin-left:10px;">{{ t('الشهر:') }}
              <input type="month" v-model="month" style="min-width:160px;" @change="load">
            </label>
            <button class="btn btn-primary" @click="generate" :disabled="saving || totals.posted">
              {{ saving ? t('جارٍ التوليد...') : t('توليد الرواتب') }}
            </button>
            <button v-if="can('hr-payroll', 'print_preview')" class="btn btn-sm btn-ghost" @click="preview">👁️ {{ t('معاينة قبل الطباعة') }}</button>
          </div>
          <div class="flex flex-wrap" style="gap:8px;">
            <span v-if="totals.posted" class="badge green">{{ t('مرحلة إلى القيود') }}</span>
            <span v-else class="badge yellow">{{ t('مسودة') }}</span>
            <button v-if="!totals.posted && can('hr-payroll', 'edit') && rows.length" class="btn btn-success" @click="post" :disabled="posting">{{ t('ترحيل القيود') }}</button>
            <button v-if="totals.posted && can('hr-payroll', 'edit')" class="btn btn-danger" @click="reverse" :disabled="posting">{{ t('عكس الترحيل') }}</button>
          </div>
        </div>
        <div class="flex flex-wrap mt-2" style="gap:8px;align-items:center;">
          <label>{{ t('حساب الرواتب (مدين):') }}
            <input v-model="accounts.salary" dir="ltr" style="width:90px;" placeholder="5201">
          </label>
          <label>{{ t('حساب المستحقات (دائن):') }}
            <input v-model="accounts.payable" dir="ltr" style="width:90px;" placeholder="2104">
          </label>
          <button v-if="can('hr-payroll', 'edit')" class="btn btn-sm btn-ghost" @click="saveAccounts">{{ t('حفظ الحسابات') }}</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('رواتب شهر {month}', { month }) }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('رقم الموظف') }}</th><th>{{ t('الاسم') }}</th><th>{{ t('القسم') }}</th>
                <th style="min-width:100px;">{{ t('الراتب الأساسي') }}</th><th style="min-width:90px;">{{ t('البدلات') }}</th>
                <th style="min-width:90px;">{{ t('الإضافي') }}</th><th style="min-width:90px;">{{ t('الغياب') }}</th>
                <th style="min-width:90px;">{{ t('الخصومات') }}</th><th>{{ t('الصافي') }}</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id" :class="{ 'dim': r.status === 'posted' }">
                <td class="monospace"><strong>{{ r.emp_no }}</strong></td>
                <td>{{ r.employee_name }} <span v-if="r.status === 'posted'" class="badge green">{{ t('مرحل') }}</span></td>
                <td>{{ r.department_name || '—' }}</td>
                <td><input type="number" min="0" step="0.01" v-model.number="r.basic_salary" @change="updateRow(r)" :disabled="r.status === 'posted'"></td>
                <td><input type="number" min="0" step="0.01" v-model.number="r.allowances" @change="updateRow(r)" :disabled="r.status === 'posted'"></td>
                <td><input type="number" min="0" step="0.01" v-model.number="r.overtime" @change="updateRow(r)" :disabled="r.status === 'posted'"></td>
                <td><input type="number" min="0" step="0.01" v-model.number="r.absences" @change="updateRow(r)" :disabled="r.status === 'posted'"></td>
                <td><input type="number" min="0" step="0.01" v-model.number="r.deductions" @change="updateRow(r)" :disabled="r.status === 'posted'"></td>
                <td class="num"><strong>{{ fmt.money(r.net_salary) }}</strong></td>
                <td><button v-if="r.status !== 'posted' && can('hr-payroll', 'delete')" class="btn btn-sm btn-ghost" @click="removeRow(r)">{{ t('حذف') }}</button></td>
              </tr>
              <tr v-if="!rows.length"><td colspan="10" class="muted">{{ t('لا توجد رواتب لهذا الشهر. اضغط توليد الرواتب.') }}</td></tr>
            </tbody>
            <tfoot v-if="rows.length">
              <tr class="tfoot">
                <td colspan="3">{{ t('الإجمالي') }}</td>
                <td class="num">{{ fmt.money(totals.basic) }}</td>
                <td class="num">{{ fmt.money(totals.allowances) }}</td>
                <td class="num">{{ fmt.money(totals.overtime) }}</td>
                <td class="num">{{ fmt.money(totals.absences) }}</td>
                <td class="num">{{ fmt.money(totals.deductions) }}</td>
                <td class="num"><strong>{{ fmt.money(totals.net) }}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  </div>
  `
};
