import { supabase, INVOICE_BUCKET } from './supabase';
import type { AppData, ExpenseCategory, Invoice, NewInvoiceInput, Product, Supplier } from '../types';

const numberOrZero = (value: unknown) => Number(value ?? 0) || 0;
const normalizeProductKey = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export async function bootstrapUser() {
  const { error } = await supabase.rpc('bootstrap_expense_categories');
  if (error) throw error;
}

export async function loadAppData(): Promise<AppData> {
  const [invoiceResult, lineResult, supplierResult, categoryResult, productResult] = await Promise.all([
    supabase.from('invoices').select('*').order('issue_date', { ascending: false, nullsFirst: false }),
    supabase.from('invoice_lines').select('*'),
    supabase.from('suppliers').select('*').order('name'),
    supabase.from('expense_categories').select('*').eq('active', true).order('sort_order'),
    supabase.from('products').select('*').eq('active', true).order('name'),
  ]);

  for (const result of [invoiceResult, lineResult, supplierResult, categoryResult, productResult]) {
    if (result.error) throw result.error;
  }

  const suppliers: Supplier[] = (supplierResult.data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    taxId: s.tax_id,
    email: s.email,
    supplierType: s.supplier_type,
    defaultCategoryId: s.default_category_id,
  }));
  const supplierById = new Map(suppliers.map(s => [s.id, s]));

  const categories: ExpenseCategory[] = (categoryResult.data ?? []).map((c: any) => ({ id: c.id, name: c.name, icon: c.icon }));
  const categoryById = new Map(categories.map(c => [c.id, c]));

  const linesByInvoice = new Map<string, any[]>();
  for (const line of lineResult.data ?? []) {
    const bucket = linesByInvoice.get(line.invoice_id) ?? [];
    bucket.push(line);
    linesByInvoice.set(line.invoice_id, bucket);
  }

  const invoices: Invoice[] = (invoiceResult.data ?? []).map((i: any) => ({
    id: i.id,
    supplierId: i.supplier_id,
    supplierName: supplierById.get(i.supplier_id)?.name ?? 'Proveedor sin asignar',
    invoiceNumber: i.invoice_number ?? '—',
    invoiceDate: i.issue_date ?? i.received_date,
    fiscalYear: i.fiscal_year,
    fiscalQuarter: i.fiscal_quarter,
    categoryId: i.expense_category_id,
    category: categoryById.get(i.expense_category_id)?.name ?? 'Sin categoría',
    subtotal: numberOrZero(i.net_amount),
    vat: numberOrZero(i.tax_amount),
    withholding: numberOrZero(i.withholding_amount),
    total: numberOrZero(i.total_amount),
    source: i.source,
    status: i.status,
    fileName: i.file_name,
    filePath: i.file_path,
    lines: (linesByInvoice.get(i.id) ?? []).map((l: any) => ({
      id: l.id,
      description: l.description,
      quantity: numberOrZero(l.quantity),
      unitPrice: l.unit_price == null ? null : numberOrZero(l.unit_price),
      normalizedUnitPrice: l.normalized_unit_price == null ? null : numberOrZero(l.normalized_unit_price),
      lineTotal: l.line_total == null ? null : numberOrZero(l.line_total),
      supplierSku: l.supplier_sku,
      productId: l.product_id,
      priceUpdateStatus: l.price_update_status,
    })),
  }));

  const products: Product[] = (productResult.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    unit: p.base_unit,
    lastPrice: p.last_cost == null ? null : numberOrZero(p.last_cost),
    previousPrice: p.previous_cost == null ? null : numberOrZero(p.previous_cost),
    supplierId: p.last_supplier_id,
    supplier: supplierById.get(p.last_supplier_id)?.name ?? '—',
    lastPurchaseDate: p.last_purchase_date,
  }));

  return { invoices, products, suppliers, categories };
}

