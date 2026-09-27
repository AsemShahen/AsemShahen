'use strict';
// ==================== الفاتورة الوطنية الأردنية (JoFotara) ====================
// توليد حمولة الفاتورة الإلكترونية الأردنية وإرسالها عند تفعيل بيانات الاعتماد.
// تعمل المنظومة محلياً (توليد الحمولة ورمز الاستجابة) حتى يتم إدخال بيانات الاعتماد.
const crypto = require('crypto');
const taxLib = require('../tax');
const client = require('./client');

const JO_SETTINGS_KEYS = [
  'jofotara_active', 'jofotara_mode', 'jofotara_base_url',
  'jofotara_client_id', 'jofotara_client_secret',
  'jofotara_tax_number', 'jofotara_activity_number'
];

const DEFAULT_BASE_URL = 'https://backend.jofotara.gov.jo/core';

function getConfig(db, env = process.env) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const active = s.jofotara_active === '1' || env.JOFOTARA_ACTIVE === '1';
  const mode = s.jofotara_mode || env.JOFOTARA_MODE || 'sandbox';
  const baseUrl = s.jofotara_base_url || env.JOFOTARA_BASE_URL || DEFAULT_BASE_URL;
  const clientId = s.jofotara_client_id || env.JOFOTARA_CLIENT_ID || '';
  const clientSecret = s.jofotara_client_secret || env.JOFOTARA_CLIENT_SECRET || '';
  const taxNumber = s.jofotara_tax_number || env.JOFOTARA_TAX_NUMBER || '';
  const activityNumber = s.jofotara_activity_number || env.JOFOTARA_ACTIVITY_NUMBER || '';
  const configured = active && !!clientId && !!clientSecret && !!taxNumber;
  return { active, mode, baseUrl, clientId, clientSecret, taxNumber, activityNumber, configured };
}

function saveConfig(db, cfg) {
  const set = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const vals = {
    jofotara_active: cfg.active ? '1' : '0',
    jofotara_mode: cfg.mode || 'sandbox',
    jofotara_base_url: cfg.baseUrl || '',
    jofotara_client_id: cfg.clientId || '',
    jofotara_client_secret: cfg.clientSecret || '',
    jofotara_tax_number: cfg.taxNumber || '',
    jofotara_activity_number: cfg.activityNumber || ''
  };
  for (const [k, v] of Object.entries(vals)) set.run(k, String(v));
}

function maskConfig(config) {
  return {
    active: config.active,
    mode: config.mode,
    baseUrl: config.baseUrl,
    clientIdSet: !!config.clientId,
    clientSecretSet: !!config.clientSecret,
    taxNumberSet: !!config.taxNumber,
    activityNumber: config.activityNumber,
    configured: config.configured
  };
}

// توليد حمولة الفاتورة الأردنية (JoFotara)
function buildInvoiceData(invoice, company, branch, config) {
  const party = invoice.party || null;
  const currency = invoice.currency || taxLib.defaultCurrency('JO');
  const uuid = invoice.jo_uuid || crypto.randomUUID();
  const isB2B = !!party && !!party.tax_id;
  // نوع الفاتورة: مبيعات عامة للتعاملات مع المنشآت، ودخل للأفراد
  const invoiceType = isB2B ? 'general_sales_tax' : 'income';
  const paymentMethod = (invoice.status === 'paid' || invoice.payment_method !== 'credit') ? 'cash' : 'receivable';

  const sellerTaxNumber = (branch && branch.tax_number) || company.vat_number || config.taxNumber || '';
  const sellerActivity = (branch && branch.jofotara_activity_number) || config.activityNumber || '';
  const sellerIncomeSeq = (branch && branch.jofotara_income_source_sequence) || '';

  const items = (invoice.lines || []).map(l => ({
    name: l.description || l.product_name || '',
    quantity: Number(l.qty) || 1,
    unit_price: Number(l.unit_price) || 0,
    discount: Number(l.discount) || 0,
    tax_percent: Number(l.vat_rate) || 0,
    line_total: Number(l.line_total) || 0
  }));
  if (!items.length) {
    items.push({ name: 'invoice', quantity: 1, unit_price: Number(invoice.sub_total) || 0, discount: 0, tax_percent: Number(invoice.vat_rate) || 0, line_total: Number(invoice.sub_total) || 0 });
  }

  const payload = {
    invoice_number: invoice.invoice_no,
    invoice_uuid: uuid,
    invoice_date: invoice.date,
    invoice_type: invoiceType,
    payment_method: paymentMethod,
    currency,
    exchange_rate: 1,
    invoice_tax_percent: Number(invoice.vat_rate) || 0,
    discount_amount: Number(invoice.discount) || 0,
    invoice_notes: invoice.notes || '',
    seller: {
      seller_name: company.name,
      seller_tax_number: sellerTaxNumber,
      seller_activity_number: sellerActivity,
      seller_income_source_sequence: sellerIncomeSeq,
      seller_address: (branch && branch.address) || company.address || ''
    },
    buyer: party ? {
      buyer_name: party.name,
      buyer_tax_number: party.tax_id || '',
      buyer_address: party.address || ''
    } : null,
    items,
    invoice_total: {
      tax_exclusive_amount: Number(invoice.sub_total) || 0,
      discount_amount: Number(invoice.discount) || 0,
      tax_amount: Number(invoice.vat) || 0,
      tax_inclusive_amount: Number(invoice.total) || 0,
      total: Number(invoice.total) || 0
    }
  };

  return { invoice_uuid: uuid, payload };
}

