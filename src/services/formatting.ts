import type { GeneralSettings, DocumentLanguage } from './settingsSchema';

type FormattingSettings=Pick<GeneralSettings,'currencyCode'|'timezone'|'dateFormat'|'documentLanguage'>;

const LANGUAGE_LOCALE:Record<DocumentLanguage,string>={
  es:'es-ES',
  en:'en-GB',
  fr:'fr-FR',
  it:'it-IT',
  de:'de-DE',
  pt:'pt-PT',
};

export type InvoiceDocumentLabels={
  invoice:string;
  draftInvoice:string;
  rectifyingInvoice:string;
  draftRectifyingInvoice:string;
  date:string;
  dueDate:string;
  operationDate:string;
  billTo:string;
  taxId:string;
  description:string;
  quantity:string;
  price:string;
  vat:string;
  total:string;
  taxableBase:string;
  discounts:string;
  paymentMethod:string;
  notes:string;
};

const INVOICE_LABELS:Record<DocumentLanguage,InvoiceDocumentLabels>={
  es:{invoice:'FACTURA',draftInvoice:'BORRADOR DE FACTURA',rectifyingInvoice:'FACTURA RECTIFICATIVA',draftRectifyingInvoice:'BORRADOR RECTIFICATIVA',date:'Fecha',dueDate:'Vencimiento',operationDate:'Operación',billTo:'FACTURAR A',taxId:'NIF/CIF',description:'Descripción',quantity:'Cant.',price:'Precio',vat:'IVA',total:'TOTAL',taxableBase:'Base imponible',discounts:'Descuentos',paymentMethod:'Forma de pago',notes:'Notas'},
  en:{invoice:'INVOICE',draftInvoice:'DRAFT INVOICE',rectifyingInvoice:'CREDIT / CORRECTIVE INVOICE',draftRectifyingInvoice:'DRAFT CORRECTIVE INVOICE',date:'Date',dueDate:'Due date',operationDate:'Supply date',billTo:'BILL TO',taxId:'TAX ID',description:'Description',quantity:'Qty.',price:'Price',vat:'VAT',total:'TOTAL',taxableBase:'Taxable amount',discounts:'Discounts',paymentMethod:'Payment method',notes:'Notes'},
  fr:{invoice:'FACTURE',draftInvoice:'BROUILLON DE FACTURE',rectifyingInvoice:'FACTURE RECTIFICATIVE',draftRectifyingInvoice:'BROUILLON RECTIFICATIF',date:'Date',dueDate:'Échéance',operationDate:'Date d’opération',billTo:'FACTURER À',taxId:'N° TVA / fiscal',description:'Description',quantity:'Qté',price:'Prix',vat:'TVA',total:'TOTAL',taxableBase:'Base imposable',discounts:'Remises',paymentMethod:'Mode de paiement',notes:'Notes'},
  it:{invoice:'FATTURA',draftInvoice:'BOZZA FATTURA',rectifyingInvoice:'FATTURA RETTIFICATIVA',draftRectifyingInvoice:'BOZZA RETTIFICATIVA',date:'Data',dueDate:'Scadenza',operationDate:'Data operazione',billTo:'FATTURARE A',taxId:'P. IVA / C.F.',description:'Descrizione',quantity:'Qtà',price:'Prezzo',vat:'IVA',total:'TOTALE',taxableBase:'Imponibile',discounts:'Sconti',paymentMethod:'Metodo di pagamento',notes:'Note'},
  de:{invoice:'RECHNUNG',draftInvoice:'RECHNUNGSENTWURF',rectifyingInvoice:'KORREKTURRECHNUNG',draftRectifyingInvoice:'ENTWURF KORREKTURRECHNUNG',date:'Datum',dueDate:'Fällig am',operationDate:'Leistungsdatum',billTo:'RECHNUNG AN',taxId:'USt-IdNr. / Steuer-ID',description:'Beschreibung',quantity:'Menge',price:'Preis',vat:'MwSt.',total:'GESAMT',taxableBase:'Nettobetrag',discounts:'Rabatte',paymentMethod:'Zahlungsart',notes:'Anmerkungen'},
  pt:{invoice:'FATURA',draftInvoice:'RASCUNHO DE FATURA',rectifyingInvoice:'FATURA RETIFICATIVA',draftRectifyingInvoice:'RASCUNHO RETIFICATIVO',date:'Data',dueDate:'Vencimento',operationDate:'Data da operação',billTo:'FATURAR A',taxId:'NIF / IVA',description:'Descrição',quantity:'Qtd.',price:'Preço',vat:'IVA',total:'TOTAL',taxableBase:'Base tributável',discounts:'Descontos',paymentMethod:'Método de pagamento',notes:'Notas'},
};

export function localeForLanguage(language:DocumentLanguage){
  return LANGUAGE_LOCALE[language]||LANGUAGE_LOCALE.es;
}

function dateParts(value:string|Date,timezone:string){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return null;
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:timezone||'Europe/Madrid',
    day:'2-digit',month:'2-digit',year:'numeric',
  }).formatToParts(date);
  const get=(type:string)=>parts.find(item=>item.type===type)?.value||'';
  const day=get('day'),month=get('month'),year=get('year');
  return day&&month&&year?{day,month,year}:null;
}

function pureDateParts(value:string){
  const match=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match?{year:match[1],month:match[2],day:match[3]}:null;
}

function arrangeDate(parts:{day:string;month:string;year:string},format:GeneralSettings['dateFormat']){
  if(format==='YYYY-MM-DD')return `${parts.year}-${parts.month}-${parts.day}`;
  if(format==='DD-MM-YYYY')return `${parts.day}-${parts.month}-${parts.year}`;
  return `${parts.day}/${parts.month}/${parts.year}`;
}

export function formatAppDate(value:string|Date|null|undefined,settings:FormattingSettings,fallback='—'){
  if(value==null||value==='')return fallback;
  const pure=typeof value==='string'?pureDateParts(value):null;
  const parts=pure||dateParts(value,settings.timezone);
  return parts?arrangeDate(parts,settings.dateFormat):fallback;
}

export function formatAppDateTime(value:string|Date|null|undefined,settings:FormattingSettings,fallback='—'){
  if(value==null||value==='')return fallback;
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return fallback;
  const dateText=formatAppDate(date,settings,fallback);
  const time=new Intl.DateTimeFormat(localeForLanguage(settings.documentLanguage),{
    timeZone:settings.timezone||'Europe/Madrid',
    hour:'2-digit',minute:'2-digit',hour12:false,
  }).format(date);
  return `${dateText} ${time}`;
}

export function formatAppMoney(value:number,currency:string|null|undefined,settings:FormattingSettings,options:{minimumFractionDigits?:number;maximumFractionDigits?:number}={}){
  const code=(currency||settings.currencyCode||'EUR').trim().toUpperCase();
  return new Intl.NumberFormat(localeForLanguage(settings.documentLanguage),{
    style:'currency',currency:code,
    minimumFractionDigits:options.minimumFractionDigits,
    maximumFractionDigits:options.maximumFractionDigits,
  }).format(value);
}

export function invoiceDocumentLabels(language:DocumentLanguage){
  return INVOICE_LABELS[language]||INVOICE_LABELS.es;
}
