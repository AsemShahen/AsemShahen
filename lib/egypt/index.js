'use strict';
// ==================== الفاتورة الإلكترونية المصرية (ETA) ====================
// توليد مستند الفاتورة الإلكترونية المصري وإرساله عند تفعيل بيانات الاعتماد.
// تعمل المنظومة محلياً (توليد الحمولة) حتى يتم إدخال بيانات الاعتماد.
const crypto = require('crypto');
const taxLib = require('../tax');
const client = require('./client');

const EG_SETTINGS_KEYS = [
  'egypt_active', 'egypt_mode', 'egypt_identity_url', 'egypt_api_url',
  'egypt_client_id', 'egypt_client_secret',
  'egypt_tax_number', 'egypt_activity_code'
];

const DEFAULT_IDENTITY_SANDBOX = 'https://id.preprod.eta.gov.eg';
const DEFAULT_IDENTITY_PROD = 'https://id.eta.gov.eg';
const DEFAULT_API_SANDBOX = 'https://api.preprod.invoicing.eta.gov.eg';
const DEFAULT_API_PROD = 'https://api.invoicing.eta.gov.eg';

function getConfig(db, env = process.env) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const mode = s.egypt_mode || env.EGYPT_MODE || 'sandbox';
  const production = mode === 'production';
  const active = s.egypt_active === '1' || env.EGYPT_ACTIVE === '1';
  const identityUrl = s.egypt_identity_url || env.EGYPT_IDENTITY_URL || (production ? DEFAULT_IDENTITY_PROD : DEFAULT_IDENTITY_SANDBOX);
  const apiUrl = s.egypt_api_url || env.EGYPT_API_URL || (production ? DEFAULT_API_PROD : DEFAULT_API_SANDBOX);
  const clientId = s.egypt_client_id || env.EGYPT_CLIENT_ID || '';
  const clientSecret = s.egypt_client_secret || env.EGYPT_CLIENT_SECRET || '';
  const taxNumber = s.egypt_tax_number || env.EGYPT_TAX_NUMBER || '';
  const activityCode = s.egypt_activity_code || env.EGYPT_ACTIVITY_CODE || '';
  const configured = active && !!clientId && !!clientSecret && !!taxNumber;
  return { active, mode, identityUrl, apiUrl, clientId, clientSecret, taxNumber, activityCode, configured };
}

function saveConfig(db, cfg) {
  const set = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const vals = {
    egypt_active: cfg.active ? '1' : '0',
    egypt_mode: cfg.mode || 'sandbox',
    egypt_identity_url: cfg.identityUrl || '',
    egypt_api_url: cfg.apiUrl || '',
    egypt_client_id: cfg.clientId || '',
    egypt_client_secret: cfg.clientSecret || '',
    egypt_tax_number: cfg.taxNumber || '',
    egypt_activity_code: cfg.activityCode || ''
  };
  for (const [k, v] of Object.entries(vals)) set.run(k, String(v));
}

function maskConfig(config) {
  return {
    active: config.active,
    mode: config.mode,
    identityUrl: config.identityUrl,
    apiUrl: config.apiUrl,
    clientIdSet: !!config.clientId,
    clientSecretSet: !!config.clientSecret,
    taxNumberSet: !!config.taxNumber,
    activityCode: config.activityCode,
    configured: config.configured
  };
}

// توليد مستند الفاتورة الإلكترونية المصري
function buildInvoiceData(invoice, company, branch, config) {
  const party = invoice.party || null;
  const currency = invoice.currency || taxLib.defaultCurrency('EG');
  const uuid = invoice.eg_uuid || crypto.randomUUID();
  const isBusiness = !!party && !!party.tax_id;
  const taxNumber = (branch && branch.tax_number) || company.vat_number || config.taxNumber || '';
  const activityCode = (branch && branch.egypt_activity_code) || config.activityCode || '';
  const vatRate = Number(invoice.vat_rate) || 0;

  const address = {
    branchID: String(invoice.branch_id || '0'),
    country: 'EG',
    governate: '',
    regionCity: '',
    street: (branch && branch.address) || company.address || ''
  };

  const lines = (invoice.lines || []).map(l => {
    const qty = Number(l.qty) || 1;
    const unitPrice = Number(l.unit_price) || 0;
    const discount = Number(l.discount) || 0;
    const net = (Number(l.line_total) || 0);
    return {
      description: l.description || l.product_name || '',
      itemType: 'EGS',
      itemCode: String(l.product_id || l.id || ''),
      unitType: 'EA',
      quantity: qty,
      internalCode: String(l.product_id || l.id || ''),
      salesTotal: net + discount,
      total: net,
      valueDifference: 0,
      totalTaxableFees: 0,
      netTotal: net,
      itemsDiscount: discount,
      unitValue: {
        currencySold: currency,
        amountEGP: unitPrice,
        amountSold: unitPrice,
        currencyExchangeRate: 1
      },
      taxableItems: [{ taxType: 'T1', amount: net * (Number(l.vat_rate) || 0) / 100, subType: 'V009', rate: Number(l.vat_rate) || 0 }]
    };
  });
  if (!lines.length) {
    lines.push({
      description: 'invoice', itemType: 'EGS', itemCode: '1', unitType: 'EA', quantity: 1, internalCode: '1',
      salesTotal: Number(invoice.sub_total) || 0, total: Number(invoice.sub_total) || 0, valueDifference: 0,
      totalTaxableFees: 0, netTotal: Number(invoice.sub_total) || 0, itemsDiscount: Number(invoice.discount) || 0,
      unitValue: { currencySold: currency, amountEGP: Number(invoice.sub_total) || 0, amountSold: Number(invoice.sub_total) || 0, currencyExchangeRate: 1 },
      taxableItems: [{ taxType: 'T1', amount: Number(invoice.vat) || 0, subType: 'V009', rate: vatRate }]
    });
  }

  const document = {
    issuer: {
      address,
      type: 'B',
      id: taxNumber,
      name: company.name
    },
    receiver: {
      address: {
        branchID: '0',
        country: 'EG',
        governate: '',
        regionCity: '',
        street: (party && party.address) || ''
      },
      type: isBusiness ? 'B' : 'P',
      id: (party && party.tax_id) || '',
      name: party ? party.name : ''
    },
    documentType: 'I',
    documentTypeVersion: '1.0',
    dateTimeIssued: new Date(invoice.date || Date.now()).toISOString(),
    taxpayerActivityCode: activityCode,
    internalID: invoice.invoice_no,
    totalSalesAmount: Number(invoice.sub_total) || 0,
    totalDiscountAmount: Number(invoice.discount) || 0,
    netAmount: (Number(invoice.sub_total) || 0) - (Number(invoice.discount) || 0),
    taxTotals: [{ taxType: 'T1', amount: Number(invoice.vat) || 0 }],
    totalAmount: Number(invoice.total) || 0,
    extraDiscountAmount: 0,
    totalItemsDiscountAmount: 0,
    invoiceLines: lines
  };

  return { invoice_uuid: uuid, payload: document };
}

