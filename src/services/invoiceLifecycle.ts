import { deleteInvoice } from './repository';
import { supabase } from './supabase';
import { loadGmailImports, updateGmailImport, type GmailCandidate } from './gmail';

export async function deleteInvoiceWithGmailRecovery(invoiceId: string, filePath?: string | null) {
  const { data: gmailLinks, error: gmailReadError } = await supabase
    .from('gmail_imports')
    .select('id,metadata')
    .eq('invoice_id', invoiceId);

  if (gmailReadError) throw gmailReadError;

  await deleteInvoice(invoiceId, filePath);

  if (!gmailLinks?.length) return;

  const reopenedAt = new Date().toISOString();
  const updates = await Promise.all(gmailLinks.map(link => supabase
    .from('gmail_imports')
    .update({
      status: 'found',
      invoice_id: null,
      metadata: {
        ...(link.metadata || {}),
        reopenReason: 'invoice_deleted',
        reopenedAt,
      },
    })
    .eq('id', link.id)));

  for (const result of updates) {
    if (result.error) {
      console.warn('La factura se borró, pero no se pudo reabrir automáticamente el adjunto de Gmail.', result.error);
    }
  }
}

export async function loadRecoverableGmailImports(): Promise<GmailCandidate[]> {
  const imports = await loadGmailImports();
  const stale = imports.filter(item => item.id && item.status === 'imported' && !item.invoiceId);
  if (!stale.length) return imports;

  const reopenedAt = new Date().toISOString();
  await Promise.all(stale.map(item => updateGmailImport(item.id!, 'found', null, {
    ...(item.metadata || {}),
    reopenReason: 'invoice_deleted',
    reopenedAt,
  })));

  return loadGmailImports();
}
