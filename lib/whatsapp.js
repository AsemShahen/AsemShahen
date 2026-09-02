'use strict';
// ربط الواتساب: إرسال الفواتير والإيصالات وكشوفات الحساب عبر WhatsApp
// يعمل بطريقتين: رابط wa.me (بدون إعدادات) أو واجهة WhatsApp Business Cloud API (إذا تم ضبط بياناتها)

const DEFAULT_TPL_SALE = 'مرحباً {party} 👋\nفاتورة مبيعات من {company}\nرقم الفاتورة: {invoice_no}\nالتاريخ: {date}\nالإجمالي: {total} ر.س\nشكراً لتعاملكم معنا.';
const DEFAULT_TPL_PURCHASE = 'مرحباً {party} 👋\nفاتورة مشتريات من {company}\nرقم الفاتورة: {invoice_no}\nالتاريخ: {date}\nالإجمالي: {total} ر.س';
const DEFAULT_TPL_POS = 'مرحباً {party} 👋\nإيصال من {company}\nرقم الإيصال: {invoice_no}\nالتاريخ: {date}\nالإجمالي: {total} ر.س\nشكراً لزيارتكم.';
const DEFAULT_TPL_STATEMENT = 'مرحباً {party} 👋\nكشف حساب من {company}\nالمستحق عليكم: {outstanding} ر.س\nيرجى مراجعة حساباتكم.';

function fmtNum(v) {
  return (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getConfig(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    enabled: s.wa_enabled === '1',
    number: s.wa_number || '',
    apiToken: s.wa_api_token || '',
    phoneId: s.wa_phone_id || '',
    tplSale: s.wa_tpl_sale || DEFAULT_TPL_SALE,
    tplPurchase: s.wa_tpl_purchase || DEFAULT_TPL_PURCHASE,
    tplPos: s.wa_tpl_pos || DEFAULT_TPL_POS,
    tplStatement: s.wa_tpl_statement || DEFAULT_TPL_STATEMENT
  };
}

function maskConfig(c) {
  return {
    enabled: c.enabled,
    number: c.number,
    apiConfigured: !!(c.apiToken && c.phoneId),
    apiTokenSet: !!c.apiToken,
    phoneId: c.phoneId || '',
    tplSale: c.tplSale,
    tplPurchase: c.tplPurchase,
    tplPos: c.tplPos,
    tplStatement: c.tplStatement
  };
}

function saveConfig(db, config) {
  const set = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  const put = (k, v) => set.run(k, String(v === undefined ? '' : v));
  put('wa_enabled', config.enabled ? '1' : '0');
  put('wa_number', config.number || '');
  if (config.apiToken !== undefined) put('wa_api_token', config.apiToken || '');
  if (config.phoneId !== undefined) put('wa_phone_id', config.phoneId || '');
  put('wa_tpl_sale', config.tplSale || DEFAULT_TPL_SALE);
  put('wa_tpl_purchase', config.tplPurchase || DEFAULT_TPL_PURCHASE);
  put('wa_tpl_pos', config.tplPos || DEFAULT_TPL_POS);
  put('wa_tpl_statement', config.tplStatement || DEFAULT_TPL_STATEMENT);
}

function buildMessage(tpl, vars) {
  let s = String(tpl || '');
  for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k] === undefined || vars[k] === null ? '' : vars[k]));
  return s;
}

function waLink(phone, text) {
  let p = String(phone || '').replace(/[^0-9]/g, '');
  if (p.startsWith('00')) p = p.replace(/^00/, '');
  return 'https://wa.me/' + p + '?text=' + encodeURIComponent(text);
}

function invoiceMessage(db, company, invoiceId, kind) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND kind = ?').get(invoiceId, kind);
  if (!inv) throw new Error('الفاتورة غير موجودة');
  const party = inv.party_id ? db.prepare('SELECT * FROM parties WHERE id = ?').get(inv.party_id) : null;
  if (!party || !party.phone) throw new Error('لا يوجد رقم هاتف مسجل لهذا الطرف');
  const config = getConfig(db);
  const tpl = kind === 'purchase' ? config.tplPurchase : (config.tplSale);
  const total = Number(inv.total) || 0;
  const paid = Number(inv.paid_amount) || 0;
  const text = buildMessage(tpl, {
    company: company.name,
    party: party.name || '',
    invoice_no: inv.invoice_no,
    date: inv.date || '',
    total: fmtNum(total),
    vat: fmtNum(inv.vat),
    sub_total: fmtNum(inv.sub_total),
    paid: fmtNum(paid),
    due: fmtNum(total - paid)
  });
  return { to: party.phone, party: party.name, text };
}

function posMessage(db, company, invoiceId, phoneOverride) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND kind = ?').get(invoiceId, 'sale');
  if (!inv) throw new Error('الإيصال غير موجود');
  const party = inv.party_id ? db.prepare('SELECT * FROM parties WHERE id = ?').get(inv.party_id) : null;
  const phone = phoneOverride || (party && party.phone);
  if (!phone) throw new Error('لا يوجد رقم هاتف للعميل');
  const config = getConfig(db);
  const text = buildMessage(config.tplPos, {
    company: company.name,
    party: (party && party.name) || 'عميل نقدي',
    invoice_no: inv.invoice_no,
    date: inv.date || '',
    total: fmtNum(inv.total),
    vat: fmtNum(inv.vat),
    sub_total: fmtNum(inv.sub_total)
  });
  return { to: phone, party: (party && party.name) || 'عميل نقدي', text };
}

function statementMessage(db, company, partyId) {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(partyId);
  if (!party) throw new Error('الطرف غير موجود');
  if (!party.phone) throw new Error('لا يوجد رقم هاتف مسجل لهذا الطرف');
  const row = db.prepare(`SELECT COALESCE(SUM(total - paid_amount), 0) AS o
    FROM invoices WHERE party_id = ? AND status != 'paid'`).get(partyId);
  const config = getConfig(db);
  const text = buildMessage(config.tplStatement, {
    company: company.name,
    party: party.name || '',
    outstanding: fmtNum(row.o)
  });
  return { to: party.phone, party: party.name, text };
}

// الإرسال عبر واجهة WhatsApp Cloud API إن توفرت بياناتها، وإلا يُرجع رابط wa.me
async function send(config, to, text) {
  if (!config.apiToken || !config.phoneId) return { method: 'link' };
  try {
    const number = String(to).replace(/[^0-9]/g, '');
    const resp = await fetch(`https://graph.facebook.com/v20.0/${config.phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + config.apiToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: number,
        type: 'text',
        text: { body: text }
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data && data.error && data.error.message;
      return { method: 'link', api_error: msg || ('HTTP ' + resp.status) };
    }
    return { method: 'api', sent: true, api_id: data.messages && data.messages[0] && data.messages[0].id };
  } catch (e) {
    return { method: 'link', api_error: e.message };
  }
}

module.exports = {
  getConfig, maskConfig, saveConfig, buildMessage, waLink,
  invoiceMessage, posMessage, statementMessage, send, DEFAULT_TPL_SALE, DEFAULT_TPL_PURCHASE, DEFAULT_TPL_POS, DEFAULT_TPL_STATEMENT
};