// تطبيق الفاتورة الإلكترونية المصرية على فاتورة مبيعات وتخزين النتائج ومحاولة الإرسال
async function applyEgypt(db, invoice, company, env) {
  if (invoice.kind !== 'sale') return invoice;
  if (invoice.tax_country && invoice.tax_country !== 'EG') return invoice;
  const branch = invoice.branch_id ? db.prepare('SELECT * FROM branches WHERE id = ?').get(invoice.branch_id) : null;
  const config = getConfig(db, env);
  const data = buildInvoiceData(invoice, company, branch, config);
  db.prepare(`UPDATE invoices SET eg_uuid=? WHERE id=?`).run(data.invoice_uuid, invoice.id);
  invoice.eg_uuid = data.invoice_uuid;
  invoice.eg_payload = data.payload;

  if (!config.configured) {
    db.prepare(`UPDATE invoices SET eg_status='not_configured', eg_response=? WHERE id=?`)
      .run('لم تُفعّل بيانات الاعتماد مع منظومة الفاتورة الإلكترونية المصرية (ETA) بعد', invoice.id);
    invoice.eg_status = 'not_configured';
    invoice.eg_response = 'لم تُفعّل بيانات الاعتماد مع منظومة الفاتورة الإلكترونية المصرية (ETA) بعد';
    return invoice;
  }

  try {
    await submit(db, invoice, data, config);
  } catch (e) {
    console.error('ETA apply error:', e.message);
    db.prepare(`UPDATE invoices SET eg_status='failed', eg_response=? WHERE id=?`).run(String(e.message || e).slice(0, 1000), invoice.id);
    invoice.eg_status = 'failed';
    invoice.eg_response = String(e.message || e).slice(0, 1000);
  }
  return invoice;
}

async function submit(db, invoice, data, config) {
  db.prepare(`UPDATE invoices SET eg_status='submitting' WHERE id=?`).run(invoice.id);
  try {
    const result = await client.submitInvoice(config, data.payload);
    const accepted = (result.acceptedDocuments && result.acceptedDocuments[0]) || {};
    const rejected = (result.rejectedDocuments && result.rejectedDocuments[0]) || null;
    const uuid = accepted.uuid || invoice.eg_uuid;
    const qr = accepted.uuid || accepted.longId || '';
    const summary = {
      status: rejected ? 'REJECTED' : 'SUBMITTED',
      submissionId: result.submissionId || '',
      uuid,
      rejected,
      acceptedCount: (result.acceptedDocuments || []).length,
      rejectedCount: (result.rejectedDocuments || []).length
    };
    const status = rejected ? 'failed' : 'submitted';
    db.prepare(`UPDATE invoices SET eg_status=?, eg_qr=?, eg_response=?, eg_submitted_at=? WHERE id=?`)
      .run(status, String(qr || '').slice(0, 4000), JSON.stringify(summary).slice(0, 2000), new Date().toISOString(), invoice.id);
    invoice.eg_status = status;
    invoice.eg_qr = String(qr || '');
    invoice.eg_response = JSON.stringify(summary);
    invoice.eg_submitted_at = new Date().toISOString();
    return qr;
  } catch (e) {
    db.prepare(`UPDATE invoices SET eg_status='failed', eg_response=? WHERE id=?`)
      .run(String(e.message || e).slice(0, 1000), invoice.id);
    invoice.eg_status = 'failed';
    invoice.eg_response = String(e.message || e).slice(0, 1000);
    throw e;
  }
}

module.exports = { getConfig, saveConfig, maskConfig, buildInvoiceData, applyEgypt, submit, EG_SETTINGS_KEYS };