// تطبيق JoFotara على فاتورة مبيعات أردنية وتخزين النتائج ومحاولة الإرسال
async function applyJoFotara(db, invoice, company, env) {
  if (invoice.kind !== 'sale') return invoice;
  if (invoice.tax_country && invoice.tax_country !== 'JO') return invoice;
  const branch = invoice.branch_id ? db.prepare('SELECT * FROM branches WHERE id = ?').get(invoice.branch_id) : null;
  const config = getConfig(db, env);
  try {
    const data = buildInvoiceData(invoice, company, branch, config);
    db.prepare(`UPDATE invoices SET jo_uuid=? WHERE id=?`).run(data.invoice_uuid, invoice.id);
    invoice.jo_uuid = data.invoice_uuid;
    invoice.jo_payload = data.payload;

    if (!config.configured) {
      db.prepare(`UPDATE invoices SET jo_status='not_configured', jo_response=? WHERE id=?`)
        .run('لم تُفعّل بيانات الاعتماد مع نظام الفاتورة الوطنية (JoFotara) بعد', invoice.id);
      invoice.jo_status = 'not_configured';
      invoice.jo_response = 'لم تُفعّل بيانات الاعتماد مع نظام الفاتورة الوطنية (JoFotara) بعد';
      return invoice;
    }

    await submit(db, invoice, data, config);
  } catch (e) {
    console.error('JoFotara apply error:', e.message);
    db.prepare(`UPDATE invoices SET jo_status='failed', jo_response=? WHERE id=?`).run(String(e.message || e).slice(0, 1000), invoice.id);
    invoice.jo_status = 'failed';
    invoice.jo_response = String(e.message || e).slice(0, 1000);
  }
  return invoice;
}

async function submit(db, invoice, data, config) {
  db.prepare(`UPDATE invoices SET jo_status='submitting' WHERE id=?`).run(invoice.id);
  try {
    const result = await client.submitInvoice(config, data.payload);
    const qr = result.qr_code || result.qrCode || result.qr || result.QRCode || result.qr_data || '';
    const summary = {
      status: result.status || result.invoice_status || 'SUBMITTED',
      invoice_number: result.invoice_number || invoice.invoice_no,
      qr,
      warnings: result.warnings || result.validationResults || []
    };
    db.prepare(`UPDATE invoices SET jo_status='submitted', jo_qr=?, jo_response=?, jo_submitted_at=? WHERE id=?`)
      .run(String(qr || '').slice(0, 4000), JSON.stringify(summary).slice(0, 2000), new Date().toISOString(), invoice.id);
    invoice.jo_status = 'submitted';
    invoice.jo_qr = String(qr || '');
    invoice.jo_response = JSON.stringify(summary);
    invoice.jo_submitted_at = new Date().toISOString();
    return qr;
  } catch (e) {
    db.prepare(`UPDATE invoices SET jo_status='failed', jo_response=? WHERE id=?`)
      .run(String(e.message || e).slice(0, 1000), invoice.id);
    invoice.jo_status = 'failed';
    invoice.jo_response = String(e.message || e).slice(0, 1000);
    throw e;
  }
}

module.exports = { getConfig, saveConfig, maskConfig, buildInvoiceData, applyJoFotara, submit, JO_SETTINGS_KEYS };
