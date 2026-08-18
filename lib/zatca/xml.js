'use strict';
// توليد فاتورة إلكترونية XML بصيغة UBL 2.1 متوافقة مع هيئة الزكاة والدخل والجمارك
// الناتج يُبنى بصيغة Canonical-ready (سطور LF، بلا ترويسة XML، سمات مفروزة حسب C14N)

const XMLNS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const XMLNS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const XMLNS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const XMLNS_EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';
const XMLNS_SIG = 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2';
const XMLNS_SAC = 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2';
const XMLNS_UDT = 'urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2';
const XMLNS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const XMLNS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n) {
  return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
}

// بناء جزء الفاتورة الأساسي (بدون التوقيع)
// args: { seller:{name,vat_number,address,city}, buyer:{name,vat_number}|null,
//         invoice:{uuid,no,issue_date,issue_time,type_code,tax_category,currency,line_total,allowance,taxable,vat,total,paid},
//         lines:[{description,qty,unit_price,vat_rate,line_total}] }
function buildBaseInvoice(args) {
  const { seller, buyer, invoice, lines } = args;
  const lineItems = lines.map((l, i) => {
    const catId = Number(l.vat_rate) > 0 ? 'S' : 'Z';
    const lineVat = l.line_total * Number(l.vat_rate) / 100;
    return `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${fmt(l.qty)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${invoice.currency}">${fmt(l.line_total)}</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="${invoice.currency}">${fmt(lineVat)}</cbc:TaxAmount></cac:TaxTotal><cac:Item><cbc:Name>${esc(l.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${catId}</cbc:ID><cbc:Percent>${fmt(l.vat_rate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="${invoice.currency}">${fmt(l.unit_price)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
  }).join('');

  const supplier = `<cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>${esc(seller.name)}</cbc:RegistrationName><cac:RegistrationAddress><cbc:StreetName>${esc(seller.address || '')}</cbc:StreetName><cbc:CityName>${esc(seller.city || '')}</cbc:CityName><cbc:CountrySubentity/></cac:RegistrationAddress></cac:PartyLegalEntity><cac:PartyTaxScheme><cbc:CompanyID>${esc(seller.vat_number)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>`;

  let customer;
  if (invoice.type_code === '0200000' && buyer) {
    customer = `<cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>${esc(buyer.name || '')}</cbc:RegistrationName><cac:RegistrationAddress><cbc:StreetName/><cbc:CityName/></cac:RegistrationAddress></cac:PartyLegalEntity><cac:PartyTaxScheme><cbc:CompanyID>${esc(buyer.vat_number || '')}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>`;
  } else {
    customer = `<cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>${esc(buyer ? buyer.name || 'نقدي' : 'نقدي')}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>`;
  }

  const taxCategoryId = invoice.tax_category || 'S';
  const allowance = invoice.allowance > 0
    ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>خصم</cbc:AllowanceChargeReason><cbc:Amount currencyID="${invoice.currency}">${fmt(invoice.allowance)}</cbc:Amount></cac:AllowanceCharge>`
    : '';

  return `<Invoice xmlns="${XMLNS}" xmlns:cac="${XMLNS_CAC}" xmlns:cbc="${XMLNS_CBC}" xmlns:ds="${XMLNS_DS}" xmlns:ext="${XMLNS_EXT}" xmlns:sac="${XMLNS_SAC}" xmlns:sig="${XMLNS_SIG}" xmlns:udt="${XMLNS_UDT}" xmlns:xades="${XMLNS_XADES}"><cbc:ProfileID>reporting:1.0</cbc:ProfileID><cbc:ID>${esc(invoice.no)}</cbc:ID><cbc:UUID>${esc(invoice.uuid)}</cbc:UUID><cbc:IssueDate>${invoice.issue_date}</cbc:IssueDate><cbc:IssueTime>${invoice.issue_time}</cbc:IssueTime><cbc:InvoiceTypeCode name="${invoice.type_code}">388</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>${invoice.currency}</cbc:DocumentCurrencyCode>${supplier}${customer}<cac:TaxTotal><cbc:TaxAmount currencyID="${invoice.currency}">${fmt(invoice.vat)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${invoice.currency}">${fmt(invoice.taxable)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${invoice.currency}">${fmt(invoice.vat)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${taxCategoryId}</cbc:ID><cbc:Percent>${fmt(args.vat_rate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="${invoice.currency}">${fmt(invoice.line_total)}</cbc:LineExtensionAmount>${allowance}<cbc:TaxExclusiveAmount currencyID="${invoice.currency}">${fmt(invoice.taxable)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${invoice.currency}">${fmt(invoice.total)}</cbc:TaxInclusiveAmount><cbc:PrepaidAmount currencyID="${invoice.currency}">${fmt(invoice.paid)}</cbc:PrepaidAmount><cbc:PayableAmount currencyID="${invoice.currency}">${fmt(invoice.total)}</cbc:PayableAmount></cac:LegalMonetaryTotal>${lineItems}</Invoice>`;
}

// إدراج كتلة التوقيع (UBLExtensions) قبل cbc:ProfileID
function withSignature(baseXml, { signature, digest, certB64, signingTime, certDigest }) {
  const block = `<ext:UBLExtensions xmlns:ext="${XMLNS_EXT}" xmlns:sac="${XMLNS_SAC}" xmlns:sig="${XMLNS_SIG}" xmlns:udt="${XMLNS_UDT}" xmlns:ds="${XMLNS_DS}" xmlns:xades="${XMLNS_XADES}"><ext:UBLExtension><ext:ExtensionContent><sig:UBLDocumentSignatures><sac:SignatureInformation><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><sac:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sac:ReferencedSignatureID><ds:Signature Id="signature"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference></ds:SignedInfo><ds:SignatureValue>${signature}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature><xades:QualifyingProperties Target="#signature"><xades:SignedProperties><xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>CN=ZATCA</ds:X509IssuerName><ds:X509SerialNumber>1</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties><xades:UnsignedProperties/></xades:QualifyingProperties></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;
  return baseXml.replace('<cbc:ProfileID>', block + '<cbc:ProfileID>');
}

module.exports = { buildBaseInvoice, withSignature, fmt, esc, XMLNS_DS, XMLNS_XADES };
