import type { FulfillmentOrder } from './orders';

type LabelOrder = Pick<FulfillmentOrder, 'orderNumber' | 'items'> & { customerName?: string | null };

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
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

