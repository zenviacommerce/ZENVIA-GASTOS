import jsPDF from 'jspdf';
import { supabase } from './supabase';

export type Client = {
  id: string;
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  countryCode: string;
  paymentTermsDays: number;
  notes?: string | null;
};

export type ClientInput = Omit<Client, 'id'>;

export type BusinessSettings = {
  legalName: string;
  tradeName?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  countryCode: string;
  email?: string | null;
  phone?: string | null;
  iban?: string | null;
  invoiceFooter?: string | null;
};

export type SalesInvoiceSeries = {
  id: string;
  code: string;
  name: string;
  kind: 'standard' | 'rectifying';
  year: number;
  prefix: string;
  nextNumber: number;
  padding: number;
};

export type SalesInvoiceLine = {
  id?: string;
  productId?: string | null;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  lineNet?: number;
  taxAmount?: number;
  lineTotal?: number;
};

export type SalesPayment = {
  id: string;
  paymentDate: string;
  amount: number;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
};

export type SalesInvoiceStatus = 'draft' | 'issued' | 'sent' | 'partially_paid' | 'paid' | 'rectified';

export type SalesInvoice = {
  id: string;
  clientId: string;
  clientName: string;
  seriesId: string;
  seriesName: string;
  invoiceType: 'standard' | 'rectifying';
  rectifiesInvoiceId?: string | null;
  invoiceNumber?: string | null;
  status: SalesInvoiceStatus;
  issueDate: string;
  operationDate?: string | null;
  dueDate?: string | null;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod?: string | null;
  notes?: string | null;
  clientTaxId?: string | null;
  clientEmail?: string | null;
  clientAddress?: string | null;
  issuerName?: string | null;
  issuerTaxId?: string | null;
  issuerEmail?: string | null;
  issuerAddress?: string | null;
  issuedAt?: string | null;
  sentAt?: string | null;
  paidAt?: string | null;
  lines: SalesInvoiceLine[];
  payments: SalesPayment[];
  paidAmount: number;
};

export type SalesInvoiceDraftInput = {
  clientId: string;
  seriesId: string;
  issueDate: string;
  operationDate?: string;
  dueDate?: string;
  paymentMethod?: string;
  notes?: string;
  lines: SalesInvoiceLine[];
};

const n = (value: unknown) => Number(value ?? 0) || 0;
const nullable = (value?: string | null) => value?.trim() || null;

export async function loadClients(): Promise<Client[]> {
  const { data, error } = await supabase.from('clients').select('*').eq('active', true).order('name');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    taxId: row.tax_id,
    email: row.email,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    postalCode: row.postal_code,
    city: row.city,
    province: row.province,
    countryCode: row.country_code || 'ES',
    paymentTermsDays: Number(row.payment_terms_days || 0),
    notes: row.notes,
  }));
}

function clientRow(input: ClientInput) {
  return {
    name: input.name.trim(),
    tax_id: nullable(input.taxId),
    email: nullable(input.email)?.toLowerCase() || null,
    phone: nullable(input.phone),
    address_line1: nullable(input.addressLine1),
    address_line2: nullable(input.addressLine2),
    postal_code: nullable(input.postalCode),
    city: nullable(input.city),
    province: nullable(input.province),
    country_code: (input.countryCode || 'ES').trim().toUpperCase().slice(0, 2),
    payment_terms_days: Math.max(0, Math.round(input.paymentTermsDays || 0)),
    notes: nullable(input.notes),
  };
}

export async function addClient(input: ClientInput) {
  const { error } = await supabase.from('clients').insert(clientRow(input));
  if (error) throw error;
}

export async function updateClient(id: string, input: ClientInput) {
  const { error } = await supabase.from('clients').update(clientRow(input)).eq('id', id);
  if (error) throw error;
}

export async function deleteClient(id: string) {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') throw new Error('Este cliente tiene facturas asociadas y no se puede eliminar. Puedes dejarlo registrado y reutilizarlo.');
    throw error;
  }
}

export async function loadBusinessSettings(): Promise<BusinessSettings> {
  const { data, error } = await supabase.from('business_settings').select('*').maybeSingle();
  if (error) throw error;
  return {
    legalName: data?.legal_name || 'ZENVIA COMMERCE SL',
    tradeName: data?.trade_name || 'ZENVIA',
    taxId: data?.tax_id || '',
    addressLine1: data?.address_line1 || '',
    addressLine2: data?.address_line2 || '',
    postalCode: data?.postal_code || '',
    city: data?.city || '',
    province: data?.province || '',
    countryCode: data?.country_code || 'ES',
    email: data?.email || '',
    phone: data?.phone || '',
    iban: data?.iban || '',
    invoiceFooter: data?.invoice_footer || '',
  };
}

