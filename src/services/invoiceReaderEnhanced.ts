import type { ExpenseCategory } from '../types';
import { readInvoiceDocument, type InvoiceReadResult } from './invoiceReader';
import { detectMerchandiseCategory, extractServiceTableLines, extractStructuredProductLines, extractSupplierV2, repairInvoiceAmounts } from './invoiceReaderV2';
import { getRetailInvoiceCorrection } from './invoiceRetailCorrections';
import { canonicalizeSupplierName, extractExplicitLegalSupplier } from './supplierIdentity';

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const moneyToken = /-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2,6}|-?\d+\.\d{2,6}/g;

export class MultiInvoiceDocumentError extends Error {
  invoiceNumbers: string[];

  constructor(invoiceNumbers: string[]) {
    const sample = invoiceNumbers.slice(0, 6).join(', ');
    const suffix = invoiceNumbers.length > 6 ? ', …' : '';
    super(`Este PDF contiene varias facturas o abonos${sample ? ` (${sample}${suffix})` : ''}. Por seguridad no se importará como una única factura. Divide el documento por factura o revísalo manualmente.`);
    this.name = 'MultiInvoiceDocumentError';
    this.invoiceNumbers = invoiceNumbers;
  }
}

export function isMultiInvoiceDocumentError(error: unknown): error is MultiInvoiceDocumentError {
  return error instanceof MultiInvoiceDocumentError
    || (error instanceof Error && error.name === 'MultiInvoiceDocumentError');
}

function parseMoney(value: string | undefined | null) {
  if (!value) return 0;
  const cleaned = value.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma > lastDot) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma) normalized = cleaned.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineMoneyValues(line: string) {
  return [...line.matchAll(moneyToken)].map(match => parseMoney(match[0])).filter(value => Number.isFinite(value));
}

function detectBundledInvoiceNumbers(lines: string[], fullText: string) {
  const numbers = new Set<string>();

  for (const line of lines) {
    const summary = line.match(/\b(?:factura|abono)\s+[—-]?\s*(\d{3,12})\s+\d{2}\/\d{2}\/\d{2,4}\b/i)?.[1];
    if (summary) numbers.add(summary);
  }

  const taxSections = (fullText.match(/desglose\s+de\s+impuestos/gi) || []).length;
  if (taxSections >= 2) {
    for (const line of lines) {
      const datedNumber = line.match(/\b\d{2}\/\d{2}\/\d{2,4}\s+(\d{5,12})\s*$/)?.[1];
      if (datedNumber) numbers.add(datedNumber);
    }
  }

  const looksLikeCustomerStatement = /\bventas?\s+por\s+cliente\b|\btotal\s+cliente\s*:/i.test(fullText);
  if (numbers.size >= 2 && (looksLikeCustomerStatement || taxSections >= 2)) return [...numbers];
  return [];
}

