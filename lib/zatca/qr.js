'use strict';
// توليد رمز QR للفاتورة الإلكترونية بتنسيق TLV المتوافق مع هيئة الزكاة والدخل والجمارك
// tags:
// 1=اسم البائع 2=الرقم الضريبي 3=الطابع الزمني 4=إجمالي الفاتورة 5=إجمالي الضريبة
// 6=تجزئة XML 7=التوقيع 8=المفتاح العام 9=خوارزمية التشفير

function encodeTLV(tag, value) {
  const buf = Buffer.from(String(value), 'utf8');
  const out = Buffer.alloc(2 + buf.length + 2);
  let off = 0;
  out[off++] = tag & 0xff;
  if (buf.length <= 255) {
    out[off++] = buf.length;
  } else {
    out[off++] = 0x81;
    out[off++] = (buf.length >> 8) & 0xff;
    out[off++] = buf.length & 0xff;
  }
  buf.copy(out, off);
  return out.slice(0, off + buf.length);
}

function formatAmount(n) {
  return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
}

// بناء بيانات QR
// seller: { name, vat_number }
// invoice: { timestamp (ISO8601), total, vat }
// signed: { hash (base64), signature (base64), publicKey (base64), algorithm }
function buildQr(seller, invoice, signed) {
  const parts = [
    encodeTLV(1, seller.name),
    encodeTLV(2, seller.vat_number),
    encodeTLV(3, invoice.timestamp),
    encodeTLV(4, formatAmount(invoice.total)),
    encodeTLV(5, formatAmount(invoice.vat))
  ];
  if (signed) {
    parts.push(encodeTLV(6, signed.hash));
    if (signed.signature) parts.push(encodeTLV(7, signed.signature));
    if (signed.publicKey) parts.push(encodeTLV(8, signed.publicKey));
    parts.push(encodeTLV(9, signed.algorithm || 'ECDSA_SHA_256'));
  }
  return Buffer.concat(parts).toString('base64');
}

function decodeQr(base64) {
  const data = Buffer.from(base64, 'base64');
  const fields = [];
  let off = 0;
  while (off < data.length) {
    const tag = data[off++];
    let len = data[off++];
    if (len === 0x81) {
      len = (data[off++] << 8) | data[off++];
    }
    fields.push({ tag, value: data.slice(off, off + len).toString('utf8') });
    off += len;
  }
  return fields;
}

module.exports = { buildQr, decodeQr, formatAmount };
