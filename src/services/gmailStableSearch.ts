import type { GmailCandidate } from './gmail';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1200;
const MAX_DELAY_MS = 15000;
const CACHE_PREFIX = 'zenvia-gmail-scanned-v2:';

export interface GmailStableScanResult {
  candidates: GmailCandidate[];
  totalMessages: number;
  newMessages: number;
  cachedMessages: number;
  skippedMessages: number;
}

class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailAuthError';
  }
}

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function parseGmailError(text: string) {
  try {
    const parsed = JSON.parse(text) as any;
    const error = parsed?.error;
    const detail = Array.isArray(error?.errors) ? error.errors[0] : null;
    return {
      reason: String(detail?.reason || error?.status || ''),
      message: String(error?.message || detail?.message || text || ''),
    };
  } catch {
    return { reason: '', message: text || '' };
  }
}

function isTemporaryGmailError(status: number, reason: string, message: string) {
  const r = reason.toLowerCase();
  const m = message.toLowerCase();
  return status === 429
    || status >= 500
    || (status === 403 && (
      r.includes('ratelimit')
      || r.includes('quota')
      || r.includes('resource_exhausted')
      || r.includes('userratelimitexceeded')
      || m.includes('rate limit')
      || m.includes('quota')
      || m.includes('too many requests')
      || m.includes('resource exhausted')
    ));
}

async function gmailFetchJson<T>(accessToken: string, path: string): Promise<T> {
  let lastMessage = '';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) return response.json() as Promise<T>;

    const text = await response.text();
    const { reason, message } = parseGmailError(text);
    lastMessage = message;
    const normalized = `${reason} ${message}`.toLowerCase();
    const authError = response.status === 401
      || normalized.includes('invalid credentials')
      || normalized.includes('insufficient authentication scopes')
      || normalized.includes('insufficientpermissions');

    if (authError) {
      throw new GmailAuthError('La autorización de Gmail ha caducado o ya no tiene permiso de lectura. Pulsa «Conectar Gmail» para renovarla.');
    }

    if (isTemporaryGmailError(response.status, reason, message) && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const exponential = BASE_DELAY_MS * (2 ** attempt) + Math.floor(Math.random() * 500);
      await sleep(Math.min(retryAfter > 0 ? retryAfter * 1000 : exponential, MAX_DELAY_MS));
      continue;
    }

    throw new Error(isTemporaryGmailError(response.status, reason, message)
      ? 'Gmail está limitando temporalmente las peticiones.'
      : `Gmail respondió con un error (${response.status}). ${message.slice(0, 180)}`);
  }
  throw new Error(lastMessage || 'Gmail no respondió tras varios reintentos.');
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  return headers?.find(header => header.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function isSupportedAttachment(filename: string, mimeType: string) {
  const name = filename.toLowerCase();
  return mimeType === 'application/pdf' || mimeType.startsWith('image/') || /\.(pdf|png|jpe?g|webp)$/i.test(name);
}

function looksLikeInvoice(filename: string, subject: string, snippet: string, mimeType: string) {
  const haystack = `${filename} ${subject} ${snippet}`.toLowerCase();
  const invoiceWords = /factura|invoice|receipt|recibo|ticket|billing|bill|fatura|fattura|rechnung/;
  if (invoiceWords.test(haystack)) return true;
  return mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
}

function collectAttachmentParts(part: any, result: Array<{ attachmentId: string; partId?: string; filename: string; mimeType: string; size?: number }>) {
  const filename = String(part?.filename || '').trim();
  const mimeType = String(part?.mimeType || 'application/octet-stream');
  if (filename && isSupportedAttachment(filename, mimeType) && (part?.body?.attachmentId || part?.body?.data)) {
    result.push({
      attachmentId: part.body.attachmentId || `inline:${part.partId || filename}`,
      partId: part.partId || undefined,
      filename,
      mimeType,
      size: Number(part.body.size || 0) || undefined,
    });
  }
  for (const child of part?.parts || []) collectAttachmentParts(child, result);
}

function cacheKey(account: string) {
  return `${CACHE_PREFIX}${account.trim().toLowerCase() || 'default'}`;
}

function loadScannedMessageIds(account: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(account)) || '[]');
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function saveScannedMessageIds(account: string, ids: Set<string>) {
  try {
    localStorage.setItem(cacheKey(account), JSON.stringify(Array.from(ids).slice(-500)));
  } catch {
    // La caché es solo una optimización; si el navegador la bloquea, la búsqueda sigue funcionando.
  }
}

