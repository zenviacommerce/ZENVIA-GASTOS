import { downloadGmailAttachment, type GmailCandidate } from './gmail';
import { searchGmailInvoiceCandidatesStable, type GmailStableScanResult } from './gmailStableSearch';
import { classifyInvoiceFile, shouldInspectInvoiceAttachment } from './invoiceCandidateClassifier';

function normalizedFile(file: File) {
  const type = String(file.type || '').toLowerCase();
  if (type && type !== 'application/octet-stream') return file;
  const lower = file.name.toLowerCase();
  const normalizedType = lower.endsWith('.pdf') ? 'application/pdf'
    : /\.jpe?g$/i.test(lower) ? 'image/jpeg'
      : lower.endsWith('.png') ? 'image/png'
        : lower.endsWith('.webp') ? 'image/webp'
          : type || 'application/octet-stream';
  return normalizedType === type ? file : new File([file], file.name, { type: normalizedType, lastModified: file.lastModified });
}

export async function searchGmailInvoiceCandidatesDeterministic(
  accessToken: string,
  months: number,
  account: string,
  knownMessageIds: Iterable<string>,
  onProgress?: (message: string) => void,
): Promise<GmailStableScanResult> {
  const base = await searchGmailInvoiceCandidatesStable(accessToken, months, account, knownMessageIds, onProgress);
  if (!base.candidates.length) return base;

  const accepted: GmailCandidate[] = [];
  let inspected = 0;

  for (const candidate of base.candidates) {
    const context = {
      filename: candidate.attachmentName,
      subject: candidate.subject,
      snippet: candidate.snippet,
      sender: candidate.sender,
    };

    if (!shouldInspectInvoiceAttachment(context)) continue;

    inspected += 1;
    onProgress?.(`Validando si es factura ${inspected} de ${base.candidates.length}: ${candidate.attachmentName}…`);

    try {
      const downloaded = await downloadGmailAttachment(accessToken, candidate);
      const file = normalizedFile(downloaded);
      const classification = await classifyInvoiceFile(file, context);
      if (!classification.isInvoice) continue;

      accepted.push({
        ...candidate,
        metadata: {
          ...(candidate.metadata || {}),
          invoiceClassificationVersion: 1,
          invoiceClassificationScore: classification.score,
          invoiceClassificationSignals: classification.signals,
          invoiceClassificationNegativeSignals: classification.negativeSignals,
        },
      });
    } catch (error) {
      console.warn(`No se pudo clasificar ${candidate.attachmentName}.`, error);
      // En caso de fallo de lectura no lo aceptamos automáticamente. Es preferible
      // un falso negativo recuperable a llenar Gmail de PDFs informativos.
    }
  }

  return { ...base, candidates: accepted };
}
