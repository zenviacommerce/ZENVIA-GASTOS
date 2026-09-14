import { supabase } from './supabase';

export async function deleteSalesInvoiceDraftSafe(id:string){
  const { data: draft, error: readError } = await supabase
    .from('sales_invoices')
    .select('id,status')
    .eq('id',id)
    .maybeSingle();
  if(readError) throw readError;
  if(!draft) throw new Error('No se ha encontrado el borrador.');
  if(draft.status!=='draft') throw new Error('Solo se pueden eliminar facturas que sigan en borrador.');

  const { data: deleted, error } = await supabase
    .from('sales_invoices')
    .delete()
    .eq('id',id)
    .eq('status','draft')
    .select('id')
    .maybeSingle();
  if(error) throw error;
  if(!deleted) throw new Error('El borrador no se pudo eliminar. Revisa tus permisos y vuelve a intentarlo.');
}
