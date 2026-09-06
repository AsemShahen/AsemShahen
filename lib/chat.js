'use strict';
// نظام المحادثة الداخلية: محادثات كتابية وصوتية وملفات ومكالمات بين موظفي الشركة
// السجل كامل ومحفوظ، الحذف مقتصر على مدير النظام مع تسجيل العملية
const path = require('path');
const fs = require('fs');

const UPLOAD_ROOT = path.join(__dirname, '..', 'data', 'uploads');
const MAX_UPLOAD = 30 * 1024 * 1024; // 30 ميغابايت

// ==================== مجرى الأحداث اللحظية (SSE) ====================
const streams = new Map();   // key `${companyId}:${userId}` -> Set<res>
const companyUsers = new Map(); // companyId -> Set(userId)

function sseKey(companyId, userId) { return `${companyId}:${userId}`; }

function subscribe(companyId, userId, res) {
  const k = sseKey(companyId, userId);
  if (!streams.has(k)) streams.set(k, new Set());
  streams.get(k).add(res);
  if (!companyUsers.has(companyId)) companyUsers.set(companyId, new Set());
  companyUsers.get(companyId).add(userId);
}

function unsubscribe(companyId, userId, res) {
  const k = sseKey(companyId, userId);
  const set = streams.get(k);
  if (set) {
    set.delete(res);
    if (!set.size) streams.delete(k);
  }
  const cu = companyUsers.get(companyId);
  if (cu) {
    cu.delete(userId);
    if (!cu.size) companyUsers.delete(companyId);
  }
}

function onlineUsers(companyId) {
  return Array.from(companyUsers.get(companyId) || []);
}

function pushUser(companyId, userId, event, data) {
  const set = streams.get(sseKey(companyId, userId));
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (e) { /* تجاهل */ }
  }
}

function pushChannel(companyId, event, data) {
  for (const uid of Array.from(companyUsers.get(companyId) || [])) {
    pushUser(companyId, uid, event, data);
  }
}

function pushDm(companyId, a, b, event, data) {
  pushUser(companyId, a, event, data);
  pushUser(companyId, b, event, data);
}

// ==================== أدوات داخلية ====================
function sortPair(a, b) { return a < b ? [a, b] : [b, a]; }

function dmKey(a, b) { const p = sortPair(Number(a), Number(b)); return p[0] + ':' + p[1]; }

function now() { return Date.now(); }

function publicMessage(m) {
  return {
    id: m.id, channel_id: m.channel_id, user_a: m.user_a, user_b: m.user_b,
    sender_id: m.sender_id, sender_name: m.sender_name, sender_dept: m.sender_dept,
    msg_type: m.msg_type, body: m.body, file_name: m.file_name, file_size: m.file_size,
    file_mime: m.file_mime, file_path: m.file_path, created_at: m.created_at,
    deleted: !!m.deleted, deleted_by: m.deleted_by
  };
}

// التأكد من وجود قنوات الأقسام والقناة العامة
function ensureChannels(db) {
  const nowIso = new Date().toISOString();
  if (!db.prepare(`SELECT id FROM chat_channels WHERE kind = 'general' LIMIT 1`).get()) {
    db.prepare(`INSERT INTO chat_channels (kind, department_id, name, description, created_at)
      VALUES ('general', NULL, 'عام', '', ?)`).run(nowIso);
  }
  const depts = db.prepare('SELECT * FROM hr_departments ORDER BY name').all();
  const have = new Set(db.prepare(`SELECT department_id FROM chat_channels WHERE kind = 'department' AND department_id IS NOT NULL`).all().map(r => r.department_id));
  const ins = db.prepare(`INSERT INTO chat_channels (kind, department_id, name, description, created_at)
    VALUES ('department', ?, ?, ?, ?)`);
  for (const d of depts) {
    if (!have.has(d.id)) ins.run(d.id, d.name, d.description || '', nowIso);
  }
}

function memberDepartments(db) {
  return db.prepare(`
    SELECT d.id, d.name FROM hr_departments d
    WHERE d.id IN (SELECT DISTINCT department_id FROM chat_members WHERE department_id IS NOT NULL)
    ORDER BY d.name`).all();
}

function getChannel(db, id) {
  return db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(id);
}

// هل يملك الطرف (مستخدم) حق الوصول لدردشة الشركة؟
// يُتحقق في المسارات، هنا نتحقق من العضويات للمحادثة المباشرة
function isMember(db, userId) {
  return !!db.prepare('SELECT user_id FROM chat_members WHERE user_id = ?').get(userId);
}

