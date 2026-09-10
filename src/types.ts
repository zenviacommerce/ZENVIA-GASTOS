export type InvoiceStatus = 'pending' | 'reviewed' | 'accounted';
export type InvoiceSource = 'manual' | 'camera' | 'gmail';

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
  supplierType: 'goods' | 'service' | 'both';
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
  withholding: number;
  total: number;
  source: InvoiceSource;
  status: InvoiceStatus;
  fileName?: string | null;
  filePath?: string | null;
  lines: InvoiceLine[];
}

export interface Product {
  id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  unit: string;
  lastPrice?: number | null;
  previousPrice?: number | null;
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

export interface NewInvoiceInput {
  file: File;
  source: InvoiceSource;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  categoryId?: string;
  subtotal: number;
  vat: number;
  withholding: number;
  total: number;
}
