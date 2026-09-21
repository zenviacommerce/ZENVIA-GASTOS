import { supabase } from './supabase';
import { syncSendcloudOrders } from './orders';
import { requestAmazonSync } from './amazon';

export type DuplicateEvidence=
  |'same_tax_id'
  |'same_normalized_name'
  |'same_sku'
  |'same_file_hash'
  |'same_supplier_invoice_number'
  |'compatible_date'
  |'compatible_amount';

export type DuplicateCandidate={
  id:string;
  leftId:string;
  leftLabel:string;
  rightId:string;
  rightLabel:string;
  confidence:number;
  evidence:DuplicateEvidence[];
};

export type MergePreview={
  sourceId:string;
  sourceLabel:string;
  destinationId:string;
  destinationLabel:string;
  affected:Record<string,number>;
  warnings:string[];
};

function normalize(value:unknown){
  return String(value??'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\b(s\.?l\.?u?|s\.?a\.?|sl|slu|sa|sociedad limitada|sociedad anonima)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}
function tax(value:unknown){return String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'').trim();}
function invoiceNumber(value:unknown){return String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'').trim();}
function pairId(kind:string,a:string,b:string){return kind+':'+[a,b].sort().join(':');}
function withinDays(a:unknown,b:unknown,days:number){
  if(!a||!b)return false;
  const one=new Date(String(a)+'T12:00:00').getTime(),two=new Date(String(b)+'T12:00:00').getTime();
  return Number.isFinite(one)&&Number.isFinite(two)&&Math.abs(one-two)<=days*86400000;
}
function amountCompatible(a:unknown,b:unknown){
  const one=Number(a),two=Number(b);
  return Number.isFinite(one)&&Number.isFinite(two)&&Math.abs(one-two)<=0.01;
}
function thresholdValue(value:number|undefined){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):80;}

export async function findSupplierDuplicates(threshold=80):Promise<DuplicateCandidate[]>{
  const {data,error}=await supabase.from('suppliers').select('id,name,tax_id').eq('active',true).order('name');
  if(error)throw error;
  const rows=data||[],minimum=thresholdValue(threshold),result:DuplicateCandidate[]=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a:any=rows[i],b:any=rows[j],evidence:DuplicateEvidence[]=[];
    let confidence=0;
    const ta=tax(a.tax_id),tb=tax(b.tax_id),na=normalize(a.name),nb=normalize(b.name);
    if(ta&&tb&&ta===tb){evidence.push('same_tax_id');confidence=100;}
    else if(na&&na===nb){evidence.push('same_normalized_name');confidence=80;}
    if(confidence>=minimum)result.push({id:pairId('supplier',a.id,b.id),leftId:a.id,leftLabel:a.name,rightId:b.id,rightLabel:b.name,confidence,evidence});
  }
  return result.sort((a,b)=>b.confidence-a.confidence||a.leftLabel.localeCompare(b.leftLabel,'es'));
}

export async function findClientDuplicates(threshold=80):Promise<DuplicateCandidate[]>{
  const {data,error}=await supabase.from('clients').select('id,name,tax_id').eq('active',true).order('name');
  if(error)throw error;
  const rows=data||[],minimum=thresholdValue(threshold),result:DuplicateCandidate[]=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a:any=rows[i],b:any=rows[j],evidence:DuplicateEvidence[]=[];
    let confidence=0;
    const ta=tax(a.tax_id),tb=tax(b.tax_id),na=normalize(a.name),nb=normalize(b.name);
    if(ta&&tb&&ta===tb){evidence.push('same_tax_id');confidence=100;}
    else if(na&&na===nb){evidence.push('same_normalized_name');confidence=80;}
    if(confidence>=minimum)result.push({id:pairId('client',a.id,b.id),leftId:a.id,leftLabel:a.name,rightId:b.id,rightLabel:b.name,confidence,evidence});
  }
  return result.sort((a,b)=>b.confidence-a.confidence||a.leftLabel.localeCompare(b.leftLabel,'es'));
}

export async function findProductDuplicates(threshold=80):Promise<DuplicateCandidate[]>{
  const {data,error}=await supabase.from('products').select('id,name,sku').eq('active',true).order('name');
  if(error)throw error;
  const rows=data||[],minimum=thresholdValue(threshold),result:DuplicateCandidate[]=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a:any=rows[i],b:any=rows[j],evidence:DuplicateEvidence[]=[];
    let confidence=0;
    const sa=normalize(a.sku),sb=normalize(b.sku),na=normalize(a.name),nb=normalize(b.name);
    if(sa&&sb&&sa===sb){evidence.push('same_sku');confidence=100;}
    else if(na&&na===nb){evidence.push('same_normalized_name');confidence=80;}
    if(confidence>=minimum)result.push({id:pairId('product',a.id,b.id),leftId:a.id,leftLabel:a.name,rightId:b.id,rightLabel:b.name,confidence,evidence});
  }
  return result.sort((a,b)=>b.confidence-a.confidence||a.leftLabel.localeCompare(b.leftLabel,'es'));
}

