'use strict';
// ==================== إدارة العملات وأسعار الصرف ====================
// قاعدة الاعتماد المحاسبي: العملة الأساسية (base_currency) للشركة.
// rate = عدد وحدات العملة الأساسية مقابل وحدة واحدة من هذه العملة.
//   المبلغ الأساسي = المبلغ بالعملة الأجنبية × rate
//   العملة الأساسية rate = 1 دائماً.

const DEFAULT_CURRENCIES = [
  { code: 'SAR', name: 'ريال سعودي', symbol: 'ر.س', rate: 1 },
  { code: 'JOD', name: 'دينار أردني', symbol: 'د.أ', rate: 5.29 },
  { code: 'SYP', name: 'ليرة سورية', symbol: 'ل.س', rate: 0.00026 },
  { code: 'EGP', name: 'جنيه مصري', symbol: 'ج.م', rate: 0.076 },
  { code: 'AED', name: 'درهم إماراتي', symbol: 'د.إ', rate: 1.02 },
  { code: 'KWD', name: 'دينار كويتي', symbol: 'د.ك', rate: 12.25 },
  { code: 'QAR', name: 'ريال قطري', symbol: 'ر.ق', rate: 1.03 },
  { code: 'OMR', name: 'ريال عماني', symbol: 'ر.ع', rate: 9.75 },
  { code: 'USD', name: 'دولار أمريكي', symbol: '$', rate: 3.75 },
  { code: 'EUR', name: 'يورو', symbol: '€', rate: 4.05 },
  { code: 'GBP', name: 'جنيه إسترليني', symbol: '£', rate: 4.75 },
  { code: 'TRY', name: 'ليرة تركية', symbol: '₺', rate: 0.11 }
];

const SYMBOLS = Object.fromEntries(DEFAULT_CURRENCIES.map(c => [c.code, c.symbol]));

function symbolFor(code, fallback) {
  const c = String(code || '').toUpperCase();
  return SYMBOLS[c] || fallback || c;
}

function getSetting(db, key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}

function setSetting(db, key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(key, value === null || value === undefined ? '' : String(value));
}

function ensureCurrencies(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM currencies').get().c;
  if (!count) {
    const ins = db.prepare(`INSERT OR IGNORE INTO currencies (code, name, symbol, rate, is_base, is_active, source, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 'manual', ?)`);
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const c of DEFAULT_CURRENCIES) ins.run(c.code, c.name, c.symbol, c.rate, 0, now);
    });
    tx();
  }
  let base = getSetting(db, 'base_currency');
  if (!base) {
    const row = db.prepare('SELECT code FROM currencies WHERE is_base = 1 LIMIT 1').get();
    base = row ? row.code : 'SAR';
    setSetting(db, 'base_currency', base);
  }
  setBaseRow(db, base);
  return base;
}

function setBaseRow(db, code) {
  db.prepare('UPDATE currencies SET is_base = 0, rate = CASE WHEN code = ? THEN 1 ELSE rate END').run(code);
  const exists = db.prepare('SELECT code FROM currencies WHERE code = ?').get(code);
  if (!exists) {
    db.prepare(`INSERT INTO currencies (code, name, symbol, rate, is_base, is_active, source, updated_at)
      VALUES (?, ?, ?, 1, 1, 1, 'manual', ?)`).run(code, code, symbolFor(code), new Date().toISOString());
  } else {
    db.prepare('UPDATE currencies SET is_base = 1, rate = 1 WHERE code = ?').run(code);
  }
}

function getBaseCurrency(db) {
  const base = getSetting(db, 'base_currency');
  if (base) return base;
  return ensureCurrencies(db);
}

function setBaseCurrency(db, code, value) {
  const c = String(code || '').toUpperCase();
  if (!c) throw new Error('رمز العملة الأساسية مطلوب');
  const rate = value !== undefined && value !== null && value !== '' ? Number(value) : null;
  // العملة الأساسية سعرها 1؛ القيم الأخرى تُفسَّر كأسعار مقابل العملة الجديدة
  setSetting(db, 'base_currency', c);
  setBaseRow(db, c);
  if (rate !== null && Number.isFinite(rate) && rate > 0) {
    // عند تغيير العملة الأساسية مع تمرير قيم صريحة يمكن للواجهة تحديث بقية الأسعار لاحقاً
  }
  return c;
}

