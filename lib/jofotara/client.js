'use strict';
// عميل التواصل مع منظومة الفاتورة الوطنية الأردنية (JoFotara)
// المصادقة: OAuth2 (client_credentials) عبر client_id / client_secret
// الإرسال: POST إلى مسار الفواتير مع ترويسة Client-Id
// بدون بيانات اعتماد يعمل النظام محلياً فقط (توليد حمولة الفاتورة دون إرسال).

function makeError(message, body) {
  const e = new Error(message);
  e.body = body;
  return e;
}

async function fetchWithTimeout(url, options, ms = Number(process.env.JOFOTARA_TIMEOUT_MS) || 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw makeError('انتهت مهلة الاتصال بمنظومة الفاتورة الوطنية (JoFotara)');
    throw makeError('تعذر الاتصال بمنظومة الفاتورة الوطنية (JoFotara): ' + e.message);
  } finally {
    clearTimeout(t);
  }
}

async function parseRes(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return { res, data };
}

// الحصول على رمز الوصول عبر بيانات الاعتماد
async function getToken({ baseUrl, clientId, clientSecret }) {
  let res;
  try {
    res = await fetchWithTimeout(`${baseUrl}/api/clients/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' })
    });
  } catch (e) {
    throw e;
  }
  const { data } = await parseRes(res);
  if (!res.ok) throw makeError(`فشل الحصول على رمز الوصول من JoFotara (${res.status}): ${data.message || data.error || JSON.stringify(data)}`, data);
  return data.access_token || data.token;
}

// إرسال فاتورة إلى منظومة الفاتورة الوطنية
async function submitInvoice(config, payload) {
  const token = await getToken(config);
  let res;
  try {
    res = await fetchWithTimeout(`${config.baseUrl}/invoices/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Client-Id': config.clientId
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    throw e;
  }
  const { data } = await parseRes(res);
  if (!res.ok) {
    const reasons = data.validationResults || data.errors || data.message || data.error || JSON.stringify(data);
    throw makeError(`فشل إرسال الفاتورة إلى JoFotara (${res.status}): ${typeof reasons === 'string' ? reasons : JSON.stringify(reasons)}`, data);
  }
  return data;
}

module.exports = { getToken, submitInvoice, parseRes };
