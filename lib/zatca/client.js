'use strict';
// عميل التواصل مع منظومة فاتورة الإلكترونية التابعة لهيئة الزكاة والدخل والجمارك (Fatoora)
// الإعدادات: baseUrl, csid, otp, deviceSerialNumber
// يتطلب بيانات اعتماد (CSID) من بوابة الهيئة؛ بدونها يُستخدم الوضع المحلي فقط.

function makeError(message, body) {
  const e = new Error(message);
  e.body = body;
  return e;
}

async function fetchWithTimeout(url, options, ms = Number(process.env.ZATCA_TIMEOUT_MS) || 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw makeError('انتهت مهلة الاتصال بمنظومة هيئة الزكاة');
    throw makeError('تعذر الاتصال بمنظومة هيئة الزكاة: ' + e.message);
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

// الحصول على رمز وصول (access token) عبر المصادقة الأساسية بـ CSID
async function getToken({ baseUrl, csid, otp, deviceSerialNumber }) {
  const basic = Buffer.from(`${csid}:`).toString('base64');
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept-Language': 'en',
    'Authorization': `Basic ${basic}`
  };
  if (otp) headers.OTP = otp;
  if (deviceSerialNumber) headers['Device-Serial-Number'] = deviceSerialNumber;

  let res;
  try {
    res = await fetchWithTimeout(`${baseUrl}/auth/token`, {
      method: 'POST', headers, body: 'grant_type=client_credentials'
    });
  } catch (e) {
    throw e;
  }
  const { data } = await parseRes(res);
  if (!res.ok) throw makeError(`فشل الحصول على رمز الوصول (${res.status}): ${data.error_description || data.message || JSON.stringify(data)}`, data);
  return data.access_token;
}

// إرسال فاتورة: إبلاغ (reporting) أو اعتماد (clearance)
async function submitInvoice(config, { invoiceHash, uuid, invoiceB64, invoiceType, clearance = false }) {
  const token = await getToken(config);
  const body = {
    invoiceHash,
    uuid,
    invoice: invoiceB64,
    invoiceType: invoiceType || (clearance ? 'StandardTaxInvoice' : 'SimplifiedTaxInvoice')
  };
  const path = clearance ? '/invoices/clearance/single' : '/invoices/reporting/single';

  let res;
  try {
    res = await fetchWithTimeout(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw e;
  }
  const { data } = await parseRes(res);
  if (!res.ok) {
    const reasons = (data.validationResults && data.validationResults.validationSteps)
      ? data.validationResults.validationSteps.map(s => s.errorMessage || s.warningMessage).filter(Boolean).join(' | ')
      : (data.message || data.error || JSON.stringify(data));
    throw makeError(`فشل ${clearance ? 'الاعتماد' : 'الإبلاغ'} (${res.status}): ${reasons}`, data);
  }
  return data;
}

module.exports = { getToken, submitInvoice, parseRes };