export async function findInvoiceDuplicates(threshold=80):Promise<DuplicateCandidate[]>{
  const {data,error}=await supabase.from('invoices').select('id,supplier_id,invoice_number,issue_date,total_amount,file_hash').order('issue_date',{ascending:false,nullsFirst:false});
  if(error)throw error;
  const rows=data||[],minimum=thresholdValue(threshold),result:DuplicateCandidate[]=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a:any=rows[i],b:any=rows[j],evidence:DuplicateEvidence[]=[];
    let confidence=0;
    if(a.file_hash&&b.file_hash&&a.file_hash===b.file_hash){evidence.push('same_file_hash');confidence=100;}
    else if(a.supplier_id&&a.supplier_id===b.supplier_id&&invoiceNumber(a.invoice_number)&&invoiceNumber(a.invoice_number)===invoiceNumber(b.invoice_number)){
      evidence.push('same_supplier_invoice_number');confidence=85;
      if(withinDays(a.issue_date,b.issue_date,3)){evidence.push('compatible_date');confidence+=5;}
      if(amountCompatible(a.total_amount,b.total_amount)){evidence.push('compatible_amount');confidence+=10;}
    }
    confidence=Math.min(100,confidence);
    if(confidence>=minimum)result.push({
      id:pairId('invoice',a.id,b.id),leftId:a.id,leftLabel:String(a.invoice_number||a.id),
      rightId:b.id,rightLabel:String(b.invoice_number||b.id),confidence,evidence,
    });
  }
  return result.sort((a,b)=>b.confidence-a.confidence||a.leftLabel.localeCompare(b.leftLabel,'es'));
}

async function count(table:string,column:string,id:string){
  const {count,error}=await supabase.from(table).select('*',{count:'exact',head:true}).eq(column,id);
  if(error)throw error;
  return count||0;
}
async function label(table:'suppliers'|'clients',id:string){
  const {data,error}=await supabase.from(table).select('name').eq('id',id).single();
  if(error)throw error;
  return String(data?.name||id);
}

export async function previewSupplierMerge(sourceId:string,destinationId:string):Promise<MergePreview>{
  if(sourceId===destinationId)throw new Error('El origen y el destino deben ser distintos.');
  const [sourceLabel,destinationLabel,invoices,priceHistory,products,supplierProducts]=await Promise.all([
    label('suppliers',sourceId),label('suppliers',destinationId),
    count('invoices','supplier_id',sourceId),
    count('product_price_history','supplier_id',sourceId),
    count('products','last_supplier_id',sourceId),
    count('supplier_products','supplier_id',sourceId),
  ]);
  return {
    sourceId,sourceLabel,destinationId,destinationLabel,
    affected:{invoices,priceHistory,products,supplierProducts},
    warnings:['La fusión no se puede deshacer automáticamente.','Si ambos proveedores contienen la misma factura, la operación se bloqueará antes de modificar datos.'],
  };
}

export async function previewClientMerge(sourceId:string,destinationId:string):Promise<MergePreview>{
  if(sourceId===destinationId)throw new Error('El origen y el destino deben ser distintos.');
  const [sourceLabel,destinationLabel,salesInvoices]=await Promise.all([
    label('clients',sourceId),label('clients',destinationId),count('sales_invoices','client_id',sourceId),
  ]);
  return {
    sourceId,sourceLabel,destinationId,destinationLabel,
    affected:{salesInvoices},
    warnings:['La fusión no se puede deshacer automáticamente.','Las facturas conservan la instantánea fiscal y de nombre que tenían al emitirse.'],
  };
}

export async function mergeSupplier(sourceId:string,destinationId:string){
  const {data,error}=await supabase.rpc('configuration_merge_supplier',{p_source_id:sourceId,p_destination_id:destinationId});
  if(error)throw error;
  return data;
}
export async function mergeClient(sourceId:string,destinationId:string){
  const {data,error}=await supabase.rpc('configuration_merge_client',{p_source_id:sourceId,p_destination_id:destinationId});
  if(error)throw error;
  return data;
}

export async function listSuppliersMissingTaxId(){
  const {data,error}=await supabase.from('suppliers').select('id,name,tax_id').eq('active',true).or('tax_id.is.null,tax_id.eq.').order('name');
  if(error)throw error;
  return data||[];
}
export async function listClientsMissingTaxId(){
  const {data,error}=await supabase.from('clients').select('id,name,tax_id').eq('active',true).or('tax_id.is.null,tax_id.eq.').order('name');
  if(error)throw error;
  return data||[];
}
export async function listProductsWithoutCost(){
  const {data,error}=await supabase.from('products').select('id,name,sku,last_cost').eq('active',true).or('last_cost.is.null,last_cost.lte.0').order('name');
  if(error)throw error;
  return data||[];
}

export async function runSendcloudSync(){
  return syncSendcloudOrders(false,true,false);
}
export async function runAmazonSync(){
  return requestAmazonSync();
}
