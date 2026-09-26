import { supabase } from './supabase';
import { sanitizeDatabaseSingleLine, sanitizeDatabaseText } from './textSanitizer';
import { defaultSalesDueDate } from './salesDefaults';
import { DEFAULT_APP_SETTINGS } from './settingsSchema';
export { defaultSalesDueDate, resolveSalesDueDays } from './salesDefaults';

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
  defaultVatRate?: number | null;
  defaultPaymentMethod?: string | null;
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
  website?: string | null;
  iban?: string | null;
  invoiceFooter?: string | null;
};

export type SalesInvoiceSeries = {
  id: string;
  code: string;
  name: string;
  kind: 'standard' | 'rectifying' | 'receipt';
  year: number;
  prefix: string;
  nextNumber: number;
  padding: number;
  active?: boolean;
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
  taxRegistrationId?: string | null;
  taxRegistrationLabel?: string | null;
  taxRegistrationCountryCode?: string | null;
  invoiceType: 'standard' | 'rectifying';
  documentKind: 'invoice' | 'receipt';
  fiscalTreatment: 'taxable' | 'exempt' | 'non_taxable' | 'out_of_scope';
  fiscalReason?: string | null;
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
  clientPhone?: string | null;
  clientAddress?: string | null;
  issuerName?: string | null;
  issuerTaxId?: string | null;
  issuerEmail?: string | null;
  issuerPhone?: string | null;
  issuerAddress?: string | null;
  issuerTaxCountryCode?: string | null;
  issuerTaxRegistrationLabel?: string | null;
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
  taxRegistrationId?: string | null;
  issueDate: string;
  operationDate?: string;
  dueDate?: string;
  currency?: string;
  paymentMethod?: string;
  notes?: string;
  lines: SalesInvoiceLine[];
};

const n=(value:unknown)=>Number(value??0)||0;
const nullable=(value?:string|null)=>{const cleaned=sanitizeDatabaseText(value).trim();return cleaned||null;};
const addressFrom=(row:any)=>[row?.address_line1,row?.address_line2,[row?.postal_code,row?.city].filter(Boolean).join(' '),row?.province,row?.country_code].filter(Boolean).join(', ');
export async function loadClients():Promise<Client[]> {
  const {data,error}=await supabase.from('clients').select('*').eq('active',true).order('name');
  if(error)throw error;
  return (data??[]).map((row:any)=>({id:row.id,name:row.name,taxId:row.tax_id,email:row.email,phone:row.phone,addressLine1:row.address_line1,addressLine2:row.address_line2,postalCode:row.postal_code,city:row.city,province:row.province,countryCode:row.country_code||'ES',paymentTermsDays:Number(row.payment_terms_days||0),defaultVatRate:row.default_vat_rate==null?null:Number(row.default_vat_rate),defaultPaymentMethod:row.default_payment_method||null,notes:row.notes}));
}

function clientRow(input:ClientInput){
  return {name:sanitizeDatabaseSingleLine(input.name),tax_id:nullable(input.taxId),email:nullable(input.email)?.toLowerCase()||null,phone:nullable(input.phone),address_line1:nullable(input.addressLine1),address_line2:nullable(input.addressLine2),postal_code:nullable(input.postalCode),city:nullable(input.city),province:nullable(input.province),country_code:sanitizeDatabaseSingleLine(input.countryCode||'ES').toUpperCase().slice(0,2),payment_terms_days:Math.max(0,Math.round(input.paymentTermsDays||0)),default_vat_rate:input.defaultVatRate==null?null:Math.min(100,Math.max(0,Number(input.defaultVatRate))),default_payment_method:nullable(input.defaultPaymentMethod),notes:nullable(input.notes)};
}

export async function addClient(input:ClientInput){const {data,error}=await supabase.from('clients').insert(clientRow(input)).select('id').single();if(error)throw error;return data.id as string;}
export async function updateClient(id:string,input:ClientInput){const {error}=await supabase.from('clients').update(clientRow(input)).eq('id',id);if(error)throw error;}
export async function deleteClient(id:string){const {error}=await supabase.from('clients').delete().eq('id',id);if(error){if(error.code==='23503')throw new Error('Este cliente tiene facturas asociadas y no se puede eliminar. Puedes dejarlo registrado y reutilizarlo.');throw error;}}
export async function deleteClientIfUnused(id:string){const {count,error}=await supabase.from('sales_invoices').select('id',{count:'exact',head:true}).eq('client_id',id);if(error)throw error;if((count||0)>0)return false;const {error:deleteError}=await supabase.from('clients').delete().eq('id',id);if(deleteError){if(deleteError.code==='23503')return false;throw deleteError;}return true;}

