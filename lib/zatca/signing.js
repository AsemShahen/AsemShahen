'use strict';
const crypto = require('crypto');
const { buildBaseInvoice, withSignature, XMLNS_DS, XMLNS_XADES } = require('./xml');

function sha256Base64(data) {
  return crypto.createHash('sha256').update(data).digest('base64');
}

function ecdsaSign(privKey, data) {
  return crypto.sign('sha256', data, privKey).toString('base64');
}

// تجزئة الفاتورة المتعارف عليها (Canonical C14N)
function invoiceHash(baseXml) {
  return sha256Base64(baseXml);
}

// توليد الفاتورة الموقعة كاملة
// privKeyPem: PEM لمفتاح ECDSA P-256  |  certB64: شهادة X.509 بصيغة base64 (CSID)
// returns { signedXml, hash, signature, publicKeyB64 }
function signInvoice(baseXml, privKeyPem, certB64) {
  const privKey = crypto.createPrivateKey(privKeyPem);
  const pubKey = crypto.createPublicKey(privKey);
  const publicKeyB64 = pubKey.export({ type: 'spki', format: 'der' }).toString('base64');

  const hash = invoiceHash(baseXml);
  const digest = hash;

  const signingTime = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const certDigest = sha256Base64(Buffer.from(certB64, 'base64'));

  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${XMLNS_DS}"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;

  const signature = ecdsaSign(privKey, signedInfo);

  const signedXml = withSignature(baseXml, {
    signature, digest, certB64, signingTime, certDigest
  });

  return { signedXml, hash, signature, publicKeyB64 };
}

module.exports = { signInvoice, invoiceHash, sha256Base64 };
