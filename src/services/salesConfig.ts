import { supabase } from './supabase';

export type TaxRegistration = {
  id: string;
  label: string;
  countryCode: string;
  vatNumber: string;
  fiscalName?: string | null;
  addressText?: string | null;
  isDefault: boolean;
  active: boolean;
  notes?: string | null;
};

export type TaxRegistrationInput = Omit<TaxRegistration,'id'>;

export type ManagedSalesSeries = {
  id: string;
  code: string;
  name: string;
  kind: 'standard'|'rectifying';
  year: number;
  prefix: string;
  nextNumber: number;
  padding: number;
  active: boolean;
};

export type SalesSeriesInput = Omit<ManagedSalesSeries,'id'>;

const clean=(value?:string|null)=>value?.trim()||null;

export async function loadTaxRegistrations():Promise<TaxRegistration[]> {
  const {data,error}=await supabase.from('business_tax_registrations').select('*').order('is_default',{ascending:false}).order('country_code').order('label');
  if(error)throw error;
  return (data??[]).map((row:any)=>({
    id:row.id,label:row.label,countryCode:row.country_code,vatNumber:row.vat_number,
    fiscalName:row.fiscal_name,addressText:row.address_text,isDefault:Boolean(row.is_default),
    active:Boolean(row.active),notes:row.notes,
  }));
}

export async function addTaxRegistration(input:TaxRegistrationInput){
  if(input.isDefault){
    const {error:clearError}=await supabase.from('business_tax_registrations').update({is_default:false}).eq('is_default',true);
    if(clearError)throw clearError;
  }
  const {error}=await supabase.from('business_tax_registrations').insert({
    label:input.label.trim(),country_code:input.countryCode.trim().toUpperCase().slice(0,2),vat_number:input.vatNumber.trim().toUpperCase(),
    fiscal_name:clean(input.fiscalName),address_text:clean(input.addressText),is_default:input.isDefault,active:input.active,notes:clean(input.notes),
  });
  if(error)throw error;
}

export async function updateTaxRegistration(id:string,input:TaxRegistrationInput){
  if(input.isDefault){
    const {error:clearError}=await supabase.from('business_tax_registrations').update({is_default:false}).eq('is_default',true).neq('id',id);
    if(clearError)throw clearError;
  }
  const {error}=await supabase.from('business_tax_registrations').update({
    label:input.label.trim(),country_code:input.countryCode.trim().toUpperCase().slice(0,2),vat_number:input.vatNumber.trim().toUpperCase(),
    fiscal_name:clean(input.fiscalName),address_text:clean(input.addressText),is_default:input.isDefault,active:input.active,notes:clean(input.notes),updated_at:new Date().toISOString(),
  }).eq('id',id);
  if(error)throw error;
}

export async function deleteTaxRegistration(id:string){
  const {error}=await supabase.from('business_tax_registrations').delete().eq('id',id);
  if(error){
    if(error.code==='23503')throw new Error('Este registro IVA está asociado a facturas. Desactívalo en lugar de eliminarlo.');
    throw error;
  }
}

export async function loadManagedSalesSeries():Promise<ManagedSalesSeries[]> {
  const {data,error}=await supabase.from('sales_invoice_series').select('*').order('year',{ascending:false}).order('kind').order('code');
  if(error)throw error;
  return (data??[]).map((row:any)=>({id:row.id,code:row.code,name:row.name,kind:row.kind,year:row.year,prefix:row.prefix,nextNumber:Number(row.next_number),padding:Number(row.padding),active:Boolean(row.active)}));
}

export async function addSalesSeries(input:SalesSeriesInput){
  const {error}=await supabase.from('sales_invoice_series').insert({
    code:input.code.trim().toUpperCase(),name:input.name.trim(),kind:input.kind,year:input.year,prefix:input.prefix,
    next_number:Math.max(1,Math.trunc(input.nextNumber)),padding:Math.min(8,Math.max(1,Math.trunc(input.padding))),active:input.active,
  });
  if(error)throw error;
}

export async function updateSalesSeries(id:string,input:SalesSeriesInput){
  const {error}=await supabase.from('sales_invoice_series').update({
    code:input.code.trim().toUpperCase(),name:input.name.trim(),kind:input.kind,year:input.year,prefix:input.prefix,
    next_number:Math.max(1,Math.trunc(input.nextNumber)),padding:Math.min(8,Math.max(1,Math.trunc(input.padding))),active:input.active,updated_at:new Date().toISOString(),
  }).eq('id',id);
  if(error)throw error;
}

export async function deleteSalesSeries(id:string){
  const {error}=await supabase.from('sales_invoice_series').delete().eq('id',id);
  if(error){
    if(error.code==='23503')throw new Error('Esta serie ya tiene facturas asociadas. Puedes desactivarla, pero no eliminarla.');
    throw error;
  }
}