export async function loadBusinessSettings():Promise<BusinessSettings>{
  const {data,error}=await supabase.from('business_settings').select('*').maybeSingle();if(error)throw error;
  return {legalName:data?.legal_name||'ZENVIA COMMERCE SL',tradeName:data?.trade_name||'ZENVIA',taxId:data?.tax_id||'',addressLine1:data?.address_line1||'',addressLine2:data?.address_line2||'',postalCode:data?.postal_code||'',city:data?.city||'',province:data?.province||'',countryCode:data?.country_code||'ES',email:data?.email||'',phone:data?.phone||'',website:data?.website||'',iban:data?.iban||'',invoiceFooter:data?.invoice_footer||''};
}

export async function saveBusinessSettings(input:BusinessSettings){
  const row={legal_name:input.legalName.trim(),trade_name:nullable(input.tradeName),tax_id:nullable(input.taxId),address_line1:nullable(input.addressLine1),address_line2:nullable(input.addressLine2),postal_code:nullable(input.postalCode),city:nullable(input.city),province:nullable(input.province),country_code:(input.countryCode||'ES').trim().toUpperCase().slice(0,2),email:nullable(input.email)?.toLowerCase()||null,phone:nullable(input.phone),website:nullable(input.website),iban:nullable(input.iban),invoice_footer:nullable(input.invoiceFooter)};
  const {data:existing,error:findError}=await supabase.from('business_settings').select('owner_id').maybeSingle();if(findError)throw findError;
  const result=existing?await supabase.from('business_settings').update(row).eq('owner_id',existing.owner_id):await supabase.from('business_settings').insert(row);if(result.error)throw result.error;
}

const mapSeries=(row:any):SalesInvoiceSeries=>({id:row.id,code:row.code,name:row.name,kind:row.kind,year:row.year,prefix:row.prefix,nextNumber:Number(row.next_number),padding:Number(row.padding),active:Boolean(row.active)});

export async function ensureSalesSeries(year:number):Promise<SalesInvoiceSeries[]>{
  const {data:current,error}=await supabase.from('sales_invoice_series').select('*').eq('year',year).eq('active',true).order('code');if(error)throw error;
  const rows=current??[];const missing:Record<string,unknown>[]=[];
  if(!rows.some((row:any)=>row.kind==='standard'))missing.push({code:'F',name:`Facturas ${year}`,kind:'standard',year,prefix:`F-${year}-`,next_number:1,padding:4});
  if(!rows.some((row:any)=>row.kind==='rectifying'))missing.push({code:'R',name:`Rectificativas ${year}`,kind:'rectifying',year,prefix:`R-${year}-`,next_number:1,padding:4});
  if(!rows.some((row:any)=>row.kind==='receipt'))missing.push({code:'REC',name:`Recibos ${year}`,kind:'receipt',year,prefix:`REC-${year}-`,next_number:1,padding:4});
  if(missing.length){const {error:insertError}=await supabase.from('sales_invoice_series').insert(missing);if(insertError&&insertError.code!=='23505')throw insertError;}
  const {data,error:reloadError}=await supabase.from('sales_invoice_series').select('*').eq('year',year).eq('active',true).order('code');if(reloadError)throw reloadError;return (data??[]).map(mapSeries);
}