function memberName(db, userId) {
  const row = db.prepare('SELECT display_name, department_id FROM chat_members WHERE user_id = ?').get(userId);
  return row ? row.display_name : String(userId);
}

// ==================== إدارة الأعضاء ====================
// تُستدعى عند أول دخول: تسجيل العضو تلقائياً إذا لم يكن موجوداً (الاسم من المستخدم العام)
function ensureMember(db, userId, username) {
  const exists = db.prepare('SELECT user_id FROM chat_members WHERE user_id = ?').get(userId);
  if (!exists) {
    db.prepare(`INSERT INTO chat_members (user_id, display_name, department_id, title, created_at)
      VALUES (?, ?, NULL, '', ?)`).run(userId, username, new Date().toISOString());
  }
}

function setMember(db, userId, data) {
  const exists = db.prepare('SELECT user_id FROM chat_members WHERE user_id = ?').get(userId);
  if (!exists) throw new Error('العضو غير موجود');
  db.prepare(`UPDATE chat_members SET display_name = ?, department_id = ?, title = ? WHERE user_id = ?`)
    .run(String(data.display_name || '').trim() || memberName(db, userId),
      data.department_id ? Number(data.department_id) : null,
      String(data.title || ''), userId);
  return memberPublic(db, userId);
}

function memberPublic(db, userId) {
  const m = db.prepare(`
    SELECT cm.user_id, cm.display_name, cm.department_id, cm.title,
           d.name AS department_name, cm.created_at
    FROM chat_members cm LEFT JOIN hr_departments d ON d.id = cm.department_id
    WHERE cm.user_id = ?`).get(userId);
  return m || null;
}

// قائمة الأعضاء المسموح لهم (مع الأقسام وأسماء الأقسام)
function listMembers(db, userIds) {
  const out = [];
  for (const uid of userIds) {
    const m = db.prepare(`
      SELECT cm.user_id, cm.display_name, cm.department_id, cm.title, d.name AS department_name
      FROM chat_members cm LEFT JOIN hr_departments d ON d.id = cm.department_id
      WHERE cm.user_id = ?`).get(uid);
    if (m) out.push(m);
  }
  return out;
}

