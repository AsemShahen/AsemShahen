'use strict';

// ==================== نظام المحادثة الداخلية ====================
// محادثات كتابية وصوتية وملفات ومكالمات مباشرة بين موظفي الشركة
// يظهر للقنوات (عام/أقسام) والمحادثات المباشرة مع جميع الأعضاء
// سجل المحادثة دائم لا يُحذف، والحذف متاح لمدير النظام مع تسجيله

const FILE_ICONS = { pdf: '📕', doc: '📄', docx: '📄', xls: '📊', xlsx: '📊', ppt: '📽️', pptx: '📽️', zip: '🗜️', txt: '📝' };
const MAX_CHAT_UPLOAD = 30 * 1024 * 1024; // 30 MB

function chatFileExt(name) {
  const i = String(name || '').lastIndexOf('.');
  return i >= 0 ? String(name).slice(i + 1).toLowerCase() : '';
}

function chatFmtTime(ts) {
  const d = new Date(Number(ts));
  const h = d.getHours(), m = d.getMinutes();
  return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
}

function chatFmtBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' MB';
  if (v >= 1024) return Math.round(v / 1024) + ' KB';
  return v + ' B';
}

function chatDayKey(ts) {
  const d = new Date(Number(ts));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function chatDayLabel(key) {
  const parts = key.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return t('اليوم');
  if (diff === 1) return t('أمس');
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const ChatView = {
  name: 'ChatView',
  mixins: [CommonMixin],
  data() {
    return {
      loading: true, alert: null,
      isAdmin: false,
      myProfile: null,
      members: [],
      departments: [],
      convs: [],
      sel: { channelId: null, peerId: null },
      msgs: [], msgLoading: false, more: false,
      text: '',
      blobs: {},
      _blobBusy: {},
      showEmoji: false,
      rec: { on: false, sec: 0 }, recorder: null, recChunks: [], recTimer: null,
      fileInput: null,
      call: null,
      pendingCalls: [],
      memberModal: null,
      purgeBusy: false, deletingId: null
    };
  },
  computed: {
    meId() { return getAuthUser() ? getAuthUser().id : null; },
    channels() { return this.convs.filter(c => c.kind === 'channel'); },
    dmConvs() {
      const map = {};
      for (const c of this.convs) if (c.kind === 'dm') map[c.peerId] = c;
      return map;
    },
    dmMembers() {
      const map = this.dmConvs;
      return this.members
        .filter(m => m.user_id !== this.meId)
        .map(m => {
          const c = map[m.user_id];
          return {
            kind: 'dm', peerId: m.user_id, name: m.display_name,
            dept: m.department_name || '', online: !!m.online,
            last: c ? c.last : null, unread: c ? c.unread : 0,
            title: m.title || ''
          };
        })
        .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name, 'ar'));
    },
    activeConv() {
      if (this.sel.channelId) return this.channels.find(c => c.id === this.sel.channelId) || null;
      if (this.sel.peerId) {
        const m = this.dmMembers.find(d => d.peerId === this.sel.peerId);
        if (m) return m;
        const raw = this.members.find(x => x.user_id === this.sel.peerId);
        return raw ? { kind: 'dm', peerId: raw.user_id, name: raw.display_name, dept: raw.department_name || '', online: raw.online, last: null, unread: 0 } : null;
      }
      return null;
    },
    activeIsChannel() { return !!(this.sel.channelId && this.activeConv); },
    activeName() {
      const c = this.activeConv;
      if (!c) return '';
      if (c.kind === 'channel' && c.isGeneral) return t('عام');
      if (c.kind === 'channel' && c.isDepartment) return c.name;
      return c.name;
    },
    activeSub() {
      const c = this.activeConv;
      if (!c) return '';
      if (c.kind === 'channel') return c.description || (c.isDepartment ? t('قناة قسم') : t('قناة عامة لكل الموظفين'));
      if (c.online) return t('متصل الآن');
      return c.dept || '';
    },
    groupByDay() {
      const groups = [];
      let lastKey = null;
      for (const m of this.msgs) {
        const k = chatDayKey(m.created_at);
        if (k !== lastKey) { groups.push({ key: k, label: chatDayLabel(k), msgs: [] }); lastKey = k; }
        groups[groups.length - 1].msgs.push(m);
      }
      return groups;
    },
    recLabel() {
      const s = this.rec.sec;
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    },
    callDur() {
      if (!this.call || this.call.state !== 'active' || !this.call.started) return '00:00';
      const s = Math.floor((Date.now() - this.call.started) / 1000);
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }
  },
  async created() {
    await this.init();
  },
  beforeUnmount() {
    this.teardown();
  },
  methods: {
    // ---------------- تهيئة ----------------
    async init() {
      try {
        const [mem, convs] = await Promise.all([
          this.api(`/api/companies/${this.company.id}/chat/members`),
          this.api(`/api/companies/${this.company.id}/chat/conversations`)
        ]);
        this.isAdmin = !!mem.isAdmin;
        this.myProfile = mem.me;
        this.members = mem.members || [];
        this.departments = mem.departments || [];
        this.convs = convs || [];
      } catch (e) { this.toast(e.message, 'error'); }
      finally {
        this.loading = false;
        this.pickDefault();
        this.startEvents();
        await this.restoreCalls();
      }
    },
    pickDefault() {
      if (this.sel.channelId || this.sel.peerId) return;
      const gen = this.channels.find(c => c.isGeneral) || this.channels[0];
      if (gen) this.openChannel(gen.id);
      else if (this.dmMembers.length) this.openDm(this.dmMembers[0].peerId);
    },
    async restoreCalls() {
      try {
        const pending = await this.api(`/api/companies/${this.company.id}/chat/calls/pending`);
        this.pendingCalls = pending || [];
        for (const c of this.pendingCalls) {
          if (Number(c.callee_id) === this.meId && c.status === 'ringing' && !this.call) {
            const from = this.members.find(m => m.user_id === c.caller_id);
            this.call = {
              id: c.id, type: c.call_type, state: 'incoming',
              peerId: c.caller_id, peerName: (from && from.display_name) || String(c.caller_id),
              started: null, pc: null, local: null
            };
          } else if (c.status === 'accepted' && !this.call) {
            this.call = {
              id: c.id, type: c.call_type, state: 'active',
              peerId: Number(c.caller_id) === this.meId ? c.callee_id : c.caller_id,
              peerName: '',
              started: Number(c.answered_at) || Date.now(), pc: null, local: null
            };
            const who = Number(c.caller_id) === this.meId ? c.callee_id : c.caller_id;
            const p = this.members.find(m => m.user_id === who);
            this.call.peerName = (p && p.display_name) || String(who);
            this.setupPeerStream().catch(() => {});
          }
        }
      } catch (e) { /* لا توجد مكالمات */ }
    },

    // ---------------- فتح المحادثة ----------------
    openChannel(id) {
      this.sel = { channelId: id, peerId: null };
      this.loadThread();
    },
    openDm(peerId) {
      if (peerId === this.meId) return;
      this.sel = { channelId: null, peerId };
      this.loadThread();
    },
    async loadThread(before) {
      if (!this.sel.channelId && !this.sel.peerId) return;
      const target = this.sel.channelId
        ? { channel: this.sel.channelId }
        : { dm: this.sel.peerId };
      const listEl = this.$refs.msgList;
      const prevScroll = listEl ? listEl.scrollHeight - listEl.scrollTop : 0;
      this.msgLoading = true;
      try {
        const list = await this.api(`/api/companies/${this.company.id}/chat/messages?${new URLSearchParams(target)}&limit=50${before ? '&before=' + before : ''}`);
        this.more = list.length >= 50;
        if (before) this.msgs = list.concat(this.msgs);
        else this.msgs = list;
        if (!before) this.markReadTarget();
        this.requestBlobs();
      } catch (e) { this.toast(e.message, 'error'); }
      finally {
        this.msgLoading = false;
        this.$nextTick(() => {
          const el = this.$refs.msgList;
          if (!el) return;
          if (before) el.scrollTop = el.scrollHeight - prevScroll;
          else el.scrollTop = el.scrollHeight;
        });
      }
    },
    async markReadTarget() {
      const body = this.sel.channelId ? { channelId: this.sel.channelId } : { peerId: this.sel.peerId };
      try { await this.api(`/api/companies/${this.company.id}/chat/read`, { method: 'POST', body }); } catch (e) { /* تجاهل */ }
      this.convs.forEach(c => {
        if (c.kind === 'channel' && c.id === this.sel.channelId) c.unread = 0;
        if (c.kind === 'dm' && c.peerId === this.sel.peerId) c.unread = 0;
      });
    },
    // ---------------- إرسال ----------------
    async send() {
      const body = this.text.trim();
      if (!body || this.msgLoading) return;
      const payload = this.sel.channelId ? { channelId: this.sel.channelId, body } : { peerId: this.sel.peerId, body };
      if (!payload.channelId && !payload.peerId) return;
      this.text = '';
      try {
        const m = await this.api(`/api/companies/${this.company.id}/chat/messages`, { method: 'POST', body: payload });
        this.acceptIncoming([m]);
      } catch (e) { this.toast(e.message, 'error'); }
    },
    onKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    },
    // ---------------- المرفقات ----------------
    clickAttach() {
      if (!this.fileInput) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) this.uploadFile(f); inp.value = ''; };
        this.fileInput = inp;
      }
      this.fileInput.click();
    },
    async uploadFile(f) {
      if (!this.sel.channelId && !this.sel.peerId) return this.toast(t('اختر محادثة أولاً'), 'error');
      if (f.size > MAX_CHAT_UPLOAD) return this.toast(t('حجم الملف يتجاوز الحد الأقصى (30 ميغابايت)'), 'error');
      const target = this.sel.channelId ? 'channel' : 'dm';
      const id = this.sel.channelId || this.sel.peerId;
      this.toast(t('جارٍ الرفع...'));
      try {
        const qs = new URLSearchParams({ target, id: String(id), name: f.name, mime: f.type || 'application/octet-stream' });
        const resp = await apiFetch(`/api/companies/${this.company.id}/chat/files?${qs}`, { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || t('فشل رفع الملف'));
        this.acceptIncoming([data]);
        this.alert = null;
      } catch (e) { this.toast(e.message, 'error'); }
    },
    // ---------------- التسجيل الصوتي ----------------
    async toggleRec() {
      if (this.rec.on) return this.stopRec();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        return this.toast(t('المتصفح لا يدعم التسجيل الصوتي'), 'error');
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream);
        this.recChunks = [];
        mr.ondataavailable = e => { if (e.data && e.data.size) this.recChunks.push(e.data); };
        mr.onstop = () => {
          stream.getTracks().forEach(tr => tr.stop());
          const blob = new Blob(this.recChunks, { type: mr.mimeType || 'audio/webm' });
          this.recChunks = [];
          const name = 'تسجيل_' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + (blob.type.includes('ogg') ? '.ogg' : '.webm');
          if (blob.size) this.uploadFile(new File([blob], name, { type: blob.type }));
        };
        mr.start();
        this.recorder = mr;
        this.rec = { on: true, sec: 0 };
        clearInterval(this.recTimer);
        this.recTimer = setInterval(() => { this.rec.sec++; }, 1000);
      } catch (e) { this.toast(t('تعذر الوصول إلى الميكروفون'), 'error'); }
    },
    stopRec() {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
      clearInterval(this.recTimer);
      this.rec = { on: false, sec: 0 };
    },
    cancelRec() {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.onstop = null;
        try { this.recorder.stop(); } catch (e) { /* تجاهل */ }
        if (this.recorder.stream) this.recorder.stream.getTracks().forEach(tr => tr.stop());
      }
      clearInterval(this.recTimer);
      this.recChunks = [];
      this.rec = { on: false, sec: 0 };
    },
    // ---------------- عرض المرفقات ----------------
    msgBody(m) {
      if (m.msg_type === 'text') return m.body;
      if (m.msg_type === 'image') return t('🖼️ صورة');
      if (m.msg_type === 'audio') return t('🎤 رسالة صوتية');
      if (m.msg_type === 'video') return t('🎬 فيديو');
      return t('📎 مرفق');
    },
    msgSummary(m) {
      if (!m) return '';
      if (m.msg_type === 'text') return m.body;
      if (m.msg_type === 'image') return t('صورة');
      if (m.msg_type === 'audio') return t('رسالة صوتية');
      if (m.msg_type === 'video') return t('فيديو');
      return m.file_name || t('مرفق');
    },
    isMine(m) { return m.sender_id === this.meId; },
    fmtTime(ts) { return chatFmtTime(ts); },
    fmtBytes(n) { return chatFmtBytes(n); },
    openImage(m) {
      const u = this.fileURL(m);
      if (u) window.open(u, '_blank');
    },
    onScroll() {
      const el = this.$refs.msgList;
      if (el && el.scrollTop <= 10 && this.more && !this.msgLoading && this.msgs.length) {
        this.loadThread(this.msgs[0].id);
      }
    },
    fileIcon(m) {
      return FILE_ICONS[chatFileExt(m.file_name)] || '📎';
    },
    fileURL(m) {
      const cached = this.blobs[m.id];
      if (cached) return cached;
      if (!this._blobBusy[m.id]) {
        this._blobBusy[m.id] = true;
        this.fetchBlob(m).catch(() => { delete this._blobBusy[m.id]; });
      }
      return '';
    },
    async fetchBlob(m) {
      const resp = await apiFetch(`/api/companies/${this.company.id}/chat/files/${m.id}`);
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: m.file_mime || 'application/octet-stream' }));
      this.blobs = { ...this.blobs, [m.id]: url };
      delete this._blobBusy[m.id];
    },
    requestBlobs() {
      this.msgs.forEach(m => { if (m.msg_type !== 'text') this.fileURL(m); });
    },
    async saveFile(m) {
      try {
        const resp = await apiFetch(`/api/companies/${this.company.id}/chat/files/${m.id}`);
        if (!resp.ok) throw new Error(t('تعذر تنزيل الملف'));
        const buf = await resp.arrayBuffer();
        const blob = new Blob([buf], { type: m.file_mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = m.file_name || 'file';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } catch (e) { this.toast(e.message, 'error'); }
    },
    // ---------------- دمج الرسائل الواردة ----------------
    belongs(m) {
      if (m.channel_id) return this.sel.channelId === m.channel_id;
      const other = Number(m.user_a) === this.meId ? m.user_b : m.user_a;
      return this.sel.peerId === Number(other);
    },
    acceptIncoming(newMsgs) {
      const lastId = this.msgs.length ? this.msgs[this.msgs.length - 1].id : 0;
      const add = [];
      for (const m of newMsgs) {
        if (this.msgs.some(x => x.id === m.id)) continue;
        if (this.belongs(m)) add.push(m);
        else this.bumpConv(m);
      }
      if (add.length) {
        this.msgs = this.msgs.concat(add);
        if (add[add.length - 1].id > lastId) this.markReadTarget();
        this.requestBlobs();
        this.$nextTick(() => { const el = this.$refs.msgList; if (el) el.scrollTop = el.scrollHeight; });
      }
    },
    bumpConv(m) {
      let target = null;
      if (m.channel_id) target = this.convs.find(c => c.kind === 'channel' && c.id === m.channel_id);
      else {
        const other = Number(m.user_a) === this.meId ? m.user_b : m.user_a;
        target = this.convs.find(c => c.kind === 'dm' && c.peerId === other);
        if (!target) {
          target = { kind: 'dm', id: null, peerId: other, name: '', last: null, last_id: m.id, unread: 0, isGeneral: false, isDepartment: false };
          this.convs.push(target);
        }
      }
      if (target) {
        target.last = m;
        target.last_id = Math.max(target.last_id || 0, m.id);
        if (!this.belongs(m)) target.unread = (target.unread || 0) + 1;
      }
      this.convs.sort((a, b) => (b.last_id || 0) - (a.last_id || 0));
    },
    removeMsgById(id) {
      this.msgs = this.msgs.filter(x => x.id !== id);
      this.convs.forEach(c => {
        if (c.last && c.last.id === id) {
          c.last = null; c.last_id = 0;
          this.refreshConvs();
        }
      });
    },
    async refreshConvs() {
      try { this.convs = await this.api(`/api/companies/${this.company.id}/chat/conversations`); }
      catch (e) { /* تجاهل */ }
    },
    // ---------------- SSE ----------------
    startEvents() {
      this._abort = new AbortController();
      const read = async () => {
        try {
          const resp = await fetch(`/api/companies/${this.company.id}/chat/events`, {
            headers: { 'x-auth-token': localStorage.getItem('muhasib_token') || '' },
            signal: this._abort.signal
          });
          if (!resp.ok || !resp.body) throw new Error('no stream');
          const reader = resp.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, i);
              buf = buf.slice(i + 2);
              if (chunk.trim()) this.dispatch(chunk);
            }
          }
        } catch (e) { /* سيُعاد الاتصال */ }
        if (!this._abort.signal.aborted) setTimeout(read, 3000);
      };
      read();
    },
    dispatch(chunk) {
      let event = 'message', dataStr = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      if (!dataStr) return;
      let data;
      try { data = JSON.parse(dataStr); } catch (e) { return; }
      if (event === 'message') this.acceptIncoming([data]);
      else if (event === 'delete') {
        if (data && data.id) {
          if (this.msgs.some(x => x.id === data.id)) this.removeMsgById(data.id);
          else if (data.channel_id || data.user_a) { this.removeMsgById(data.id); this.refreshConvs(); }
        }
      } else if (event === 'purge') {
        if (data && data.channelId === this.sel.channelId) { this.msgs = []; this.markReadTarget(); }
        this.refreshConvs();
      } else if (event.startsWith('call')) this.onCallEvent(event, data);
    },
    // ---------------- إدارة (مدير النظام) ----------------
    canDelete(m) {
      return this.isAdmin && !m.deleted;
    },
    async deleteMsg(m) {
      if (!this.isAdmin) return;
      if (!confirm(t('هل أنت متأكد من حذف هذه الرسالة؟ سيُسجَّل الحذف في سجل المراجعة.'))) return;
      this.deletingId = m.id;
      try {
        await this.api(`/api/companies/${this.company.id}/chat/messages/${m.id}/delete`, { method: 'POST' });
        this.removeMsgById(m.id);
        this.toast(t('تم حذف الرسالة وتسجيل العملية'));
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.deletingId = null; }
    },
    async purgeActive() {
      const c = this.activeConv;
      if (!c || c.kind !== 'channel' || !this.isAdmin) return;
      if (!confirm(t('سيتم إخفاء جميع رسائل هذه القناة مع تسجيل العملية. هل تريد المتابعة؟'))) return;
      this.purgeBusy = true;
      try {
        await this.api(`/api/companies/${this.company.id}/chat/channels/${c.id}/purge`, { method: 'POST' });
        this.msgs = [];
        await this.refreshConvs();
        this.toast(t('تم تطهير القناة وتسجيل العملية'));
      } catch (e) { this.toast(e.message, 'error'); }
      finally { this.purgeBusy = false; }
    },
    editMember(m) {
      if (!this.isAdmin) return;
      const raw = this.members.find(x => x.user_id === m.user_id) || this.members.find(x => x.user_id === m.peerId);
      if (!raw) return;
      this.memberModal = {
        user_id: raw.user_id,
        display_name: raw.display_name || '',
        department_id: raw.department_id || '',
        title: raw.title || ''
      };
    },
    async saveMember() {
      const f = this.memberModal;
      try {
        const updated = await this.api(`/api/companies/${this.company.id}/chat/members/${f.user_id}`, {
          method: 'PUT', body: { display_name: f.display_name, department_id: f.department_id || null, title: f.title }
        });
        const idx = this.members.findIndex(x => x.user_id === f.user_id);
        if (idx >= 0) this.members[idx] = updated;
        if (this.myProfile && this.myProfile.user_id === f.user_id) this.myProfile = updated;
        this.memberModal = null;
        this.toast(t('تم تحديث العضو'));
      } catch (e) { this.toast(e.message, 'error'); }
    },
    // ---------------- المكالمات ----------------
    async startCall(type) {
      const peer = this.activeConv;
      if (!peer || peer.kind !== 'dm' || !peer.peerId || this.call) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return this.toast(t('المتصفح لا يدعم المكالمات'), 'error');
      }
      const peerName = peer.name;
      try {
        const res = await this.api(`/api/companies/${this.company.id}/chat/calls`, { method: 'POST', body: { calleeId: peer.peerId, callType: type } });
        if (res.busy) throw new Error(t('الطرف الآخر مشغول حالياً'));
        this.call = {
          id: res.call.id, type: res.call.call_type, state: 'outgoing',
          peerId: peer.peerId, peerName, started: null, pc: null, local: null
        };
        this.ensureLocalMedia();
      } catch (e) { this.toast(e.message, 'error'); }
    },
    async ensureLocalMedia() {
      if (!this.call || this.call.local) return;
      try {
        this.call.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: this.call.type === 'video' });
        this.attachLocalVideo();
      } catch (e) { this.toast(t('تعذر الوصول للكاميرا أو الميكروفون'), 'error'); }
    },
    attachLocalVideo() {
      this.$nextTick(() => {
        if (this.call && this.call.local && this.$refs.localVideo) this.$refs.localVideo.srcObject = this.call.local;
      });
    },
    attachRemoteVideo() {
      this.$nextTick(() => {
        if (this.call && this.call.remote && this.$refs.remoteVideo) this.$refs.remoteVideo.srcObject = this.call.remote;
      });
    },
    createPeer() {
      if (!this.call || this.call.pc) return;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      if (this.call.local) this.call.local.getTracks().forEach(tr => pc.addTrack(tr, this.call.local));
      pc.ontrack = ev => {
        if (!this.call) return;
        this.call.remote = ev.streams[0] || new MediaStream([ev.track]);
        this.attachRemoteVideo();
      };
      pc.onicecandidate = ev => {
        if (ev.candidate && this.call && this.call.id) {
          this.signal({ type: 'candidate', candidate: ev.candidate }).catch(() => {});
        }
      };
      this.call.pc = pc;
    },
    async setupPeerStream() {
      await this.ensureLocalMedia();
      this.createPeer();
    },
    async signal(payload) {
      if (!this.call || !this.call.id) return;
      await this.api(`/api/companies/${this.company.id}/chat/calls/${this.call.id}/signal`, { method: 'POST', body: { data: payload } });
    },
    async acceptIncomingCall() {
      const c = this.call;
      if (!c || c.state !== 'incoming') return;
      c.state = 'active';
      c.started = Date.now();
      try {
        await this.api(`/api/companies/${this.company.id}/chat/calls/${c.id}/accept`, { method: 'POST' });
        await this.setupPeerStream();
      } catch (e) { this.toast(e.message, 'error'); this.teardownCall(); }
    },
    async rejectIncomingCall() {
      const c = this.call;
      if (!c || c.state !== 'incoming') return;
      try { await this.api(`/api/companies/${this.company.id}/chat/calls/${c.id}/reject`, { method: 'POST' }); }
      catch (e) { /* تجاهل */ }
      this.teardownCall();
    },
    async hangupCall() {
      const c = this.call;
      if (!c) return;
      if (c.id) { try { await this.api(`/api/companies/${this.company.id}/chat/calls/${c.id}/end`, { method: 'POST' }); } catch (e) { /* تجاهل */ } }
      this.teardownCall();
    },
    onCallEvent(event, data) {
      const call = data && data.call;
      if (!call) return;
      if (event === 'call') {
        if (Number(call.callee_id) === this.meId && !this.call) {
          this.call = {
            id: call.id, type: call.call_type, state: 'incoming',
            peerId: call.caller_id, peerName: call.caller_name || String(call.caller_id),
            started: null, pc: null, local: null
          };
        }
        return;
      }
      if (event === 'call-accepted') {
        if (!this.call) return;
        if (Number(call.caller_id) === this.meId) {
          this.call.state = 'active';
          this.call.started = Number(call.answered_at) || Date.now();
          this.call.peerName = this.call.peerName || call.callee_name || '';
          this.setupPeerStream().then(async () => {
            if (!this.call || !this.call.pc) return;
            try {
              const offer = await this.call.pc.createOffer();
              await this.call.pc.setLocalDescription(offer);
              await this.signal({ type: 'offer', sdp: offer });
            } catch (e) { /* تجاهل */ }
          }).catch(() => {});
        }
        return;
      }
      if (event === 'call-signal') {
        const c = this.call;
        if (!c || !data.data) return;
        const sig = data.data;
        if (sig.type === 'offer') {
          this.createPeer();
          if (!c.pc) return;
          c.pc.setRemoteDescription(new RTCSessionDescription(sig.sdp || sig)).then(async () => {
            const answer = await c.pc.createAnswer();
            await c.pc.setLocalDescription(answer);
            await this.signal({ type: 'answer', sdp: answer });
          }).catch(() => {});
        } else if (sig.type === 'answer') {
          if (c.pc && c.pc.remoteDescription) return;
          if (c.pc) c.pc.setRemoteDescription(new RTCSessionDescription(sig.sdp || sig)).catch(() => {});
        } else if (sig.type === 'candidate' && c.pc) {
          c.pc.addIceCandidate(new RTCIceCandidate(sig.candidate)).catch(() => {});
        }
        return;
      }
      if (event === 'call-rejected') {
        if (this.call && this.call.state === 'outgoing' && Number(call.callee_id) !== this.meId) {
          this.call.peerName = call.callee_name || this.call.peerName;
          this.teardownCall();
          this.toast(t('تم رفض المكالمة'));
        }
        return;
      }
      if (event === 'call-ended') {
        if (this.call && this.call.state !== 'incoming') { this.toast(t('انتهت المكالمة')); }
        if (this.call) this.teardownCall();
      }
    },
    teardownCall() {
      const c = this.call;
      if (!c) return;
      if (c.pc) { try { c.pc.onicecandidate = null; c.pc.ontrack = null; c.pc.close(); } catch (e) { /* تجاهل */ } }
      if (c.local) c.local.getTracks().forEach(tr => { try { tr.stop(); } catch (e) { /* تجاهل */ } });
      this.call = null;
    },
    teardown() {
      if (this._abort) { try { this._abort.abort(); } catch (e) { /* تجاهل */ } }
      clearInterval(this.recTimer);
      if (this.recorder && this.recorder.state !== 'inactive') {
        try { this.recorder.stop(); } catch (e) { /* تجاهل */ }
        if (this.recorder.stream) this.recorder.stream.getTracks().forEach(tr => tr.stop());
      }
      if (this.call) this.teardownCall();
      for (const k in this.blobs) { try { URL.revokeObjectURL(this.blobs[k]); } catch (e) { /* تجاهل */ } }
    }
  },
  template: `
  <div class="chat-app" v-cloak>
    <div class="chat-side">
      <div class="chat-side-head">
        <strong>{{ t('المحادثة الداخلية') }}</strong>
      </div>
      <div v-if="loading" class="chat-loading">{{ t('جارٍ التحميل...') }}</div>
      <div v-else class="chat-convs">
        <div class="chat-group-label">{{ t('عام') }}</div>
        <div v-for="c in channels.filter(x => x.isGeneral)" :key="'c'+c.id"
             :class="['chat-row', { active: sel.channelId === c.id }]" @click="openChannel(c.id)">
          <div class="chat-avatar gen">💬</div>
          <div class="chat-row-body">
            <div class="chat-row-top"><strong>{{ t('عام') }}</strong></div>
            <div class="chat-row-last">{{ c.last ? msgSummary(c.last) : (c.description || t('لا توجد رسائل بعد')) }}</div>
          </div>
          <span v-if="c.unread" class="chat-unread">{{ c.unread }}</span>
        </div>

        <div class="chat-group-label">{{ t('قنوات الأقسام') }}</div>
        <div v-if="!channels.filter(x => x.isDepartment).length" class="chat-none">{{ t('لا توجد أقسام بعد') }}</div>
        <div v-for="c in channels.filter(x => x.isDepartment)" :key="'c'+c.id"
             :class="['chat-row', { active: sel.channelId === c.id }]" @click="openChannel(c.id)">
          <div class="chat-avatar dep">{{ String(c.name || 'قسم').trim().slice(0,1) }}</div>
          <div class="chat-row-body">
            <div class="chat-row-top"><strong>{{ c.name }}</strong>
              <span v-if="isAdmin" class="chat-mini" @click.stop="purgeChannel(c)" title="تطهير">{{ t('تطهير') }}</span>
            </div>
            <div class="chat-row-last">{{ c.last ? msgSummary(c.last) : t('لا توجد رسائل بعد') }}</div>
          </div>
          <span v-if="c.unread" class="chat-unread">{{ c.unread }}</span>
        </div>

        <div class="chat-group-label">{{ t('المحادثات المباشرة') }}</div>
        <div v-if="!dmMembers.length" class="chat-none">{{ t('لا يوجد أعضاء آخرون') }}</div>
        <div v-for="m in dmMembers" :key="'d'+m.peerId"
             :class="['chat-row', { active: sel.peerId === m.peerId }]" @click="openDm(m.peerId)">
          <div class="chat-avatar mem">
            <span class="chat-online" v-if="m.online"></span>
            {{ String(m.name || '؟').trim().slice(0,1) }}
          </div>
          <div class="chat-row-body">
            <div class="chat-row-top"><strong>{{ m.name }}</strong>
              <span class="chat-dept">{{ m.dept }}</span>
              <span v-if="isAdmin" class="chat-mini" @click.stop="editMember(m)" title="تعديل العضو">✎</span>
            </div>
            <div class="chat-row-last">{{ m.online ? t('متصل الآن') : (m.last ? msgSummary(m.last) : t('اضغط لبدء المحادثة')) }}</div>
          </div>
          <span v-if="m.unread" class="chat-unread">{{ m.unread }}</span>
        </div>
      </div>
    </div>

    <div class="chat-main">
      <template v-if="activeConv">
        <div class="chat-head">
          <div class="chat-head-txt">
            <strong>{{ activeName }}</strong>
            <div class="chat-head-sub">
              <span v-if="activeIsChannel" class="badge" :class="activeConv.isGeneral ? 'green' : 'blue'">{{ activeConv.isGeneral ? t('عام') : t('قسم') }}</span>
              <span class="muted">{{ activeSub }}</span>
            </div>
          </div>
          <div class="chat-head-actions">
            <template v-if="activeConv.kind === 'dm'">
              <button class="btn btn-sm btn-ghost" @click="startCall('voice')" :disabled="!!call" :title="t('مكالمة صوتية')">📞</button>
              <button class="btn btn-sm btn-ghost" @click="startCall('video')" :disabled="!!call" :title="t('مكالمة فيديو')">🎥</button>
            </template>
            <template v-if="isAdmin && activeIsChannel">
              <button class="btn btn-sm btn-danger" :disabled="purgeBusy" @click="purgeActive">{{ t('تطهير القناة') }}</button>
            </template>
          </div>
        </div>

        <div class="chat-msgs" ref="msgList" @scroll="onScroll">
          <div v-if="more" class="chat-more"><button class="btn btn-sm btn-ghost" @click="loadThread(msgs.length ? msgs[0].id : null)">{{ t('تحميل أقدم') }}</button></div>
          <div v-if="msgLoading && !msgs.length" class="chat-loading">{{ t('جارٍ التحميل...') }}</div>
          <div v-if="!msgLoading && !msgs.length" class="chat-empty">{{ t('لا توجد رسائل بعد — ابدأ المحادثة') }}</div>
          <div v-for="g in groupByDay" :key="g.key" class="chat-day">
            <div class="chat-day-label">{{ g.label }}</div>
            <div v-for="m in g.msgs" :key="m.id" :class="['chat-msg', { mine: isMine(m) }]">
              <div v-if="!isMine(m)" class="chat-msg-name">{{ m.sender_name }}<span v-if="m.sender_dept"> · {{ m.sender_dept }}</span></div>
              <div class="bubble-wrap">
                <div :class="['bubble', m.msg_type]">
                  <template v-if="m.msg_type === 'text'">
                    <span class="bubble-text">{{ m.body }}</span>
                  </template>
                  <template v-else-if="m.msg_type === 'image'">
                    <img :src="fileURL(m)" class="bubble-img" @click="openImage(m)" alt="image">
                    <div v-if="m.body" class="bubble-caption">{{ m.body }}</div>
                  </template>
                  <template v-else-if="m.msg_type === 'audio'">
                    <audio :src="fileURL(m)" controls preload="metadata"></audio>
                    <div v-if="m.body" class="bubble-caption">{{ m.body }}</div>
                  </template>
                  <template v-else-if="m.msg_type === 'video'">
                    <video :src="fileURL(m)" class="bubble-video" controls preload="metadata"></video>
                    <div v-if="m.body" class="bubble-caption">{{ m.body }}</div>
                  </template>
                  <template v-else>
                    <div class="bubble-file" @click="saveFile(m)">
                      <span class="bf-icon">{{ fileIcon(m) }}</span>
                      <span class="bf-meta"><strong>{{ m.file_name }}</strong><small>{{ fmtBytes(m.file_size) }}</small></span>
                      <span class="bf-dl">⬇</span>
                    </div>
                    <div v-if="m.body" class="bubble-caption">{{ m.body }}</div>
                  </template>
                </div>
                <div class="bubble-foot">
                  <span class="bubble-time">{{ fmtTime(m.created_at) }}</span>
                  <span v-if="canDelete(m)" class="bubble-del" @click="deleteMsg(m)" :title="t('حذف (مدير النظام)')">🗑</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="chat-composer">
          <div v-if="rec.on" class="chat-recing">
            <span class="rec-dot"></span>{{ t('جارٍ التسجيل...') }} {{ recLabel }}
            <button class="btn btn-sm btn-ghost" @click="cancelRec">{{ t('إلغاء') }}</button>
            <button class="btn btn-sm btn-danger" @click="stopRec">{{ t('إرسال التسجيل') }}</button>
          </div>
          <div v-else class="composer-row">
            <button class="btn btn-icon" @click="clickAttach" :title="t('إرفاق ملف')">📎</button>
            <button class="btn btn-icon" @click="toggleRec" :title="t('رسالة صوتية')" v-if="!rec.on">🎤</button>
            <textarea v-model="text" rows="1" :placeholder="t('اكتب رسالتك...')" @keydown="onKey"></textarea>
            <button class="btn btn-primary btn-send" @click="send" :disabled="!text.trim() || msgLoading">{{ t('إرسال') }}</button>
          </div>
        </div>
      </template>
      <div v-else class="chat-welcome">
        <div class="chat-welcome-ic">💬</div>
        <h3>{{ t('المحادثة الداخلية') }}</h3>
        <p class="muted">{{ t('اختر محادثة للبدء، أو تواصل مباشرة مع أي زميل') }}</p>
      </div>
    </div>

    <!-- مودال إدارة العضو -->
    <div v-if="memberModal" class="modal-overlay" @click.self="memberModal = null">
      <div class="modal" style="max-width:440px;">
        <h3>{{ t('تعديل بيانات العضو') }}</h3>
        <div class="form-grid">
          <label>{{ t('الاسم المعروض') }}
            <input v-model.trim="memberModal.display_name">
          </label>
          <label>{{ t('القسم') }}
            <select v-model="memberModal.department_id">
              <option :value="''">{{ t('بدون قسم') }}</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </label>
          <label class="span2">{{ t('المسمى الوظيفي') }}
            <input v-model.trim="memberModal.title" :placeholder="t('مثال: محاسب أول')">
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="memberModal = null">{{ t('إلغاء') }}</button>
          <button class="btn btn-primary" @click="saveMember">{{ t('حفظ') }}</button>
        </div>
      </div>
    </div>

    <!-- نافذة المكالمة -->
    <div v-if="call" class="chat-call-ov">
      <div class="chat-call-card">
        <div class="chat-call-videos" v-if="call.state === 'active'">
          <video v-if="call.type === 'video'" ref="remoteVideo" autoplay playsinline class="call-remote-vid"></video>
          <video ref="localVideo" autoplay playsinline muted class="call-local-vid"></video>
          <div v-if="call.type === 'voice'" class="call-voice-avatar">{{ String(call.peerName || '؟').trim().slice(0,1) }}</div>
        </div>
        <div class="call-status" :class="{ outgoing: call.state === 'outgoing', incoming: call.state === 'incoming' }">
          <template v-if="call.state === 'incoming'"><span class="call-pulse"></span>{{ t('مكالمة واردة') }}</template>
          <template v-else-if="call.state === 'outgoing'"><span class="call-pulse"></span>{{ t('جارٍ الاتصال...') }}</template>
          <template v-else><span class="call-live"></span>{{ t('متصل') }} · {{ callDur }}</template>
        </div>
        <div class="call-peer">
          <div class="call-peer-avatar">{{ String(call.peerName || '؟').trim().slice(0,1) }}</div>
          <strong>{{ call.peerName || call.peerId }}</strong>
          <span class="muted">{{ call.type === 'video' ? t('مكالمة فيديو') : t('مكالمة صوتية') }}</span>
        </div>
        <div class="call-actions">
          <template v-if="call.state === 'incoming'">
            <button class="call-btn reject" @click="rejectIncomingCall" title="رفض">✖</button>
            <button class="call-btn accept" @click="acceptIncomingCall" title="قبول">📞</button>
          </template>
          <template v-else>
            <button class="call-btn reject" @click="hangupCall" title="إنهاء">✖</button>
          </template>
        </div>
      </div>
    </div>
  </div>
  `
};

// التعامل مع حدث حذف عام للقناة من الشريط الجانبي
ChatView.methods.purgeChannel = async function (c) {
  if (!this.isAdmin) return;
  if (!confirm(t('سيتم إخفاء جميع رسائل هذه القناة مع تسجيل العملية. هل تريد المتابعة؟'))) return;
  this.purgeBusy = true;
  try {
    await this.api(`/api/companies/${this.company.id}/chat/channels/${c.id}/purge`, { method: 'POST' });
    if (this.sel.channelId === c.id) this.msgs = [];
    await this.refreshConvs();
    this.toast(t('تم تطهير القناة وتسجيل العملية'));
  } catch (e) { this.toast(e.message, 'error'); }
  finally { this.purgeBusy = false; }
};
