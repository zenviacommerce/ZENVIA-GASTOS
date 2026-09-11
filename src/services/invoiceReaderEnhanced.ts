import type { ExpenseCategory } from '../types';
import { readInvoiceDocument, type InvoiceReadResult } from './invoiceReader';
import { detectMerchandiseCategory, extractServiceTableLines, extractStructuredProductLines, extractSupplierV2, repairInvoiceAmounts } from './invoiceReaderV2';
import { getRetailInvoiceCorrection } from './invoiceRetailCorrections';
import { canonicalizeSupplierName, extractExplicitLegalSupplier } from './supplierIdentity';

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

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

function explicitInvoiceNumber(text: string) {
  const patterns = [
    /\bn(?:º|°|o)\.?\s*factura\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bn[uú]mero\s+(?:de\s+)?factura\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\bfactura\s+(?:n(?:º|°|o)\.?|n[uú]m(?:ero)?\.?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
    /\binvoice\s+(?:no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})\b/i,
  ];
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1]?.trim();
    if (value && !/^(?:factura|invoice|fecha|date)$/i.test(value)) return value;
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

  onProgress?.('Reconstruyendo proveedor y líneas de producto…');
  const supplierName = canonicalizeSupplierName(
    extractExplicitLegalSupplier(textLines)
      || extractSupplierV2(textLines, base.text)
      || base.supplierName,
  );
  const invoiceNumber = explicitInvoiceNumber(base.text) || base.invoiceNumber;
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
  const effectiveSubtotal = retailCorrection ? retailCorrection.subtotal : explicitSubtotal || repaired.subtotal;
  const effectiveTotal = retailCorrection ? retailCorrection.total : repaired.total;
  const reverseChargeTotal = Math.round((effectiveSubtotal - base.withholding) * 100) / 100;
  const vat = retailCorrection
    ? retailCorrection.vat
    : reverseCharge && effectiveSubtotal > 0 && effectiveTotal > 0 && Math.abs(reverseChargeTotal - effectiveTotal) <= 0.02
      ? 0
      : base.vat;

  const gainedSupplier = supplierName && supplierName !== base.supplierName;
  const gainedNumber = invoiceNumber && invoiceNumber !== base.invoiceNumber;
  const gainedSubtotal = explicitSubtotal > 0 && Math.abs(explicitSubtotal - base.subtotal) > 0.01;
  const gainedLines = retailCorrection ? invoiceLines.length > 0 : specializedLines.length >= 2 && specializedLines.length >= base.lines.length;
  const confidenceBoost = (gainedSupplier ? 0.06 : 0) + (gainedNumber ? 0.04 : 0) + (gainedSubtotal ? 0.04 : 0) + (gainedLines ? 0.08 : 0) + (retailCorrection ? 0.06 : 0);

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
