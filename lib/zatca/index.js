'use strict';
const crypto = require('crypto');
const { buildQr, formatAmount } = require('./qr');
const { buildBaseInvoice } = require('./xml');
const { signInvoice, invoiceHash } = require('./signing');
const client = require('./client');

const ZATCA_SETTINGS_KEYS = ['zatca_active', 'zatca_mode', 'zatca_base_url', 'zatca_csid', 'zatca_private_key', 'zatca_cert', 'zatca_otp', 'zatca_device_serial'];

function getConfig(db, env = process.env) {
  const row = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(row.map(r => [r.key, r.value]));
  const active = s.zatca_active === '1' || env.ZATCA_ACTIVE === '1';
  const mode = s.zatca_mode || env.ZATCA_MODE || 'sandbox';
  const baseUrl = s.zatca_base_url || env.ZATCA_BASE_URL || (mode === 'production' ? 'https://einvoice.zatca.gov.sa' : 'https://sandbox.zatca.gov.sa');
  const csid = s.zatca_csid || env.ZATCA_CSID || '';
  const privateKeyPem = s.zatca_private_key || env.ZATCA_PRIVATE_KEY || '';
  const certB64 = s.zatca_cert || env.ZATCA_CERT || '';
  const otp = s.zatca_otp || env.ZATCA_OTP || '';
  const deviceSerialNumber = s.zatca_device_serial || env.ZATCA_DEVICE_SERIAL || '';
  const configured = active && !!baseUrl && !!csid;
  return { active, mode, baseUrl, csid, privateKeyPem, certB64, otp, deviceSerialNumber, configured };
}

function saveConfig(db, cfg) {
  const set = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const vals = {
    zatca_active: cfg.active ? '1' : '0',
    zatca_mode: cfg.mode || 'sandbox',
    zatca_base_url: cfg.baseUrl || '',
    zatca_csid: cfg.csid || '',
    zatca_private_key: cfg.privateKeyPem || '',
    zatca_cert: cfg.certB64 || '',
    zatca_otp: cfg.otp || '',
    zatca_device_serial: cfg.deviceSerialNumber || ''
  };
  for (const [k, v] of Object.entries(vals)) set.run(k, String(v));
}

function uuidv4() {
  return crypto.randomUUID();
}

function pad(n) { return String(n).padStart(2, '0'); }

