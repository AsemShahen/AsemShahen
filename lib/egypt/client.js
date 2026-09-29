'use strict';
// عميل التواصل مع منظومة الفاتورة الإلكترونية المصرية (ETA - مصلحة الضرائب المصرية)
// المصادقة: OAuth2 (client_credentials) عبر client_id / client_secret + نطاق InvoicingAPI
// الإرسال: POST إلى مسار تقديم المستندات مع ترويسة Bearer.
// بدون بيانات اعتماد يعمل النظام محلياً فقط (توليد حمولة الفاتورة دون إرسال).

function makeError(message, body) {
  const e = new Error(message);
  e.body = body;
  return e;
}

async function fetchWithTimeout(url, options, ms = Number(process.env.EGYPT_TIMEOUT_MS) || 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw makeError('انتهت مهلة الاتصال بمنظومة الفاتورة الإلكترونية المصرية (ETA)');
    throw makeError('تعذر الاتصال بمنظومة الفاتورة الإلكترونية المصرية (ETA): ' + e.message);
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

// الحصول على رمز الوصول من منصة الهوية المصرية
async function getToken({ identityUrl, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'InvoicingAPI'
  });
  const res = await fetchWithTimeout(`${identityUrl}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString()
  });
  const { data } = await parseRes(res);
  if (!res.ok) throw makeError(`فشل الحصول على رمز الوصول من ETA (${res.status}): ${data.error_description || data.error || JSON.stringify(data)}`, data);
  return data.access_token || data.token;
}

// إرسال مستند الفاتورة إلى منظومة الفاتورة الإلكترونية
async function submitInvoice(config, document) {
  const token = await getToken(config);
  const res = await fetchWithTimeout(`${config.apiUrl}/api/v1.0/documentsubmissions/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ documents: [document] })
  });
  const { data } = await parseRes(res);
  if (!res.ok) {
    const reasons = data.error || data.message || data.validationResults || data.errors || JSON.stringify(data);
    throw makeError(`فشل إرسال الفاتورة إلى ETA (${res.status}): ${typeof reasons === 'string' ? reasons : JSON.stringify(reasons)}`, data);
  }
  return data;
}

module.exports = { getToken, submitInvoice, parseRes };
