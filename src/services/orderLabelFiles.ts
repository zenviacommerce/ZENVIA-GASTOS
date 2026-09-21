import type { FulfillmentOrder, ShippingOption } from './orders';

type LabelOrder = Pick<FulfillmentOrder, 'orderNumber' | 'shippingAddress' | 'items'> & { customerName?: string | null };
type LabelOption = Pick<ShippingOption, 'code' | 'name' | 'carrierCode' | 'carrierName' | 'contractId'>;

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type LabelFilenameOptions={
  strategy?:'order_number'|'sku'|'product'|'customer_order'|'custom';
  template?:string;
  date?:string;
};

function safeName(value:string,fallback='pedido'){
  const clean=value.trim()
    .replace(/[^a-z0-9._-]+/gi,'_')
    .replace(/^_+|_+$/g,'');
  return clean||fallback;
}

function firstItem(order:LabelOrder){
  return Array.isArray(order.items)&&order.items.length?order.items[0]||{}:{};
}

function templateValue(order:LabelOrder,key:string,date:string){
  const item=firstItem(order) as Record<string,unknown>;
  if(key==='order')return text(order.orderNumber).trim();
  if(key==='sku')return text(item.sku).trim();
  if(key==='product')return text(item.name||item.description).trim();
  if(key==='customer')return text(order.customerName).trim();
  if(key==='date')return date;
  return '';
}

export function labelPdfBaseName(order: LabelOrder, options:LabelFilenameOptions={}) {
  const strategy=options.strategy||'order_number';
  const date=options.date||new Date().toISOString().slice(0,10);
  const item=firstItem(order) as Record<string,unknown>;
  let raw='';
  if(strategy==='sku')raw=text(item.sku);
  else if(strategy==='product')raw=text(item.name||item.description);
  else if(strategy==='customer_order')raw=[text(order.customerName),text(order.orderNumber)].filter(Boolean).join('_');
  else if(strategy==='custom'){
    const template=options.template||'{order}';
    raw=template.replace(/\{(order|sku|product|customer|date)\}/g,(_match,key)=>templateValue(order,key,date));
  }else raw=text(order.orderNumber);
  return safeName(raw,'pedido');
}

export function labelPdfFilename(order: LabelOrder, options:LabelFilenameOptions={}) {
  return `${labelPdfBaseName(order,options)}.pdf`;
}

export function uniqueLabelPdfFilename(order: LabelOrder, used: Set<string>, options:LabelFilenameOptions={}) {
  const base = labelPdfBaseName(order,options);
  let suffix = 1;
  let fileName = labelPdfFilename(order,options);
  while (used.has(fileName)) {
    suffix += 1;
    fileName = `${base}_${suffix}.pdf`;
  }
  used.add(fileName);
  return fileName;
}

export function bulkLabelZipFilename(template:string,scope:string,date:string){
  const raw=(template||'etiquetas_{scope}_{date}')
    .replace(/\{scope\}/g,scope)
    .replace(/\{date\}/g,date);
  const base=safeName(raw,'etiquetas');
  return base.toLowerCase().endsWith('.zip')?base:`${base}.zip`;
}

export function isBalearicOrder(order: LabelOrder) {
  const country = text(order.shippingAddress?.country_code).trim().toUpperCase();
  const postal = text(order.shippingAddress?.postal_code).replace(/\s+/g, '').trim();
  return country === 'ES' && /^07\d{3}$/.test(postal);
}

function isCorreos(option: LabelOption) {
  return normalized(`${option.carrierCode || ''} ${option.carrierName || ''} ${option.name || ''} ${option.code || ''}`).includes('correos');
}

function isMrwUrgent1900(option: LabelOption) {
  const raw = `${option.carrierCode || ''} ${option.carrierName || ''} ${option.name || ''} ${option.code || ''}`.toLowerCase();
  const friendly = normalized(raw);
  const friendlyMatch = friendly.includes('mrw') && friendly.includes('urgent') && (friendly.includes('19:00') || friendly.includes('19 00')) && friendly.includes('expedition');
  const technicalMatch = raw.includes('mrw:') && (raw.includes('timeslot=19') || raw.includes('timeslot=19:00')) && raw.includes('expedition');
  return friendlyMatch || technicalMatch;
}

export function selectAutomaticShippingOption<T extends LabelOption>(order: LabelOrder, options: T[]): T | null {
  if (isBalearicOrder(order)) return options.find(isCorreos) || null;
  return options.find(isMrwUrgent1900) || null;
}
