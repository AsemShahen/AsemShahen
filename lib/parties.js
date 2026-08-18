'use strict';

function listParties(db, type) {
  let sql = `SELECT p.*,
    COALESCE(SUM(CASE WHEN p.type='customer' AND i.total > i.paid_amount THEN i.total - i.paid_amount ELSE 0 END),0) AS outstanding
    FROM parties p
    LEFT JOIN invoices i ON i.party_id = p.id AND i.kind = p.type
  `;
  const params = [];
  if (type) { sql += ` WHERE p.type = ?`; params.push(type); }
  sql += ` GROUP BY p.id ORDER BY p.name`;
  return db.prepare(sql).all(...params);
}

function createParty(db, data) {
  const type = data.type === 'supplier' ? 'supplier' : 'customer';
  const info = db.prepare(`
    INSERT INTO parties (type, name, tax_id, phone, email, address, opening_balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(type, data.name || '', data.tax_id || '', data.phone || '', data.email || '', data.address || '', Number(data.opening_balance) || 0, new Date().toISOString());
  return db.prepare('SELECT * FROM parties WHERE id = ?').get(info.lastInsertRowid);
}

function updateParty(db, id, data) {
  const p = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
  if (!p) return null;
  db.prepare(`
    UPDATE parties SET name=?, tax_id=?, phone=?, email=?, address=?, opening_balance=? WHERE id=?
  `).run(data.name || p.name, data.tax_id !== undefined ? data.tax_id : p.tax_id,
    data.phone !== undefined ? data.phone : p.phone,
    data.email !== undefined ? data.email : p.email,
    data.address !== undefined ? data.address : p.address,
    data.opening_balance !== undefined ? Number(data.opening_balance) : p.opening_balance, id);
  return db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
}

function getPartiesByType(db, type) {
  return db.prepare('SELECT * FROM parties WHERE type = ? ORDER BY name').all(type);
}

module.exports = { listParties, createParty, updateParty, getPartiesByType };
