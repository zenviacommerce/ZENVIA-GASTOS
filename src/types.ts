export type InvoiceStatus = 'pending' | 'reviewed' | 'accounted';
export type InvoiceSource = 'manual' | 'camera' | 'gmail';
export type SupplierType = 'unclassified' | 'goods' | 'service' | 'both';
export type InvoiceImportCandidateStatus = 'analyzing' | 'ready' | 'needs_review' | 'duplicate' | 'error' | 'importing' | 'imported';

export interface ExpenseCategory {
  id: string;
  name: string;
  icon?: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  supplierType: SupplierType;
  defaultCategoryId?: string | null;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice?: number | null;
  normalizedUnitPrice?: number | null;
  lineTotal?: number | null;
  supplierSku?: string | null;
  productId?: string | null;
  priceUpdateStatus: 'pending' | 'confirmed' | 'ignored';
}

export interface Invoice {
  id: string;
  supplierId?: string | null;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  fiscalYear?: number | null;
  fiscalQuarter?: number | null;
  categoryId?: string | null;
  category: string;
  subtotal: number;
  vat: number;
  equivalenceSurcharge: number;
  withholding: number;
  total: number;
  source: InvoiceSource;
  status: InvoiceStatus;
  fileName?: string | null;
  filePath?: string | null;
  fileHash?: string | null;
  lines: InvoiceLine[];
}

export interface Product {
  id: string;
  name: string;
  sku?: string | null;
  ean?: string | null;
  category?: string | null;
  unit: string;
  lastPrice?: number | null;
  previousPrice?: number | null;
  salePrice?: number | null;
  salesTaxRate?: number | null;
  invoiceDescription?: string | null;
  supplierId?: string | null;
  supplier: string;
  lastPurchaseDate?: string | null;
}

export interface AppData {
  invoices: Invoice[];
  products: Product[];
  suppliers: Supplier[];
  categories: ExpenseCategory[];
}

export interface NewInvoiceLineInput {
  description: string;
  quantity: number;
  unit?: string | null;
  supplierSku?: string | null;
  unitPrice?: number | null;
  normalizedUnitPrice?: number | null;
  lineNet?: number | null;
  taxRate?: number | null;
  taxAmount?: number | null;
  lineTotal?: number | null;
}

export interface NewInvoiceInput {
  file: File;
  source: InvoiceSource;
  supplierName: string;
  supplierTaxId?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  supplierWebsite?: string;
  invoiceNumber: string;
  invoiceDate: string;
  categoryId?: string;
  subtotal: number;
  vat: number;
  equivalenceSurcharge?: number;
  withholding: number;
  total: number;
  ocrText?: string;
  extraction?: Record<string, unknown>;
  extractionConfidence?: number;
  lines?: NewInvoiceLineInput[];
}

export interface InvoiceImportCandidate {
  id: string;
  file: File;
  fileHash: string;
  status: InvoiceImportCandidateStatus;
  reviewReason?: string;
  supplierName: string;
  supplierTaxId?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  supplierWebsite?: string;
  recipientTaxId?: string;
  recipientName?: string;
  invoiceNumber: string;
  invoiceDate: string;
  categoryId?: string;
  subtotal: number;
  vat: number;
  equivalenceSurcharge: number;
  withholding: number;
  total: number;
  text: string;
  confidence: number;
  usedOcr: boolean;
  lines: NewInvoiceLineInput[];
  multiInvoiceSource?: boolean;
  bundleIndex?: number;
  bundleCount?: number;
}
