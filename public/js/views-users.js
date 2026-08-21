'use strict';

// ==================== المستخدمون والصلاحيات ====================
const UsersView = {
  name: 'UsersView',
  mixins: [CommonMixin],
  data() {
    return {
      users: [], windows: [], actions: [], loading: true, alert: null,
      showModal: false, editing: null, saving: false, deleting: null
    };
  },
  async created() {
    try {
      const [users, model] = await Promise.all([
        this.api(`/api/users`),
        this.api(`/api/permission-model`)
      ]);
      this.users = users;
      this.windows = model.windows || [];
      this.actions = model.actions || [];
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
    emptyPermissions() {
      const p = {};
      for (const w of this.windows) {
        p[w.key] = {};
        for (const a of this.actions) p[w.key][a.key] = true;
      }
      return p;
    },
    openCreate() {
      this.editing = null;
      this.form = { username: '', password: '', role: 'user', is_active: true, permissions: this.emptyPermissions() };
      this.showModal = true;
    },
    openEdit(u) {
      this.editing = u;
      const perms = {};
      for (const w of this.windows) {
        perms[w.key] = {};
        for (const a of this.actions) {
          perms[w.key][a.key] = !!(u.permissions && u.permissions[w.key] && u.permissions[w.key][a.key]);
        }
      }
      this.form = {
        username: u.username, password: '', role: u.role, is_active: !!u.is_active, permissions: perms
      };
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
          this.toast('تم تحديث المستخدم والصلاحيات');
        } else {
          await this.api(`/api/users`, { method: 'POST', body });
          this.toast('تم إنشاء المستخدم');
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
        this.toast('تم حذف المستخدم');
        this.deleting = null;
        await this.load();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    setAll(v) {
      for (const w of this.windows) {
        for (const a of this.actions) this.form.permissions[w.key][a.key] = v;
      }
    },
    grantedCount(u) {
      if (u.role === 'admin') return 'الكل';
      let n = 0;
      for (const w of this.windows) for (const a of this.actions) if (u.permissions && u.permissions[w.key] && u.permissions[w.key][a.key]) n++;
      return n + ' / ' + (this.windows.length * this.actions.length);
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="flex-between flex-wrap mb-2">
      <p class="muted">عدد المستخدمين: {{ users.length }}</p>
      <button class="btn btn-primary" @click="openCreate">+ مستخدم جديد</button>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>المستخدمون والصلاحيات</h3></div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>اسم المستخدم</th><th>الدور</th><th>الحالة</th><th>عدد الصلاحيات</th><th>تاريخ الإنشاء</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td><strong dir="ltr" style="display:inline-block;text-align:right;">{{ u.username }}</strong>
                  <span v-if="u.id === currentUserId" class="badge green" style="margin-right:6px;">أنا</span>
                </td>
                <td><span class="badge" :class="u.role === 'admin' ? 'yellow' : 'gray'">{{ u.role === 'admin' ? 'مدير' : 'مستخدم' }}</span></td>
                <td><span class="badge" :class="u.is_active ? 'green' : 'red'">{{ u.is_active ? 'نشط' : 'موقوف' }}</span></td>
                <td>{{ grantedCount(u) }}</td>
                <td class="monospace">{{ u.created_at ? u.created_at.slice(0, 10) : '—' }}</td>
                <td>
                  <button class="btn btn-sm btn-ghost" @click="openEdit(u)">تعديل</button>
                  <button class="btn btn-sm btn-danger" @click="confirmDelete(u)" v-if="u.id !== currentUserId">حذف</button>
                </td>
              </tr>
              <tr v-if="!users.length"><td colspan="6" class="muted">لا يوجد مستخدمون</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal" style="max-width:900px;">
        <h3>{{ editing ? 'تعديل مستخدم' : 'إضافة مستخدم جديد' }}</h3>
        <div class="form-grid">
          <label>اسم المستخدم
            <input v-model.trim="form.username" dir="ltr" placeholder="username">
          </label>
          <label>كلمة المرور
            <input v-model="form.password" dir="ltr" :placeholder="editing ? '(تُترك فارغة للاحتفاظ بها)' : '4 أحرف على الأقل'">
          </label>
          <label>الدور
            <select v-model="form.role">
              <option value="user">مستخدم</option>
              <option value="admin">مدير</option>
            </select>
          </label>
          <label class="flex" style="flex-direction:row;align-items:center;gap:8px;">
            <input type="checkbox" v-model="form.is_active" style="width:auto;"> الحساب نشط
          </label>
        </div>

        <div class="mt-3">
          <div class="flex-between flex-wrap" style="margin-bottom:8px;">
            <strong>الصلاحيات حسب النافذة</strong>
            <div class="flex" v-if="form.role === 'user'">
              <button class="btn btn-sm btn-ghost" @click="setAll(true)">تحديد الكل</button>
              <button class="btn btn-sm btn-ghost" @click="setAll(false)">مسح الكل</button>
            </div>
          </div>

          <div class="alert info" v-if="form.role === 'admin'">
            مستخدم بصلاحية <strong>مدير</strong> يملك تلقائياً جميع الصلاحيات في جميع النوافذ، ولا حاجة لتحديد صلاحيات فردية.
          </div>

          <div class="perm-matrix" v-else>
            <div class="perm-row perm-head">
              <span class="perm-window">النافذة</span>
              <span v-for="a in actions" :key="a.key" class="perm-cell">{{ a.label }}</span>
            </div>
            <div class="perm-row" v-for="w in windows" :key="w.key">
              <span class="perm-window">{{ w.label }}</span>
              <span v-for="a in actions" :key="a.key" class="perm-cell">
                <input type="checkbox" v-model="form.permissions[w.key][a.key]">
              </span>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showModal = false">إلغاء</button>
          <button class="btn btn-primary" @click="save" :disabled="saving || !form.username">
            {{ saving ? 'جارٍ الحفظ...' : 'حفظ' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleting" class="modal-overlay" @click.self="deleting = null">
      <div class="modal" style="max-width:440px;border-top:4px solid var(--danger);">
        <h3>تأكيد حذف المستخدم</h3>
        <p>هل أنت متأكد من حذف المستخدم <strong dir="ltr">{{ deleting.username }}</strong>؟ سيتم إنهاء جميع جلساته.</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deleting = null">تراجع</button>
          <button class="btn btn-danger" @click="doDelete">نعم، حذف</button>
        </div>
      </div>
    </div>
  </div>
  `
};
