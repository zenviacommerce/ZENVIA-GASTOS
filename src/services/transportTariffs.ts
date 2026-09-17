import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from './supabase';

pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;

export type TransportTariffStatus='draft'|'reviewed'|'active'|'superseded';
export type TransportMappingStatus='suggested'|'confirmed'|'unmapped';

export interface TransportTariffBandDraft{
  id?:string;
  countryCode:string;
  zoneCode:string;
  zoneName:string;
  minWeightKg:number;
  maxWeightKg:number|null;
  basePrice:number|null;
  extraKgPrice:number|null;
  notes?:string|null;
  sortOrder?:number;
}
export interface TransportTariffServiceDraft{
  id?:string;
  serviceName:string;
  canonicalServiceKey:string;
  externalProvider:string;
  externalServiceCode:string;
  mappingStatus:TransportMappingStatus;
  sortOrder?:number;
  bands:TransportTariffBandDraft[];
}
export interface TransportTariffProposal{
  carrierCode:string;
  carrierName:string;
  effectiveFrom:string|null;
  effectiveTo:string|null;
  currencyCode:string;
  pricesIncludeVat:boolean;
  fuelSurchargePct:number|null;
  fuelSurchargeIncluded:boolean;
  parserProvider:string;
  parserModel:string|null;
  parserConfidence:number;
  parserNotes:string[];
  services:TransportTariffServiceDraft[];
}
export interface TransportTariffDocument extends TransportTariffProposal{
  id:string;
  status:TransportTariffStatus;
  sourceFileName:string|null;
  sourceFilePath:string|null;
  sourceMimeType:string|null;
  createdAt:string;
  reviewedAt:string|null;
  activatedAt:string|null;
  revisions:Array<{id:string;effectiveFrom:string;snapshot:TransportTariffProposal}>;
}