export async function searchGmailInvoiceCandidatesStable(
  accessToken: string,
  months: number,
  account: string,
  knownMessageIds: Iterable<string>,
  onProgress?: (message: string) => void,
): Promise<GmailStableScanResult> {
  const period = months >= 12 && months % 12 === 0 ? `${months / 12}y` : `${months}m`;
  const q = encodeURIComponent(`has:attachment newer_than:${period} {filename:pdf filename:jpg filename:jpeg filename:png filename:webp}`);
  onProgress?.('Buscando correos con adjuntos…');

  const list = await gmailFetchJson<{ messages?: Array<{ id: string; threadId?: string }> }>(
    accessToken,
    `messages?maxResults=100&q=${q}`,
  );
  const messages = list.messages || [];
  if (!messages.length) {
    return { candidates: [], totalMessages: 0, newMessages: 0, cachedMessages: 0, skippedMessages: 0 };
  }

  const scannedIds = loadScannedMessageIds(account);
  const known = new Set<string>(knownMessageIds);
  for (const id of scannedIds) known.add(id);

  const freshMessages = messages.filter(message => !known.has(message.id));
  const cachedMessages = messages.length - freshMessages.length;
  if (!freshMessages.length) {
    onProgress?.(`Gmail al día: ${cachedMessages} correos ya estaban revisados.`);
    return { candidates: [], totalMessages: messages.length, newMessages: 0, cachedMessages, skippedMessages: 0 };
  }

  const candidates: GmailCandidate[] = [];
  let skippedMessages = 0;

  for (let index = 0; index < freshMessages.length; index += 1) {
    const message = freshMessages[index];
    onProgress?.(`Revisando correos nuevos ${index + 1} de ${freshMessages.length}…`);
    try {
      const full = await gmailFetchJson<any>(accessToken, `messages/${encodeURIComponent(message.id)}?format=full`);
      const headers = full.payload?.headers as Array<{ name?: string; value?: string }> | undefined;
      const subject = headerValue(headers, 'Subject');
      const sender = headerValue(headers, 'From');
      const snippet = String(full.snippet || '');
      const receivedAt = full.internalDate ? new Date(Number(full.internalDate)).toISOString() : null;
      const attachments: Array<{ attachmentId: string; partId?: string; filename: string; mimeType: string; size?: number }> = [];
      collectAttachmentParts(full.payload, attachments);

      for (const attachment of attachments.filter(item => looksLikeInvoice(item.filename, subject, snippet, item.mimeType))) {
        candidates.push({
          messageId: full.id || message.id,
          threadId: full.threadId || message.threadId || null,
          sender: sender || null,
          subject: subject || null,
          receivedAt,
          attachmentId: attachment.attachmentId,
          attachmentName: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size || null,
          snippet: snippet || null,
          partId: attachment.partId || null,
          status: 'found',
          invoiceId: null,
          metadata: { snippet, partId: attachment.partId || null },
        });
      }

      scannedIds.add(message.id);
      if ((index + 1) % 10 === 0) saveScannedMessageIds(account, scannedIds);
      await sleep(140);
    } catch (error) {
      if (error instanceof GmailAuthError) throw error;
      skippedMessages += 1;
      console.warn(`No se pudo revisar temporalmente el correo ${message.id}.`, error);
      await sleep(900);
    }
  }

  saveScannedMessageIds(account, scannedIds);
  candidates.sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
  return {
    candidates,
    totalMessages: messages.length,
    newMessages: freshMessages.length,
    cachedMessages,
    skippedMessages,
  };
}