export async function saveBusinessSettings(input: BusinessSettings) {
  const row = {
    legal_name: input.legalName.trim(),
    trade_name: nullable(input.tradeName),
    tax_id: nullable(input.taxId),
    address_line1: nullable(input.addressLine1),
    address_line2: nullable(input.addressLine2),
    postal_code: nullable(input.postalCode),
    city: nullable(input.city),
    province: nullable(input.province),
    country_code: (input.countryCode || 'ES').trim().toUpperCase().slice(0, 2),
    email: nullable(input.email)?.toLowerCase() || null,
    phone: nullable(input.phone),
    iban: nullable(input.iban),
    invoice_footer: nullable(input.invoiceFooter),
  };
  const { data: existing, error: findError } = await supabase.from('business_settings').select('owner_id').maybeSingle();
  if (findError) throw findError;
  const result = existing
    ? await supabase.from('business_settings').update(row).eq('owner_id', existing.owner_id)
    : await supabase.from('business_settings').insert(row);
  if (result.error) throw result.error;
}

export async function ensureSalesSeries(year: number): Promise<SalesInvoiceSeries[]> {
  const { data: current, error } = await supabase.from('sales_invoice_series').select('*').eq('year', year).eq('active', true).order('code');
  if (error) throw error;
  const rows = current ?? [];
  const missing: Record<string, unknown>[] = [];
  if (!rows.some((row: any) => row.kind === 'standard')) missing.push({ code: 'F', name: `Facturas ${year}`, kind: 'standard', year, prefix: `F-${year}-`, next_number: 1, padding: 4 });
  if (!rows.some((row: any) => row.kind === 'rectifying')) missing.push({ code: 'R', name: `Rectificativas ${year}`, kind: 'rectifying', year, prefix: `R-${year}-`, next_number: 1, padding: 4 });
  if (missing.length) {
    const { error: insertError } = await supabase.from('sales_invoice_series').insert(missing);
    if (insertError && insertError.code !== '23505') throw insertError;
  }
  const { data, error: reloadError } = await supabase.from('sales_invoice_series').select('*').eq('year', year).eq('active', true).order('code');
  if (reloadError) throw reloadError;
  return (data ?? []).map((row: any) => ({ id: row.id, code: row.code, name: row.name, kind: row.kind, year: row.year, prefix: row.prefix, nextNumber: row.next_number, padding: row.padding }));
}

export async function loadSalesInvoices(): Promise<SalesInvoice[]> {
  const [invoiceResult, lineResult, paymentResult, clientResult, seriesResult] = await Promise.all([
    supabase.from('sales_invoices').select('*').order('issue_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('sales_invoice_lines').select('*').order('position'),
    supabase.from('sales_payments').select('*').order('payment_date'),
    supabase.from('clients').select('id,name'),
    supabase.from('sales_invoice_series').select('id,name'),
  ]);
  for (const result of [invoiceResult, lineResult, paymentResult, clientResult, seriesResult]) if (result.error) throw result.error;

  const clients = new Map((clientResult.data ?? []).map((row: any) => [row.id, row.name]));
  const series = new Map((seriesResult.data ?? []).map((row: any) => [row.id, row.name]));
  const lines = new Map<string, SalesInvoiceLine[]>();
  for (const row of lineResult.data ?? []) {
    const bucket = lines.get(row.invoice_id) ?? [];
    bucket.push({ id: row.id, productId: row.product_id, position: row.position, description: row.description, quantity: n(row.quantity), unit: row.unit || 'ud', unitPrice: n(row.unit_price), discountPercent: n(row.discount_percent), taxRate: n(row.tax_rate), lineNet: n(row.line_net), taxAmount: n(row.tax_amount), lineTotal: n(row.line_total) });
    lines.set(row.invoice_id, bucket);
  }
  const payments = new Map<string, SalesPayment[]>();
  for (const row of paymentResult.data ?? []) {
    const bucket = payments.get(row.invoice_id) ?? [];
    bucket.push({ id: row.id, paymentDate: row.payment_date, amount: n(row.amount), method: row.method, reference: row.reference, notes: row.notes });
    payments.set(row.invoice_id, bucket);
  }

  return (invoiceResult.data ?? []).map((row: any) => {
    const invoicePayments = payments.get(row.id) ?? [];
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name || clients.get(row.client_id) || 'Cliente',
      seriesId: row.series_id,
      seriesName: series.get(row.series_id) || 'Serie',
      invoiceType: row.invoice_type,
      rectifiesInvoiceId: row.rectifies_invoice_id,
      invoiceNumber: row.invoice_number,
      status: row.status,
      issueDate: row.issue_date,
      operationDate: row.operation_date,
      dueDate: row.due_date,
      currency: row.currency || 'EUR',
      subtotal: n(row.subtotal),
      discountAmount: n(row.discount_amount),
      taxAmount: n(row.tax_amount),
      totalAmount: n(row.total_amount),
      paymentMethod: row.payment_method,
      notes: row.notes,
      clientTaxId: row.client_tax_id,
      clientEmail: row.client_email,
      clientAddress: row.client_address,
      issuerName: row.issuer_name,
      issuerTaxId: row.issuer_tax_id,
      issuerEmail: row.issuer_email,
      issuerAddress: row.issuer_address,
      issuedAt: row.issued_at,
      sentAt: row.sent_at,
      paidAt: row.paid_at,
      lines: lines.get(row.id) ?? [],
      payments: invoicePayments,
      paidAmount: invoicePayments.reduce((sum, payment) => sum + payment.amount, 0),
    } satisfies SalesInvoice;
  });
}

