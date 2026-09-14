import { supabase } from './supabase';

export async function createRectifyingInvoice(originalInvoiceId:string){
  const year=new Date().getFullYear();
  const {data:series,error:seriesError}=await supabase
    .from('sales_invoice_series')
    .select('id')
    .eq('kind','rectifying')
    .eq('year',year)
    .eq('active',true)
    .limit(1);
  if(seriesError)throw seriesError;
  if(!series?.length){
    const {error:createError}=await supabase.from('sales_invoice_series').insert({
      code:'R',name:`Rectificativas ${year}`,kind:'rectifying',year,prefix:`R-${year}-`,next_number:1,padding:4,
    });
    if(createError&&createError.code!=='23505')throw createError;
  }
  const {data,error}=await supabase.rpc('create_rectifying_invoice',{p_original_id:originalInvoiceId});
  if(error)throw error;
  return data as string;
}
