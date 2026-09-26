'use strict';

// ==================== المستخدمون والصلاحيات (داخل الشركة فقط) ====================
const UsersView = {
  name: 'UsersView',
  mixins: [CommonMixin],
  data() {
    return {
      users: [], windows: [], actions: [], branches: [],
      loading: true, alert: null,
      showModal: false, editing: null, saving: false, deleting: null,
      form: {}
    };
  },
  async created() {
    try {
      const [users, model, branches] = await Promise.all([
        this.api(`/api/companies/${this.company.id}/users`),
        this.api(`/api/companies/${this.company.id}/permission-model`),
        this.api(`/api/companies/${this.company.id}/branches`).catch(() => [])
      ]);
      this.users = users;
      this.windows = model.windows || [];
      this.actions = model.actions || [];
      this.branches = branches || [];
    } catch (e) { this.toast(e.message, 'error'); }
    finally { this.loading = false; }
  },
  computed: {
    currentUserId() {
      const u = getAuthUser();
      return u ? u.id : null;
    }
  },
  methods: {
    branchName(id) {
      const b = this.branches.find(x => Number(x.id) === Number(id));
      return b ? b.name : '';
    },
    emptyMatrix() {
      const m = {};
      for (const w of this.windows) {
        m[w.key] = {};
        for (const a of this.actions) m[w.key][a.key] = false;
      }
      return m;
    },
    flatSource(p) {
      const src = (p && typeof p === 'object') ? p : {};
      const scoped = Object.keys(src).some(k => /^\d+$/.test(k));
      return scoped ? (src[String(this.company.id)] || {}) : src;
    },
    matrixFrom(u) {
      const src = this.flatSource(u && u.permissions);
      const m = {};
      for (const w of this.windows) {
        m[w.key] = {};
        for (const a of this.actions) m[w.key][a.key] = !!(src[w.key] && src[w.key][a.key]);
      }
      return m;
    },
    openCreate() {
      this.editing = null;
      this.form = { username: '', password: '', role: 'user', branch_id: '', is_active: true, permissions: this.emptyMatrix() };
      this.showModal = true;
    },
    openEdit(u) {
      this.editing = u;
      this.form = {
        username: u.username, password: '', role: u.role, branch_id: u.branch_id || '', is_active: !!u.is_active,
        permissions: this.matrixFrom(u)
      };
      this.showModal = true;
    },
    async save() {
      this.saving = true;
      try {
        const body = {
          username: this.form.username,
          role: this.form.role,
          branch_id: this.form.branch_id || null,
          is_active: this.form.is_active,
          permissions: this.form.permissions
        };
        if (this.form.password) body.password = this.form.password;
        if (this.editing) {
          await this.api(`/api/companies/${this.company.id}/users/${this.editing.id}`, { method: 'PUT', body });
          this.toast(t('تم تحديث المستخدم والصلاحيات'));
        } else {
          await this.api(`/api/companies/${this.company.id}/users`, { method: 'POST', body });
          this.toast(t('تم إنشاء المستخدم'));
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async load() {
      try { this.users = await this.api(`/api/companies/${this.company.id}/users`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    confirmDelete(u) { this.deleting = u; },
    async doDelete() {
      try {
        await this.api(`/api/companies/${this.company.id}/users/${this.deleting.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف المستخدم'));
        this.deleting = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    setAll(v) {
      const m = this.form.permissions;
      if (!m) return;
      for (const w of this.windows) for (const a of this.actions) m[w.key][a.key] = v;
    },
    grantedCount(u) {
      if (u.role === 'admin') return t('الكل');
      const src = this.flatSource(u.permissions);
      let n = 0;
      for (const w of this.windows) for (const a of this.actions) if (src[w] && src[w][a]) n++;
      return n;
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <p class="muted">{{ t('عدد مستخدمي هذه الشركة: {n}', { n: users.length }) }}</p>
      <button class="btn btn-primary" @click="openCreate">+ {{ t('مستخدم جديد') }}</button>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('مستخدمون وصلاحيات {company}', { company: company.name }) }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('اسم المستخدم') }}</th><th>{{ t('الدور') }}</th><th>{{ t('الفرع') }}</th><th>{{ t('الحالة') }}</th><th>{{ t('عدد الصلاحيات') }}</th><th>{{ t('تاريخ الإنشاء') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td><strong dir="ltr" style="display:inline-block;text-align:right;">{{ u.username }}</strong>
                  <span v-if="u.id === currentUserId" class="badge green" style="margin-right:6px;">{{ t('أنا') }}</span>
                </td>
                <td><span class="badge" :class="u.role === 'admin' ? 'yellow' : 'gray'">{{ u.role === 'admin' ? t('مدير الشركة') : t('مستخدم') }}</span></td>
                <td>{{ u.branch_id ? branchName(u.branch_id) : t('كل الفروع') }}</td>
                <td><span class="badge" :class="u.is_active ? 'green' : 'red'">{{ u.is_active ? t('نشط') : t('موقوف') }}</span></td>
                <td>{{ grantedCount(u) }}</td>
                <td class="monospace">{{ u.created_at ? u.created_at.slice(0, 10) : '—' }}</td>
                <td>
                  <button class="btn btn-sm btn-ghost" @click="openEdit(u)">{{ t('تعديل') }}</button>
                  <button class="btn btn-sm btn-danger" @click="confirmDelete(u)" v-if="u.id !== currentUserId">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!users.length"><td colspan="7" class="muted">{{ t('لا يوجد مستخدمون في هذه الشركة') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:940px;">
        <h3>{{ editing ? t('تعديل مستخدم') : t('إضافة مستخدم جديد') }}</h3>
        <div class="form-grid">
          <label>{{ t('اسم المستخدم') }}
            <input v-model.trim="form.username" dir="ltr" placeholder="username">
          </label>
          <label>{{ t('كلمة المرور') }}
            <input v-model="form.password" dir="ltr" :placeholder="editing ? t('(تُترك فارغة للاحتفاظ بها)') : t('4 أحرف على الأقل')">
          </label>
          <label>{{ t('الدور') }}
            <select v-model="form.role">
              <option value="user">{{ t('مستخدم') }}</option>
              <option value="admin">{{ t('مدير الشركة') }}</option>
            </select>
          </label>
          <label>{{ t('الفرع') }}
            <select v-model="form.branch_id">
              <option value="">{{ t('كل الفروع') }}</option>
              <option v-for="b in branches" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </label>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="form.is_active" style="width:auto;"> {{ t('الحساب نشط') }}
          </label>
        </div>

        <div class="mt-3">
          <div class="alert info" v-if="form.role === 'admin'">
            {{ t('مدير الشركة يملك كل الصلاحيات داخل هذه الشركة فقط ولا يمكنه الوصول إلى أي شركة أخرى.') }}
          </div>
          <template v-else>
            <div class="flex-between flex-wrap" style="margin-bottom:8px;">
              <span class="muted">{{ t('الصلاحيات داخل هذه الشركة') }}</span>
              <div class="flex">
                <button class="btn btn-sm btn-ghost" @click="setAll(true)">{{ t('تحديد الكل') }}</button>
                <button class="btn btn-sm btn-ghost" @click="setAll(false)">{{ t('مسح الكل') }}</button>
              </div>
            </div>
            <div class="perm-matrix">
              <div class="perm-row perm-head">
                <span class="perm-window">{{ t('النافذة') }}</span>
                <span v-for="a in actions" :key="a.key" class="perm-cell">{{ t(a.label) }}</span>
              </div>
              <div class="perm-row" v-for="w in windows" :key="w.key">
                <span class="perm-window">{{ t(w.label) }}</span>
                <span v-for="a in actions" :key="a.key" class="perm-cell">
                  <input type="checkbox" v-model="form.permissions[w.key][a.key]">
                </span>
              </div>
            </div>
          </template>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="save" :disabled="saving || !form.username">
            {{ saving ? t('جارٍ الحفظ...') : t('حفظ') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleting" class="modal-overlay" @click.self="deleting = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>{{ t('تأكيد حذف المستخدم') }}</h3>
        <p>{{ t('هل أنت متأكد من حذف المستخدم {name} من هذه الشركة؟ سيتم إنهاء جميع جلساته.', { name: deleting.username }) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deleting = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDelete">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};