function normalizeInvoiceNumberCandidate(value: string | undefined | null) {
  const candidate = compact(String(value || ''))
    .replace(/^[#:\s-]+/, '')
    .replace(/[.,;:\s]+$/, '');
  if (!candidate || candidate.length < 3 || candidate.length > 60) return '';

  // Un número de factura real debe contener al menos un dígito. Esto evita que
  // ciudades, cabeceras o palabras próximas a «Factura» terminen como número.
  if (!/\d/.test(candidate)) return '';

  // Una fecha nunca debe convertirse en número de factura.
  if (/^\d{1,2}[-/.]\d{1,2}[-/.](?:\d{2}|\d{4})$/.test(candidate)) return '';
  if (/^20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(candidate)) return '';

  // Rechazamos etiquetas conocidas aunque un OCR les haya añadido algún símbolo.
  if (/^(?:factura|invoice|original|copia|fecha|date|proforma)$/i.test(candidate)) return '';

  return candidate;
}

function invoiceNumberFromFilename(filename: string) {
  const base = filename.trim().replace(/\.[^.]+$/, '');

  // PDFs cuyo nombre es el propio número: Google, FedEx, etc.
  if (/^\d{6,20}$/.test(base)) return base;

  // Sendcloud_invoice_1-26-ES0047507_1-9-2026.pdf
  const labelled = base.match(/(?:invoice|factura)[_-]+((?:[A-Z0-9]+-){2,}[A-Z0-9]+)/i)?.[1];
  const validLabelled = normalizeInvoiceNumberCandidate(labelled);
  if (validLabelled) return validLabelled;

  // A28799120_15436385G_F260510648_2026.pdf
  const prefixed = base.match(/(?:^|[_-])([A-Z]\d{5,20})(?=[_-]|$)/i)?.[1];
  const validPrefixed = normalizeInvoiceNumberCandidate(prefixed);
  if (validPrefixed) return validPrefixed;

  // TRUFA_PET_585256540.pdf
  const trailingDigits = base.match(/(?:^|[_-])(\d{6,20})$/)?.[1];
  return normalizeInvoiceNumberCandidate(trailingDigits);
}

function explicitInvoiceNumber(text: string, lines: string[]) {
  // Priorizamos etiquetas inequívocas. Los patrones genéricos quedan al final para
  // evitar errores como «Factura Dublin 2» -> Dublin o «Factura original» -> original.
  const patterns = [
    /\bn[uú]mero\s+(?:de\s+)?factura\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bn(?:º|°|o)\.?\s*factura\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bbill\s*#\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\binvoice\s+(?:no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bfactura\s+(?:n(?:º|°|o)\.?|n[uú]m(?:ero)?\.?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bfactura\s+([A-Z]*\d[A-Z0-9._\/-]{2,})\b/i,
  ];
  for (const pattern of patterns) {
    const value = normalizeInvoiceNumberCandidate(text.match(pattern)?.[1]);
    if (value) return value;
  }

  // Formato frecuente en facturas de Sierra Nevada: la fecha y el número
  // aparecen al final de la línea de forma de pago, sin una etiqueta intermedia.
  for (const line of lines) {
    const value = normalizeInvoiceNumberCandidate(line.match(/\b\d{2}\/\d{2}\/\d{2,4}\s+(\d{5,12})\s*$/)?.[1]);
    if (value) return value;
  }
  return '';
}

function explicitTaxBase(text: string) {
  const patterns = [
    /\bimporte\s+base\s+total\s*[:#-]?\s*(-?[\d.,]+)\s*(?:€|eur)?/i,
    /\bbase\s+imponible(?:\s+total)?\s*[:#-]?\s*(-?[\d.,]+)\s*(?:€|eur)?/i,
    /\bsubtotal\s*[:#-]?\s*(-?[\d.,]+)\s*(?:€|eur)?/i,
    /\bimporte\s+neto\s*[:#-]?\s*(-?[\d.,]+)\s*(?:€|eur)?/i,
  ];
  for (const pattern of patterns) {
    const amount = parseMoney(text.match(pattern)?.[1]);
    if (amount > 0) return amount;
  }
  return 0;
}

type FiscalSummary = { subtotal: number; vat: number; total: number; rate: number };

function extractFiscalSummary(lines: string[]): FiscalSummary | null {
  let marker = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/desglose\s+de\s+impuestos/i.test(lines[index])) {
      marker = index;
      break;
    }
  }
  if (marker < 0) return null;

  for (let index = marker + 1; index <= Math.min(lines.length - 1, marker + 12); index += 1) {
    const line = lines[index];
    const rateRaw = line.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/)?.[1];
    const rate = parseMoney(rateRaw);
    if (!rate || rate > 30) continue;

    const withoutRate = line.replace(/\d{1,2}(?:[.,]\d{1,2})?\s*%/, ' ');
    const values = lineMoneyValues(withoutRate).filter(value => Math.abs(value) < 10_000_000);
    if (values.length < 2) continue;

    const subtotal = values.at(-2) || 0;
    const vat = values.at(-1) || 0;
    if (subtotal <= 0 || vat < 0) continue;

    const expectedVat = Math.round(subtotal * rate) / 100;
    const tolerance = Math.max(0.10, Math.abs(expectedVat) * 0.015);
    if (Math.abs(vat - expectedVat) > tolerance) continue;

    const expectedTotal = Math.round((subtotal + vat) * 100) / 100;
    let total = 0;
    for (let totalIndex = index + 1; totalIndex <= Math.min(lines.length - 1, index + 10); totalIndex += 1) {
      const totalValues = lineMoneyValues(lines[totalIndex]);
      const matching = totalValues.find(value => Math.abs(value - expectedTotal) <= 0.10);
      if (matching != null) {
        total = matching;
        break;
      }
      if (/\b(?:total\s+factura|importe\s+total|total\s+a\s+pagar)\b/i.test(lines[totalIndex])) {
        const labelled = totalValues.at(-1);
        if (labelled != null && labelled > 0) {
          total = labelled;
          break;
        }
      }
    }

    return { subtotal, vat, total: total || expectedTotal, rate };
  }
  return null;
}

function normalizedCategoryName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function findCategory(categories: ExpenseCategory[], needle: RegExp) {
  return categories.find(category => needle.test(normalizedCategoryName(category.name)))?.id;
}

/**
 * Segunda barrera antes de considerar una factura como mercancía. Las tablas de
 * honorarios, cuotas, portes o suscripciones pueden parecer tablas de artículos
 * al OCR, pero sus conceptos no deben crear registros en el maestro de productos.
 */
function serviceCategoryByContent(categories: ExpenseCategory[], text: string) {
  if (/\b(honorarios|minuta|registro\s+mercantil|registrador(?:es)?|asesor[ií]a|gestor[ií]a|consultor[ií]a|abogad[oa]|servicios?\s+profesionales?)\b/i.test(text)) {
    return findCategory(categories, /servicios? profesionales?/);
  }
  if (/\b(suscripci[oó]n|subscription|licencia|license|software|cloud|workspace|hosting|saas)\b/i.test(text)) {
    return findCategory(categories, /software|suscripciones?/);
  }
  if (/\b(transporte|log[ií]stica|portes?|env[ií]o|shipping|freight|courier|fedex|mrw|correos express)\b/i.test(text)) {
    return findCategory(categories, /transporte|logistica/);
  }
  if (/\b(publicidad|marketing|campaign|campa[nñ]a|ads?|google ads|meta ads)\b/i.test(text)) {
    return findCategory(categories, /publicidad|marketing/);
  }
  if (/\b(comisi[oó]n|commission|marketplace|amazon fees?|seller fees?)\b/i.test(text)) {
    return findCategory(categories, /comisiones?|marketplaces?/);
  }
  return undefined;
}

export async function readInvoiceDocumentEnhanced(
  file: File,
  categories: ExpenseCategory[],
  onProgress?: (message: string) => void,
): Promise<InvoiceReadResult> {
  const base = await readInvoiceDocument(file, categories, onProgress);
  const textLines = base.text.split(/\r?\n/).map(compact).filter(Boolean);

  const bundledInvoiceNumbers = detectBundledInvoiceNumbers(textLines, base.text);
  if (bundledInvoiceNumbers.length >= 2) throw new MultiInvoiceDocumentError(bundledInvoiceNumbers);

  onProgress?.('Reconstruyendo proveedor, fiscalidad y líneas de producto…');
  const supplierName = canonicalizeSupplierName(
    extractExplicitLegalSupplier(textLines)
      || extractSupplierV2(textLines, base.text)
      || base.supplierName,
  );
  const explicitNumber = explicitInvoiceNumber(base.text, textLines);
  const filenameNumber = invoiceNumberFromFilename(file.name);
  const baseNumber = normalizeInvoiceNumberCandidate(base.invoiceNumber);
  const invoiceNumber = explicitNumber || filenameNumber || baseNumber;
  const retailCorrection = getRetailInvoiceCorrection(textLines, base.text);
  const structuredLines = extractStructuredProductLines(textLines);
  const serviceLines = extractServiceTableLines(textLines);
  const specializedLines = structuredLines.length >= 2 ? structuredLines : serviceLines.length >= 2 ? serviceLines : [];
  const invoiceLines = retailCorrection ? retailCorrection.lines : specializedLines.length ? specializedLines : base.lines;
  const serviceCategoryId = serviceCategoryByContent(categories, base.text);
  const merchandiseCategoryId = serviceCategoryId ? undefined : detectMerchandiseCategory(categories, base.text, invoiceLines);
  const categoryId = serviceCategoryId || merchandiseCategoryId || base.categoryId;
  const repaired = repairInvoiceAmounts(base.subtotal, base.vat, base.withholding, base.total, textLines);
  const explicitSubtotal = explicitTaxBase(base.text);
  const reverseCharge = /inv\.?\s*pasivo|reverse\s+charge|inversi[oó]n\s+del\s+sujeto\s+pasivo/i.test(base.text);
  const fiscalSummary = reverseCharge ? null : extractFiscalSummary(textLines);
  const effectiveSubtotal = retailCorrection
    ? retailCorrection.subtotal
    : fiscalSummary?.subtotal || explicitSubtotal || repaired.subtotal;
  const effectiveTotal = retailCorrection
    ? retailCorrection.total
    : fiscalSummary?.total || repaired.total;
  const reverseChargeTotal = Math.round((effectiveSubtotal - base.withholding) * 100) / 100;
  const vat = retailCorrection
    ? retailCorrection.vat
    : reverseCharge && effectiveSubtotal > 0 && effectiveTotal > 0 && Math.abs(reverseChargeTotal - effectiveTotal) <= 0.02
      ? 0
      : fiscalSummary?.vat ?? base.vat;

  const gainedSupplier = supplierName && supplierName !== base.supplierName;
  const gainedNumber = invoiceNumber && invoiceNumber !== base.invoiceNumber;
  const gainedSubtotal = (fiscalSummary?.subtotal || explicitSubtotal) > 0 && Math.abs(effectiveSubtotal - base.subtotal) > 0.01;
  const gainedVat = Boolean(fiscalSummary && Math.abs(fiscalSummary.vat - base.vat) > 0.01);
  const gainedLines = retailCorrection ? invoiceLines.length > 0 : specializedLines.length >= 2 && specializedLines.length >= base.lines.length;
  const confidenceBoost = (gainedSupplier ? 0.06 : 0)
    + (gainedNumber ? 0.05 : 0)
    + (gainedSubtotal ? 0.04 : 0)
    + (gainedVat ? 0.08 : 0)
    + (gainedLines ? 0.08 : 0)
    + (retailCorrection ? 0.06 : 0);

  return {
    ...base,
    supplierName,
    invoiceNumber,
    categoryId,
    subtotal: effectiveSubtotal,
    vat,
    total: effectiveTotal,
    lines: invoiceLines,
    confidence: Math.min(0.99, base.confidence + confidenceBoost),
  };
}
