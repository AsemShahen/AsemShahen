'use strict';
// نظام الفنادق والضيافة (فندق / شقق مفروشة):
// أنواع الوحدات، الغرف/الوحدات، النزلاء، الحجوزات، الخدمات الفندقية،
// وحساب النزيل (Folio) مع الدفعات والترحيل المحاسبي.
// الإيراد يُعترف به عند تسجيل الخروج (Check-out) بقيد يحمّل ذمم النزلاء 1208
// ويقيد إيرادات الغرف 4130 والخدمات 4131 وضريبة المخرجات 2103.
const { createJournalEntry } = require('./accounting');

const ROOM_REVENUE_ACCOUNT = '4130';
const SERVICE_REVENUE_ACCOUNT = '4131';
const GUEST_RECEIVABLE = '1208';

const ROOM_STATUSES = ['available', 'occupied', 'cleaning', 'maintenance', 'out_of_service'];
const BOOKING_STATUSES = ['reserved', 'checked_in', 'checked_out', 'cancelled', 'no_show'];

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function getDefaultAccount(db, code) { return db.prepare('SELECT * FROM accounts WHERE code = ?').get(code); }
function getVatOutputAccount(db) { return db.prepare('SELECT * FROM accounts WHERE code = ?').get('2103'); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function companyVatRate(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'vat_rate'`).get();
  const r = row ? Number(row.value) : 15;
  return Number.isFinite(r) ? r : 15;
}

function normalizeDate(v, field = 'التاريخ') {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${field} غير صالح (الصيغة YYYY-MM-DD)`);
  return s;
}

// ليالي الإقامة من تاريخ الوصول حتى تاريخ المغادرة (المغادرة غير محسوبة)
function nightDates(checkIn, checkOut) {
  const out = [];
  const d = new Date(String(checkIn) + 'T00:00:00Z');
  const end = new Date(String(checkOut) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out;
  let guard = 0;
  while (d < end && guard < 3660) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    guard++;
  }
  return out;
}

function nextSeqNo(db, table, column, date, prefix) {
  const year = String(date).slice(0, 4);
  const head = `${prefix}-${year}-`;
  const row = db.prepare(`SELECT MAX(CAST(SUBSTR(${column}, ?) AS INTEGER)) AS m FROM ${table} WHERE ${column} LIKE ?`)
    .get(head.length + 1, head + '%');
  const next = (row.m || 0) + 1;
  return `${head}${String(next).padStart(4, '0')}`;
}
function nextGuestNo(db, date) { return nextSeqNo(db, 'hotel_guests', 'guest_no', date, 'G'); }
function nextBookingNo(db, date) { return nextSeqNo(db, 'hotel_bookings', 'booking_no', date, 'BK'); }

const PAYMENT_METHODS = ['cash', 'mada', 'credit_card', 'bank_transfer', 'sadad', 'apple_pay', 'stc_pay', 'check', 'credit', 'other'];
function isBankMethod(m) {
  return ['bank_transfer', 'sadad', 'credit_card', 'mada', 'apple_pay', 'stc_pay', 'check'].includes(m);
}

// ==================== أنواع الوحدات ====================
function listRoomTypes(db, includeInactive = false) {
  let sql = `SELECT rt.*, (SELECT COUNT(*) FROM hotel_rooms r WHERE r.room_type_id = rt.id AND r.is_active = 1) AS rooms_count
    FROM hotel_room_types rt`;
  if (!includeInactive) sql += ' WHERE rt.is_active = 1';
  sql += ' ORDER BY rt.name';
  return db.prepare(sql).all();
}