function listCurrencies(db) {
  ensureCurrencies(db);
  return db.prepare('SELECT * FROM currencies ORDER BY is_base DESC, code').all();
}

function getRate(db, code) {
  const c = String(code || '').toUpperCase();
  const base = getBaseCurrency(db);
  if (!c || c === base) return 1;
  const row = db.prepare('SELECT rate FROM currencies WHERE code = ?').get(c);
  const rate = row ? Number(row.rate) : 1;
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function upsertCurrency(db, data) {
  const code = String(data.code || '').toUpperCase().trim();
  if (!/^[A-Z]{2,5}$/.test(code)) throw new Error('رمز العملة غير صالح (مثال: USD)');
  const base = getBaseCurrency(db);
  const existing = db.prepare('SELECT * FROM currencies WHERE code = ?').get(code);
  const rate = code === base ? 1 : Number(data.rate);
  if (code !== base && (!Number.isFinite(rate) || rate <= 0)) throw new Error('سعر الصرف يجب أن يكون رقماً أكبر من صفر');
  const name = data.name !== undefined ? String(data.name) : (existing ? existing.name : code);
  const symbol = data.symbol !== undefined ? String(data.symbol) : (existing ? existing.symbol : symbolFor(code));
  const isActive = data.is_active !== undefined ? (data.is_active ? 1 : 0) : (existing ? existing.is_active : 1);
  const source = data.source || (existing ? existing.source : 'manual');
  db.prepare(`
    INSERT INTO currencies (code, name, symbol, rate, is_base, is_active, source, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET name=excluded.name, symbol=excluded.symbol, rate=excluded.rate,
      is_active=excluded.is_active, source=excluded.source, updated_at=excluded.updated_at
  `).run(code, name, symbol, rate, isActive, source, new Date().toISOString());
  return db.prepare('SELECT * FROM currencies WHERE code = ?').get(code);
}

function deleteCurrency(db, code) {
  const c = String(code || '').toUpperCase();
  const base = getBaseCurrency(db);
  if (c === base) throw new Error('لا يمكن حذف العملة الأساسية');
  db.prepare('DELETE FROM currencies WHERE code = ?').run(c);
}

// جلب أسعار الصرف تلقائياً من خدمة خارجية (يفشل بهدوء عند عدم توفر الشبكة)
async function fetchRates(db, baseCode) {
  const base = String(baseCode || getBaseCurrency(db)).toUpperCase();
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`خدمة الأسعار أعادت ${res.status}`);
    const json = await res.json();
    if (!json || !json.rates) throw new Error('استجابة غير صالحة من خدمة الأسعار');
    const localCodes = listCurrencies(db).map(c => c.code);
    const updated = [];
    const tx = db.transaction(() => {
      for (const code of localCodes) {
        if (code === base) continue;
        const perBase = json.rates[code]; // 1 base = perBase foreign
        if (!perBase) continue;
        const rate = 1 / Number(perBase); // base per 1 foreign
        if (!Number.isFinite(rate) || rate <= 0) continue;
        db.prepare('UPDATE currencies SET rate = ?, source = ?, updated_at = ? WHERE code = ?')
          .run(rate, 'auto', new Date().toISOString(), code);
        updated.push(code);
      }
    });
    tx();
    return { ok: true, base, updated, fetched_at: json.time_last_update_utc || new Date().toISOString() };
  } catch (e) {
    return { ok: false, base, updated: [], error: e.message || 'تعذّر جلب الأسعار' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_CURRENCIES, SYMBOLS, symbolFor,
  ensureCurrencies, getBaseCurrency, setBaseCurrency, listCurrencies, getRate,
  upsertCurrency, deleteCurrency, fetchRates, setSetting
};
