import { supabase, INVOICE_BUCKET } from './supabase';
import type { AppData, ExpenseCategory, Invoice, NewInvoiceInput, Product, Supplier } from '../types';
import { canonicalizeSupplierName, isLikelySameSupplier, supplierIdentityKey } from './supplierIdentity';
import { extractSupplierContactData, type SupplierContactData } from './supplierContactExtractor';
import { extractSupplierInvoiceDetails } from './supplierInvoiceDetails';
import { repairInvoiceAmounts, repairInvoiceProductLines } from './invoiceProductLine';
import { emailError, normalizeEmail, normalizePhone, normalizeTaxId, phoneError, taxIdError } from './validation';
import { sanitizeDatabaseSingleLine, sanitizeDatabaseText, sanitizeDatabaseValue } from './textSanitizer';
import { resolveEntityAlias } from './entityAliases';
import { loadAppSettings } from './settings';
import { expenseImportPolicyFromSettings, type ExpenseImportPolicy } from './expenseImportPolicy';
import { DEFAULT_APP_SETTINGS, type SuppliersSettings } from './settingsSchema';

const numberOrZero = (value: unknown) => Number(value ?? 0) || 0;
const normalizeProductKey = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

type SupplierProfileData = SupplierContactData & { address?: string; website?: string };

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
    phone: s.phone,
    address: s.address,
    website: s.website,
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
    equivalenceSurcharge: numberOrZero(i.equivalence_surcharge_amount),
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

