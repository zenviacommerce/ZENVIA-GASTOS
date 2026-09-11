import type { ExpenseCategory, NewInvoiceInput } from '../types';
import { classifyInvoiceFile } from './invoiceCandidateClassifier';
import { readInvoiceDocumentEnhanced } from './invoiceReaderEnhanced';
import { createInvoice } from './repository';
import { supabase } from './supabase';
import { downloadGmailAttachment, updateGmailImport, type GmailCandidate } from './gmail';

class NotInvoiceDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotInvoiceDocumentError';
  }
}

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

function normalizeAttachmentFile(file: File) {
  const currentType = String(file.type || '').toLowerCase();
  if (currentType && currentType !== 'application/octet-stream') return file;

  const name = file.name.toLowerCase();
  let normalizedType = currentType || 'application/octet-stream';
  if (name.endsWith('.pdf')) normalizedType = 'application/pdf';
  else if (/\.jpe?g$/i.test(name)) normalizedType = 'image/jpeg';
  else if (name.endsWith('.png')) normalizedType = 'image/png';
  else if (name.endsWith('.webp')) normalizedType = 'image/webp';

  if (normalizedType === currentType) return file;
  return new File([file], file.name, { type: normalizedType, lastModified: file.lastModified });
}

function invoiceNumberFromFilename(filename: string) {
  const base = filename.trim().replace(/\.[^.]+$/, '');
  return /^\d{6,20}$/.test(base) ? base : '';
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

async function findInvoiceBySupplierAndNumber(supplierName: string, invoiceNumber?: string | null) {
  const cleanSupplier = supplierName.trim();
  const cleanNumber = String(invoiceNumber || '').trim();
  if (!cleanSupplier || !cleanNumber) return undefined;

  const { data: suppliers, error: supplierError } = await supabase
    .from('suppliers')
    .select('id')
    .ilike('name', cleanSupplier)
    .limit(5);
  if (supplierError) throw supplierError;
  const supplierIds = (suppliers || []).map((supplier: any) => supplier.id).filter(Boolean);
  if (!supplierIds.length) return undefined;

  const { data: invoices, error: invoiceError } = await supabase
    .from('invoices')
    .select('id')
    .in('supplier_id', supplierIds)
    .eq('invoice_number', cleanNumber)
    .order('created_at', { ascending: false })
    .limit(1);
  if (invoiceError) throw invoiceError;
  return invoices?.[0]?.id as string | undefined;
}

function isSupplierNumberDuplicate(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as Record<string, unknown>;
  const haystack = [value.code, value.message, value.details, value.hint]
    .filter(item => typeof item === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes('invoices_supplier_number_uidx') || (haystack.includes('23505') && haystack.includes('invoice'));
}

async function markDuplicateAsImported(candidate: GmailCandidate, invoiceId: string, reason: string) {
  await updateGmailImport(candidate.id!, 'imported', invoiceId, {
    importedAt: new Date().toISOString(),
    duplicateResolved: true,
    duplicateReason: reason,
  });
  return invoiceId;
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
    stage = 'descargar el adjunto de Gmail';
    onProgress?.('Descargando adjunto de Gmail…');
    const downloadedFile = await downloadGmailAttachment(accessToken, candidate);
    const file = normalizeAttachmentFile(downloadedFile);

    stage = 'comprobar duplicados';
    const fileHash = await sha256(file);
    const existingInvoiceId = await findInvoiceByHash(fileHash);
    if (existingInvoiceId) {
      return markDuplicateAsImported(candidate, existingInvoiceId, 'file_hash');
    }

    // Los candidatos nuevos ya llegan validados desde la búsqueda. Para registros
    // antiguos, creados con el filtro permisivo, hacemos la validación antes de
    // permitir que creen una factura real.
    if (candidate.metadata?.invoiceClassificationVersion !== 1) {
      stage = 'validar que el documento sea una factura';
      onProgress?.('Comprobando que el documento sea realmente una factura…');
      const classification = await classifyInvoiceFile(file, {
        filename: candidate.attachmentName,
        subject: candidate.subject,
        snippet: candidate.snippet,
        sender: candidate.sender,
      });
      if (!classification.isInvoice) {
        await updateGmailImport(candidate.id, 'ignored', null, {
          autoRejected: true,
          autoRejectedAt: new Date().toISOString(),
          invoiceClassificationVersion: 1,
          invoiceClassificationScore: classification.score,
          invoiceClassificationSignals: classification.signals,
          invoiceClassificationNegativeSignals: classification.negativeSignals,
        });
        throw new NotInvoiceDocumentError('El PDF se ha descartado porque no contiene una estructura suficiente de factura. Puedes recuperarlo desde «Ignoradas» si quieres revisarlo manualmente.');
      }
    }

    stage = 'leer la factura';
    onProgress?.('Leyendo la factura…');
    const extraction = await readInvoiceDocumentEnhanced(file, categories, onProgress);
    const supplierName = extraction.supplierName || senderFallback(candidate.sender);
    const receivedDate = validIsoDate(candidate.receivedAt?.slice(0, 10));
    const invoiceDate = validIsoDate(extraction.invoiceDate) || receivedDate || new Date().toISOString().slice(0, 10);
    const filenameInvoiceNumber = invoiceNumberFromFilename(candidate.attachmentName);
    const invoiceNumber = filenameInvoiceNumber || extraction.invoiceNumber;

    const duplicateBySupplierNumber = await findInvoiceBySupplierAndNumber(supplierName, invoiceNumber);
    if (duplicateBySupplierNumber) {
      return markDuplicateAsImported(candidate, duplicateBySupplierNumber, 'supplier_invoice_number');
    }

    const invoiceInput: NewInvoiceInput = {
      file,
      source: 'gmail',
      supplierName,
      invoiceNumber,
      invoiceDate,
      categoryId: extraction.categoryId,
      subtotal: extraction.subtotal,
      vat: extraction.vat,
      withholding: extraction.withholding,
      total: extraction.total,
      ocrText: extraction.text,
      extraction: {
        parser: extraction.usedOcr ? 'gmail-browser-ocr-v2' : 'gmail-pdf-text-v2',
        gmailMessageId: candidate.messageId,
        gmailAttachmentId: candidate.attachmentId,
        originalMimeType: candidate.mimeType,
        normalizedMimeType: file.type,
        supplierName: extraction.supplierName,
        extractedInvoiceNumber: extraction.invoiceNumber,
        filenameInvoiceNumber: filenameInvoiceNumber || null,
        invoiceNumber,
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
    stage = 'guardar la factura y sus líneas';
    onProgress?.('Guardando factura y líneas de producto…');
    try {
      await createInvoice(invoiceInput);
    } catch (firstSaveError) {
      if (isSupplierNumberDuplicate(firstSaveError)) {
        const duplicateId = await findInvoiceBySupplierAndNumber(supplierName, invoiceNumber);
        if (duplicateId) return markDuplicateAsImported(candidate, duplicateId, 'supplier_invoice_number_race');
      }

      const firstMessage = errorMessage(firstSaveError);
      if (!extraction.lines.length) throw new Error(firstMessage);

      stage = 'guardar la factura sin líneas automáticas';
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
        if (isSupplierNumberDuplicate(fallbackError)) {
          const duplicateId = await findInvoiceBySupplierAndNumber(supplierName, invoiceNumber);
          if (duplicateId) return markDuplicateAsImported(candidate, duplicateId, 'supplier_invoice_number_race');
        }
        throw new Error(`No se pudo guardar la factura. Primer intento: ${firstMessage}. Reintento sin líneas: ${errorMessage(fallbackError)}`);
      }
    }

    stage = 'confirmar la importación';
    const invoiceId = await findInvoiceByHash(fileHash);
    if (!invoiceId) throw new Error('La factura se guardó, pero no se pudo recuperar su identificador.');

    await updateGmailImport(candidate.id, 'imported', invoiceId, {
      importedAt: new Date().toISOString(),
      confidence: extraction.confidence,
      lineCount: lineImportWarning ? 0 : extraction.lines.length,
      detectedLineCount: extraction.lines.length,
      originalMimeType: candidate.mimeType,
      normalizedMimeType: file.type,
      invoiceNumber,
      ...(lineImportWarning ? { lineImportWarning } : {}),
    });
    return invoiceId;
  } catch (error) {
    if (error instanceof NotInvoiceDocumentError) throw error;
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