function invoiceRow(input: SalesInvoiceDraftInput) {
  return {
    client_id: input.clientId,
    series_id: input.seriesId,
    issue_date: input.issueDate,
    operation_date: nullable(input.operationDate),
    due_date: nullable(input.dueDate),
    payment_method: nullable(input.paymentMethod),
    notes: nullable(input.notes),
  };
}

function lineRows(invoiceId: string, lines: SalesInvoiceLine[]) {
  return lines.map((line, index) => ({
    invoice_id: invoiceId,
    product_id: line.productId || null,
    position: index + 1,
    description: line.description.trim(),
    quantity: line.quantity,
    unit: line.unit.trim() || 'ud',
    unit_price: line.unitPrice,
    discount_percent: line.discountPercent || 0,
    tax_rate: line.taxRate,
  }));
}

export async function createSalesInvoiceDraft(input: SalesInvoiceDraftInput) {
  const { data: invoice, error } = await supabase.from('sales_invoices').insert(invoiceRow(input)).select('id').single();
  if (error) throw error;
  const rows = lineRows(invoice.id, input.lines).filter(row => row.description);
  if (rows.length) {
    const { error: lineError } = await supabase.from('sales_invoice_lines').insert(rows);
    if (lineError) {
      await supabase.from('sales_invoices').delete().eq('id', invoice.id);
      throw lineError;
    }
  }
  return invoice.id as string;
}

export async function updateSalesInvoiceDraft(id: string, input: SalesInvoiceDraftInput) {
  const { error } = await supabase.from('sales_invoices').update(invoiceRow(input)).eq('id', id).eq('status', 'draft');
  if (error) throw error;
  const { error: deleteError } = await supabase.from('sales_invoice_lines').delete().eq('invoice_id', id);
  if (deleteError) throw deleteError;
  const rows = lineRows(id, input.lines).filter(row => row.description);
  if (rows.length) {
    const { error: lineError } = await supabase.from('sales_invoice_lines').insert(rows);
    if (lineError) throw lineError;
  }
}

export async function deleteSalesInvoiceDraft(id: string) {
  const { error } = await supabase.from('sales_invoices').delete().eq('id', id).eq('status', 'draft');
  if (error) throw error;
}

export async function issueSalesInvoice(id: string) {
  const { data, error } = await supabase.rpc('issue_sales_invoice', { p_invoice_id: id });
  if (error) throw error;
  return data;
}