// ==================== الرسائل ====================
function insertMessage(db, { channel_id, peerA, peerB, sender_id, sender_name, sender_dept, msg_type, body, file_name, file_size, file_mime, file_path }) {
  const info = db.prepare(`
    INSERT INTO chat_messages (channel_id, user_a, user_b, sender_id, sender_name, sender_dept,
      msg_type, body, file_name, file_size, file_mime, file_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(channel_id || null, peerA || null, peerB || null, sender_id, sender_name, sender_dept || '',
    msg_type, body || '', file_name || '', file_size || 0, file_mime || '', file_path || '', now());
  return db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
}

// هل يستطيع المستخدم رؤية هذه الرسالة؟
function canSeeMessage(db, userId, m) {
  if (m.channel_id) {
    const ch = getChannel(db, m.channel_id);
    return !!ch;
  }
  const pair = sortPair(m.user_a, m.user_b);
  return Number(userId) === pair[0] || Number(userId) === pair[1];
}

function listMessages(db, userId, { channelId, peerId, before, limit }) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  let sql = `SELECT * FROM chat_messages WHERE deleted = 0`;
  const params = [];
  if (channelId) {
    const ch = getChannel(db, channelId);
    if (!ch) throw new Error('القناة غير موجودة');
    sql += ` AND channel_id = ?`;
    params.push(Number(channelId));
  } else if (peerId !== undefined) {
    const pair = sortPair(Number(userId), Number(peerId));
    sql += ` AND user_a = ? AND user_b = ?`;
    params.push(pair[0], pair[1]);
  } else {
    throw new Error('حدد القناة أو الطرف الآخر');
  }
  if (before) { sql += ` AND id < ?`; params.push(Number(before)); }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(lim);
  const rows = db.prepare(sql).all(...params).reverse();
  return rows.map(publicMessage);
}

function sendText(db, sender, { channelId, peerId, body }) {
  const text = String(body || '').trim();
  if (!text) throw new Error('نص الرسالة فارغ');
  const m = insertMessage(db, {
    channel_id: channelId, peerA: peerId !== undefined ? sortPair(sender.id, peerId)[0] : null,
    peerB: peerId !== undefined ? sortPair(sender.id, peerId)[1] : null,
    sender_id: sender.id, sender_name: sender.name, sender_dept: sender.dept,
    msg_type: 'text', body: text
  });
  return publicMessage(m);
}

// مسار تخزين المرفقات
function uploadDir(companyId) {
  const dir = path.join(UPLOAD_ROOT, String(companyId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFileName(name) {
  const base = path.basename(String(name || 'file').replace(/[\\/]/g, '_')).replace(/[^\w.\-\u0600-\u06FF ]+/g, '_');
  return base.slice(0, 180) || 'file';
}

function classifyFile(mime, name) {
  const m = String(mime || '').toLowerCase();
  const ext = path.extname(String(name || '')).toLowerCase();
  if (m.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image';
  if (m.startsWith('audio/') || ['.webm', '.ogg', '.oga', '.mp3', '.m4a', '.wav', '.opus'].includes(ext)) return 'audio';
  if (m.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(ext)) return 'video';
  return 'file';
}

function insertFile(db, sender, { channelId, peerId, body, file_name, file_size, file_mime }) {
  const msg_type = classifyFile(file_mime, file_name);
  return insertMessage(db, {
    channel_id: channelId, peerA: peerId !== undefined ? sortPair(sender.id, peerId)[0] : null,
    peerB: peerId !== undefined ? sortPair(sender.id, peerId)[1] : null,
    sender_id: sender.id, sender_name: sender.name, sender_dept: sender.dept,
    msg_type, body: body || '', file_name, file_size, file_mime
  });
}

function saveUploadFile(db, companyId, m, buffer) {
  const dir = uploadDir(companyId);
  const stored = `${m.id}_${safeFileName(m.file_name)}`;
  fs.writeFileSync(path.join(dir, stored), buffer);
  db.prepare('UPDATE chat_messages SET file_path = ? WHERE id = ?').run(stored, m.id);
  return stored;
}

function uploadFilePath(companyId, m) {
  return m.file_path ? path.join(uploadDir(companyId), path.basename(m.file_path)) : null;
}

// ==================== قراءات / غير مقروء ====================
function markRead(db, userId, { channelId, peerId }) {
  const stmt = db.prepare(`INSERT INTO chat_reads (user_id, channel_id, peer_id, last_read)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, channel_id, peer_id) DO UPDATE SET last_read = excluded.last_read`);
  if (channelId) stmt.run(userId, Number(channelId), 0, now());
  else if (peerId !== undefined) stmt.run(userId, null, Number(peerId), now());
}

function unreadFor(db, userId, conv) {
  if (conv.kind === 'channel') {
    return db.prepare(`
      SELECT COUNT(*) AS c FROM chat_messages m
      WHERE m.channel_id = ? AND m.deleted = 0 AND m.id > COALESCE(
        (SELECT last_read FROM chat_reads WHERE user_id = ? AND channel_id = ? AND peer_id = 0), 0)`).get(conv.id, userId, conv.id).c;
  }
  return db.prepare(`
    SELECT COUNT(*) AS c FROM chat_messages m
    WHERE ((m.user_a = ? AND m.user_b = ?) OR (m.user_a = ? AND m.user_b = ?))
      AND m.deleted = 0 AND m.id > COALESCE(
        (SELECT last_read FROM chat_reads WHERE user_id = ? AND channel_id IS NULL AND peer_id = ?), 0)`)
    .get(userId, conv.peerId, conv.peerId, userId, userId, conv.peerId).c;
}

// المحادثات الأخيرة: القنوات + المحادثات المباشرة
function conversations(db, userId) {
  ensureChannels(db);
  const channels = db.prepare(`SELECT c.*, (SELECT MAX(id) FROM chat_messages m WHERE m.channel_id = c.id AND m.deleted = 0) AS last_id
    FROM chat_channels c ORDER BY c.kind = 'general' DESC, c.name`).all();
  const dms = db.prepare(`
    SELECT user_a, user_b,
      MAX(id) AS last_id,
      (SELECT id FROM chat_messages x
        WHERE ((x.user_a = m.user_a AND x.user_b = m.user_b) OR (x.user_a = m.user_b AND x.user_b = m.user_a))
          AND x.deleted = 0 ORDER BY x.id DESC LIMIT 1) AS last_msg_id
    FROM chat_messages m
    WHERE (m.user_a = ? OR m.user_b = ?) AND m.deleted = 0
    GROUP BY user_a, user_b
    ORDER BY last_id DESC`).all(userId, userId);
  const convs = [];
  for (const c of channels) {
    const last = c.last_id ? db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(c.last_id) : null;
    convs.push({
      kind: 'channel', id: c.id, name: c.name, description: c.description || '',
      isGeneral: c.kind === 'general', isDepartment: c.kind === 'department',
      last: last ? publicMessage(last) : null,
      last_id: c.last_id || 0
    });
  }
  for (const d of dms) {
    const peerId = Number(d.user_a) === Number(userId) ? d.user_b : d.user_a;
    const last = d.last_msg_id ? db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(d.last_msg_id) : null;
    convs.push({
      kind: 'dm', id: null, peerId: Number(peerId), name: '', isDepartment: false,
      last: last ? publicMessage(last) : null,
      last_id: d.last_id || 0
    });
  }
  convs.sort((x, y) => (y.last_id || 0) - (x.last_id || 0));
  const result = [];
  for (const c of convs) {
    result.push({ ...c, unread: unreadFor(db, userId, c) });
  }
  return result;
}

function lastReadTime(db, userId, peerId, channelId) {
  const row = channelId
    ? db.prepare('SELECT last_read FROM chat_reads WHERE user_id = ? AND channel_id = ? AND peer_id = 0').get(userId, channelId)
    : db.prepare('SELECT last_read FROM chat_reads WHERE user_id = ? AND channel_id IS NULL AND peer_id = ?').get(userId, peerId);
  return row ? row.last_read : 0;
}

// ==================== حذف (للمدير فقط) مع تسجيل ====================
function deleteMessage(db, actor, messageId) {
  const m = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId);
  if (!m) throw new Error('الرسالة غير موجودة');
  if (m.deleted) return publicMessage(m);
  db.prepare('UPDATE chat_messages SET deleted = 1, deleted_by = ?, deleted_at = ? WHERE id = ?')
    .run(actor.id, now(), messageId);
  db.prepare(`INSERT INTO chat_audit (message_id, action, actor_id, actor_name, details, created_at)
    VALUES (?, 'delete_message', ?, ?, ?, ?)`)
    .run(messageId, actor.id, actor.name, `حذف رسالة #${messageId} في قناة ${m.channel_id || 'خاصة'}`, now());
  return publicMessage(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId));
}

