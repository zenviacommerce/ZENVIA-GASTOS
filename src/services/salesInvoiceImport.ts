import { readInvoiceDocumentEnhanced } from './invoiceReaderEnhanced';
import { addClient, createSalesInvoiceDraft, deleteClientIfUnused, loadBusinessSettings, loadClients, updateClient, updateSalesInvoiceDraft, type Client, type ClientInput, type SalesInvoiceDraftInput, type SalesInvoiceLine } from './sales';
import { updateSalesInvoiceNumber } from './salesInvoiceNumber';
import { deleteSalesInvoiceDraftSafe } from './salesDraftDelete';
import { extractInvoiceParty } from './invoicePartyExtractor';

export type SalesInvoiceImportStatus='needs_review'|'ready'|'importing'|'imported'|'error'|'duplicate';

export type SalesInvoiceImportCandidate={
  id:string;
  file:File;
  status:SalesInvoiceImportStatus;
  clientId:string;
  proposedClient?:ClientInput|null;
  invoiceNumber:string;
  issueDate:string;
  dueDate:string;
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
  existingInvoiceId?:string|null;
  existingInvoiceNumber?:string|null;
  existingClientId?:string|null;
};

function normalize(value:string|undefined|null){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function normalizedText(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ');}
function compact(value:string){return value.replace(/\s+/g,' ').trim();}
function titleCase(value:string){return value.toLowerCase().replace(/(^|\s)([a-záéíóúñ])/g,(_,space,letter)=>space+letter.toUpperCase()).replace(/\b(Sl|Sa|Slu|Sc|Cb)\b/g,value=>value.toUpperCase());}
function validClientName(value:string){const clean=compact(value).replace(/^[-:·]+|[-:·]+$/g,'');if(/^[0-9a-f]{8}(?:[-_][0-9a-f]{4}){3}[-_][0-9a-f]{12}$/i.test(clean))return '';if(/^[0-9a-f_-]{20,}$/i.test(clean))return '';return clean.length>=4&&/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(clean)&&!/^(?:cliente|customer|destinatario|factura|invoice|nombre|raz[oó]n social|transferencia|tarjeta|paypal|bizum|contado|efectivo|iban|swift|bic|vencimiento)$/i.test(clean)?clean:'';}

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

function addDays(date:string,days:number){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
  const value=new Date(date+'T12:00:00');
  if(Number.isNaN(value.getTime()))return '';
  value.setDate(value.getDate()+days);
  return value.toISOString().slice(0,10);
}

function normalizeImportedDate(raw:string|undefined|null){
  const value=compact(String(raw||''));
  if(!value)return '';
  const iso=value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(iso)return iso[1]+'-'+String(Number(iso[2])).padStart(2,'0')+'-'+String(Number(iso[3])).padStart(2,'0');
  const european=value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
  if(!european)return '';
  const year=european[3].length===2?'20'+european[3]:european[3];
  return year+'-'+String(Number(european[2])).padStart(2,'0')+'-'+String(Number(european[1])).padStart(2,'0');
}

function extractSalesDueDate(text:string,issueDate:string){
  const rows=text.split(/\r?\n/).map(compact).filter(Boolean);
  const dueLabel=/\b(?:fecha\s+de\s+vencimiento|vencimiento|due\s+date|payment\s+due|échéance|echeance|scadenza|fällig(?:keit|keitsdatum)?)\b/i;
  const labelled=rows.find(row=>dueLabel.test(row));
  if(labelled){
    const label=labelled.match(dueLabel);
    const afterLabel=label?labelled.slice((label.index||0)+label[0].length):labelled;
    const parsed=normalizeImportedDate(afterLabel)||normalizeImportedDate(labelled);
    if(parsed)return parsed;
  }
  return addDays(issueDate,30);
}

function extractSalesRecipient(text:string,filename:string,invoiceNumber:string,invoiceDate=''):ClientInput|null{
  const nameHint=clientNameFromFilename(filename,invoiceNumber);
  const party=extractInvoiceParty(text,{role:'recipient',nameHint,invoiceNumber,invoiceDate});
  const name=party.name||nameHint;
  if(!name)return null;
  return {
    name,
    taxId:party.taxId||'',
    email:party.email||'',
    phone:party.phone||'',
    addressLine1:party.addressLine1||'',
    addressLine2:'',
    postalCode:party.postalCode||'',
    city:party.city||'',
    province:party.province||'',
    countryCode:party.countryCode||'XX',
    paymentTermsDays:0,
    notes:'',
  };
}

function matchClientIdentity(input:ClientInput,clients:Client[]){
  const tax=normalize(input.taxId);
  if(tax.length>=5){const byTax=clients.find(client=>normalize(client.taxId)===tax);if(byTax)return byTax;}
  const name=normalize(input.name);
  return clients.find(client=>normalize(client.name)===name)||null;
}

function mergedImportedClient(existing:Client,input:ClientInput):ClientInput{
  return {
    name:existing.name,
    taxId:existing.taxId||input.taxId||'',
    email:existing.email||input.email||'',
    phone:existing.phone||input.phone||'',
    addressLine1:existing.addressLine1||input.addressLine1||'',
    addressLine2:existing.addressLine2||input.addressLine2||'',
    postalCode:existing.postalCode||input.postalCode||'',
    city:existing.city||input.city||'',
    province:existing.province||input.province||'',
    countryCode:existing.countryCode&&existing.countryCode!=='XX'?existing.countryCode:(input.countryCode||'XX'),
    paymentTermsDays:existing.paymentTermsDays||input.paymentTermsDays||0,
    notes:existing.notes||'',
  };
}

async function enrichImportedClient(clientId:string,input:ClientInput){
  const [clients,business]=await Promise.all([loadClients(),loadBusinessSettings()]);
  const existing=clients.find(client=>client.id===clientId);
  if(!existing)return;
  const merged=mergedImportedClient(existing,input);

  // Previous importer versions could accidentally copy issuer contact data into
  // the recipient because PDF.js joins left/right columns on the same baseline.
  const ownTax=normalize(business.taxId);
  const ownPhone=normalize(business.phone);
  const ownEmail=String(business.email||'').trim().toLowerCase();
  if(ownTax&&normalize(existing.taxId)===ownTax&&!input.taxId)merged.taxId='';
  if(ownPhone&&normalize(existing.phone)===ownPhone&&!input.phone)merged.phone='';
  if(ownEmail&&String(existing.email||'').trim().toLowerCase()===ownEmail&&!input.email)merged.email='';
  if(input.countryCode&&input.countryCode!=='XX')merged.countryCode=input.countryCode;

  const changed=
    (merged.taxId||'')!==(existing.taxId||'')
    ||(merged.email||'')!==(existing.email||'')
    ||(merged.phone||'')!==(existing.phone||'')
    ||(merged.addressLine1||'')!==(existing.addressLine1||'')
    ||(merged.postalCode||'')!==(existing.postalCode||'')
    ||(merged.city||'')!==(existing.city||'')
    ||merged.countryCode!==existing.countryCode;
  if(changed)await updateClient(clientId,merged);
}

async function ensureImportedClient(input:ClientInput){
  let clients=await loadClients();
  const existing=matchClientIdentity(input,clients);
  if(existing){await enrichImportedClient(existing.id,input);return {id:existing.id,created:false};}
  try{return {id:await addClient(input),created:true};}
  catch(error:any){
    if(error?.code!=='23505')throw error;
    clients=await loadClients();
    const raced=matchClientIdentity(input,clients);
    if(raced){await enrichImportedClient(raced.id,input);return {id:raced.id,created:false};}
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

function parseSalesNumber(value:string|undefined|null){
  if(!value)return 0;
  const cleaned=value.replace(/[^\d,.-]/g,'');
  if(!cleaned)return 0;
  const comma=cleaned.lastIndexOf(',');
  const dot=cleaned.lastIndexOf('.');
  const normalized=comma>dot?cleaned.replace(/\./g,'').replace(',','.'):dot>comma?cleaned.replace(/,/g,''):cleaned;
  const parsed=Number(normalized);
  return Number.isFinite(parsed)?parsed:0;
}

function salesMoneyValues(line:string){
  return [...line.matchAll(/-?\d{1,3}(?:\.\d{3})*,\d{2,6}|-?\d+\.\d{2,6}/g)].map(match=>parseSalesNumber(match[0]));
}

function extractSalesFiscalTotals(text:string){
  const rows=text.split(/\r?\n/).map(compact).filter(Boolean);
  let subtotal=0,vat=0,total=0;
  for(const row of rows){
    const values=salesMoneyValues(row);
    if(!values.length)continue;
    if(!subtotal&&/\bbase\s+imponible\b/i.test(row))subtotal=values.at(-1)||0;
    else if(!vat&&/^\s*iva\b/i.test(row)&&!/base\s+imponible/i.test(row))vat=values.at(-1)||0;
    else if(!total&&/^\s*total\b/i.test(row)&&!/subtotal|base\s+imponible/i.test(row))total=values.at(-1)||0;
  }
  if(subtotal>0&&total>0){
    const expected=Math.round((subtotal+vat)*100)/100;
    if(Math.abs(expected-total)<=Math.max(.03,total*.002))return {subtotal,vat,total};
  }
  return null;
}

function extractSalesConceptLines(text:string,fallbackTaxRate:number):SalesInvoiceLine[]{
  const rows=text.split(/\r?\n/).map(compact).filter(Boolean);
  const headerIndex=rows.findIndex(row=>/\bconceptos?\b/i.test(row)&&/\bcant\.?\b/i.test(row)&&/precio\s+uni/i.test(row)&&/\btotal\b/i.test(row));
  if(headerIndex<0)return [];
  const result:SalesInvoiceLine[]=[];
  for(const row of rows.slice(headerIndex+1)){
    if(/\bbase\s+imponible\b|^\s*iva\b|^\s*total\b/i.test(row))break;
    const match=row.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2,6}|-?\d+[.,]\d{2,6})\s*€?\s+(\d{1,2}(?:[.,]\d+)?)\s*%\s+(-?\d{1,3}(?:\.\d{3})*,\d{2,6}|-?\d+[.,]\d{2,6})\s*€?$/i);
    if(!match)continue;
    const quantity=parseSalesNumber(match[2]);
    const unitPrice=parseSalesNumber(match[3]);
    const taxRate=parseSalesNumber(match[4])||fallbackTaxRate;
    const lineTotal=parseSalesNumber(match[5]);
    if(quantity<=0||unitPrice<0||lineTotal<=0)continue;
    const expectedGross=Math.round(quantity*unitPrice*(1+taxRate/100)*100)/100;
    if(Math.abs(expectedGross-lineTotal)>Math.max(.05,lineTotal*.01))continue;
    result.push({position:result.length+1,description:compact(match[1]).slice(0,250),quantity,unit:'ud',unitPrice,discountPercent:0,taxRate,productId:null,lineTotal});
  }
  return result;
}

function reconcileSalesLines(lines:SalesInvoiceLine[],subtotal:number,vat:number,invoiceNumber:string){
  if(!subtotal||subtotal<=0)return lines;
  const lineSubtotal=lines.reduce((sum,line)=>sum+line.quantity*line.unitPrice*(1-(line.discountPercent||0)/100),0);
  const tolerance=Math.max(.08,subtotal*.01);
  if(lines.length&&Math.abs(lineSubtotal-subtotal)<=tolerance)return lines;
  const taxRate=nearestTaxRate(subtotal,vat);
  const description=lines.find(line=>line.description.trim())?.description||`Conceptos según factura ${invoiceNumber||'importada'}`;
  return [{position:1,description,quantity:1,unit:'ud',unitPrice:subtotal,discountPercent:0,taxRate,productId:null}];
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
  const fiscal=extractSalesFiscalTotals(read.text);
  const subtotal=fiscal?.subtotal||read.subtotal;
  const vat=fiscal?.vat??read.vat;
  const total=fiscal?.total||read.total;
  const proposedClient=extractSalesRecipient(read.text,file.name,read.invoiceNumber||'',read.invoiceDate||'');
  const dueDate=extractSalesDueDate(read.text,read.invoiceDate||'');
  const matched=(proposedClient&&matchClientIdentity(proposedClient,clients))||matchSalesInvoiceClient(read.text,clients);
  const fallbackTaxRate=nearestTaxRate(subtotal,vat);
  const exactLines=extractSalesConceptLines(read.text,fallbackTaxRate);
  let lines=exactLines.length?exactLines:(read.lines||[]).map((line,index)=>salesLineFromRead(line,index,fallbackTaxRate));
  lines=reconcileSalesLines(lines,subtotal,vat,read.invoiceNumber||'');
  if(!lines.length&&subtotal>0)lines=[{position:1,description:'Concepto importado — revisar descripción',quantity:1,unit:'ud',unitPrice:subtotal,discountPercent:0,taxRate:fallbackTaxRate,productId:null}];
  const reasons:string[]=[];
  if(!matched&&!proposedClient)reasons.push('No se ha podido identificar el cliente');
  if(!read.invoiceNumber)reasons.push('Revisa el número de factura');
  if(!read.invoiceDate)reasons.push('Revisa la fecha');
  if(!lines.length)reasons.push('Añade al menos una línea');
  return {id:crypto.randomUUID(),file,status:'needs_review',clientId:matched?.id||'',proposedClient,invoiceNumber:read.invoiceNumber||'',issueDate:read.invoiceDate||'',dueDate,seriesId:'',taxRegistrationId:null,paymentMethod:'',notes:'',lines,subtotal,taxAmount:vat,totalAmount:total,confidence:read.confidence,text:read.text,reviewReason:reasons.length?reasons.join(' · '):matched?'Comprueba cliente, serie, número, fecha, vencimiento, líneas e IVA antes de guardar.':proposedClient?`Se creará automáticamente el cliente ${proposedClient.name}. Revisa sus datos fiscales antes de guardar.`:'Comprueba cliente, serie, número, fecha, vencimiento, líneas e IVA antes de guardar.'};
}

export function recalculateSalesImportCandidate(candidate:SalesInvoiceImportCandidate){
  const totals=candidate.lines.reduce((acc,line)=>{const gross=line.quantity*line.unitPrice;const net=gross*(1-(line.discountPercent||0)/100);const tax=net*(line.taxRate||0)/100;acc.subtotal+=net;acc.taxAmount+=tax;acc.totalAmount+=net+tax;return acc;},{subtotal:0,taxAmount:0,totalAmount:0});
  return {...candidate,...totals};
}

function finite(value:number){return Number.isFinite(value)?value:0;}
function cleanImportLines(candidate:SalesInvoiceImportCandidate){
  const cleaned=candidate.lines
    .filter(line=>line.description.trim())
    .map((line,index)=>({
      ...line,
      position:index+1,
      description:line.description.trim().slice(0,500),
      quantity:finite(line.quantity),
      unit:(line.unit||'ud').trim().slice(0,20)||'ud',
      unitPrice:finite(line.unitPrice),
      discountPercent:Math.min(100,Math.max(0,finite(line.discountPercent))),
      taxRate:Math.min(100,Math.max(0,finite(line.taxRate))),
      productId:null,
    }))
    .filter(line=>line.quantity>0&&line.unitPrice>=0);

  const subtotal=finite(candidate.subtotal);
  const tax=finite(candidate.taxAmount);
  const total=finite(candidate.totalAmount);
  const rate=nearestTaxRate(subtotal,tax);
  const calculated=cleaned.reduce((sum,line)=>sum+line.quantity*line.unitPrice*(1-line.discountPercent/100),0);
  const totalsCoherent=subtotal>0&&total>0&&Math.abs((subtotal+tax)-total)<=Math.max(.05,total*.01);
  const linesCoherent=cleaned.length>0&&Math.abs(calculated-subtotal)<=Math.max(.08,subtotal*.01);

  if(linesCoherent)return cleaned;
  if(totalsCoherent){
    const description=cleaned.find(line=>line.description)?.description||`Conceptos según factura ${candidate.invoiceNumber||'importada'}`;
    return [{position:1,description,quantity:1,unit:'ud',unitPrice:subtotal,discountPercent:0,taxRate:rate,productId:null} satisfies SalesInvoiceLine];
  }
  return cleaned;
}

export function friendlySalesImportError(error:unknown){
  const anyError=error as any;
  const raw=String(anyError?.message||anyError?.details||anyError||'').trim();
  if(/precio.*negativo|precios negativos/i.test(raw))return 'Hay una línea con precio negativo o no válido.';
  if(/quantity.*check|cantidad/i.test(raw)&&/check|constraint/i.test(raw))return 'Hay una línea con cantidad no válida.';
  if(/tax_rate|iva/i.test(raw)&&/check|constraint/i.test(raw))return 'Hay una línea con un IVA no válido.';
  if(/discount_percent/i.test(raw))return 'Hay una línea con un descuento fuera del rango permitido.';
  if(/duplicate key|unique|ya existe/i.test(raw))return 'Ya existe una factura o cliente con esos datos.';
  if(/foreign key|violates foreign key/i.test(raw))return 'Algún dato vinculado (cliente, serie o producto) ya no existe.';
  return raw||'No se pudo guardar el borrador.';
}

export async function createSalesInvoiceDraftFromCandidate(candidate:SalesInvoiceImportCandidate){
  const reviewed=recalculateSalesImportCandidate(candidate);
  let clientId=reviewed.clientId;
  let createdClientId='';
  try{
    if(clientId&&reviewed.proposedClient?.name)await enrichImportedClient(clientId,reviewed.proposedClient);
    if(!clientId&&reviewed.proposedClient?.name){
      const ensured=await ensureImportedClient(reviewed.proposedClient);
      clientId=ensured.id;
      if(ensured.created)createdClientId=ensured.id;
    }
    if(!clientId)throw new Error('Selecciona el cliente o revisa los datos detectados.');
    if(!reviewed.seriesId)throw new Error('Selecciona la serie.');
    if(!reviewed.invoiceNumber.trim())throw new Error('Indica el número de factura.');
    if(!reviewed.issueDate)throw new Error('Indica la fecha de factura.');
    const lines=cleanImportLines(reviewed);
    if(!lines.length)throw new Error('No hay líneas válidas para guardar esta factura.');
    const payload:SalesInvoiceDraftInput={clientId,seriesId:reviewed.seriesId,taxRegistrationId:reviewed.taxRegistrationId||null,issueDate:reviewed.issueDate,dueDate:reviewed.dueDate||addDays(reviewed.issueDate,30)||undefined,paymentMethod:reviewed.paymentMethod||undefined,notes:reviewed.notes||undefined,lines};

    if(reviewed.existingInvoiceId){
      if(reviewed.existingInvoiceNumber&&reviewed.invoiceNumber.trim()!==reviewed.existingInvoiceNumber){
        throw new Error('Para reparar un borrador importado conserva su número de factura.');
      }
      await updateSalesInvoiceDraft(reviewed.existingInvoiceId,payload);
      if(reviewed.existingClientId&&reviewed.existingClientId!==clientId){
        await deleteClientIfUnused(reviewed.existingClientId).catch(()=>{});
      }
      return reviewed.existingInvoiceId;
    }

    const id=await createSalesInvoiceDraft(payload);
    try{await updateSalesInvoiceNumber(id,reviewed.invoiceNumber.trim());}
    catch(error){await deleteSalesInvoiceDraftSafe(id).catch(()=>{});throw error;}
    return id;
  }catch(error){
    if(createdClientId)await deleteClientIfUnused(createdClientId).catch(()=>{});
    throw error;
  }
}