function createRoomType(db, data) {
  const code = String(data.code || '').trim();
  const name = String(data.name || '').trim();
  if (!code) throw new Error('رمز نوع الوحدة مطلوب');
  if (!name) throw new Error('اسم نوع الوحدة مطلوب');
  const dup = db.prepare('SELECT id FROM hotel_room_types WHERE code = ?').get(code);
  if (dup) throw new Error('يوجد نوع وحدة بهذا الرمز مسبقاً');
  const info = db.prepare(`INSERT INTO hotel_room_types (code, name, capacity, base_price, description, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(code, name, Math.max(1, num(data.capacity) || 1), num(data.base_price), data.description || '',
      data.is_active === false ? 0 : 1, new Date().toISOString());
  return getRoomType(db, info.lastInsertRowid);
}

function getRoomType(db, id) {
  return db.prepare('SELECT * FROM hotel_room_types WHERE id = ?').get(id);
}

function updateRoomType(db, id, data) {
  const rt = getRoomType(db, id);
  if (!rt) return null;
  const code = data.code !== undefined ? String(data.code).trim() : rt.code;
  const dup = db.prepare('SELECT id FROM hotel_room_types WHERE code = ? AND id <> ?').get(code, id);
  if (dup) throw new Error('يوجد نوع وحدة بهذا الرمز مسبقاً');
  db.prepare(`UPDATE hotel_room_types SET code=?, name=?, capacity=?, base_price=?, description=?, is_active=? WHERE id=?`)
    .run(code, data.name !== undefined ? String(data.name).trim() : rt.name,
      data.capacity !== undefined ? Math.max(1, num(data.capacity) || 1) : rt.capacity,
      data.base_price !== undefined ? num(data.base_price) : rt.base_price,
      data.description !== undefined ? data.description : rt.description,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : rt.is_active, id);
  return getRoomType(db, id);
}

function deleteRoomType(db, id) {
  const rooms = db.prepare('SELECT COUNT(*) AS c FROM hotel_rooms WHERE room_type_id = ?').get(id).c;
  if (rooms) throw new Error('لا يمكن حذف نوع وحدة مرتبط بغرف/وحدات');
  db.prepare('DELETE FROM hotel_room_types WHERE id = ?').run(id);
  return true;
}

// ==================== الغرف والوحدات ====================
function listRooms(db, { status, roomTypeId, search } = {}) {
  let sql = `SELECT r.*, rt.name AS room_type_name, rt.base_price, rt.capacity,
      (SELECT b.id FROM hotel_bookings b WHERE b.room_id = r.id AND b.status = 'checked_in' ORDER BY b.id DESC LIMIT 1) AS active_booking_id,
      (SELECT g.name FROM hotel_bookings b JOIN hotel_guests g ON g.id = b.guest_id
        WHERE b.room_id = r.id AND b.status = 'checked_in' ORDER BY b.id DESC LIMIT 1) AS current_guest,
      (SELECT b.check_out_date FROM hotel_bookings b WHERE b.room_id = r.id AND b.status = 'checked_in' ORDER BY b.id DESC LIMIT 1) AS current_checkout,
      (SELECT b.check_in_date FROM hotel_bookings b WHERE b.room_id = r.id AND b.status = 'reserved' ORDER BY b.check_in_date LIMIT 1) AS next_checkin
    FROM hotel_rooms r LEFT JOIN hotel_room_types rt ON rt.id = r.room_type_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND r.status = ?'; params.push(status); }
  if (roomTypeId) { sql += ' AND r.room_type_id = ?'; params.push(Number(roomTypeId)); }
  if (search) { sql += ' AND (r.room_no LIKE ? OR rt.name LIKE ?)'; const s = `%${String(search).trim()}%`; params.push(s, s); }
  sql += ' ORDER BY r.room_no';
  return db.prepare(sql).all(...params);
}

function getRoom(db, id) {
  return db.prepare(`SELECT r.*, rt.name AS room_type_name, rt.base_price FROM hotel_rooms r
    LEFT JOIN hotel_room_types rt ON rt.id = r.room_type_id WHERE r.id = ?`).get(id);
}

function createRoom(db, data) {
  const roomNo = String(data.room_no || '').trim();
  if (!roomNo) throw new Error('رقم الغرفة/الوحدة مطلوب');
  const dup = db.prepare('SELECT id FROM hotel_rooms WHERE room_no = ?').get(roomNo);
  if (dup) throw new Error('يوجد غرفة/وحدة بهذا الرقم مسبقاً');
  const status = ROOM_STATUSES.includes(data.status) ? data.status : 'available';
  const info = db.prepare(`INSERT INTO hotel_rooms (room_no, room_type_id, floor, status, notes, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(roomNo, data.room_type_id ? Number(data.room_type_id) : null, data.floor || '', status,
      data.notes || '', data.is_active === false ? 0 : 1, new Date().toISOString());
  return getRoom(db, info.lastInsertRowid);
}

function updateRoom(db, id, data) {
  const room = getRoom(db, id);
  if (!room) return null;
  const roomNo = data.room_no !== undefined ? String(data.room_no).trim() : room.room_no;
  const dup = db.prepare('SELECT id FROM hotel_rooms WHERE room_no = ? AND id <> ?').get(roomNo, id);
  if (dup) throw new Error('يوجد غرفة/وحدة بهذا الرقم مسبقاً');
  if (data.status !== undefined && !ROOM_STATUSES.includes(data.status)) throw new Error('حالة الغرفة غير صحيحة');
  db.prepare(`UPDATE hotel_rooms SET room_no=?, room_type_id=?, floor=?, status=?, notes=?, is_active=? WHERE id=?`)
    .run(roomNo,
      data.room_type_id !== undefined ? (data.room_type_id ? Number(data.room_type_id) : null) : room.room_type_id,
      data.floor !== undefined ? data.floor : room.floor,
      data.status !== undefined ? data.status : room.status,
      data.notes !== undefined ? data.notes : room.notes,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : room.is_active, id);
  return getRoom(db, id);
}

function deleteRoom(db, id) {
  const active = db.prepare(`SELECT COUNT(*) AS c FROM hotel_bookings WHERE room_id = ? AND status IN ('reserved','checked_in')`).get(id).c;
  if (active) throw new Error('لا يمكن حذف غرفة/وحدة عليها حجز قائم');
  db.prepare('DELETE FROM hotel_rooms WHERE id = ?').run(id);
  return true;
}

function setRoomStatus(db, id, status) {
  if (!ROOM_STATUSES.includes(status)) throw new Error('حالة الغرفة غير صحيحة');
  db.prepare('UPDATE hotel_rooms SET status = ? WHERE id = ?').run(status, id);
  return getRoom(db, id);
}

function roomStatusSummary(db) {
  const rows = db.prepare(`SELECT status, COUNT(*) AS c FROM hotel_rooms WHERE is_active = 1 GROUP BY status`).all();
  const out = { available: 0, occupied: 0, cleaning: 0, maintenance: 0, out_of_service: 0, total: 0 };
  for (const r of rows) { out[r.status] = r.c; out.total += r.c; }
  return out;
}

// ==================== النزلاء ====================
function listGuests(db, search) {
  let sql = `SELECT g.*, (SELECT COUNT(*) FROM hotel_bookings b WHERE b.guest_id = g.id) AS bookings_count,
      (SELECT MAX(b.check_in_date) FROM hotel_bookings b WHERE b.guest_id = g.id) AS last_stay
    FROM hotel_guests g WHERE 1=1`;
  const params = [];
  if (search) {
    sql += ' AND (g.name LIKE ? OR g.guest_no LIKE ? OR g.phone LIKE ? OR g.national_id LIKE ?)';
    const s = `%${String(search).trim()}%`; params.push(s, s, s, s);
  }
  sql += ' ORDER BY g.name';
  return db.prepare(sql).all(...params);
}

function getGuest(db, id) {
  const g = db.prepare('SELECT * FROM hotel_guests WHERE id = ?').get(id);
  if (!g) return null;
  g.bookings = db.prepare(`SELECT b.*, r.room_no FROM hotel_bookings b LEFT JOIN hotel_rooms r ON r.id = b.room_id
    WHERE b.guest_id = ? ORDER BY b.check_in_date DESC, b.id DESC`).all(id);
  return g;
}

function createGuest(db, data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم النزيل مطلوب');
  const date = data.date || todayStr();
  const info = db.prepare(`INSERT INTO hotel_guests (guest_no, name, national_id, phone, email, nationality, address, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(nextGuestNo(db, date), name, data.national_id || '', data.phone || '', data.email || '',
      data.nationality || '', data.address || '', data.notes || '', new Date().toISOString());
  return getGuest(db, info.lastInsertRowid);
}

function updateGuest(db, id, data) {
  const g = db.prepare('SELECT * FROM hotel_guests WHERE id = ?').get(id);
  if (!g) return null;
  const name = data.name !== undefined ? String(data.name).trim() : g.name;
  if (!name) throw new Error('اسم النزيل مطلوب');
  db.prepare(`UPDATE hotel_guests SET name=?, national_id=?, phone=?, email=?, nationality=?, address=?, notes=? WHERE id=?`)
    .run(name,
      data.national_id !== undefined ? data.national_id : g.national_id,
      data.phone !== undefined ? data.phone : g.phone,
      data.email !== undefined ? data.email : g.email,
      data.nationality !== undefined ? data.nationality : g.nationality,
      data.address !== undefined ? data.address : g.address,
      data.notes !== undefined ? data.notes : g.notes, id);
  return getGuest(db, id);
}

function deleteGuest(db, id) {
  const bookings = db.prepare('SELECT COUNT(*) AS c FROM hotel_bookings WHERE guest_id = ?').get(id).c;
  if (bookings) throw new Error('لا يمكن حذف نزيل له حجوزات مسجّلة');
  db.prepare('DELETE FROM hotel_guests WHERE id = ?').run(id);
  return true;
}

// ==================== الخدمات الفندقية ====================
function listServices(db, includeInactive = false) {
  let sql = 'SELECT * FROM hotel_services';
  if (!includeInactive) sql += ' WHERE is_active = 1';
  sql += ' ORDER BY name';
  return db.prepare(sql).all();
}

function createService(db, data) {
  const code = String(data.code || '').trim();
  const name = String(data.name || '').trim();
  if (!code) throw new Error('رمز الخدمة مطلوب');
  if (!name) throw new Error('اسم الخدمة مطلوب');
  const dup = db.prepare('SELECT id FROM hotel_services WHERE code = ?').get(code);
  if (dup) throw new Error('توجد خدمة بهذا الرمز مسبقاً');
  const info = db.prepare(`INSERT INTO hotel_services (code, name, category, price, cost, account_code, vat_applicable, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, name, data.category || 'other', num(data.price), num(data.cost),
      data.account_code || SERVICE_REVENUE_ACCOUNT, data.vat_applicable === false ? 0 : 1,
      data.is_active === false ? 0 : 1, new Date().toISOString());
  return db.prepare('SELECT * FROM hotel_services WHERE id = ?').get(info.lastInsertRowid);
}

function updateService(db, id, data) {
  const s = db.prepare('SELECT * FROM hotel_services WHERE id = ?').get(id);
  if (!s) return null;
  const code = data.code !== undefined ? String(data.code).trim() : s.code;
  const dup = db.prepare('SELECT id FROM hotel_services WHERE code = ? AND id <> ?').get(code, id);
  if (dup) throw new Error('توجد خدمة بهذا الرمز مسبقاً');
  db.prepare(`UPDATE hotel_services SET code=?, name=?, category=?, price=?, cost=?, account_code=?, vat_applicable=?, is_active=? WHERE id=?`)
    .run(code, data.name !== undefined ? String(data.name).trim() : s.name,
      data.category !== undefined ? data.category : s.category,
      data.price !== undefined ? num(data.price) : s.price,
      data.cost !== undefined ? num(data.cost) : s.cost,
      data.account_code !== undefined ? data.account_code : s.account_code,
      data.vat_applicable !== undefined ? (data.vat_applicable ? 1 : 0) : s.vat_applicable,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : s.is_active, id);
  return db.prepare('SELECT * FROM hotel_services WHERE id = ?').get(id);
}

function deleteService(db, id) {
  db.prepare('DELETE FROM hotel_services WHERE id = ?').run(id);
  return true;
}

// ==================== الحجوزات ====================
function bookingSql() {
  return `SELECT b.*, g.name AS guest_name, g.phone AS guest_phone, g.national_id AS guest_national_id,
      g.nationality AS guest_nationality, r.room_no, rt.name AS room_type_name
    FROM hotel_bookings b
    LEFT JOIN hotel_guests g ON g.id = b.guest_id
    LEFT JOIN hotel_rooms r ON r.id = b.room_id
    LEFT JOIN hotel_room_types rt ON rt.id = b.room_type_id`;
}

function listBookings(db, { status, roomId, search, from, to, limit = 500 } = {}) {
  let sql = bookingSql() + ' WHERE 1=1';
  const params = [];
  if (status) {
    if (Array.isArray(status)) { sql += ` AND b.status IN (${status.map(() => '?').join(',')})`; params.push(...status); }
    else { sql += ' AND b.status = ?'; params.push(status); }
  }
  if (roomId) { sql += ' AND b.room_id = ?'; params.push(Number(roomId)); }
  if (from) { sql += ' AND b.check_in_date >= ?'; params.push(String(from)); }
  if (to) { sql += ' AND b.check_in_date <= ?'; params.push(String(to)); }
  if (search) {
    sql += ' AND (b.booking_no LIKE ? OR g.name LIKE ? OR r.room_no LIKE ? OR g.phone LIKE ?)';
    const s = `%${String(search).trim()}%`; params.push(s, s, s, s);
  }
  sql += ' ORDER BY b.check_in_date DESC, b.id DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function getBooking(db, id) {
  const booking = db.prepare(bookingSql() + ' WHERE b.id = ?').get(id);
  if (!booking) return null;
  const folio = computeFolio(db, booking);
  booking.charges = folio.charges;
  booking.payments = folio.payments;
  booking.folio = {
    sub_total: folio.sub_total, discount: folio.discount, vat: folio.vat, total: folio.total,
    vat_rate: folio.vat_rate, paid_amount: folio.paid_amount, balance: folio.balance
  };
  return booking;
}

function computeFolio(db, booking) {
  const charges = db.prepare('SELECT * FROM hotel_charges WHERE booking_id = ? ORDER BY date, id').all(booking.id);
  const payments = db.prepare('SELECT * FROM hotel_payments WHERE booking_id = ? ORDER BY date, id').all(booking.id);
  const vatRate = num(booking.vat_rate) || companyVatRate(db);
  const subTotal = charges.reduce((s, c) => s + num(c.amount), 0);
  const discount = num(booking.discount);
  const taxable = Math.max(0, subTotal - discount);
  const vat = taxable * vatRate / 100;
  const total = taxable + vat;
  const paid = payments.reduce((s, p) => s + num(p.amount), 0);
  return { charges, payments, sub_total: subTotal, discount, vat, total, vat_rate: vatRate, paid_amount: paid, balance: total - paid };
}

// توليد بنود إيجار الغرفة لليالي الحجز (يُعاد توليدها عند تغيّر التواريخ)
function regenerateRoomCharges(db, booking) {
  db.prepare(`DELETE FROM hotel_charges WHERE booking_id = ? AND charge_type = 'room'`).run(booking.id);
  const nights = nightDates(booking.check_in_date, booking.check_out_date);
  if (!nights.length) return 0;
  const room = db.prepare('SELECT room_no FROM hotel_rooms WHERE id = ?').get(booking.room_id);
  const label = room ? room.room_no : '';
  const ins = db.prepare(`INSERT INTO hotel_charges (booking_id, date, charge_type, description, qty, unit_price, amount, account_code, vat_applicable, notes, created_at)
    VALUES (?, ?, 'room', ?, 1, ?, ?, ?, 1, '', ?)`);
  const now = new Date().toISOString();
  for (const d of nights) {
    ins.run(booking.id, d, `إيجار غرفة ${label} - ليلة ${d}`, num(booking.rate), num(booking.rate), ROOM_REVENUE_ACCOUNT, now);
  }
  return nights.length;
}

function hasOverlap(db, roomId, checkIn, checkOut, excludeId) {
  let sql = `SELECT id, check_in_date, check_out_date FROM hotel_bookings
    WHERE room_id = ? AND status IN ('reserved','checked_in')`;
  const params = [roomId];
  if (excludeId) { sql += ' AND id <> ?'; params.push(Number(excludeId)); }
  const rows = db.prepare(sql).all(...params);
  return rows.some(r => checkIn < r.check_out_date && checkOut > r.check_in_date);
}

function createBooking(db, data) {
  const guestId = Number(data.guest_id);
  const roomId = Number(data.room_id);
  if (!guestId || !db.prepare('SELECT id FROM hotel_guests WHERE id = ?').get(guestId)) throw new Error('يجب اختيار النزيل');
  const room = db.prepare('SELECT * FROM hotel_rooms WHERE id = ?').get(roomId);
  if (!room) throw new Error('يجب اختيار الغرفة/الوحدة');
  const checkIn = normalizeDate(data.check_in_date, 'تاريخ الوصول');
  const checkOut = normalizeDate(data.check_out_date, 'تاريخ المغادرة');
  const nights = nightDates(checkIn, checkOut);
  if (!nights.length) throw new Error('تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول');
  if (hasOverlap(db, roomId, checkIn, checkOut, null)) throw new Error('الغرفة/الوحدة محجوزة في هذه الفترة');

  const roomType = room.room_type_id ? db.prepare('SELECT * FROM hotel_room_types WHERE id = ?').get(room.room_type_id) : null;
  const rate = (data.rate !== undefined && data.rate !== '' && data.rate !== null) ? num(data.rate) : num(roomType && roomType.base_price);
  const vatRate = companyVatRate(db);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO hotel_bookings
      (booking_no, guest_id, room_id, room_type_id, check_in_date, check_out_date, nights, adults, children, rate, status,
        discount, vat_rate, deposit, payment_method, notes, fiscal_year_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?)`)
      .run(nextBookingNo(db, checkIn), guestId, roomId, room.room_type_id || null, checkIn, checkOut, nights.length,
        Math.max(1, num(data.adults) || 1), Math.max(0, num(data.children) || 0), rate,
        num(data.discount), vatRate, num(data.deposit), data.payment_method || 'cash', data.notes || '',
        data.fiscal_year_id || null, now);
    const id = info.lastInsertRowid;
    const booking = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
    regenerateRoomCharges(db, booking);
    if (num(data.deposit) > 0) {
      addPayment(db, { booking_id: id, amount: num(data.deposit), method: data.payment_method || 'cash', date: checkIn, notes: 'عربون الحجز' });
    }
    return id;
  });
  return getBooking(db, tx());
}

function updateBooking(db, id, data) {
  const booking = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
  if (!booking) return null;
  if (['checked_out', 'cancelled'].includes(booking.status)) throw new Error('لا يمكن تعديل حجز مغلق');
  const checkIn = data.check_in_date !== undefined ? normalizeDate(data.check_in_date, 'تاريخ الوصول') : booking.check_in_date;
  const checkOut = data.check_out_date !== undefined ? normalizeDate(data.check_out_date, 'تاريخ المغادرة') : booking.check_out_date;
  const nights = nightDates(checkIn, checkOut);
  if (!nights.length) throw new Error('تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول');
  const roomId = data.room_id !== undefined ? Number(data.room_id) : booking.room_id;
  const room = db.prepare('SELECT * FROM hotel_rooms WHERE id = ?').get(roomId);
  if (!room) throw new Error('الغرفة/الوحدة غير موجودة');
  if (hasOverlap(db, roomId, checkIn, checkOut, id)) throw new Error('الغرفة/الوحدة محجوزة في هذه الفترة');

  const tx = db.transaction(() => {
    db.prepare(`UPDATE hotel_bookings SET guest_id=?, room_id=?, room_type_id=?, check_in_date=?, check_out_date=?, nights=?,
      adults=?, children=?, rate=?, discount=?, notes=?, payment_method=? WHERE id=?`)
      .run(
        data.guest_id !== undefined ? Number(data.guest_id) : booking.guest_id,
        roomId, room.room_type_id || null, checkIn, checkOut, nights.length,
        data.adults !== undefined ? Math.max(1, num(data.adults) || 1) : booking.adults,
        data.children !== undefined ? Math.max(0, num(data.children) || 0) : booking.children,
        data.rate !== undefined ? num(data.rate) : booking.rate,
        data.discount !== undefined ? num(data.discount) : booking.discount,
        data.notes !== undefined ? data.notes : booking.notes,
        data.payment_method !== undefined ? data.payment_method : booking.payment_method, id);
    const updated = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
    regenerateRoomCharges(db, updated);
  });
  tx();
  return getBooking(db, id);
}

function cancelBooking(db, id) {
  const booking = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
  if (!booking) throw new Error('الحجز غير موجود');
  if (booking.status === 'checked_out') throw new Error('لا يمكن إلغاء حجز تم تسجيل خروجه');
  const tx = db.transaction(() => {
    db.prepare(`UPDATE hotel_bookings SET status = 'cancelled', sub_total = 0, vat = 0, total = 0, paid_amount = 0 WHERE id = ?`).run(id);
    db.prepare('DELETE FROM hotel_charges WHERE booking_id = ?').run(id);
    const room = db.prepare('SELECT status FROM hotel_rooms WHERE id = ?').get(booking.room_id);
    if (room && room.status === 'occupied') db.prepare(`UPDATE hotel_rooms SET status = 'available' WHERE id = ?`).run(booking.room_id);
  });
  tx();
  return getBooking(db, id);
}

function checkIn(db, id, { date, room_id } = {}) {
  const booking = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
  if (!booking) throw new Error('الحجز غير موجود');
  if (booking.status !== 'reserved') throw new Error('يمكن تسجيل الدخول فقط لحجز محجوز');
  const checkInDate = date ? normalizeDate(date, 'تاريخ الدخول') : booking.check_in_date;
  let roomId = booking.room_id;
  const tx = db.transaction(() => {
    if (room_id && Number(room_id) !== Number(booking.room_id)) {
      const room = db.prepare('SELECT * FROM hotel_rooms WHERE id = ?').get(Number(room_id));
      if (!room) throw new Error('الغرفة/الوحدة غير موجودة');
      if (hasOverlap(db, Number(room_id), checkInDate, booking.check_out_date, id)) throw new Error('الغرفة البديلة محجوزة في هذه الفترة');
      roomId = Number(room_id);
    }
    db.prepare(`UPDATE hotel_bookings SET status = 'checked_in', check_in_date = ?, room_id = ?, checked_in_at = ? WHERE id = ?`)
      .run(checkInDate, roomId, new Date().toISOString(), id);
    const updated = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
    regenerateRoomCharges(db, updated);
    db.prepare(`UPDATE hotel_rooms SET status = 'occupied' WHERE id = ?`).run(roomId);
  });
  tx();
  return getBooking(db, id);
}

function checkedIn(db, id) {
  return db.prepare(`SELECT * FROM hotel_bookings WHERE id = ? AND status = 'checked_in'`).get(id);
}

// تسجيل الخروج: توليد بنود الليالي الفعلية، احتساب الحساب، ترحيل الإيراد، تحرير الغرفة
function checkOut(db, id, data = {}) {
  const booking = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
  if (!booking) throw new Error('الحجز غير موجود');
  if (booking.status !== 'checked_in') throw new Error('يمكن تسجيل الخروج فقط لنزيل مسجّل الدخول');
  const outDate = data.date ? normalizeDate(data.date, 'تاريخ الخروج') : todayStr();
  if (outDate <= booking.check_in_date) throw new Error('تاريخ الخروج يجب أن يكون بعد تاريخ الدخول');
  const fiscalYearId = data.fiscal_year_id || booking.fiscal_year_id || null;

  const tx = db.transaction(() => {
    db.prepare('UPDATE hotel_bookings SET check_out_date = ?, discount = ?, payment_method = ? WHERE id = ?')
      .run(outDate, data.discount !== undefined ? num(data.discount) : booking.discount,
        data.payment_method || booking.payment_method, id);
    const updated = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
    updated.nights = regenerateRoomCharges(db, updated);
    db.prepare('UPDATE hotel_bookings SET nights = ? WHERE id = ?').run(updated.nights, id);

    if (data.paid_amount !== undefined && num(data.paid_amount) > 0) {
      addPayment(db, { booking_id: id, amount: num(data.paid_amount), method: data.payment_method || booking.payment_method, date: outDate, notes: data.notes || 'دفعة عند المغادرة', fiscal_year_id: fiscalYearId });
    }

    const fresh = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
    const folio = computeFolio(db, fresh);
    postFolioJournal(db, { booking: fresh, folio, date: outDate, fiscal_year_id: fiscalYearId });

    const status = folio.total - folio.paid_amount <= 0.01 ? 'paid' : (folio.paid_amount > 0 ? 'partial' : 'unpaid');
    db.prepare(`UPDATE hotel_bookings SET sub_total = ?, vat = ?, total = ?, paid_amount = ?, status = 'checked_out', check_out_date = ?, checked_out_at = ? WHERE id = ?`)
      .run(folio.sub_total, folio.vat, folio.total, folio.paid_amount, outDate, new Date().toISOString(), id);
    db.prepare(`UPDATE hotel_rooms SET status = 'cleaning' WHERE id = ?`).run(fresh.room_id);
    return status;
  });
  const status = tx();
  const result = getBooking(db, id);
  result.payment_status = status;
  return result;
}

function postFolioJournal(db, { booking, folio, date, fiscal_year_id }) {
  const charges = folio.charges;
  const gross = charges.reduce((s, c) => s + num(c.amount), 0);
  const netRevenue = folio.sub_total - folio.discount;
  const revenueMap = {};
  for (const c of charges) {
    const accCode = c.account_code || (c.charge_type === 'room' ? ROOM_REVENUE_ACCOUNT : SERVICE_REVENUE_ACCOUNT);
    const acc = getDefaultAccount(db, accCode) || getDefaultAccount(db, SERVICE_REVENUE_ACCOUNT);
    if (!acc) continue;
    const amount = gross > 0 ? netRevenue * num(c.amount) / gross : 0;
    revenueMap[acc.id] = (revenueMap[acc.id] || 0) + amount;
  }
  const lines = [];
  for (const [accId, amount] of Object.entries(revenueMap)) {
    if (Math.abs(amount) > 0.001) lines.push({ account_id: Number(accId), credit: amount, detail: 'إيراد فندقي' });
  }
  const vatAcc = getVatOutputAccount(db);
  if (folio.vat > 0.01 && vatAcc) {
    lines.push({ account_id: vatAcc.id, credit: folio.vat, vat_amount: folio.vat, vat_type: 'output', detail: `ضريبة القيمة المضافة ${folio.vat_rate}%` });
  }
  const recvAcc = getDefaultAccount(db, GUEST_RECEIVABLE) || getDefaultAccount(db, '1201');
  if (recvAcc) lines.push({ account_id: recvAcc.id, debit: folio.total, detail: 'حساب نزيل' });
  if (lines.length >= 2) {
    createJournalEntry(db, {
      date, description: `حساب نزيل ${booking.booking_no}`, ref_type: 'hotel_folio', ref_id: booking.id,
      fiscal_year_id, lines
    });
  }
}

function deleteBooking(db, id) {
  const booking = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(id);
  if (!booking) return false;
  const tx = db.transaction(() => {
    for (const refType of ['hotel_folio', 'hotel_payment']) {
      db.prepare('DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE ref_type = ? AND ref_id = ?)').run(refType, id);
      db.prepare('DELETE FROM journal_entries WHERE ref_type = ? AND ref_id = ?').run(refType, id);
    }
    db.prepare('DELETE FROM hotel_charges WHERE booking_id = ?').run(id);
    db.prepare('DELETE FROM hotel_payments WHERE booking_id = ?').run(id);
    db.prepare('DELETE FROM hotel_bookings WHERE id = ?').run(id);
    const room = db.prepare('SELECT status FROM hotel_rooms WHERE id = ?').get(booking.room_id);
    if (room && room.status === 'occupied') db.prepare(`UPDATE hotel_rooms SET status = 'available' WHERE id = ?`).run(booking.room_id);
  });
  tx();
  return true;
}

// ==================== بنود الحساب (Charges) ====================
function addCharge(db, data) {
  const booking = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(Number(data.booking_id));
  if (!booking) throw new Error('الحجز غير موجود');
  if (['checked_out', 'cancelled'].includes(booking.status)) throw new Error('لا يمكن إضافة بند لحجز مغلق');
  const description = String(data.description || '').trim();
  if (!description) throw new Error('وصف البند مطلوب');
  const qty = num(data.qty) > 0 ? num(data.qty) : 1;
  const unitPrice = num(data.unit_price);
  const amount = data.amount !== undefined && data.amount !== '' ? num(data.amount) : qty * unitPrice;
  let accountCode = data.account_code || '';
  if (!accountCode && data.service_id) {
    const svc = db.prepare('SELECT * FROM hotel_services WHERE id = ?').get(Number(data.service_id));
    if (svc) accountCode = svc.account_code || SERVICE_REVENUE_ACCOUNT;
  }
  const chargeType = ['room', 'service', 'other'].includes(data.charge_type) ? data.charge_type : 'service';
  const info = db.prepare(`INSERT INTO hotel_charges (booking_id, date, charge_type, description, qty, unit_price, amount, account_code, vat_applicable, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(booking.id, data.date ? normalizeDate(data.date, 'تاريخ البند') : todayStr(), chargeType, description,
      qty, unitPrice, amount, accountCode || SERVICE_REVENUE_ACCOUNT,
      data.vat_applicable === false ? 0 : 1, data.notes || '', new Date().toISOString());
  return db.prepare('SELECT * FROM hotel_charges WHERE id = ?').get(info.lastInsertRowid);
}

function deleteCharge(db, id) {
  const c = db.prepare('SELECT * FROM hotel_charges WHERE id = ?').get(id);
  if (!c) return false;
  if (c.charge_type === 'room') throw new Error('لا يمكن حذف بند إيجار الغرفة يدوياً');
  db.prepare('DELETE FROM hotel_charges WHERE id = ?').run(id);
  return true;
}

// ==================== الدفعات ====================
function addPayment(db, data) {
  const booking = db.prepare('SELECT * FROM hotel_bookings WHERE id = ?').get(Number(data.booking_id));
  if (!booking) throw new Error('الحجز غير موجود');
  const amount = num(data.amount);
  if (amount <= 0) throw new Error('مبلغ الدفعة يجب أن يكون أكبر من صفر');
  const method = PAYMENT_METHODS.includes(data.method) ? data.method : 'cash';
  const date = data.date ? normalizeDate(data.date, 'تاريخ الدفعة') : todayStr();
  const fiscalYearId = data.fiscal_year_id || booking.fiscal_year_id || null;
  const tx = db.transaction(() => {
    let entryId = null;
    const cashAcc = getDefaultAccount(db, '1101');
    const bankAcc = getDefaultAccount(db, '1111');
    const debitAcc = isBankMethod(method) ? bankAcc : cashAcc;
    const recvAcc = getDefaultAccount(db, GUEST_RECEIVABLE) || getDefaultAccount(db, '1201');
    if (debitAcc && recvAcc) {
      const entry = createJournalEntry(db, {
        date, description: `دفعة من نزيل ${booking.booking_no}`, ref_type: 'hotel_payment', ref_id: booking.id,
        fiscal_year_id: fiscalYearId,
        lines: [
          { account_id: debitAcc.id, debit: amount, detail: `تحصيل - ${method}` },
          { account_id: recvAcc.id, credit: amount, detail: `دفعة نزيل ${booking.booking_no}` }
        ]
      });
      entryId = entry ? entry.id : null;
    }
    const info = db.prepare(`INSERT INTO hotel_payments (booking_id, date, amount, method, notes, journal_entry_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(booking.id, date, amount, method, data.notes || '', entryId, new Date().toISOString());
    db.prepare('UPDATE hotel_bookings SET paid_amount = COALESCE((SELECT SUM(amount) FROM hotel_payments WHERE booking_id = ?), 0) WHERE id = ?')
      .run(booking.id, booking.id);
    return info.lastInsertRowid;
  });
  const paymentId = tx();
  return { payment: db.prepare('SELECT * FROM hotel_payments WHERE id = ?').get(paymentId), booking: getBooking(db, booking.id) };
}

// ==================== لوحة الفندق ====================
function hotelDashboard(db, fiscalYearId) {
  const statusCounts = roomStatusSummary(db);
  const today = todayStr();
  const arrivals = db.prepare(`SELECT COUNT(*) AS c FROM hotel_bookings WHERE status = 'reserved' AND check_in_date = ?`).get(today).c;
  const departures = db.prepare(`SELECT COUNT(*) AS c FROM hotel_bookings WHERE status = 'checked_in' AND check_out_date <= ?`).get(today).c;
  const inHouse = db.prepare(`SELECT COUNT(*) AS c FROM hotel_bookings WHERE status = 'checked_in'`).get().c;
  const activeBookings = db.prepare(`SELECT COUNT(*) AS c FROM hotel_bookings WHERE status IN ('reserved','checked_in')`).get().c;
  const guestsCount = db.prepare('SELECT COUNT(*) AS c FROM hotel_guests').get().c;
  const revenue = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM hotel_bookings WHERE status = 'checked_out' AND fiscal_year_id = ?`).get(fiscalYearId).t;
  const collected = db.prepare(`SELECT COALESCE(SUM(hp.amount),0) AS t FROM hotel_payments hp
    JOIN hotel_bookings b ON b.id = hp.booking_id WHERE b.status = 'checked_out' AND b.fiscal_year_id = ?`).get(fiscalYearId).t;
  const receivable = db.prepare(`SELECT COALESCE(SUM(total - paid_amount),0) AS t FROM hotel_bookings
    WHERE status = 'checked_out' AND fiscal_year_id = ? AND total > paid_amount`).get(fiscalYearId).t;
  const occupancy = statusCounts.total ? Math.round(statusCounts.occupied * 100 / statusCounts.total) : 0;
  const arrivalsList = db.prepare(bookingSql() + ` WHERE b.status = 'reserved' AND b.check_in_date = ? ORDER BY b.id LIMIT 20`).all(today);
  const inHouseList = db.prepare(bookingSql() + ` WHERE b.status = 'checked_in' ORDER BY b.check_out_date LIMIT 20`).all();
  const rooms = listRooms(db, {});
  return {
    rooms: statusCounts, occupancy, arrivals, departures, in_house: inHouse, active_bookings: activeBookings,
    guests_count: guestsCount, revenue, collected, receivable,
    arrivals_list: arrivalsList, in_house_list: inHouseList, rooms_list: rooms
  };
}

module.exports = {
  ROOM_STATUSES, BOOKING_STATUSES, ROOM_REVENUE_ACCOUNT, SERVICE_REVENUE_ACCOUNT, GUEST_RECEIVABLE,
  listRoomTypes, getRoomType, createRoomType, updateRoomType, deleteRoomType,
  listRooms, getRoom, createRoom, updateRoom, deleteRoom, setRoomStatus, roomStatusSummary,
  listGuests, getGuest, createGuest, updateGuest, deleteGuest,
  listServices, createService, updateService, deleteService,
  listBookings, getBooking, createBooking, updateBooking, cancelBooking, checkIn, checkOut, deleteBooking, computeFolio,
  addCharge, deleteCharge, addPayment, hotelDashboard
};
