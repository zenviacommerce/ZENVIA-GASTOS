import { readInvoiceDocumentEnhanced } from './invoiceReaderEnhanced';
import { createSalesInvoiceDraft, type Client, type SalesInvoiceDraftInput, type SalesInvoiceLine } from './sales';
import { updateSalesInvoiceNumber } from './salesInvoiceNumber';
import { deleteSalesInvoiceDraftSafe } from './salesDraftDelete';

export type SalesInvoiceImportStatus='needs_review'|'ready'|'importing'|'imported'|'error'|'duplicate';

export type SalesInvoiceImportCandidate={
  id:string;
  file:File;
  status:SalesInvoiceImportStatus;
  clientId:string;
  invoiceNumber:string;
  issueDate:string;
  seriesId:string;
  taxRegistrationId?:string|null;
  paymentMethod?:string;
  notes?:string;
  lines:SalesInvoiceLine[];
  subtotal:number;
  taxAmount:number;
  totalAmount:number;
  confidence:number;
  text:string;
  reviewReason?:string;
  error?:string;
};

function normalize(value:string|undefined|null){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function normalizedText(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ');}

export function matchSalesInvoiceClient(text:string,clients:Client[]):Client|null{
  const compactText=normalize(text);
  const byTax=clients.filter(client=>{const tax=normalize(client.taxId);return tax.length>=5&&compactText.includes(tax);});
  if(byTax.length===1)return byTax[0];
  const haystack=` ${normalizedText(text)} `;
  const byName=clients.filter(client=>{const name=normalizedText(client.name).trim();return name.length>=4&&haystack.includes(` ${name} `);});
  return byName.length===1?byName[0]:null;
}

function nearestTaxRate(subtotal:number,vat:number){
  if(subtotal<=0||vat<=0)return 0;
  const raw=vat/subtotal*100;
  const options=[4,10,21];
  const nearest=options.reduce((best,value)=>Math.abs(value-raw)<Math.abs(best-raw)?value:best,options[0]);
  return Math.abs(nearest-raw)<=1?nearest:0;
}

function salesLineFromRead(line:any,index:number,fallbackTaxRate:number):SalesInvoiceLine{
  const quantity=Number(line?.quantity)>0?Number(line.quantity):1;
  const taxRate=Number.isFinite(Number(line?.taxRate))?Number(line.taxRate):fallbackTaxRate;
  let unitPrice=line?.normalizedUnitPrice??line?.unitPrice;
  if(unitPrice==null&&line?.lineNet!=null)unitPrice=Number(line.lineNet)/quantity;
  if(unitPrice==null&&line?.lineTotal!=null){const gross=Number(line.lineTotal);unitPrice=taxRate>0?gross/(1+taxRate/100)/quantity:gross/quantity;}
  return {position:index+1,description:String(line?.description||`Concepto importado ${index+1}`).trim()||`Concepto importado ${index+1}`,quantity,unit:String(line?.unit||'ud'),unitPrice:Number.isFinite(Number(unitPrice))?Number(unitPrice):0,discountPercent:0,taxRate:Number.isFinite(taxRate)?taxRate:0,productId:null};
}

export async function prepareSalesInvoiceImportCandidate(file:File,clients:Client[]):Promise<SalesInvoiceImportCandidate>{
  const read=await readInvoiceDocumentEnhanced(file,[]);
  const matched=matchSalesInvoiceClient(read.text,clients);
  const fallbackTaxRate=nearestTaxRate(read.subtotal,read.vat);
  let lines=(read.lines||[]).map((line,index)=>salesLineFromRead(line,index,fallbackTaxRate));
  if(!lines.length&&read.subtotal>0)lines=[{position:1,description:'Concepto importado — revisar descripción',quantity:1,unit:'ud',unitPrice:read.subtotal,discountPercent:0,taxRate:fallbackTaxRate,productId:null}];
  const reasons:string[]=[];
  if(!matched)reasons.push('Selecciona el cliente');
  if(!read.invoiceNumber)reasons.push('Revisa el número de factura');
  if(!read.invoiceDate)reasons.push('Revisa la fecha');
  if(!lines.length)reasons.push('Añade al menos una línea');
  return {id:crypto.randomUUID(),file,status:'needs_review',clientId:matched?.id||'',invoiceNumber:read.invoiceNumber||'',issueDate:read.invoiceDate||'',seriesId:'',taxRegistrationId:null,paymentMethod:'',notes:`Importada desde ${file.name}`,lines,subtotal:read.subtotal,taxAmount:read.vat,totalAmount:read.total,confidence:read.confidence,text:read.text,reviewReason:reasons.length?reasons.join(' · '):'Comprueba cliente, serie, número, fecha, líneas e IVA antes de guardar.'};
}

export function recalculateSalesImportCandidate(candidate:SalesInvoiceImportCandidate){
  const totals=candidate.lines.reduce((acc,line)=>{const gross=line.quantity*line.unitPrice;const net=gross*(1-(line.discountPercent||0)/100);const tax=net*(line.taxRate||0)/100;acc.subtotal+=net;acc.taxAmount+=tax;acc.totalAmount+=net+tax;return acc;},{subtotal:0,taxAmount:0,totalAmount:0});
  return {...candidate,...totals};
}

export async function createSalesInvoiceDraftFromCandidate(candidate:SalesInvoiceImportCandidate){
  const reviewed=recalculateSalesImportCandidate(candidate);
  if(!reviewed.clientId)throw new Error('Selecciona el cliente.');
  if(!reviewed.seriesId)throw new Error('Selecciona la serie.');
  if(!reviewed.invoiceNumber.trim())throw new Error('Indica el número de factura.');
  if(!reviewed.issueDate)throw new Error('Indica la fecha de factura.');
  const lines=reviewed.lines.filter(line=>line.description.trim()&&line.quantity>0);
  if(!lines.length)throw new Error('Añade al menos una línea.');
  const payload:SalesInvoiceDraftInput={clientId:reviewed.clientId,seriesId:reviewed.seriesId,taxRegistrationId:reviewed.taxRegistrationId||null,issueDate:reviewed.issueDate,paymentMethod:reviewed.paymentMethod||undefined,notes:reviewed.notes||undefined,lines};
  const id=await createSalesInvoiceDraft(payload);
  try{await updateSalesInvoiceNumber(id,reviewed.invoiceNumber.trim());}
  catch(error){await deleteSalesInvoiceDraftSafe(id).catch(()=>{});throw error;}
  return id;
}