export async function loadSalesInvoices():Promise<SalesInvoice[]>{
  const [invoiceResult,lineResult,paymentResult,clientResult,seriesResult,taxResult]=await Promise.all([
    supabase.from('sales_invoices').select('*').order('issue_date',{ascending:false}).order('created_at',{ascending:false}),
    supabase.from('sales_invoice_lines').select('*').order('position'),
    supabase.from('sales_payments').select('*').order('payment_date'),
    supabase.from('clients').select('id,name,tax_id,email,phone,address_line1,address_line2,postal_code,city,province,country_code'),
    supabase.from('sales_invoice_series').select('id,name'),
    supabase.from('business_tax_registrations').select('id,label,country_code,vat_number,fiscal_name,address_text,is_default,active'),
  ]);
  for(const result of [invoiceResult,lineResult,paymentResult,clientResult,seriesResult,taxResult])if(result.error)throw result.error;
  const clients=new Map((clientResult.data??[]).map((row:any)=>[row.id,row]));
  const series=new Map((seriesResult.data??[]).map((row:any)=>[row.id,row.name]));
  const taxRegs=new Map((taxResult.data??[]).map((row:any)=>[row.id,row]));
  const defaultTax=(taxResult.data??[]).find((row:any)=>row.is_default&&row.active)??null;
  const lines=new Map<string,SalesInvoiceLine[]>();
  for(const row of lineResult.data??[]){const bucket=lines.get(row.invoice_id)??[];bucket.push({id:row.id,productId:row.product_id,position:row.position,description:row.description,quantity:n(row.quantity),unit:row.unit||'ud',unitPrice:n(row.unit_price),discountPercent:n(row.discount_percent),taxRate:n(row.tax_rate),lineNet:n(row.line_net),taxAmount:n(row.tax_amount),lineTotal:n(row.line_total)});lines.set(row.invoice_id,bucket);}
  const payments=new Map<string,SalesPayment[]>();
  for(const row of paymentResult.data??[]){const bucket=payments.get(row.invoice_id)??[];bucket.push({id:row.id,paymentDate:row.payment_date,amount:n(row.amount),method:row.method,reference:row.reference,notes:row.notes});payments.set(row.invoice_id,bucket);}
  return (invoiceResult.data??[]).map((row:any)=>{
    const liveClient:any=clients.get(row.client_id);const tax:any=taxRegs.get(row.tax_registration_id)||defaultTax;const draft=row.status==='draft';const invoicePayments=payments.get(row.id)??[];
    return {id:row.id,clientId:row.client_id,clientName:row.client_name||liveClient?.name||'Cliente',seriesId:row.series_id,seriesName:series.get(row.series_id)||'Serie',taxRegistrationId:row.tax_registration_id||tax?.id||null,taxRegistrationLabel:row.issuer_tax_registration_label||tax?.label||null,taxRegistrationCountryCode:row.issuer_tax_country_code||tax?.country_code||null,invoiceType:row.invoice_type,documentKind:row.document_kind||'invoice',fiscalTreatment:row.fiscal_treatment||'taxable',fiscalReason:row.fiscal_reason||null,rectifiesInvoiceId:row.rectifies_invoice_id,invoiceNumber:row.invoice_number,status:row.status,issueDate:row.issue_date,operationDate:row.operation_date,dueDate:row.due_date,currency:row.currency||DEFAULT_APP_SETTINGS.general.currencyCode,subtotal:n(row.subtotal),discountAmount:n(row.discount_amount),taxAmount:n(row.tax_amount),totalAmount:n(row.total_amount),paymentMethod:row.payment_method,notes:row.notes,
      clientTaxId:row.client_tax_id||(draft?liveClient?.tax_id:null),clientEmail:row.client_email||(draft?liveClient?.email:null),clientPhone:row.client_phone||(draft?liveClient?.phone:null),clientAddress:row.client_address||(draft?addressFrom(liveClient):null),
      issuerName:row.issuer_name||(draft?tax?.fiscal_name:null),issuerTaxId:row.issuer_tax_id||(draft?tax?.vat_number:null),issuerEmail:row.issuer_email,issuerPhone:row.issuer_phone,issuerAddress:row.issuer_address||(draft?tax?.address_text:null),issuerTaxCountryCode:row.issuer_tax_country_code||(draft?tax?.country_code:null),issuerTaxRegistrationLabel:row.issuer_tax_registration_label||(draft?tax?.label:null),issuedAt:row.issued_at,sentAt:row.sent_at,paidAt:row.paid_at,lines:lines.get(row.id)??[],payments:invoicePayments,paidAmount:invoicePayments.reduce((sum,p)=>sum+p.amount,0)} satisfies SalesInvoice;
  });
}

function invoiceRow(input:SalesInvoiceDraftInput,defaultDueDays:number){const issueDate=sanitizeDatabaseSingleLine(input.issueDate);const currency=sanitizeDatabaseSingleLine(input.currency||DEFAULT_APP_SETTINGS.general.currencyCode).toUpperCase().slice(0,3)||DEFAULT_APP_SETTINGS.general.currencyCode;return {client_id:input.clientId,series_id:input.seriesId,tax_registration_id:input.taxRegistrationId||null,issue_date:issueDate,operation_date:nullable(input.operationDate),due_date:nullable(input.dueDate)||defaultSalesDueDate(issueDate,defaultDueDays)||null,currency,payment_method:nullable(input.paymentMethod),notes:nullable(input.notes)}}
function lineRows(invoiceId:string,lines:SalesInvoiceLine[]){return lines.map((line,index)=>({invoice_id:invoiceId,product_id:line.productId||null,position:index+1,description:sanitizeDatabaseSingleLine(line.description),quantity:line.quantity,unit:sanitizeDatabaseSingleLine(line.unit)||'ud',unit_price:line.unitPrice,discount_percent:line.discountPercent||0,tax_rate:line.taxRate}));}

