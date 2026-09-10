import type { ExpenseCategory, NewInvoiceInput } from '../types';
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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'details', 'hint', 'code']) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized.slice(0, 500);
    } catch {
      // Ignoramos errores de serialización y usamos el texto genérico.
    }
  }
  return 'Error desconocido';
}

function validIsoDate(value?: string | null): string {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10) === date ? date : '';
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

  let stage = 'iniciando importación';
  try {
    stage = 'descargando el adjunto de Gmail';
    onProgress?.('Descargando adjunto de Gmail…');
    const file = await downloadGmailAttachment(accessToken, candidate);

    stage = 'comprobando duplicados';
    const fileHash = await sha256(file);
    const existingInvoiceId = await findInvoiceByHash(fileHash);
    if (existingInvoiceId) {
      await updateGmailImport(candidate.id, 'imported', existingInvoiceId, {
        importedAt: new Date().toISOString(),
        duplicateResolved: true,
      });
      return existingInvoiceId;
    }

    stage = 'leyendo la factura';
    onProgress?.('Leyendo la factura…');
    const extraction = await readInvoiceDocument(file, categories, onProgress);
    const supplierName = extraction.supplierName || senderFallback(candidate.sender);
    const receivedDate = validIsoDate(candidate.receivedAt?.slice(0, 10));
    const invoiceDate = validIsoDate(extraction.invoiceDate) || receivedDate || new Date().toISOString().slice(0, 10);

    const invoiceInput: NewInvoiceInput = {
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
        normalizedInvoiceDate: invoiceDate,
        categoryId: extraction.categoryId ?? null,
        subtotal: extraction.subtotal,
        vat: extraction.vat,
        withholding: extraction.withholding,
        total: extraction.total,
        lineCount: extraction.lines.length,
      },
      extractionConfidence: extraction.confidence,
      lines: extraction.lines,
    };

    let lineImportWarning = '';
    stage = 'guardando la factura y sus líneas';
    onProgress?.('Guardando factura y líneas de producto…');
    try {
      await createInvoice(invoiceInput);
    } catch (firstSaveError) {
      const firstMessage = errorMessage(firstSaveError);
      if (!extraction.lines.length) throw new Error(firstMessage);

      // La cabecera y el documento son prioritarios. Si el enriquecimiento de líneas/productos
      // falla, createInvoice revierte ese intento; hacemos un segundo guardado sin líneas para
      // que la factura no se pierda y quede disponible para revisión manual.
      stage = 'guardando la factura sin líneas automáticas';
      onProgress?.('Las líneas automáticas dieron un problema. Guardando la factura para revisión…');
      lineImportWarning = firstMessage;
      try {
        await createInvoice({
          ...invoiceInput,
          lines: [],
          extraction: {
            ...(invoiceInput.extraction || {}),
            detectedLineCount: extraction.lines.length,
            lineImportWarning: firstMessage,
          },
        });
      } catch (fallbackError) {
        throw new Error(`No se pudo guardar la factura. Primer intento: ${firstMessage}. Reintento sin líneas: ${errorMessage(fallbackError)}`);
      }
    }

    stage = 'confirmando la importación';
    const invoiceId = await findInvoiceByHash(fileHash);
    if (!invoiceId) throw new Error('La factura se guardó, pero no se pudo recuperar su identificador.');

    await updateGmailImport(candidate.id, 'imported', invoiceId, {
      importedAt: new Date().toISOString(),
      confidence: extraction.confidence,
      lineCount: lineImportWarning ? 0 : extraction.lines.length,
      detectedLineCount: extraction.lines.length,
      ...(lineImportWarning ? { lineImportWarning } : {}),
    });
    return invoiceId;
  } catch (error) {
    const detail = errorMessage(error);
    const fullMessage = `Error al ${stage}: ${detail}`;
    await updateGmailImport(candidate.id, 'error', null, {
      lastError: fullMessage,
      lastErrorAt: new Date().toISOString(),
      lastErrorStage: stage,
    }).catch(() => undefined);
    throw new Error(fullMessage);
  }
}
