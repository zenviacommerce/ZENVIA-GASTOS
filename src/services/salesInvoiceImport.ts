import { readInvoiceDocumentEnhanced } from './invoiceReaderEnhanced';
import { addClient, createSalesInvoiceDraft, loadClients, type Client, type ClientInput, type SalesInvoiceDraftInput, type SalesInvoiceLine } from './sales';
import { updateSalesInvoiceNumber } from './salesInvoiceNumber';
import { deleteSalesInvoiceDraftSafe } from './salesDraftDelete';

export type SalesInvoiceImportStatus='needs_review'|'ready'|'importing'|'imported'|'error'|'duplicate';

export type SalesInvoiceImportCandidate={
  id:string;
  file:File;
  status:SalesInvoiceImportStatus;
  clientId:string;
  proposedClient?:ClientInput|null;
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
function compact(value:string){return value.replace(/\s+/g,' ').trim();}
function titleCase(value:string){return value.toLowerCase().replace(/(^|\s)([a-záéíóúñ])/g,(_,space,letter)=>space+letter.toUpperCase()).replace(/\b(Sl|Sa|Slu|Sc|Cb)\b/g,value=>value.toUpperCase());}
function validClientName(value:string){const clean=compact(value).replace(/^[-:·]+|[-:·]+$/g,'');return clean.length>=4&&/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(clean)&&!/^(?:cliente|customer|destinatario|factura|invoice|nombre|raz[oó]n social)$/i.test(clean)?clean:'';}

function clientNameFromFilename(filename:string,invoiceNumber:string){
  let base=filename.replace(/\.[^.]+$/,'').trim();
  const invoice=invoiceNumber.trim();
  if(invoice){
    const escaped=invoice.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    base=base.replace(new RegExp('^'+escaped+'[_\\s-]*','i'),'');
  }
  base=base.replace(/^F\d{5,12}[_\s-]*/i,'').replace(/[_]+/g,' ').replace(/\s*-\s*/g,' ');
  return validClientName(titleCase(base));
}

function extractSalesRecipient(text:string,filename:string,invoiceNumber:string):ClientInput|null{
  const rows=text.split(/\r?\n/).map(compact).filter(Boolean);
  const marker=/\b(?:cliente|customer|destinatario|receptor|facturar\s+a|bill\s+to)\b/i;
  const markerIndex=rows.findIndex(line=>marker.test(line));
  const nearby=markerIndex>=0?rows.slice(markerIndex,Math.min(rows.length,markerIndex+10)):[];
  let name=clientNameFromFilename(filename,invoiceNumber);
  if(!name&&markerIndex>=0){
    const sameLine=validClientName(rows[markerIndex].replace(/^.*?\b(?:cliente|customer|destinatario|receptor|facturar\s+a|bill\s+to)\b\s*[:.-]?\s*/i,'').split(/\b(?:CIF|NIF|NIE|VAT|Email|Tel[eé]fono|Direcci[oó]n|Address)\b/i)[0]);
    if(sameLine)name=sameLine;
    if(!name){
      name=nearby.slice(1,5).map(line=>validClientName(line)).find(line=>line&&!/^(?:cif|nif|nie|vat|email|tel[eé]fono|direcci[oó]n|address|cp|c\.p\.)\b/i.test(line))||'';
    }
  }
  if(!name)return null;
  const scope=nearby.join(' ');
  const taxMatch=scope.match(/\b(?:CIF|NIF|NIE|VAT(?:\s*(?:ID|NO|NUMBER))?)\s*[:#-]?\s*((?:ES)?(?:[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[A-Z]{2}[A-Z0-9]{8,12}))\b/i);
  const taxId=(taxMatch?.[1]||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
  const email=scope.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||'';
  const phone=(scope.match(/(?:\+34\s*)?(?:\d[\s.-]?){9}\b/)?.[0]||'').replace(/[\s.-]/g,'');
  const postalMatch=scope.match(/\b(\d{5})\b\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ .'-]{2,50})/);
  const postalCode=postalMatch?.[1]||'';
  const city=postalMatch?.[2]?.trim().replace(/\s+(?:CIF|NIF|VAT|Tel[eé]fono|Email).*$/i,'')||'';
  let addressLine1='';
  if(postalCode&&nearby.length){
    const postalIndex=nearby.findIndex(line=>line.includes(postalCode));
    if(postalIndex>0){
      const candidate=nearby[postalIndex-1];
      if(!marker.test(candidate)&&!/(?:CIF|NIF|VAT|email|tel[eé]fono)/i.test(candidate))addressLine1=candidate;
    }
  }
  return {name,taxId,email,phone,addressLine1,addressLine2:'',postalCode,city,province:'',countryCode:'ES',paymentTermsDays:0,notes:'Creado automáticamente desde una factura importada.'};
}

function matchClientIdentity(input:ClientInput,clients:Client[]){
  const tax=normalize(input.taxId);
  if(tax.length>=5){const byTax=clients.find(client=>normalize(client.taxId)===tax);if(byTax)return byTax;}
  const name=normalize(input.name);
  return clients.find(client=>normalize(client.name)===name)||null;
}

async function ensureImportedClient(input:ClientInput){
  let clients=await loadClients();
  const existing=matchClientIdentity(input,clients);
  if(existing)return existing.id;
  try{return await addClient(input);}
  catch(error:any){
    if(error?.code!=='23505')throw error;
    clients=await loadClients();
    const raced=matchClientIdentity(input,clients);
    if(raced)return raced.id;
    throw error;
  }
}

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
  const proposedClient=extractSalesRecipient(read.text,file.name,read.invoiceNumber||'');
  const matched=(proposedClient&&matchClientIdentity(proposedClient,clients))||matchSalesInvoiceClient(read.text,clients);
  const fallbackTaxRate=nearestTaxRate(read.subtotal,read.vat);
  let lines=(read.lines||[]).map((line,index)=>salesLineFromRead(line,index,fallbackTaxRate));
  if(!lines.length&&read.subtotal>0)lines=[{position:1,description:'Concepto importado — revisar descripción',quantity:1,unit:'ud',unitPrice:read.subtotal,discountPercent:0,taxRate:fallbackTaxRate,productId:null}];
  const reasons:string[]=[];
  if(!matched&&!proposedClient)reasons.push('No se ha podido identificar el cliente');
  if(!read.invoiceNumber)reasons.push('Revisa el número de factura');
  if(!read.invoiceDate)reasons.push('Revisa la fecha');
  if(!lines.length)reasons.push('Añade al menos una línea');
  return {id:crypto.randomUUID(),file,status:'needs_review',clientId:matched?.id||'',proposedClient:matched?null:proposedClient,invoiceNumber:read.invoiceNumber||'',issueDate:read.invoiceDate||'',seriesId:'',taxRegistrationId:null,paymentMethod:'',notes:`Importada desde ${file.name}`,lines,subtotal:read.subtotal,taxAmount:read.vat,totalAmount:read.total,confidence:read.confidence,text:read.text,reviewReason:reasons.length?reasons.join(' · '):matched?'Comprueba cliente, serie, número, fecha, líneas e IVA antes de guardar.':proposedClient?`Se creará automáticamente el cliente ${proposedClient.name}. Revisa los datos antes de guardar.`:'Comprueba cliente, serie, número, fecha, líneas e IVA antes de guardar.'};
}

export function recalculateSalesImportCandidate(candidate:SalesInvoiceImportCandidate){
  const totals=candidate.lines.reduce((acc,line)=>{const gross=line.quantity*line.unitPrice;const net=gross*(1-(line.discountPercent||0)/100);const tax=net*(line.taxRate||0)/100;acc.subtotal+=net;acc.taxAmount+=tax;acc.totalAmount+=net+tax;return acc;},{subtotal:0,taxAmount:0,totalAmount:0});
  return {...candidate,...totals};
}

export async function createSalesInvoiceDraftFromCandidate(candidate:SalesInvoiceImportCandidate){
  const reviewed=recalculateSalesImportCandidate(candidate);
  let clientId=reviewed.clientId;
  if(!clientId&&reviewed.proposedClient?.name)clientId=await ensureImportedClient(reviewed.proposedClient);
  if(!clientId)throw new Error('Selecciona el cliente o revisa los datos detectados.');
  if(!reviewed.seriesId)throw new Error('Selecciona la serie.');
  if(!reviewed.invoiceNumber.trim())throw new Error('Indica el número de factura.');
  if(!reviewed.issueDate)throw new Error('Indica la fecha de factura.');
  const lines=reviewed.lines.filter(line=>line.description.trim()&&line.quantity>0);
  if(!lines.length)throw new Error('Añade al menos una línea.');
  const payload:SalesInvoiceDraftInput={clientId,seriesId:reviewed.seriesId,taxRegistrationId:reviewed.taxRegistrationId||null,issueDate:reviewed.issueDate,paymentMethod:reviewed.paymentMethod||undefined,notes:reviewed.notes||undefined,lines};
  const id=await createSalesInvoiceDraft(payload);
  try{await updateSalesInvoiceNumber(id,reviewed.invoiceNumber.trim());}
  catch(error){await deleteSalesInvoiceDraftSafe(id).catch(()=>{});throw error;}
  return id;
}