export async function createSalesInvoiceDraft(input:SalesInvoiceDraftInput,defaultDueDays:number){const {data:invoice,error}=await supabase.from('sales_invoices').insert(invoiceRow(input,defaultDueDays)).select('id').single();if(error)throw error;const rows=lineRows(invoice.id,input.lines).filter(row=>row.description);if(rows.length){const {error:lineError}=await supabase.from('sales_invoice_lines').insert(rows);if(lineError){await supabase.from('sales_invoices').delete().eq('id',invoice.id);throw lineError;}}return invoice.id as string;}
export async function updateSalesInvoiceDraft(id:string,input:SalesInvoiceDraftInput,defaultDueDays:number){const {error}=await supabase.from('sales_invoices').update(invoiceRow(input,defaultDueDays)).eq('id',id).eq('status','draft');if(error)throw error;const {error:deleteError}=await supabase.from('sales_invoice_lines').delete().eq('invoice_id',id);if(deleteError)throw deleteError;const rows=lineRows(id,input.lines).filter(row=>row.description);if(rows.length){const {error:lineError}=await supabase.from('sales_invoice_lines').insert(rows);if(lineError)throw lineError;}}
export async function deleteSalesInvoiceDraft(id:string){const {error}=await supabase.from('sales_invoices').delete().eq('id',id).eq('status','draft');if(error)throw error;}
export async function issueSalesInvoice(id:string){const {data,error}=await supabase.rpc('issue_sales_invoice',{p_invoice_id:id});if(error)throw error;return data;}
export async function markSalesInvoiceSent(id:string){const {error}=await supabase.from('sales_invoices').update({status:'sent',sent_at:new Date().toISOString()}).eq('id',id).in('status',['issued','sent']);if(error)throw error;}
export async function addSalesPayment(invoiceId:string,input:{amount:number;paymentDate:string;method?:string;reference?:string;notes?:string}){const {error}=await supabase.from('sales_payments').insert({invoice_id:invoiceId,amount:input.amount,payment_date:input.paymentDate,method:nullable(input.method),reference:nullable(input.reference),notes:nullable(input.notes)});if(error)throw error;}
export async function markSalesInvoicePaid(id:string){const {data,error}=await supabase.rpc('mark_sales_invoice_paid',{p_invoice_id:id});if(error)throw error;return data;}

export type SalesReceiptDraftInput={
  clientId:string;
  seriesId:string;
  taxRegistrationId?:string|null;
  issueDate:string;
  paymentMethod?:string;
  notes?:string;
  fiscalTreatment:'taxable'|'exempt'|'non_taxable'|'out_of_scope';
  fiscalReason?:string;
  lines:SalesInvoiceLine[];
};

export async function createSalesReceiptDraft(input:SalesReceiptDraftInput){
  const row={
    client_id:input.clientId,
    series_id:input.seriesId,
    tax_registration_id:input.taxRegistrationId||null,
    invoice_type:'standard',
    document_kind:'receipt',
    fiscal_treatment:input.fiscalTreatment,
    fiscal_reason:nullable(input.fiscalReason),
    issue_date:sanitizeDatabaseSingleLine(input.issueDate),
    due_date:sanitizeDatabaseSingleLine(input.issueDate),
    currency:DEFAULT_APP_SETTINGS.general.currencyCode,
    payment_method:nullable(input.paymentMethod),
    notes:nullable(input.notes),
  };
  const {data:receipt,error}=await supabase.from('sales_invoices').insert(row).select('id').single();
  if(error)throw error;
  const rows=lineRows(receipt.id,input.lines).filter(item=>item.description);
  if(rows.length){
    const {error:lineError}=await supabase.from('sales_invoice_lines').insert(rows);
    if(lineError){await supabase.from('sales_invoices').delete().eq('id',receipt.id);throw lineError;}
  }
  return receipt.id as string;
}

export async function updateSalesReceiptDraft(id:string,input:SalesReceiptDraftInput){
  const row={
    client_id:input.clientId,
    series_id:input.seriesId,
    tax_registration_id:input.taxRegistrationId||null,
    fiscal_treatment:input.fiscalTreatment,
    fiscal_reason:nullable(input.fiscalReason),
    issue_date:sanitizeDatabaseSingleLine(input.issueDate),
    due_date:sanitizeDatabaseSingleLine(input.issueDate),
    payment_method:nullable(input.paymentMethod),
    notes:nullable(input.notes),
  };
  const {error}=await supabase.from('sales_invoices').update(row).eq('id',id).eq('document_kind','receipt').eq('status','draft');
  if(error)throw error;
  const {error:deleteError}=await supabase.from('sales_invoice_lines').delete().eq('invoice_id',id);
  if(deleteError)throw deleteError;
  const rows=lineRows(id,input.lines).filter(item=>item.description);
  if(rows.length){const {error:lineError}=await supabase.from('sales_invoice_lines').insert(rows);if(lineError)throw lineError;}
}

export async function issueSalesReceipt(id:string){
  const {data,error}=await supabase.rpc('issue_sales_receipt',{p_invoice_id:id});
  if(error)throw error;
  return data;
}

export async function deleteSalesReceiptDraft(id:string){
  const {error}=await supabase.from('sales_invoices').delete().eq('id',id).eq('document_kind','receipt').eq('status','draft');
  if(error)throw error;
}