async function sha256(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ensureSupplier(name: string): Promise<string> {
  const clean = name.trim();
  const { data: existing, error: findError } = await supabase.from('suppliers').select('id').ilike('name', clean).limit(1);
  if (findError) throw findError;
  if (existing?.[0]?.id) return existing[0].id;
  const { data, error } = await supabase.from('suppliers').insert({ name: clean }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function isMerchandiseCategory(categoryId?: string) {
  if (!categoryId) return false;
  const { data, error } = await supabase.from('expense_categories').select('name').eq('id', categoryId).maybeSingle();
  if (error) throw error;
  return Boolean(data?.name && normalizeProductKey(data.name).includes('mercancia'));
}

async function createInvoiceLinesWithProducts(invoiceId: string, supplierId: string, input: NewInvoiceInput) {
  if (!input.lines?.length) return;

  const autoCreateProducts = await isMerchandiseCategory(input.categoryId);
  const createdProductIds: string[] = [];
  const createdSupplierProductIds: string[] = [];

  const [productsResult, supplierProductsResult] = autoCreateProducts
    ? await Promise.all([
        supabase.from('products').select('id,name,base_unit').eq('active', true),
        supabase.from('supplier_products').select('id,product_id,supplier_description').eq('supplier_id', supplierId),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (productsResult.error) throw productsResult.error;
  if (supplierProductsResult.error) throw supplierProductsResult.error;

  const productByName = new Map<string, { id: string; unit: string }>();
  for (const product of productsResult.data ?? []) {
    const key = normalizeProductKey(product.name);
    if (key && !productByName.has(key)) productByName.set(key, { id: product.id, unit: product.base_unit || 'ud' });
  }

  const supplierProductByDescription = new Map<string, { id: string; productId: string }>();
  for (const supplierProduct of supplierProductsResult.data ?? []) {
    const key = normalizeProductKey(supplierProduct.supplier_description);
    if (key && !supplierProductByDescription.has(key)) {
      supplierProductByDescription.set(key, { id: supplierProduct.id, productId: supplierProduct.product_id });
    }
  }

  const lineRows: Record<string, unknown>[] = [];

  try {
    for (const line of input.lines) {
      const description = line.description.trim().slice(0, 250);
      if (!description) continue;

      const key = normalizeProductKey(description);
      const unit = line.unit?.trim() || 'ud';
      let productId: string | null = null;
      let supplierProductId: string | null = null;

      if (autoCreateProducts && key) {
        const supplierMatch = supplierProductByDescription.get(key);
        if (supplierMatch) {
          supplierProductId = supplierMatch.id;
          productId = supplierMatch.productId;
        } else {
          let product = productByName.get(key);
          if (!product) {
            const { data: created, error: productError } = await supabase.from('products').insert({
              name: description,
              sku: null,
              category: 'Mercancía',
              base_unit: unit,
            }).select('id,base_unit').single();
            if (productError) throw productError;
            product = { id: created.id, unit: created.base_unit || unit };
            createdProductIds.push(created.id);
            productByName.set(key, product);
          }
          productId = product.id;

          const { data: supplierProduct, error: supplierProductError } = await supabase.from('supplier_products').insert({
            supplier_id: supplierId,
            product_id: productId,
            supplier_sku: line.supplierSku?.trim() || null,
            supplier_description: description,
            purchase_unit: unit,
            units_per_purchase: 1,
          }).select('id').single();
          if (supplierProductError) throw supplierProductError;
          supplierProductId = supplierProduct.id;
          createdSupplierProductIds.push(supplierProduct.id);
          supplierProductByDescription.set(key, { id: supplierProduct.id, productId });
        }
      }

      const normalizedPrice = productId && line.unitPrice != null ? line.unitPrice : null;
      lineRows.push({
        invoice_id: invoiceId,
        product_id: productId,
        supplier_product_id: supplierProductId,
        description,
        supplier_sku: line.supplierSku?.trim() || null,
        quantity: line.quantity || 1,
        unit,
        unit_price: line.unitPrice ?? null,
        normalized_unit_price: normalizedPrice,
        line_net: line.lineTotal ?? null,
        line_total: line.lineTotal ?? null,
        price_update_status: normalizedPrice != null ? 'confirmed' : 'pending',
      });
    }

    if (!lineRows.length) return;
    const { error: lineError } = await supabase.from('invoice_lines').insert(lineRows);
    if (lineError) throw lineError;
  } catch (error) {
    if (createdSupplierProductIds.length) await supabase.from('supplier_products').delete().in('id', createdSupplierProductIds);
    if (createdProductIds.length) await supabase.from('products').delete().in('id', createdProductIds);
    throw error;
  }
}

export async function createInvoice(input: NewInvoiceInput) {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Sesión no válida.');

  const fileHash = await sha256(input.file);
  const { data: duplicates, error: duplicateError } = await supabase.from('invoices').select('id, invoice_number').eq('file_hash', fileHash).limit(1);
  if (duplicateError) throw duplicateError;
  if (duplicates?.length) throw new Error(`Esta factura parece estar subida ya (${duplicates[0].invoice_number || 'sin número'}).`);

  const supplierId = await ensureSupplier(input.supplierName);
  const year = input.invoiceDate ? new Date(`${input.invoiceDate}T12:00:00`).getFullYear() : new Date().getFullYear();
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100);
  const storagePath = `${user.id}/${year}/${crypto.randomUUID()}-${safeName}`;
  const { error: storageError } = await supabase.storage.from(INVOICE_BUCKET).upload(storagePath, input.file, {
    contentType: input.file.type || 'application/pdf',
    upsert: false,
  });
  if (storageError) throw storageError;

  const { data: invoice, error } = await supabase.from('invoices').insert({
    supplier_id: supplierId,
    invoice_number: input.invoiceNumber.trim() || null,
    issue_date: input.invoiceDate || null,
    expense_category_id: input.categoryId || null,
    net_amount: input.subtotal,
    tax_amount: input.vat,
    withholding_amount: input.withholding,
    total_amount: input.total,
    source: input.source,
    status: 'pending',
    file_path: storagePath,
    file_name: input.file.name,
    mime_type: input.file.type || 'application/pdf',
    file_hash: fileHash,
    ocr_text: input.ocrText || null,
    extraction: input.extraction ?? {},
    extraction_confidence: input.extractionConfidence ?? null,
  }).select('id').single();

  if (error) {
    await supabase.storage.from(INVOICE_BUCKET).remove([storagePath]);
    throw error;
  }

  try {
    await createInvoiceLinesWithProducts(invoice.id, supplierId, input);
  } catch (lineError) {
    await supabase.from('invoices').delete().eq('id', invoice.id);
    await supabase.storage.from(INVOICE_BUCKET).remove([storagePath]);
    throw lineError;
  }
}

export async function updateInvoiceStatus(invoiceId: string, status: 'pending' | 'reviewed' | 'accounted') {
  const { error } = await supabase.from('invoices').update({ status }).eq('id', invoiceId);
  if (error) throw error;
}

export async function deleteInvoice(invoiceId: string, filePath?: string | null) {
  const { error } = await supabase.from('invoices').delete().eq('id', invoiceId);
  if (error) throw error;
  if (filePath) {
    const { error: storageError } = await supabase.storage.from(INVOICE_BUCKET).remove([filePath]);
    if (storageError) console.warn('La factura se eliminó, pero no se pudo borrar el archivo de Storage.', storageError);
  }
}

export async function getInvoiceFileUrl(path: string) {
  const { data, error } = await supabase.storage.from(INVOICE_BUCKET).createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function addProduct(input: { name: string; sku?: string; category?: string; unit: string }) {
  const { error } = await supabase.from('products').insert({
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    category: input.category?.trim() || null,
    base_unit: input.unit.trim() || 'ud',
  });
  if (error) throw error;
}

type SupplierInput = { name: string; taxId?: string; email?: string; supplierType: 'goods' | 'service' | 'both' };

export async function addSupplier(input: SupplierInput) {
  const { error } = await supabase.from('suppliers').insert({
    name: input.name.trim(),
    tax_id: input.taxId?.trim() || null,
    email: input.email?.trim() || null,
    supplier_type: input.supplierType,
  });
  if (error) throw error;
}

export async function updateSupplier(supplierId: string, input: SupplierInput) {
  const { error } = await supabase.from('suppliers').update({
    name: input.name.trim(),
    tax_id: input.taxId?.trim() || null,
    email: input.email?.trim() || null,
    supplier_type: input.supplierType,
  }).eq('id', supplierId);
  if (error) throw error;
}

export async function deleteSupplier(supplierId: string) {
  const { error } = await supabase.from('suppliers').delete().eq('id', supplierId);
  if (error) throw error;
}

export async function downloadInvoiceFile(path: string) {
  const { data, error } = await supabase.storage.from(INVOICE_BUCKET).download(path);
  if (error) throw error;
  return data;
}
