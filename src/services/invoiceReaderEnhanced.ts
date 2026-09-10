import type { ExpenseCategory } from '../types';
import { readInvoiceDocument, type InvoiceReadResult } from './invoiceReader';
import { detectMerchandiseCategory, extractServiceTableLines, extractStructuredProductLines, extractSupplierV2, repairInvoiceAmounts } from './invoiceReaderV2';

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
  const structuredLines = extractStructuredProductLines(textLines);
  const serviceLines = extractServiceTableLines(textLines);
  const specializedLines = structuredLines.length >= 2 ? structuredLines : serviceLines.length >= 2 ? serviceLines : [];
  const invoiceLines = specializedLines.length ? specializedLines : base.lines;
  const merchandiseCategoryId = detectMerchandiseCategory(categories, base.text, invoiceLines);
  const categoryId = merchandiseCategoryId || base.categoryId;
  const repaired = repairInvoiceAmounts(base.subtotal, base.vat, base.withholding, base.total, textLines);
  const reverseCharge = /inv\.?\s*pasivo|reverse\s+charge|inversi[oó]n\s+del\s+sujeto\s+pasivo/i.test(base.text);
  const reverseChargeTotal = Math.round((repaired.subtotal - base.withholding) * 100) / 100;
  const vat = reverseCharge && repaired.subtotal > 0 && repaired.total > 0 && Math.abs(reverseChargeTotal - repaired.total) <= 0.02 ? 0 : base.vat;

  const gainedSupplier = supplierName && supplierName !== base.supplierName;
  const gainedLines = specializedLines.length >= 2 && specializedLines.length >= base.lines.length;
  const confidenceBoost = (gainedSupplier ? 0.06 : 0) + (gainedLines ? 0.08 : 0);

  return {
    ...base,
    supplierName,
    categoryId,
    subtotal: repaired.subtotal,
    vat,
    total: repaired.total,
    lines: invoiceLines,
    confidence: Math.min(0.99, base.confidence + confidenceBoost),
  };
}