export async function markSalesInvoiceSent(id: string) {
  const { error } = await supabase.from('sales_invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id).in('status', ['issued','sent']);
  if (error) throw error;
}

export async function addSalesPayment(invoiceId: string, input: { amount: number; paymentDate: string; method?: string; reference?: string; notes?: string }) {
  const { error } = await supabase.from('sales_payments').insert({
    invoice_id: invoiceId,
    amount: input.amount,
    payment_date: input.paymentDate,
    method: nullable(input.method),
    reference: nullable(input.reference),
    notes: nullable(input.notes),
  });
  if (error) throw error;
}

const money = (value: number) => `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function downloadSalesInvoicePdf(invoice: SalesInvoice, settings?: BusinessSettings | null) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const issuerName = invoice.issuerName || settings?.legalName || 'ZENVIA COMMERCE SL';
  const issuerTaxId = invoice.issuerTaxId || settings?.taxId || '';
  const issuerAddress = invoice.issuerAddress || [settings?.addressLine1, settings?.addressLine2, [settings?.postalCode, settings?.city].filter(Boolean).join(' '), settings?.province, settings?.countryCode].filter(Boolean).join(', ');
  const client = invoice.clientName;
  const number = invoice.invoiceNumber || 'BORRADOR';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('FACTURA', 14, 18);
  doc.setFontSize(11);
  doc.text(number, 14, 25);
  doc.setFont('helvetica', 'normal');
  doc.text(`Fecha: ${new Date(`${invoice.issueDate}T12:00:00`).toLocaleDateString('es-ES')}`, 14, 31);
  if (invoice.dueDate) doc.text(`Vencimiento: ${new Date(`${invoice.dueDate}T12:00:00`).toLocaleDateString('es-ES')}`, 14, 37);

  doc.setFont('helvetica', 'bold');
  doc.text(issuerName, 120, 18);
  doc.setFont('helvetica', 'normal');
  if (issuerTaxId) doc.text(`NIF/CIF: ${issuerTaxId}`, 120, 24);
  const issuerLines = doc.splitTextToSize(issuerAddress || '', 74);
  if (issuerLines.length) doc.text(issuerLines, 120, 30);

  const blockY = Math.max(52, 30 + issuerLines.length * 5);
  doc.setDrawColor(210);
  doc.line(14, blockY - 5, 196, blockY - 5);
  doc.setFont('helvetica', 'bold');
  doc.text('FACTURAR A', 14, blockY);
  doc.setFont('helvetica', 'normal');
  doc.text(client, 14, blockY + 7);
  if (invoice.clientTaxId) doc.text(`NIF/CIF: ${invoice.clientTaxId}`, 14, blockY + 13);
  const clientAddress = doc.splitTextToSize(invoice.clientAddress || '', 85);
  if (clientAddress.length) doc.text(clientAddress, 14, blockY + 19);

  let y = blockY + 35 + Math.max(0, clientAddress.length - 1) * 5;
  doc.setFillColor(245,245,245);
  doc.rect(14, y - 5, 182, 8, 'F');
  doc.setFont('helvetica','bold');
  doc.setFontSize(9);
  doc.text('Descripción', 16, y);
  doc.text('Cant.', 112, y, { align: 'right' });
  doc.text('Precio', 135, y, { align: 'right' });
  doc.text('IVA', 153, y, { align: 'right' });
  doc.text('Total', 194, y, { align: 'right' });
  y += 7;
  doc.setFont('helvetica','normal');

  for (const line of invoice.lines) {
    if (y > 270) { doc.addPage(); y = 20; }
    const description = doc.splitTextToSize(line.description, 85);
    doc.text(description, 16, y);
    doc.text(line.quantity.toLocaleString('es-ES'), 112, y, { align: 'right' });
    doc.text(money(line.unitPrice), 135, y, { align: 'right' });
    doc.text(`${line.taxRate.toLocaleString('es-ES')} %`, 153, y, { align: 'right' });
    doc.text(money(line.lineTotal ?? 0), 194, y, { align: 'right' });
    y += Math.max(7, description.length * 4.5 + 2);
  }

  y = Math.min(275, y + 4);
  doc.line(115, y, 196, y);
  y += 7;
  doc.text(`Base imponible:`, 150, y, { align: 'right' });
  doc.text(money(invoice.subtotal), 194, y, { align: 'right' });
  y += 6;
  if (invoice.discountAmount > 0) {
    doc.text(`Descuentos:`, 150, y, { align: 'right' });
    doc.text(`-${money(invoice.discountAmount)}`, 194, y, { align: 'right' });
    y += 6;
  }
  doc.text(`IVA:`, 150, y, { align: 'right' });
  doc.text(money(invoice.taxAmount), 194, y, { align: 'right' });
  y += 7;
  doc.setFont('helvetica','bold');
  doc.setFontSize(12);
  doc.text('TOTAL:', 150, y, { align: 'right' });
  doc.text(money(invoice.totalAmount), 194, y, { align: 'right' });

  doc.setFont('helvetica','normal');
  doc.setFontSize(9);
  let footerY = 286;
  if (invoice.paymentMethod) doc.text(`Forma de pago: ${invoice.paymentMethod}`, 14, footerY);
  if (settings?.iban) doc.text(`IBAN: ${settings.iban}`, 14, footerY + 5);
  if (settings?.invoiceFooter) doc.text(doc.splitTextToSize(settings.invoiceFooter, 180), 14, footerY + 10);

  doc.save(`${number.replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`);
}