function cleanSupplierContact(contact: SupplierProfileData): SupplierProfileData {
  const taxId = contact.taxId ? normalizeTaxId(contact.taxId) : '';
  const email = contact.email ? normalizeEmail(contact.email) : '';
  const phone = contact.phone ? normalizePhone(contact.phone) : '';
  const address = sanitizeDatabaseSingleLine(contact.address).slice(0, 500);
  const rawWebsite = sanitizeDatabaseSingleLine(contact.website).slice(0, 300);
  const website = rawWebsite ? (/^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`) : '';
  return {
    taxId: taxId && !taxIdError(taxId, false) ? taxId : undefined,
    email: email && !emailError(email, false) ? email : undefined,
    phone: phone && !phoneError(phone, false) ? phone : undefined,
    address: address || undefined,
    website: website || undefined,
  };
}

async function ensureSupplier(name: string, contactInput: SupplierProfileData = {}, supplierTypeHint?: 'goods', policy:ExpenseImportPolicy=expenseImportPolicyFromSettings(undefined), supplierSettings:SuppliersSettings=DEFAULT_APP_SETTINGS.suppliers): Promise<{ id: string; created: boolean }> {
  const clean = sanitizeDatabaseSingleLine(canonicalizeSupplierName(name) || name).slice(0, 120);
  const cleanKey = supplierIdentityKey(clean);
  const contact = cleanSupplierContact(contactInput);

  const { data: existing, error: findError } = await supabase
    .from('suppliers')
    .select('id,name,tax_id,email,phone,address,website,supplier_type,default_category_id');
  if (findError) throw findError;

  const alias=await resolveEntityAlias('supplier',clean);
  const aliasMatch=alias?(existing??[]).find((supplier:any)=>supplier.id===alias.targetEntityId):null;
  if(alias&&!aliasMatch){
    throw new Error(`El alias “${alias.alias}” apunta a un proveedor que ya no existe. Revísalo en Configuración.`);
  }

  const ranked = (existing ?? [])
    .map((supplier: any) => {
      const existingKey = supplierIdentityKey(supplier.name || '');
      const existingTaxId = supplier.tax_id ? normalizeTaxId(supplier.tax_id) : '';
      let score = 0;
      if (aliasMatch?.id===supplier.id) score = 200;
      else if (supplierSettings.detectDuplicates && contact.taxId && existingTaxId && contact.taxId === existingTaxId) score = 140;
      else if (supplierSettings.detectDuplicates && cleanKey && existingKey === cleanKey) score = 100;
      else if (supplierSettings.detectDuplicates && isLikelySameSupplier(clean, supplier.name || '')) score = 80;
      if(score>0 && score<supplierSettings.identityThreshold && aliasMatch?.id!==supplier.id) score = 0;
      if (score && supplier.tax_id) score += 3;
      if (score && supplier.email) score += 1;
      return { supplier, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const bestMatch = ranked[0];
  const match = bestMatch?.supplier;
  if (match?.id) {
    const patch: Record<string, string|null> = {};
    // Solo enriquecemos datos fiscales/contacto cuando la identidad es exacta
    // o coincide el propio identificador fiscal. Una coincidencia por nombre
    // abreviado sirve para reutilizar el proveedor, pero no para copiar datos
    // potencialmente pertenecientes al bloque del cliente de la factura.
    const safeToEnrich = policy.fillMissingSupplierData && (bestMatch?.score ?? 0) >= Math.max(100,supplierSettings.identityThreshold);
    const mayWrite=(current:unknown)=>!supplierSettings.onlyFillEmpty||!String(current||'').trim();
    if (safeToEnrich && supplierSettings.enrichTaxId && contact.taxId && mayWrite(match.tax_id)) patch.tax_id = contact.taxId;
    if (safeToEnrich && supplierSettings.enrichEmail && contact.email && mayWrite(match.email)) patch.email = contact.email;
    if (safeToEnrich && supplierSettings.enrichPhone && contact.phone && mayWrite(match.phone)) patch.phone = contact.phone;
    if (safeToEnrich && supplierSettings.enrichAddress && contact.address && mayWrite(match.address)) patch.address = contact.address;
    if (safeToEnrich && supplierSettings.enrichWebsite && contact.website && mayWrite(match.website)) patch.website = contact.website;
    if (!match.default_category_id && supplierSettings.defaultCategoryId) patch.default_category_id=supplierSettings.defaultCategoryId;
    if (supplierTypeHint === 'goods') {
      if (!match.supplier_type || match.supplier_type === 'unclassified') patch.supplier_type = 'goods';
      else if (match.supplier_type === 'service') patch.supplier_type = 'both';
    }
    if (Object.keys(patch).length) {
      const { error: updateError } = await supabase.from('suppliers').update(patch).eq('id', match.id);
      if (updateError) throw updateError;
    }
    return { id: match.id as string, created: false };
  }

  if(!policy.autoCreateSuppliers||!supplierSettings.autoCreate){
    throw new Error('La creación automática de proveedores está desactivada. Selecciona o crea el proveedor antes de guardar la factura.');
  }
  const createdSupplierType=supplierTypeHint==='goods'?'goods':(supplierSettings.defaultType||policy.defaultSupplierType||'unclassified');
  const { data, error } = await supabase.from('suppliers').insert({
    name: clean,
    tax_id: contact.taxId || null,
    email: contact.email || null,
    phone: contact.phone || null,
    address: contact.address || null,
    website: contact.website || null,
    supplier_type: createdSupplierType,
    default_category_id: supplierSettings.defaultCategoryId || policy.defaultCategoryId || null,
  }).select('id').single();
  if (error) throw error;
  return { id: data.id, created: true };
}

async function cleanupCreatedSupplier(supplierId: string) {
  const { count, error } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('supplier_id', supplierId);
  if (error) {
    console.warn('No se pudo comprobar si el proveedor nuevo estaba huérfano.', error);
    return;
  }
  if ((count ?? 0) !== 0) return;
  const { error: deleteError } = await supabase.from('suppliers').delete().eq('id', supplierId);
  if (deleteError) console.warn('No se pudo limpiar el proveedor huérfano creado durante la importación.', deleteError);
}

async function isMerchandiseCategory(categoryId?: string) {
  if (!categoryId) return false;
  const { data, error } = await supabase.from('expense_categories').select('name').eq('id', categoryId).maybeSingle();
  if (error) throw error;
  return Boolean(data?.name && normalizeProductKey(data.name).includes('mercancia'));
}

async function createInvoiceLinesWithProducts(invoiceId: string, supplierId: string, input: NewInvoiceInput, policy:ExpenseImportPolicy) {
  if (!input.lines?.length) return;

  const merchandise = await isMerchandiseCategory(input.categoryId);
  const manageProducts = merchandise && (policy.autoCreateProducts || policy.createSupplierProductRelation);
  const createdProductIds: string[] = [];
  const createdSupplierProductIds: string[] = [];

  const [productsResult, supplierProductsResult] = manageProducts
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
      const description = sanitizeDatabaseSingleLine(line.description).slice(0, 250);
      if (!description) continue;

      const key = normalizeProductKey(description);
      const unit = sanitizeDatabaseSingleLine(line.unit) || 'ud';
      let productId: string | null = null;
      let supplierProductId: string | null = null;

      if (manageProducts && key) {
        const supplierMatch = supplierProductByDescription.get(key);
        if (supplierMatch) {
          supplierProductId = supplierMatch.id;
          productId = supplierMatch.productId;
        } else {
          let product = productByName.get(key);
          if (!product && policy.autoCreateProducts) {
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
          if(product){
            productId = product.id;
            if(policy.createSupplierProductRelation){
              const { data: supplierProduct, error: supplierProductError } = await supabase.from('supplier_products').insert({
                supplier_id: supplierId,
                product_id: productId,
                supplier_sku: sanitizeDatabaseSingleLine(line.supplierSku) || null,
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
        }
      }

      const normalizedPrice = productId && line.unitPrice != null ? (line.normalizedUnitPrice ?? line.unitPrice) : null;
      lineRows.push({
        invoice_id: invoiceId,
        product_id: productId,
        supplier_product_id: supplierProductId,
        description,
        supplier_sku: sanitizeDatabaseSingleLine(line.supplierSku) || null,
        quantity: line.quantity || 1,
        unit,
        unit_price: line.unitPrice ?? null,
        normalized_unit_price: normalizedPrice,
        line_net: line.lineNet ?? line.lineTotal ?? null,
        tax_rate: line.taxRate ?? null,
        tax_amount: line.taxAmount ?? null,
        line_total: line.lineTotal ?? null,
        price_update_status: normalizedPrice != null && policy.updateProductCosts && policy.updatePriceHistory ? 'confirmed' : normalizedPrice != null ? 'ignored' : 'pending',
      });
    }

    if (!lineRows.length) return;
    const { data:insertedLines,error: lineError } = await supabase.from('invoice_lines').insert(lineRows).select('id,product_id,unit_price,normalized_unit_price,unit');
    if (lineError) throw lineError;

    const priced=(insertedLines??[]).filter((line:any)=>line.product_id&&line.normalized_unit_price!=null);
    if(policy.updateProductCosts&&!policy.updatePriceHistory){
      for(const line of priced as any[]){
        const {data:product,error:readError}=await supabase.from('products').select('last_cost,base_unit').eq('id',line.product_id).single();
        if(readError)throw readError;
        const nextCost=Number(line.normalized_unit_price);
        const oldCost=product?.last_cost==null?null:Number(product.last_cost);
        const {error:updateError}=await supabase.from('products').update({
          previous_cost:oldCost!=null&&oldCost!==nextCost?oldCost:null,
          last_cost:nextCost,
          cost_unit:product?.base_unit||line.unit||'ud',
          last_supplier_id:supplierId,
          last_purchase_date:input.invoiceDate||new Date().toISOString().slice(0,10),
        }).eq('id',line.product_id);
        if(updateError)throw updateError;
      }
    }else if(policy.updatePriceHistory&&!policy.updateProductCosts){
      for(const line of priced as any[]){
        const {data:product,error:readError}=await supabase.from('products').select('base_unit').eq('id',line.product_id).single();
        if(readError)throw readError;
        const {error:historyError}=await supabase.from('product_price_history').upsert({
          product_id:line.product_id,
          supplier_id:supplierId,
          invoice_id:invoiceId,
          invoice_line_id:line.id,
          price_date:input.invoiceDate||new Date().toISOString().slice(0,10),
          purchase_unit_price:line.unit_price,
          normalized_unit_price:line.normalized_unit_price,
          base_unit:product?.base_unit||line.unit||'ud',
          currency:'EUR',
        },{onConflict:'invoice_line_id'});
        if(historyError)throw historyError;
      }
    }
  } catch (error) {
    if (createdSupplierProductIds.length) await supabase.from('supplier_products').delete().in('id', createdSupplierProductIds);
    if (createdProductIds.length) await supabase.from('products').delete().in('id', createdProductIds);
    throw error;
  }
}

export async function createInvoice(input: NewInvoiceInput) {
  const loadedSettings=await loadAppSettings();
  const policy=expenseImportPolicyFromSettings(loadedSettings.settings.expenses);
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Sesión no válida.');

  const fileHash = await sha256(input.file);
  if(policy.detectDuplicates){
    const { data: duplicates, error: duplicateError } = await supabase.from('invoices').select('id, invoice_number').eq('file_hash', fileHash).limit(1);
    if (duplicateError) throw duplicateError;
    if (duplicates?.length&&policy.blockHighConfidenceDuplicates) throw new Error(`Esta factura parece estar subida ya (${duplicates[0].invoice_number || 'sin número'}).`);
  }

  const repairedAmounts = repairInvoiceAmounts(input.ocrText || '', { subtotal: input.subtotal, vat: input.vat, total: input.total });
  const preparedInput: NewInvoiceInput = {
    ...input,
    ...repairedAmounts,
    categoryId:input.categoryId||policy.defaultCategoryId||undefined,
    lines: repairInvoiceProductLines(input.ocrText || '', input.lines || []),
  };
  const extractedContact = input.ocrText ? extractSupplierContactData(input.ocrText, input.supplierName) : {};
  const extractedDetails = input.ocrText ? extractSupplierInvoiceDetails(input.ocrText, input.supplierName) : {};
  const merchandiseSupplier = await isMerchandiseCategory(preparedInput.categoryId);
  const supplierResult = await ensureSupplier(input.supplierName, {
    taxId: input.supplierTaxId || extractedContact.taxId || extractedDetails.taxId,
    email: input.supplierEmail || extractedContact.email,
    phone: input.supplierPhone || extractedContact.phone,
    address: input.supplierAddress || extractedDetails.address,
    website: input.supplierWebsite || extractedDetails.website,
  }, merchandiseSupplier ? 'goods' : undefined, policy, loadedSettings.settings.suppliers);
  const supplierId = supplierResult.id;
  const year = input.invoiceDate ? new Date(`${input.invoiceDate}T12:00:00`).getFullYear() : new Date().getFullYear();
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100);
  const storagePath = `${user.id}/${year}/${crypto.randomUUID()}-${safeName}`;
  const { error: storageError } = await supabase.storage.from(INVOICE_BUCKET).upload(storagePath, input.file, {
    contentType: input.file.type || 'application/pdf',
    upsert: false,
  });
  if (storageError) {
    if (supplierResult.created) await cleanupCreatedSupplier(supplierId);
    throw storageError;
  }

  const { data: invoice, error } = await supabase.from('invoices').insert({
    supplier_id: supplierId,
    invoice_number: sanitizeDatabaseSingleLine(input.invoiceNumber) || null,
    issue_date: input.invoiceDate || null,
    expense_category_id: preparedInput.categoryId || null,
    net_amount: preparedInput.subtotal,
    tax_amount: preparedInput.vat,
    equivalence_surcharge_amount: preparedInput.equivalenceSurcharge ?? 0,
    withholding_amount: input.withholding,
    total_amount: preparedInput.total,
    source: input.source,
    status: policy.initialStatus,
    file_path: storagePath,
    file_name: sanitizeDatabaseSingleLine(input.file.name),
    mime_type: input.file.type || 'application/pdf',
    file_hash: fileHash,
    ocr_text: sanitizeDatabaseText(input.ocrText) || null,
    extraction: sanitizeDatabaseValue({
      ...(input.extraction ?? {}),
      supplierTaxId: input.supplierTaxId || extractedContact.taxId || extractedDetails.taxId || null,
      supplierEmail: input.supplierEmail || extractedContact.email || null,
      supplierPhone: input.supplierPhone || extractedContact.phone || null,
      supplierAddress: input.supplierAddress || extractedDetails.address || null,
      supplierWebsite: input.supplierWebsite || extractedDetails.website || null,
      equivalenceSurcharge: preparedInput.equivalenceSurcharge ?? 0,
      normalizedLineCount: preparedInput.lines?.length || 0,
    }),
    extraction_confidence: input.extractionConfidence ?? null,
  }).select('id').single();

  if (error) {
    await supabase.storage.from(INVOICE_BUCKET).remove([storagePath]);
    if (supplierResult.created) await cleanupCreatedSupplier(supplierId);
    throw error;
  }

  try {
    await createInvoiceLinesWithProducts(invoice.id, supplierId, preparedInput, policy);
  } catch (lineError) {
    await supabase.from('invoices').delete().eq('id', invoice.id);
    await supabase.storage.from(INVOICE_BUCKET).remove([storagePath]);
    if (supplierResult.created) await cleanupCreatedSupplier(supplierId);
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
    name: sanitizeDatabaseSingleLine(input.name),
    sku: sanitizeDatabaseSingleLine(input.sku) || null,
    category: sanitizeDatabaseSingleLine(input.category) || null,
    base_unit: sanitizeDatabaseSingleLine(input.unit) || 'ud',
  });
  if (error) throw error;
}

export async function updateProduct(productId: string, input: { name: string; sku?: string; category?: string; unit: string }) {
  const { error } = await supabase.from('products').update({
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    category: input.category?.trim() || null,
    base_unit: input.unit.trim() || 'ud',
  }).eq('id', productId);
  if (error) throw error;
}

export async function deleteProduct(productId: string) {
  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) throw error;
}

type SupplierInput = { name: string; taxId?: string; email?: string; phone?: string; address?: string; website?: string; supplierType: 'unclassified' | 'goods' | 'service' | 'both' };

export async function addSupplier(input: SupplierInput) {
  const { error } = await supabase.from('suppliers').insert({
    name: sanitizeDatabaseSingleLine(input.name),
    tax_id: sanitizeDatabaseSingleLine(input.taxId) || null,
    email: sanitizeDatabaseSingleLine(input.email) || null,
    phone: sanitizeDatabaseSingleLine(input.phone) || null,
    address: sanitizeDatabaseSingleLine(input.address) || null,
    website: sanitizeDatabaseSingleLine(input.website) || null,
    supplier_type: input.supplierType,
  });
  if (error) throw error;
}

export async function updateSupplier(supplierId: string, input: SupplierInput) {
  const { error } = await supabase.from('suppliers').update({
    name: input.name.trim(),
    tax_id: input.taxId?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    website: input.website?.trim() || null,
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
