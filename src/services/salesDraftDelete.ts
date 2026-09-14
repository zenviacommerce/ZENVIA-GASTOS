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

  // Delete child rows while the parent is still visible as a draft. This also avoids
  // the line immutability guard being confused by an ON DELETE CASCADE after the
  // parent row has already disappeared from the trigger snapshot.
  const { error: lineError } = await supabase
    .from('sales_invoice_lines')
    .delete()
    .eq('invoice_id',id);
  if(lineError) throw lineError;

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