function issueTime() {
  const d = new Date();
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function issueTimestamp(date, time) {
  return `${date}T${time}Z`;
}

// توليد بيانات الفاتورة الإلكترونية
// company: من سجل الشركات (name, vat_number, address, city)
function buildInvoiceData(db, invoice, company, config) {
  const party = invoice.party || null;
  const isB2B = !!party && !!party.tax_id && invoice.kind === 'sale';
  const invoiceType = isB2B ? 'standard' : 'simplified';
  const typeCode = isB2B ? '0200000' : '0100000';

  const uuid = invoice.invoice_uuid || uuidv4();
  const time = issueTime();
  const timestamp = issueTimestamp(invoice.date, time);
  const currency = 'SAR';
  const vatRate = invoice.vat_rate;

  const baseXml = buildBaseInvoice({
    seller: {
      name: company.name,
      vat_number: company.vat_number || '',
      address: company.address || '',
      city: company.city || ''
    },
    buyer: party ? { name: party.name, vat_number: party.tax_id || '' } : null,
    invoice: {
      uuid,
      no: invoice.invoice_no,
      issue_date: invoice.date,
      issue_time: time,
      type_code: typeCode,
      tax_category: vatRate > 0 ? 'S' : 'Z',
      currency,
      line_total: invoice.sub_total,
      allowance: invoice.discount,
      taxable: invoice.sub_total - invoice.discount,
      vat: invoice.vat,
      total: invoice.total,
      paid: invoice.paid_amount || invoice.total
    },
    lines: invoice.lines || [],
    vat_rate: vatRate
  });

  let signed = null;
  let finalXml = baseXml;
  if (config.privateKeyPem && config.certB64) {
    try {
      signed = signInvoice(baseXml, config.privateKeyPem, config.certB64);
      finalXml = signed.signedXml;
    } catch (e) {
      console.error('ZATCA signing failed:', e.message);
    }
  }
  const hash = signed ? signed.hash : invoiceHash(baseXml);

  const qr = buildQr(
    { name: company.name, vat_number: company.vat_number || '' },
    { timestamp, total: invoice.total, vat: invoice.vat },
    signed ? { hash, signature: signed.signature, publicKey: signed.publicKeyB64, algorithm: 'ECDSA_SHA_256' } : null
  );

  return {
    invoice_uuid: uuid,
    issue_datetime: timestamp,
    invoice_type: invoiceType,
    invoice_type_code: typeCode,
    base_xml: baseXml,
    xml: finalXml,
    hash,
    qr,
    signed: !!signed
  };
}

// تطبيق ZATCA على فاتورة (مبيعات فقط) وتخزين النتائج ومحاولة الإرسال
async function applyZatca(db, invoice, company, env) {
  if (invoice.kind !== 'sale') return invoice;
  const config = getConfig(db, env);
  try {
    const data = buildInvoiceData(db, invoice, company, config);
    db.prepare(`UPDATE invoices SET invoice_uuid=?, issue_datetime=?, invoice_type=?, qr_data=?, xml_data=?, zatca_hash=? WHERE id=?`)
      .run(data.invoice_uuid, data.issue_datetime, data.invoice_type, data.qr, data.xml, data.hash, invoice.id);
    invoice.invoice_uuid = data.invoice_uuid;
    invoice.issue_datetime = data.issue_datetime;
    invoice.invoice_type = data.invoice_type;
    invoice.qr_data = data.qr;
    invoice.xml_data = data.xml;
    invoice.zatca_hash = data.hash;

    if (!config.configured) {
      db.prepare(`UPDATE invoices SET zatca_status='not_configured', zatca_response='لم تُفعّل بيانات الاعتماد مع هيئة الزكاة بعد' WHERE id=?`).run(invoice.id);
      invoice.zatca_status = 'not_configured';
      invoice.zatca_response = 'لم تُفعّل بيانات الاعتماد مع هيئة الزكاة بعد';
      return invoice;
    }

    await submit(db, invoice, data, config);
  } catch (e) {
    console.error('ZATCA apply error:', e.message);
    db.prepare(`UPDATE invoices SET zatca_status='failed', zatca_response=? WHERE id=?`).run(String(e.message || e).slice(0, 1000), invoice.id);
    invoice.zatca_status = 'failed';
    invoice.zatca_response = String(e.message || e).slice(0, 1000);
  }
  return invoice;
}

async function submit(db, invoice, data, config) {
  const clearance = data.invoice_type === 'standard' && invoice.total >= 1000;
  db.prepare(`UPDATE invoices SET zatca_status='submitting' WHERE id=?`).run(invoice.id);
  try {
    const result = await client.submitInvoice(config, {
      invoiceHash: data.hash,
      uuid: data.invoice_uuid,
      invoiceB64: Buffer.from(data.xml, 'utf8').toString('base64'),
      invoiceType: data.invoice_type === 'standard' ? 'StandardTaxInvoice' : 'SimplifiedTaxInvoice',
      clearance
    });
    const qr = (clearance && result.clearedInvoice)
      ? result.qrCodeUrl || data.qr
      : result.qrCodeUrl || data.qr;
    const status = clearance ? 'cleared' : 'submitted';
    const summary = {
      status: result.status || 'SUBMITTED',
      reportingStatus: result.reportingStatus || '',
      clearanceStatus: result.clearanceStatus || '',
      qrCodeUrl: result.qrCodeUrl || '',
      warnings: (result.validationResults && result.validationResults.warningMessages) || []
    };
    db.prepare(`UPDATE invoices SET zatca_status=?, zatca_response=?, zatca_submitted_at=? WHERE id=?`)
      .run(status, JSON.stringify(summary).slice(0, 1000), new Date().toISOString(), invoice.id);
    invoice.zatca_status = status;
    invoice.zatca_response = JSON.stringify(summary);
    invoice.zatca_submitted_at = new Date().toISOString();
    return qr;
  } catch (e) {
    db.prepare(`UPDATE invoices SET zatca_status='failed', zatca_response=? WHERE id=?`)
      .run(String(e.message || e).slice(0, 1000), invoice.id);
    invoice.zatca_status = 'failed';
    invoice.zatca_response = String(e.message || e).slice(0, 1000);
    throw e;
  }
}

function maskConfig(config) {
  return {
    active: config.active,
    mode: config.mode,
    baseUrl: config.baseUrl,
    csidSet: !!config.csid,
    privateKeySet: !!config.privateKeyPem,
    certSet: !!config.certB64,
    otpSet: !!config.otp,
    deviceSerialNumber: config.deviceSerialNumber,
    configured: config.configured
  };
}

module.exports = {
  getConfig, saveConfig, buildInvoiceData, applyZatca, submit, maskConfig,
  ZATCA_SETTINGS_KEYS, formatAmount
};
