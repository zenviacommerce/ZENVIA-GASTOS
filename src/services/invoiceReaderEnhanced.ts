import type { ExpenseCategory } from '../types';
import { readInvoiceDocument, type InvoiceReadResult } from './invoiceReader';
import { detectMerchandiseCategory, extractServiceTableLines, extractStructuredProductLines, extractSupplierV2, repairInvoiceAmounts } from './invoiceReaderV2';
import { getRetailInvoiceCorrection } from './invoiceRetailCorrections';

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

export async function readInvoiceDocumentEnhanced(
  file: File,
  categories: ExpenseCategory[],
  onProgress?: (message: string) => void,
): Promise<InvoiceReadResult> {
  const base = await readInvoiceDocument(file, categories, onProgress);
  const textLines = base.text.split(/\r?\n/).map(compact).filter(Boolean);

  onProgress?.('Reconstruyendo proveedor y líneas de producto…');
  const supplierName = extractSupplierV2(textLines, base.text) || base.supplierName;
  const retailCorrection = getRetailInvoiceCorrection(textLines, base.text);
  const structuredLines = extractStructuredProductLines(textLines);
  const serviceLines = extractServiceTableLines(textLines);
  const specializedLines = structuredLines.length >= 2 ? structuredLines : serviceLines.length >= 2 ? serviceLines : [];
  const invoiceLines = retailCorrection ? retailCorrection.lines : specializedLines.length ? specializedLines : base.lines;
  const merchandiseCategoryId = detectMerchandiseCategory(categories, base.text, invoiceLines);
  const categoryId = merchandiseCategoryId || base.categoryId;
  const repaired = repairInvoiceAmounts(base.subtotal, base.vat, base.withholding, base.total, textLines);
  const reverseCharge = /inv\.?\s*pasivo|reverse\s+charge|inversi[oó]n\s+del\s+sujeto\s+pasivo/i.test(base.text);
  const effectiveSubtotal = retailCorrection ? retailCorrection.subtotal : repaired.subtotal;
  const effectiveTotal = retailCorrection ? retailCorrection.total : repaired.total;
  const reverseChargeTotal = Math.round((effectiveSubtotal - base.withholding) * 100) / 100;
  const vat = retailCorrection
    ? retailCorrection.vat
    : reverseCharge && effectiveSubtotal > 0 && effectiveTotal > 0 && Math.abs(reverseChargeTotal - effectiveTotal) <= 0.02
      ? 0
      : base.vat;

  const gainedSupplier = supplierName && supplierName !== base.supplierName;
  const gainedLines = retailCorrection ? invoiceLines.length > 0 : specializedLines.length >= 2 && specializedLines.length >= base.lines.length;
  const confidenceBoost = (gainedSupplier ? 0.06 : 0) + (gainedLines ? 0.08 : 0) + (retailCorrection ? 0.06 : 0);

  return {
    ...base,
    supplierName,
    categoryId,
    subtotal: effectiveSubtotal,
    vat,
    total: effectiveTotal,
    lines: invoiceLines,
    confidence: Math.min(0.99, base.confidence + confidenceBoost),
  };
}
