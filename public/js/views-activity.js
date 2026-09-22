'use strict';

// ==================== سجل عمليات المستخدمين ====================
// يعرض كل عملية قام بها المستخدمون (إضافة، تعديل، حذف، بحث، طباعة، استيراد، تصدير)
// مع الوقت والتاريخ ونوع العملية وملخصها وعنوان IP واسم الجهاز/الحاسب.
const ActivityLogView = {
  name: 'ActivityLogView',
  mixins: [CommonMixin],
  data() {
    return {
      filters: { from: '', to: '', user_id: '', action: '', window_key: '', q: '' },
      allCompanies: false,
      rows: [], total: 0,
      actionsMeta: {}, windowsMeta: {}, users: [],
      limit: 100, offset: 0,
      loading: true, alert: null
    };
  },
  async created() { await this.load(); },
  computed: {
    isPlatform() { return isPlatformUser(getAuthUser()); },
    actionOptions() {
      return Object.keys(this.actionsMeta).map(k => ({ key: k, label: this.actionsMeta[k] }));
    },
    windowOptions() {
      return Object.keys(this.windowsMeta).map(k => ({ key: k, label: this.windowsMeta[k] }));
    },
    page() { return Math.floor(this.offset / this.limit) + 1; },
    pages() { return Math.max(1, Math.ceil(this.total / this.limit)); }
  },
  methods: {
    basePath() {
      return (this.isPlatform && this.allCompanies)
        ? '/api/activity'
        : `/api/companies/${this.company.id}/activity`;
    },
    queryString() {
      const p = new URLSearchParams();
      const f = this.filters;
      ['from', 'to', 'user_id', 'action', 'window_key', 'q'].forEach(k => { if (f[k]) p.set(k, f[k]); });
      p.set('limit', this.limit);
      p.set('offset', this.offset);
      return p.toString();
    },
    async load(reset = true) {
      if (reset) this.offset = 0;
      this.loading = true;
      try {
        const data = await this.api(`${this.basePath()}?${this.queryString()}`);
        this.rows = data.rows || [];
        this.total = data.total || 0;
        this.actionsMeta = data.actions || {};
        this.windowsMeta = data.windows || {};
        this.users = data.users || [];
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.loading = false; }
    },
    resetFilters() {
      this.filters = { from: '', to: '', user_id: '', action: '', window_key: '', q: '' };
      this.load();
    },
    nextPage() { if (this.offset + this.limit < this.total) { this.offset += this.limit; this.load(false); } },
    prevPage() { if (this.offset > 0) { this.offset -= this.limit; this.load(false); } },
    dt(v) {
      if (!v) return '—';
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },
    actionLabel(a) { return this.actionsMeta[a] || a; },
    windowLabel(k) { return this.windowsMeta[k] || k || '—'; },
    roleLabel(r) {
      return { platform: 'مدير المنصة', admin: 'مدير الشركة', user: 'مستخدم' }[r] || r || '—';
    },
    actionClass(a) {
      return {
        add: 'green', edit: 'yellow', delete: 'red', search: 'gray',
        print: 'green', print_preview: 'gray', import: 'yellow', export: 'green',
        login: 'green', logout: 'gray'
      }[a] || 'gray';
    },
    isFailure(r) { return Number(r.status) >= 400; },
    exportRows() {
      const cols = [t('التاريخ والوقت'), t('المستخدم'), t('الدور'), t('نوع العملية'), t('الشاشة'), t('ملخص العملية'), t('عنوان IP'), t('اسم الحاسب')];
      const data = this.rows.map(r => [
        this.dt(r.created_at), r.username, this.roleLabel(r.role), t(this.actionLabel(r.action)),
        t(this.windowLabel(r.window_key)), r.summary, r.ip, r.device
      ]);
      exportCsv('activity-log', cols, data);
    },
    preview() {
      openPrintPreview({
        title: t('سجل عمليات المستخدمين'),
        sub: this.company ? this.company.name : '',
        cols: [t('#'), t('التاريخ والوقت'), t('المستخدم'), t('نوع العملية'), t('الشاشة'), t('ملخص العملية'), t('عنوان IP'), t('اسم الحاسب')],
        rows: this.rows.map((r, i) => [
          i + 1 + this.offset, this.dt(r.created_at), r.username,
          t(this.actionLabel(r.action)), t(this.windowLabel(r.window_key)), r.summary, r.ip, r.device
        ])
      });
    }
  },
  template: `
  <div>
    <div v-if="alert" class="alert" :class="alert.type">{{ alert.message }}</div>

    <div class="panel mb-2">
      <div class="panel-body">
        <div class="flex flex-wrap gap-2" style="align-items:flex-end;">
          <label style="display:flex;flex-direction:column;gap:4px;">{{ t('من تاريخ') }}
            <input type="date" v-model="filters.from" @change="load" dir="ltr">
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">{{ t('إلى تاريخ') }}
            <input type="date" v-model="filters.to" @change="load" dir="ltr">
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">{{ t('نوع العملية') }}
            <select v-model="filters.action" @change="load">
              <option value="">{{ t('الكل') }}</option>
              <option v-for="a in actionOptions" :key="a.key" :value="a.key">{{ t(a.label) }}</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">{{ t('الشاشة') }}
            <select v-model="filters.window_key" @change="load">
              <option value="">{{ t('الكل') }}</option>
              <option v-for="w in windowOptions" :key="w.key" :value="w.key">{{ t(w.label) }}</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">{{ t('المستخدم') }}
            <select v-model="filters.user_id" @change="load">
              <option value="">{{ t('الكل') }}</option>
              <option v-for="u in users" :key="u.user_id" :value="u.user_id">{{ u.username }}</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:180px;">{{ t('بحث') }}
            <input v-model.trim="filters.q" :placeholder="t('ملخص/مستخدم/IP/جهاز')" @keyup.enter="load">
          </label>
          <label class="flex" v-if="isPlatform" style="flex-direction:row;align-items:center;gap:6px;">
            <input type="checkbox" v-model="allCompanies" style="width:auto;" @change="load"> {{ t('كل الشركات') }}
          </label>
          <button class="btn btn-sm btn-ghost" @click="load">{{ t('تحديث') }}</button>
          <button class="btn btn-sm btn-ghost" @click="resetFilters">{{ t('مسح') }}</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header flex-between">
        <h3>{{ t('سجل عمليات المستخدمين') }} <span class="muted" style="font-size:13px;">({{ fmt.num(total) }})</span></h3>
        <div class="flex gap-2 no-print">
          <button class="btn btn-sm btn-ghost" @click="preview">{{ t('معاينة قبل الطباعة') }}</button>
          <button class="btn btn-sm btn-ghost" @click="exportRows">{{ t('تصدير') }}</button>
        </div>
      </div>
      <div class="panel-body pad-0">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{{ t('التاريخ والوقت') }}</th>
                <th>{{ t('المستخدم') }}</th>
                <th>{{ t('نوع العملية') }}</th>
                <th>{{ t('الشاشة') }}</th>
                <th>{{ t('ملخص العملية') }}</th>
                <th>{{ t('عنوان IP') }}</th>
                <th>{{ t('اسم الحاسب') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id">
                <td class="num">{{ i + 1 + offset }}</td>
                <td class="monospace" dir="ltr">{{ dt(r.created_at) }}</td>
                <td>
                  <strong dir="ltr" style="display:inline-block;text-align:right;">{{ r.username || '—' }}</strong>
                  <span class="badge gray" style="margin-right:6px;">{{ t(roleLabel(r.role)) }}</span>
                </td>
                <td>
                  <span class="badge" :class="isFailure(r) ? 'red' : actionClass(r.action)">{{ t(actionLabel(r.action)) }}</span>
                  <span v-if="isFailure(r)" class="badge red" style="margin-right:4px;">{{ r.status }}</span>
                </td>
                <td>{{ t(windowLabel(r.window_key)) }}</td>
                <td>{{ r.summary || '—' }}</td>
                <td class="monospace" dir="ltr">{{ r.ip || '—' }}</td>
                <td>{{ r.device || '—' }}</td>
              </tr>
              <tr v-if="loading"><td colspan="8" class="muted">{{ t('جارٍ التحميل...') }}</td></tr>
              <tr v-else-if="!rows.length"><td colspan="8" class="muted">{{ t('لا توجد عمليات مسجّلة') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel-body flex-between no-print" v-if="total > limit">
        <button class="btn btn-sm btn-ghost" @click="prevPage" :disabled="offset === 0">{{ t('السابق') }}</button>
        <span class="muted">{{ t('صفحة') }} {{ page }} / {{ pages }}</span>
        <button class="btn btn-sm btn-ghost" @click="nextPage" :disabled="offset + limit >= total">{{ t('التالي') }}</button>
      </div>
    </div>
  </div>
  `
};