function purgeChannel(db, actor, channelId) {
  const ch = getChannel(db, channelId);
  if (!ch) throw new Error('القناة غير موجودة');
  const n = db.prepare('UPDATE chat_messages SET deleted = 1, deleted_by = ?, deleted_at = ? WHERE channel_id = ? AND deleted = 0')
    .run(actor.id, now(), channelId).changes;
  db.prepare(`INSERT INTO chat_audit (message_id, action, actor_id, actor_name, details, created_at)
    VALUES (NULL, 'purge_channel', ?, ?, ?, ?)`)
    .run(actor.id, actor.name, `تطهير قناة "${ch.name}" (${n} رسالة)`, now());
  return { deleted: n };
}

// ==================== المكالمات ====================
function createCall(db, caller, calleeId, callType) {
  const busy = db.prepare(`SELECT id FROM chat_calls WHERE callee_id = ? AND status IN ('ringing','accepted') LIMIT 1`).get(calleeId);
  if (busy) {
    return { busy: true };
  }
  const info = db.prepare(`
    INSERT INTO chat_calls (target_type, channel_id, caller_id, callee_id, call_type, status, created_at)
    VALUES ('dm', NULL, ?, ?, ?, 'ringing', ?)`).run(caller.id, calleeId, callType === 'video' ? 'video' : 'voice', now());
  const call = db.prepare('SELECT * FROM chat_calls WHERE id = ?').get(info.lastInsertRowid);
  return { busy: false, call };
}

function updateCallStatus(db, callId, status, actorId, endReason) {
  db.prepare(`UPDATE chat_calls SET status = ?, answered_at = COALESCE(answered_at, ?), ended_at = ?, end_reason = ? WHERE id = ?`)
    .run(status, status === 'accepted' ? now() : null, status === 'ended' || status === 'rejected' || status === 'missed' || status === 'timeout' ? now() : null, endReason || '', callId);
  return db.prepare('SELECT * FROM chat_calls WHERE id = ?').get(callId);
}

function pendingCallsFor(db, userId) {
  return db.prepare(`SELECT * FROM chat_calls WHERE callee_id = ? AND status IN ('ringing','accepted') ORDER BY id DESC LIMIT 10`).all(userId);
}

module.exports = {
  UPLOAD_ROOT, MAX_UPLOAD,
  subscribe, unsubscribe, onlineUsers, pushUser, pushChannel, pushDm,
  ensureChannels, ensureMember, setMember, memberPublic, listMembers, memberDepartments,
  getChannel, conversations, listMessages, sendText, insertFile, saveUploadFile,
  uploadFilePath, safeFileName, classifyFile, markRead, lastReadTime,
  deleteMessage, purgeChannel, createCall, updateCallStatus, pendingCallsFor,
  dmKey, sortPair, now, publicMessage
};
