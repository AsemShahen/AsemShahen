'use strict';

// ==================== المستخدمون والصلاحيات ====================
const UsersView = {
  name: 'UsersView',
  mixins: [CommonMixin],
  data() {
    return {
      users: [], windows: [], actions: [], companies: [],
      loading: true, alert: null,
      showModal: false, editing: null, saving: false, deleting: null,
      permCompany: '', form: {}
    };
  },
  async created() {
    try {
      const [users, model, companies] = await Promise.all([
        this.api(`/api/users`),
        this.api(`/api/permission-model`),
        this.api(`/api/companies`)
      ]);
      this.users = users;
      this.windows = model.windows || [];
      this.actions = model.actions || [];
      this.companies = companies.companies || [];
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
    emptyMatrix() {
      const m = {};
      for (const w of this.windows) {
        m[w.key] = {};
        for (const a of this.actions) m[w.key][a.key] = false;
      }
      return m;
    },
    matrixFrom(u, cid) {
      const p = (u && u.permissions) || {};
      const scoped = Object.keys(p).some(k => /^\d+$/.test(k));
      const src = scoped ? (p[String(cid)] || {}) : p;
      const m = {};
      for (const w of this.windows) {
        m[w.key] = {};
        for (const a of this.actions) m[w.key][a.key] = !!(src[w.key] && src[w.key][a.key]);
      }
      return m;
    },
    ensureMatrix(cid) {
      if (cid && !this.form.permissions[cid]) this.form.permissions[cid] = this.emptyMatrix();
    },
    openCreate() {
      this.editing = null;
      this.permCompany = this.companies.length ? String(this.companies[0].id) : '';
      this.form = { username: '', password: '', role: 'user', is_active: true, permissions: {} };
      this.ensureMatrix(this.permCompany);
      this.showModal = true;
    },
    openEdit(u) {
      this.editing = u;
      const scoped = Object.keys((u.permissions || {})).some(k => /^\d+$/.test(k));
      const firstWith = scoped ? this.companies.find(c => u.permissions[String(c.id)] && Object.keys(u.permissions[String(c.id)]).some(w => Object.keys(u.permissions[String(c.id)][w] || {}).some(a => u.permissions[String(c.id)][w][a]))) : null;
      this.permCompany = firstWith ? String(firstWith.id) : (this.companies.length ? String(this.companies[0].id) : '');
      this.form = {
        username: u.username, password: '', role: u.role, is_active: !!u.is_active, permissions: {}
      };
      for (const c of this.companies) this.form.permissions[String(c.id)] = this.matrixFrom(u, c.id);
      this.ensureMatrix(this.permCompany);
      this.showModal = true;
    },
    async save() {
      this.saving = true;
      try {
        const body = {
          username: this.form.username,
          role: this.form.role,
          is_active: this.form.is_active,
          permissions: this.form.permissions
        };
        if (this.form.password) body.password = this.form.password;
        if (this.editing) {
          await this.api(`/api/users/${this.editing.id}`, { method: 'PUT', body });
          this.toast(t('تم تحديث المستخدم والصلاحيات'));
        } else {
          await this.api(`/api/users`, { method: 'POST', body });
          this.toast(t('تم إنشاء المستخدم'));
        }
        this.showModal = false;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.saving = false; }
    },
    async load() {
      try { this.users = await this.api(`/api/users`); }
      catch (e) { this.toast(e.message, 'error'); }
    },
    confirmDelete(u) { this.deleting = u; },
    async doDelete() {
      try {
        await this.api(`/api/users/${this.deleting.id}`, { method: 'DELETE' });
        this.toast(t('تم حذف المستخدم'));
        this.deleting = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    setAll(v) {
      const m = this.form.permissions[this.permCompany];
      if (!m) return;
      for (const w of this.windows) for (const a of this.actions) m[w.key][a.key] = v;
    },
    copyToAll() {
      if (!this.permCompany) return;
      const src = this.form.permissions[this.permCompany];
      if (!src) return;
      for (const c of this.companies) {
        const m = this.emptyMatrix();
        for (const w of this.windows) for (const a of this.actions) m[w.key][a.key] = !!(src[w.key] && src[w.key][a.key]);
        this.form.permissions[String(c.id)] = m;
      }
      this.toast(t('تم نسخ الصلاحيات إلى كل الشركات'));
    },
    grantedCount(u) {
      if (u.role === 'admin') return t('الكل');
      const p = u.permissions || {};
      const scoped = Object.keys(p).some(k => /^\d+$/.test(k));
      let n = 0;
      if (scoped) {
        for (const cid of Object.keys(p)) for (const w of Object.keys(p[cid] || {})) for (const a of Object.keys(p[cid][w] || {})) if (p[cid][w][a]) n++;
      } else {
        for (const w of this.windows) for (const a of this.actions) if (p[w] && p[w][a]) n++;
      }
      return n;
    },
    grantedCompanies(u) {
      if (u.role === 'admin') return t('الكل');
      const p = u.permissions || {};
      if (!Object.keys(p).some(k => /^\d+$/.test(k))) return t('الكل');
      return Object.keys(p).filter(cid => Object.keys(p[cid] || {}).some(w => Object.keys(p[cid][w] || {}).some(a => p[cid][w][a]))).length;
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <p class="muted">{{ t('عدد المستخدمين: {n}', { n: users.length }) }}</p>
      <button class="btn btn-primary" @click="openCreate">+ {{ t('مستخدم جديد') }}</button>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>{{ t('المستخدمون والصلاحيات') }}</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ t('اسم المستخدم') }}</th><th>{{ t('الدور') }}</th><th>{{ t('الحالة') }}</th><th>{{ t('عدد الصلاحيات') }}</th><th>{{ t('الشركات') }}</th><th>{{ t('تاريخ الإنشاء') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td><strong dir="ltr" style="display:inline-block;text-align:right;">{{ u.username }}</strong>
                  <span v-if="u.id === currentUserId" class="badge green" style="margin-right:6px;">{{ t('أنا') }}</span>
                </td>
                <td><span class="badge" :class="u.role === 'admin' ? 'yellow' : 'gray'">{{ u.role === 'admin' ? t('مدير') : t('مستخدم') }}</span></td>
                <td><span class="badge" :class="u.is_active ? 'green' : 'red'">{{ u.is_active ? t('نشط') : t('موقوف') }}</span></td>
                <td>{{ grantedCount(u) }}</td>
                <td>{{ grantedCompanies(u) }}</td>
                <td class="monospace">{{ u.created_at ? u.created_at.slice(0, 10) : '—' }}</td>
                <td>
                  <button class="btn btn-sm btn-ghost" @click="openEdit(u)">{{ t('تعديل') }}</button>
                  <button class="btn btn-sm btn-danger" @click="confirmDelete(u)" v-if="u.id !== currentUserId">{{ t('حذف') }}</button>
                </td>
              </tr>
              <tr v-if="!users.length"><td colspan="7" class="muted">{{ t('لا يوجد مستخدمون') }}</td></tr>
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
              <option value="admin">{{ t('مدير') }}</option>
            </select>
          </label>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="form.is_active" style="width:auto;"> {{ t('الحساب نشط') }}
          </label>
        </div>

        <div class="mt-3">
          <div class="alert info" v-if="form.role === 'admin'">
            {{ t('مستخدم بصلاحية مدير يملك تلقائياً جميع الصلاحيات في جميع الشركات والنوافذ، ولا حاجة لتحديد صلاحيات فردية.') }}
          </div>

          <template v-else>
            <div class="flex-between flex-wrap" style="margin-bottom:8px;">
              <label class="perm-company">
                {{ t('الشركة:') }}
                <select v-model="permCompany" style="min-width:260px;">
                  <option v-for="c in companies" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
                </select>
              </label>
              <div class="flex">
                <button class="btn btn-sm btn-ghost" @click="setAll(true)">{{ t('تحديد الكل') }}</button>
                <button class="btn btn-sm btn-ghost" @click="setAll(false)">{{ t('مسح الكل') }}</button>
                <button class="btn btn-sm btn-ghost" @click="copyToAll" :disabled="!permCompany">{{ t('نسخ إلى كل الشركات') }}</button>
              </div>
            </div>

            <p class="muted mb-2" v-if="!companies.length">{{ t('لا توجد شركات بعد.') }}</p>

            <div class="perm-matrix" v-if="permCompany && form.permissions[permCompany]">
              <div class="perm-row perm-head">
                <span class="perm-window">{{ t('النافذة') }}</span>
                <span v-for="a in actions" :key="a.key" class="perm-cell">{{ t(a.label) }}</span>
              </div>
              <div class="perm-row" v-for="w in windows" :key="w.key">
                <span class="perm-window">{{ t(w.label) }}</span>
                <span v-for="a in actions" :key="a.key" class="perm-cell">
                  <input type="checkbox" v-model="form.permissions[permCompany][w.key][a.key]">
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
        <p>{{ t('هل أنت متأكد من حذف المستخدم {name}؟ سيتم إنهاء جميع جلساته.', { name: deleting.username }) }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deleting = null">{{ t('تراجع') }}</button>
          <button class="btn btn-danger" @click="doDelete">{{ t('نعم، حذف') }}</button>
        </div>
      </div>
    </div>
  </div>
  `
};