const BUCKET='transport-tariffs';
const clean=(value:unknown)=>String(value??'').replace(/\s+/g,' ').trim();
const slug=(value:string)=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const num=(value:string|number|null|undefined)=>{if(value==null||value==='')return null;const raw=String(value).replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.').replace(/[^\d.-]/g,'');const parsed=Number(raw);return Number.isFinite(parsed)?parsed:null};
const isoDate=(day:string,month:string,year:string)=>`${year.length===2?`20${year}`:year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;

function safeFileName(name:string){return (name||'tarifa').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,120)||'tarifa';}
async function sha256(file:File){const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');}

async function readPdfText(file:File){
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const pages:string[]=[];
  for(let p=1;p<=pdf.numPages;p+=1){
    const page=await pdf.getPage(p);const content=await page.getTextContent();
    const items=(content.items as Array<any>).map(item=>({text:clean(item.str),x:Number(item.transform?.[4]||0),y:Number(item.transform?.[5]||0)})).filter(item=>item.text);
    const rows=new Map<number,Array<{text:string;x:number}>>();
    for(const item of items){const key=Math.round(item.y/3)*3;const row=rows.get(key)||[];row.push({text:item.text,x:item.x});rows.set(key,row)}
    const text=Array.from(rows.entries()).sort((a,b)=>b[0]-a[0]).map(([,row])=>row.sort((a,b)=>a.x-b.x).map(item=>item.text).join(' ')).join('\n');
    pages.push(text);
  }
  return pages.join('\n\n');
}

function xmlText(node:Element|null){return node?Array.from(node.querySelectorAll('t')).map(t=>t.textContent||'').join(''):''}
async function readXlsxText(file:File){
  const zip=await JSZip.loadAsync(await file.arrayBuffer());
  const parser=new DOMParser();
  const sharedFile=zip.file('xl/sharedStrings.xml');
  const shared:string[]=[];
  if(sharedFile){const xml=parser.parseFromString(await sharedFile.async('text'),'application/xml');xml.querySelectorAll('si').forEach(si=>shared.push(xmlText(si)))}
  const sheets=Object.keys(zip.files).filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort();
  const output:string[]=[];
  for(const name of sheets){
    const sheet=zip.file(name);if(!sheet)continue;
    const xml=parser.parseFromString(await sheet.async('text'),'application/xml');
    xml.querySelectorAll('row').forEach(row=>{
      const cells:Array<{ref:string;value:string}>=[];
      row.querySelectorAll('c').forEach(cell=>{
        const type=cell.getAttribute('t')||'';const ref=cell.getAttribute('r')||'';let value='';
        if(type==='s'){const index=Number(cell.querySelector('v')?.textContent||'-1');value=shared[index]||''}
        else if(type==='inlineStr')value=xmlText(cell.querySelector('is'));
        else value=cell.querySelector('v')?.textContent||'';
        if(clean(value))cells.push({ref,value:clean(value)});
      });
      if(cells.length)output.push(cells.map(c=>c.value).join('\t'));
    });
  }
  return output.join('\n');
}

export async function readTransportDocumentText(file:File){
  const lower=file.name.toLowerCase();
  if(file.type==='application/pdf'||lower.endsWith('.pdf'))return readPdfText(file);
  if(lower.endsWith('.xlsx')||file.type.includes('spreadsheetml'))return readXlsxText(file);
  if(lower.endsWith('.csv')||file.type==='text/csv')return file.text();
  throw new Error('Formato no compatible. Utiliza PDF, XLSX o CSV.');
}

const zones=[
  {label:'Urbano',code:'urban',country:'ES'},
  {label:'Provincial',code:'provincial',country:'ES'},
  {label:'Regional-Limítrofe',code:'regional-border',country:'ES'},
  {label:'España Peninsular',code:'peninsular',country:'ES'},
  {label:'Portugal Peninsular',code:'peninsular',country:'PT'},
];
function prices(line:string){return Array.from(line.matchAll(/(-?\d+(?:[.,]\d{1,4})?)\s*€/g)).map(match=>num(match[1])).filter((value):value is number=>value!=null)}
function zoneLayout(block:string){
  const header=block.split(/\r?\n/).find(line=>/Tramos Peso/i.test(line)&&/Peninsular/i.test(line))||'';
  return zones.map(zone=>({zone,index:header.toLowerCase().indexOf(zone.label.toLowerCase())})).filter(item=>item.index>=0).sort((a,b)=>a.index-b.index).map(item=>item.zone);
}
function serviceBlocks(text:string){
  const matches=Array.from(text.matchAll(/EXPEDICIONES?\s+MAÑANA\s+(\d{1,2})\s*h/gi));
  if(!matches.length)return [] as Array<{hour:string;block:string}>;
  return matches.map((match,index)=>({hour:match[1],block:text.slice(match.index??0,matches[index+1]?.index??text.length)}));
}
function parseMrwServices(text:string):TransportTariffServiceDraft[]{
  return serviceBlocks(text).map(({hour,block},serviceIndex)=>{
    const layout=zoneLayout(block);const bands:TransportTariffBandDraft[]=[];const previousMax=new Map<string,number>();const lastPrice=new Map<string,number>();
    for(const line of block.split(/\r?\n/)){
      const weight=line.match(/Hasta\s+(\d+(?:[.,]\d+)?)\s*kg/i);
      if(weight){
        const max=num(weight[1]);const rowPrices=prices(line);if(max==null||!layout.length||rowPrices.length<layout.length)continue;
        layout.forEach((zone,column)=>{const price=rowPrices[column];if(price==null)return;const key=`${zone.country}:${zone.code}`;const minWeight=previousMax.get(key)??0;bands.push({countryCode:zone.country,zoneCode:zone.code,zoneName:zone.label,minWeightKg:minWeight,maxWeightKg:max,basePrice:price,extraKgPrice:null,sortOrder:bands.length});previousMax.set(key,max);lastPrice.set(key,price)});
        continue;
      }
      if(/^\s*adicionales/i.test(line)){
        const rowPrices=prices(line);if(!layout.length||rowPrices.length<layout.length)continue;
        layout.forEach((zone,column)=>{const extra=rowPrices[column];const key=`${zone.country}:${zone.code}`;const minWeight=previousMax.get(key);if(extra==null||minWeight==null)return;bands.push({countryCode:zone.country,zoneCode:zone.code,zoneName:zone.label,minWeightKg:minWeight,maxWeightKg:null,basePrice:lastPrice.get(key)??null,extraKgPrice:extra,notes:'kg adicional',sortOrder:bands.length})});
      }
    }
    const key=`manana-${hour}h`;
    return {serviceName:`Mañana ${hour} h`,canonicalServiceKey:key,externalProvider:'mrw',externalServiceCode:key,mappingStatus:'suggested' as TransportMappingStatus,sortOrder:serviceIndex,bands};
  }).filter(service=>service.bands.length>0);
}

function fallbackProposal(text:string,fileName:string):TransportTariffProposal{
  const upper=text.toUpperCase();const mrw=/\bMRW\b/.test(upper)||/EXPEDICIONES?\s+MAÑANA/i.test(text);
  const until=text.match(/(?:hasta|vigencia[^\n]{0,80}?hasta)(?:\s+el)?\s+(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/i)||text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})/);
  const effectiveTo=until?isoDate(until[1],until[2],until[3]):null;
  const vatExcluded=/no\s+incluyen?\s+iva|iva\s+no\s+incluido|sin\s+iva/i.test(text);
  const vatIncluded=/iva\s+incluido/i.test(text)&&!vatExcluded;
  const fuelMatch=text.match(/(?:plus|recargo|suplemento)[^\n]{0,60}combustible[^\n%]{0,30}(\d+(?:[.,]\d+)?)\s*%/i)||text.match(/(\d+(?:[.,]\d+)?)\s*%[^\n]{0,50}combustible/i);
  const services=mrw?parseMrwServices(text):[];
  return {
    carrierCode:mrw?'mrw':slug(fileName.split('.')[0])||'carrier',carrierName:mrw?'MRW':clean(fileName.replace(/\.[^.]+$/,''))||'Transportista',
    effectiveFrom:null,effectiveTo,currencyCode:'EUR',pricesIncludeVat:vatIncluded,fuelSurchargePct:fuelMatch?num(fuelMatch[1]):null,
    fuelSurchargeIncluded:!/combustible\s+no\s+incluido|plus\s+combustible\s+no\s+incluido/i.test(text),parserProvider:'automatic-rules',parserModel:null,
    parserConfidence:services.length?0.86:0.45,parserNotes:[services.length?`${services.length} servicios detectados automáticamente.`:'No se detectaron tablas de peso automáticamente; revisa y añade los tramos.',vatExcluded?'El documento indica precios sin IVA.':'Revisa si los precios incluyen IVA.',/combustible\s+no\s+incluido|plus\s+combustible\s+no\s+incluido/i.test(text)?'El documento indica que el combustible no está incluido.':'Revisa el tratamiento del combustible.'],services,
  };
}

function normalizeProposal(value:any,fallback:TransportTariffProposal):TransportTariffProposal{
  if(!value||typeof value!=='object')return fallback;
  const services=Array.isArray(value.services)?value.services.map((service:any,index:number)=>({
    serviceName:clean(service.serviceName)||`Servicio ${index+1}`,canonicalServiceKey:slug(service.canonicalServiceKey||service.serviceName||`service-${index+1}`),
    externalProvider:clean(service.externalProvider)||fallback.carrierCode,externalServiceCode:clean(service.externalServiceCode)||slug(service.serviceName||`service-${index+1}`),
    mappingStatus:(['suggested','confirmed','unmapped'].includes(service.mappingStatus)?service.mappingStatus:'suggested') as TransportMappingStatus,sortOrder:index,
    bands:Array.isArray(service.bands)?service.bands.map((band:any,bandIndex:number)=>({countryCode:clean(band.countryCode).toUpperCase().slice(0,2),zoneCode:slug(band.zoneCode||band.zoneName||'zone'),zoneName:clean(band.zoneName)||clean(band.zoneCode)||'Zona',minWeightKg:Number(band.minWeightKg||0),maxWeightKg:band.maxWeightKg==null?null:Number(band.maxWeightKg),basePrice:band.basePrice==null?null:Number(band.basePrice),extraKgPrice:band.extraKgPrice==null?null:Number(band.extraKgPrice),notes:clean(band.notes)||null,sortOrder:bandIndex})).filter((band:any)=>band.countryCode.length===2&&(band.basePrice!=null||band.extraKgPrice!=null)):[],
  })).filter((service:any)=>service.serviceName):fallback.services;
  return {...fallback,...value,carrierCode:slug(value.carrierCode||fallback.carrierCode),carrierName:clean(value.carrierName)||fallback.carrierName,effectiveFrom:value.effectiveFrom||null,effectiveTo:value.effectiveTo||null,currencyCode:clean(value.currencyCode||fallback.currencyCode).toUpperCase(),fuelSurchargePct:value.fuelSurchargePct==null?null:Number(value.fuelSurchargePct),parserConfidence:Number(value.parserConfidence??fallback.parserConfidence),parserNotes:Array.isArray(value.parserNotes)?value.parserNotes.map(clean).filter(Boolean):fallback.parserNotes,services};
}

export async function parseTransportTariffDocument(file:File):Promise<TransportTariffProposal>{
  const text=await readTransportDocumentText(file);if(!clean(text))throw new Error('No se ha podido extraer texto del documento.');
  const fallback=fallbackProposal(text,file.name);
  try{
    const {data,error}=await supabase.functions.invoke('transport-tariff-parser',{body:{fileName:file.name,mimeType:file.type,text:text.slice(0,90000),fallback}});
    if(!error&&data?.proposal)return normalizeProposal(data.proposal,{...fallback,parserProvider:data.parserProvider||fallback.parserProvider,parserModel:data.parserModel||null,parserConfidence:Number(data.parserConfidence??fallback.parserConfidence)});
  }catch{/* El lector automático local mantiene el flujo disponible si el proveedor IA no está configurado. */}
  return fallback;
}

function mapDocument(row:any):TransportTariffDocument{
  const revisions=(row.transport_tariff_revisions||[]).sort((a:any,b:any)=>String(a.effective_from||'').localeCompare(String(b.effective_from||''))).map((item:any)=>({id:item.id,effectiveFrom:item.effective_from,snapshot:item.snapshot as TransportTariffProposal}));
  const services=(row.transport_tariff_services||[]).sort((a:any,b:any)=>(a.sort_order||0)-(b.sort_order||0)).map((service:any)=>({id:service.id,serviceName:service.service_name,canonicalServiceKey:service.canonical_service_key,externalProvider:service.external_provider||'',externalServiceCode:service.external_service_code||'',mappingStatus:service.mapping_status,sortOrder:service.sort_order,bands:(service.transport_tariff_bands||[]).sort((a:any,b:any)=>(a.sort_order||0)-(b.sort_order||0)).map((band:any)=>({id:band.id,countryCode:band.country_code,zoneCode:band.zone_code,zoneName:band.zone_name,minWeightKg:Number(band.min_weight_kg),maxWeightKg:band.max_weight_kg==null?null:Number(band.max_weight_kg),basePrice:band.base_price==null?null:Number(band.base_price),extraKgPrice:band.extra_kg_price==null?null:Number(band.extra_kg_price),notes:band.notes||null,sortOrder:band.sort_order}))}));
  return {id:row.id,status:row.status,carrierCode:row.carrier_code,carrierName:row.carrier_name,effectiveFrom:row.effective_from||null,effectiveTo:row.effective_to||null,currencyCode:row.currency_code,pricesIncludeVat:Boolean(row.prices_include_vat),fuelSurchargePct:row.fuel_surcharge_pct==null?null:Number(row.fuel_surcharge_pct),fuelSurchargeIncluded:Boolean(row.fuel_surcharge_included),parserProvider:row.parser_provider||'unknown',parserModel:row.parser_model||null,parserConfidence:Number(row.parser_confidence||0),parserNotes:Array.isArray(row.parser_notes?.notes)?row.parser_notes.notes:[],services,revisions,sourceFileName:row.source_file_name||null,sourceFilePath:row.source_file_path||null,sourceMimeType:row.source_mime_type||null,createdAt:row.created_at,reviewedAt:row.reviewed_at||null,activatedAt:row.activated_at||null};
}

async function insertServices(documentId:string,ownerId:string,carrierCode:string,services:TransportTariffServiceDraft[]){
  const {data:mappings}=await supabase.from('transport_service_mappings').select('*').eq('owner_id',ownerId).eq('carrier_code',carrierCode);
  const byKey=new Map((mappings||[]).map((item:any)=>[item.canonical_service_key,item]));
  for(let index=0;index<services.length;index+=1){
    const service=services[index],remembered=byKey.get(service.canonicalServiceKey) as any;
    const payload={owner_id:ownerId,document_id:documentId,service_name:service.serviceName,canonical_service_key:service.canonicalServiceKey,external_provider:remembered?.external_provider||service.externalProvider||null,external_service_code:remembered?.external_service_code||service.externalServiceCode||null,mapping_status:remembered?'confirmed':service.mappingStatus,sort_order:index};
    const {data:saved,error}=await supabase.from('transport_tariff_services').insert(payload).select('id').single();if(error)throw error;
    if(service.bands.length){const bands=service.bands.map((band,bandIndex)=>({owner_id:ownerId,service_id:saved.id,country_code:band.countryCode.toUpperCase(),zone_code:band.zoneCode,zone_name:band.zoneName,min_weight_kg:band.minWeightKg,max_weight_kg:band.maxWeightKg,base_price:band.basePrice,extra_kg_price:band.extraKgPrice,notes:band.notes||null,sort_order:bandIndex}));const {error:bandError}=await supabase.from('transport_tariff_bands').insert(bands);if(bandError)throw bandError}
  }
}

export async function createTransportTariffDraft(file:File,proposal:TransportTariffProposal){
  const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Sesión no válida.');
  const id=crypto.randomUUID(),path=`${user.id}/${id}/${safeFileName(file.name)}`,digest=await sha256(file);
  const {error:uploadError}=await supabase.storage.from(BUCKET).upload(path,file,{contentType:file.type||undefined,upsert:false});if(uploadError)throw uploadError;
  try{
    const documentPayload={id,carrier_code:proposal.carrierCode,carrier_name:proposal.carrierName,status:'draft',effective_from:proposal.effectiveFrom,effective_to:proposal.effectiveTo,currency_code:proposal.currencyCode,prices_include_vat:proposal.pricesIncludeVat,fuel_surcharge_pct:proposal.fuelSurchargePct,fuel_surcharge_included:proposal.fuelSurchargeIncluded,source_file_name:file.name,source_file_path:path,source_mime_type:file.type||null,source_sha256:digest,parser_provider:proposal.parserProvider,parser_model:proposal.parserModel,parser_confidence:proposal.parserConfidence,parser_notes:{notes:proposal.parserNotes}};
    const {data:document,error}=await supabase.from('transport_tariff_documents').insert(documentPayload).select('id,owner_id').single();if(error)throw error;
    await insertServices(document.id,document.owner_id,proposal.carrierCode,proposal.services);
    return document.id as string;
  }catch(error){await supabase.storage.from(BUCKET).remove([path]).catch(()=>undefined);await supabase.from('transport_tariff_documents').delete().eq('id',id);throw error}
}

export async function listTransportTariffs():Promise<TransportTariffDocument[]>{
  const {data,error}=await supabase.from('transport_tariff_documents').select('*,transport_tariff_revisions(*),transport_tariff_services(*,transport_tariff_bands(*))').order('created_at',{ascending:false});if(error)throw error;return (data||[]).map(mapDocument);
}

export async function saveTransportTariffReview(document:TransportTariffDocument){
  if(document.status!=='draft')throw new Error('Solo se pueden modificar borradores con esta operación.');
  const {data:ownerRow,error:ownerError}=await supabase.from('transport_tariff_documents').select('owner_id').eq('id',document.id).single();if(ownerError)throw ownerError;
  const {error}=await supabase.from('transport_tariff_documents').update({carrier_code:document.carrierCode,carrier_name:document.carrierName,effective_from:document.effectiveFrom,effective_to:document.effectiveTo,currency_code:document.currencyCode,prices_include_vat:document.pricesIncludeVat,fuel_surcharge_pct:document.fuelSurchargePct,fuel_surcharge_included:document.fuelSurchargeIncluded,updated_at:new Date().toISOString()}).eq('id',document.id);if(error)throw error;
  const {error:deleteError}=await supabase.from('transport_tariff_services').delete().eq('document_id',document.id);if(deleteError)throw deleteError;
  await insertServices(document.id,ownerRow.owner_id,document.carrierCode,document.services);
}

function tariffSnapshot(document:TransportTariffDocument):TransportTariffProposal{
  return {
    carrierCode:document.carrierCode,carrierName:document.carrierName,effectiveFrom:document.effectiveFrom,effectiveTo:document.effectiveTo,
    currencyCode:document.currencyCode,pricesIncludeVat:document.pricesIncludeVat,fuelSurchargePct:document.fuelSurchargePct,
    fuelSurchargeIncluded:document.fuelSurchargeIncluded,parserProvider:document.parserProvider,parserModel:document.parserModel,
    parserConfidence:document.parserConfidence,parserNotes:document.parserNotes,
    services:document.services.map(service=>({...service,bands:service.bands.map(band=>({...band}))}))
  };
}

export async function saveActiveTransportTariff(document:TransportTariffDocument,applyFrom:string){
  if(document.status!=='active')throw new Error('La tarifa no está activa.');
  if(!applyFrom)throw new Error('Indica desde qué fecha se aplican los cambios.');
  const {data,error}=await supabase.rpc('transport_tariff_save_active',{document_id:document.id,apply_from:applyFrom,snapshot:tariffSnapshot(document)});if(error)throw error;
  const {error:repriceError}=await supabase.rpc('transport_tariff_reprice_estimates',{document_id:document.id});if(repriceError)throw repriceError;
  return data;
}

export async function markTransportTariffReviewed(documentId:string){const {data,error}=await supabase.rpc('transport_tariff_mark_reviewed',{document_id:documentId});if(error)throw error;return data}
export async function activateTransportTariff(documentId:string){const {data,error}=await supabase.rpc('transport_tariff_activate',{document_id:documentId});if(error)throw error;return data}
export async function deleteTransportTariffDraft(document:TransportTariffDocument){if(!['draft','reviewed'].includes(document.status))throw new Error('Una tarifa activa no se puede eliminar.');const {error}=await supabase.from('transport_tariff_documents').delete().eq('id',document.id);if(error)throw error;if(document.sourceFilePath)await supabase.storage.from(BUCKET).remove([document.sourceFilePath]).catch(()=>undefined)}
