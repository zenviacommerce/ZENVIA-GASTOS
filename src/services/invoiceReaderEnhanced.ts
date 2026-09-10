import type { ExpenseCategory } from '../types';
import { readInvoiceDocument, type InvoiceReadResult } from './invoiceReader';
import { detectMerchandiseCategory, extractStructuredProductLines, extractSupplierV2, repairInvoiceAmounts } from './invoiceReaderV2';

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
  const invoiceLines = structuredLines.length >= 2 ? structuredLines : base.lines;
  const merchandiseCategoryId = detectMerchandiseCategory(categories, base.text, invoiceLines);
  const categoryId = merchandiseCategoryId || base.categoryId;
  const repaired = repairInvoiceAmounts(base.subtotal, base.vat, base.withholding, base.total, textLines);

  const gainedSupplier = supplierName && supplierName !== base.supplierName;
  const gainedLines = structuredLines.length >= 2 && structuredLines.length > base.lines.length;
  const confidenceBoost = (gainedSupplier ? 0.06 : 0) + (gainedLines ? 0.08 : 0);

  return {
    ...base,
    supplierName,
    categoryId,
    subtotal: repaired.subtotal,
    total: repaired.total,
    lines: invoiceLines,
    confidence: Math.min(0.99, base.confidence + confidenceBoost),
  };
}
