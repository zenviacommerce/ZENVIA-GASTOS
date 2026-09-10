import type { ExpenseCategory } from '../types';
import { readInvoiceDocument } from './invoiceReader';
import { createInvoice } from './repository';
import { supabase } from './supabase';
import { downloadGmailAttachment, updateGmailImport, type GmailCandidate } from './gmail';

function senderFallback(sender?: string | null) {
  if (!sender) return 'Proveedor Gmail';
  const display = sender.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
  if (display) return display;
  const email = sender.match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1];
  return email || sender.trim() || 'Proveedor Gmail';
}

async function sha256(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
}

async function findInvoiceByHash(fileHash: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id')
    .eq('file_hash', fileHash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id as string | undefined;
}

export async function importGmailCandidate(
  accessToken: string,
  candidate: GmailCandidate,
  categories: ExpenseCategory[],
  onProgress?: (message: string) => void,
) {
  if (!candidate.id) throw new Error('El adjunto de Gmail no está registrado todavía.');

  try {
    onProgress?.('Descargando adjunto de Gmail…');
    const file = await downloadGmailAttachment(accessToken, candidate);
    const fileHash = await sha256(file);
    const existingInvoiceId = await findInvoiceByHash(fileHash);
    if (existingInvoiceId) {
      await updateGmailImport(candidate.id, 'imported', existingInvoiceId, {
        importedAt: new Date().toISOString(),
        duplicateResolved: true,
      });
      return existingInvoiceId;
    }

    onProgress?.('Leyendo la factura…');
    const extraction = await readInvoiceDocument(file, categories, onProgress);
    const supplierName = extraction.supplierName || senderFallback(candidate.sender);
    const invoiceDate = extraction.invoiceDate || candidate.receivedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);

    await createInvoice({
      file,
      source: 'gmail',
      supplierName,
      invoiceNumber: extraction.invoiceNumber,
      invoiceDate,
      categoryId: extraction.categoryId,
      subtotal: extraction.subtotal,
      vat: extraction.vat,
      withholding: extraction.withholding,
      total: extraction.total,
      ocrText: extraction.text,
      extraction: {
        parser: extraction.usedOcr ? 'gmail-browser-ocr-v1' : 'gmail-pdf-text-v1',
        gmailMessageId: candidate.messageId,
        gmailAttachmentId: candidate.attachmentId,
        supplierName: extraction.supplierName,
        invoiceNumber: extraction.invoiceNumber,
        invoiceDate: extraction.invoiceDate,
        categoryId: extraction.categoryId ?? null,
        subtotal: extraction.subtotal,
        vat: extraction.vat,
        withholding: extraction.withholding,
        total: extraction.total,
        lineCount: extraction.lines.length,
      },
      extractionConfidence: extraction.confidence,
      lines: extraction.lines,
    });

    const invoiceId = await findInvoiceByHash(fileHash);
    await updateGmailImport(candidate.id, 'imported', invoiceId || null, {
      importedAt: new Date().toISOString(),
      confidence: extraction.confidence,
      lineCount: extraction.lines.length,
    });
    return invoiceId;
  } catch (error) {
    await updateGmailImport(candidate.id, 'error', null, {
      lastError: error instanceof Error ? error.message : 'Error desconocido',
      lastErrorAt: new Date().toISOString(),
    }).catch(() => undefined);
    throw error;
  }
}
