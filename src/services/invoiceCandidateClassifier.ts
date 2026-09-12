import { readInvoiceDocument } from './invoiceReader';

export interface InvoiceCandidateContext {
  filename: string;
  subject?: string | null;
  snippet?: string | null;
  sender?: string | null;
}

export interface InvoiceCandidateClassification {
  isInvoice: boolean;
  score: number;
  signals: string[];
  negativeSignals: string[];
}

const invoiceWord = /\b(factura|invoice|tax invoice|receipt|recibo|ticket|billing statement|fattura|fatura|rechnung|facture|nota de abono|credit note|factura rectificativa)\b/i;
// Exige al menos un dígito en el identificador para que «Factura Dublin» o
// «Factura original» no cuenten como número de factura explícito.
const invoiceNumberLabel = /(?:n(?:º|°|o)\.?\s*factura|n[uú]mero\s+(?:de\s+)?factura|factura\s*(?:n[ºo°]\.?|no\.?|number|n[uú]m(?:ero)?\.?)?|invoice\s*(?:no\.?|number)?|receipt\s*(?:no\.?|number)?|ticket\s*(?:no\.?|number)?)\s*[:#-]?\s*(?=[A-Z0-9._\/-]{3,}\b)(?=[A-Z0-9._\/-]*\d)[A-Z0-9][A-Z0-9._\/-]{2,}/i;
const totalLabel = /\b(total\s+factura|importe\s+total|total\s+a\s+pagar|total\s+due|amount\s+due|invoice\s+total|grand\s+total|importe\s+adeudado|total\s+pendiente)\b/i;
const subtotalLabel = /\b(base\s+imponible|subtotal|importe\s+neto|importe\s+base\s+total|net\s+amount|taxable\s+amount|importe\s+bruto)\b/i;
const taxLabel = /\b(iva|i\.v\.a\.|vat|impuestos?|tax(?:es)?|gst)\b/i;
const dateLabel = /\b(fecha\s+(?:de\s+)?factura|invoice\s+date|date\s+of\s+issue|fecha\s+emisi[oó]n|\bfecha\s*:)\b/i;
const taxIdLabel = /\b(cif|nif|vat\s*(?:id|number|no)?|tax\s+id|identificaci[oó]n\s+fiscal)\b/i;
const partyLabel = /\b(proveedor|supplier|emisor|cliente|customer|bill\s+to|sold\s+to|ship\s+to|interesado)\b/i;
const currencyAmount = /(?:€|eur|usd|gbp|\$|£)\s*-?\d|\d[\d.,]*\s*(?:€|eur|usd|gbp|\$|£)/gi;

// Si alguno de estos términos aparece como título/cabecera, el documento no es una
// factura contable aunque tenga importes parecidos a una factura.
const hardNegative = /\b(proforma|presupuesto|quotation|quote|oferta\s+comercial|pedido\s+de\s+cliente|customer\s+order)\b/i;
// Estos términos pueden aparecer dentro de una factura real (por ejemplo, una factura
// de transporte puede mencionar albaranes/certificados), por lo que solo penalizan.
const softNegative = /\b(albar[aá]n|delivery\s+note|packing\s+list|manual|cat[aá]logo|catalogue|brochure|folleto|ficha\s+t[eé]cnica|datasheet|hoja\s+de\s+datos|certificado|certificate|condiciones\s+generales|terms\s+and\s+conditions|gu[ií]a\s+de\s+usuario|user\s+guide)\b/i;
const weakNegative = /\b(informaci[oó]n|information|documentaci[oó]n|documentation|presentaci[oó]n|presentation|newsletter|comunicado|aviso)\b/i;

function metadataText(context: InvoiceCandidateContext) {
  return `${context.filename} ${context.subject || ''} ${context.snippet || ''} ${context.sender || ''}`.replace(/\s+/g, ' ').trim();
}

export function shouldInspectInvoiceAttachment(context: InvoiceCandidateContext) {
  const text = metadataText(context);
  const filename = context.filename.toLowerCase();
  const isPdf = filename.endsWith('.pdf');
  const explicitInvoice = invoiceWord.test(text);
  invoiceWord.lastIndex = 0;
  const definitelyNonInvoice = hardNegative.test(`${context.filename} ${context.subject || ''}`);
  hardNegative.lastIndex = 0;

  if (definitelyNonInvoice) return false;
  if (explicitInvoice) return true;
  if (!isPdf) return false;

  const base = filename.replace(/\.pdf$/i, '');
  if (/^\d{6,20}$/.test(base)) return true;
  if (/^(?:fac|fact|inv|invoice|receipt|ticket)[-_ .]?[a-z0-9-]{3,}$/i.test(base)) return true;
  if (/facturaci[oó]n|billing|accounts?\s+payable|payments?|noreply.*(?:billing|invoice|payment)/i.test(text)) return true;

  // Un PDF cualquiera sin ninguna señal de facturación no merece una descarga/OCR.
  return false;
}

export async function classifyInvoiceFile(
  file: File,
  context: InvoiceCandidateContext,
  onProgress?: (message: string) => void,
): Promise<InvoiceCandidateClassification> {
  const signals: string[] = [];
  const negativeSignals: string[] = [];
  let score = 0;

  const metadata = metadataText(context);
  const metadataInvoice = invoiceWord.test(metadata);
  invoiceWord.lastIndex = 0;
  if (metadataInvoice) { score += 1.5; signals.push('contexto de correo de facturación'); }

  const hardMetadataNegative = hardNegative.test(`${context.filename} ${context.subject || ''}`);
  hardNegative.lastIndex = 0;
  if (hardMetadataNegative) { score -= 8; negativeSignals.push('metadatos de proforma/presupuesto/oferta/pedido'); }

  if (softNegative.test(metadata)) { score -= 1; negativeSignals.push('metadatos de documento auxiliar'); }
  softNegative.lastIndex = 0;
  if (weakNegative.test(metadata) && !metadataInvoice) { score -= 0.5; negativeSignals.push('contexto informativo'); }
  weakNegative.lastIndex = 0;

  let extraction;
  try {
    extraction = await readInvoiceDocument(file, [], onProgress);
  } catch {
    return { isInvoice: false, score: -10, signals, negativeSignals: [...negativeSignals, 'no se pudo leer como documento de factura'] };
  }

  const text = extraction.text || '';
  const normalized = text.replace(/\s+/g, ' ');
  const header = normalized.slice(0, 1800);

  const hasInvoiceWord = invoiceWord.test(normalized);
  invoiceWord.lastIndex = 0;
  const hasInvoiceNumber = invoiceNumberLabel.test(normalized);
  invoiceNumberLabel.lastIndex = 0;
  const hasTotal = totalLabel.test(normalized);
  totalLabel.lastIndex = 0;
  const hasSubtotal = subtotalLabel.test(normalized);
  subtotalLabel.lastIndex = 0;
  const hasTax = taxLabel.test(normalized);
  taxLabel.lastIndex = 0;
  const hasDate = dateLabel.test(normalized);
  dateLabel.lastIndex = 0;
  const hasTaxId = taxIdLabel.test(normalized);
  taxIdLabel.lastIndex = 0;
  const hasParty = partyLabel.test(normalized);
  partyLabel.lastIndex = 0;
  const hardDocumentNegative = hardNegative.test(header);
  hardNegative.lastIndex = 0;
  const softDocumentNegative = softNegative.test(normalized);
  softNegative.lastIndex = 0;
  const weakDocumentNegative = weakNegative.test(normalized);
  weakNegative.lastIndex = 0;

  if (hasInvoiceWord) { score += 2; signals.push('el documento se identifica como factura/recibo'); }
  if (hasInvoiceNumber) { score += 3; signals.push('número de factura explícito'); }
  if (hasTotal) { score += 2.5; signals.push('total de factura explícito'); }
  if (hasSubtotal) { score += 1.5; signals.push('base imponible/subtotal'); }
  if (hasTax) { score += 1; signals.push('IVA/impuestos'); }
  if (hasDate) { score += 1; signals.push('fecha de factura'); }
  if (hasTaxId) { score += 1; signals.push('identificación fiscal'); }
  if (hasParty) { score += 0.5; signals.push('partes de la factura'); }

  const amountMatches = normalized.match(currencyAmount) || [];
  currencyAmount.lastIndex = 0;
  if (amountMatches.length >= 2) { score += 1; signals.push('varios importes monetarios'); }

  if (hardDocumentNegative) { score -= 8; negativeSignals.push('documento identificado como proforma/presupuesto/oferta/pedido'); }
  if (softDocumentNegative) { score -= 2; negativeSignals.push('contiene referencias a documento auxiliar'); }
  if (weakDocumentNegative && !hasInvoiceNumber && !hasTotal) { score -= 0.75; negativeSignals.push('documento principalmente informativo'); }

  const structuralSignals = [hasInvoiceNumber, hasTotal, hasSubtotal || hasTax, hasDate, hasTaxId].filter(Boolean).length;
  const strongStructure =
    (hasInvoiceNumber && hasTotal)
    || (hasInvoiceWord && hasInvoiceNumber && (hasSubtotal || hasTax) && amountMatches.length >= 2)
    || (hasInvoiceWord && hasTotal && structuralSignals >= 2)
    || (metadataInvoice && hasInvoiceNumber && (hasSubtotal || hasTax) && amountMatches.length >= 2)
    || (/\b(receipt|recibo|ticket)\b/i.test(normalized) && hasTotal && hasDate && amountMatches.length >= 2);

  // Una proforma/presupuesto/pedido en la cabecera se descarta siempre. En cambio,
  // palabras como «albarán» o «certificado» no anulan una factura fiscal bien estructurada.
  const isInvoice = score >= 6 && strongStructure && !hardMetadataNegative && !hardDocumentNegative;
  return { isInvoice, score: Math.round(score * 10) / 10, signals, negativeSignals };
}
