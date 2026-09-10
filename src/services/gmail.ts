import { supabase } from './supabase';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_STORAGE_KEY = 'zenvia-gmail-access';

declare global {
  interface Window {
    google?: any;
  }
}

export type GmailImportStatus = 'found' | 'imported' | 'ignored' | 'error';

export interface GmailConnection {
  accessToken: string;
  expiresAt: number;
  email: string;
}

export interface GmailCandidate {
  id?: string;
  messageId: string;
  threadId?: string | null;
  sender?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  attachmentId: string;
  attachmentName: string;
  mimeType: string;
  size?: number | null;
  snippet?: string | null;
  partId?: string | null;
  status: GmailImportStatus;
  invoiceId?: string | null;
  metadata?: Record<string, unknown>;
}

function getClientId() {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Falta configurar VITE_GOOGLE_CLIENT_ID en Vercel para conectar Gmail.');
  }
  return GOOGLE_CLIENT_ID;
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar Google Identity Services.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services.'));
    document.head.appendChild(script);
  });
}

function saveConnection(connection: GmailConnection) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(connection));
}

export function getCachedGmailConnection(): GmailConnection | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GmailConnection;
    if (!parsed.accessToken || parsed.expiresAt <= Date.now() + 60_000) {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }
}

async function gmailFetch<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    throw new Error('La autorización de Gmail ha caducado o no tiene permisos. Vuelve a conectar Gmail.');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail respondió con un error (${response.status}). ${text.slice(0, 220)}`);
  }
  return response.json() as Promise<T>;
}

export async function connectGmail(forceConsent = false): Promise<GmailConnection> {
  await loadGoogleIdentityServices();
  const clientId = getClientId();

  return new Promise<GmailConnection>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: async (response: any) => {
        if (response?.error || !response?.access_token) {
          reject(new Error(response?.error_description || response?.error || 'Google no concedió acceso a Gmail.'));
          return;
        }
        try {
          const profile = await gmailFetch<{ emailAddress?: string }>(response.access_token, 'profile');
          const connection: GmailConnection = {
            accessToken: response.access_token,
            expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
            email: profile.emailAddress || 'Cuenta de Gmail',
          };
          saveConnection(connection);
          resolve(connection);
        } catch (error) {
          reject(error);
        }
      },
      error_callback: (error: any) => reject(new Error(error?.message || 'No se pudo abrir la autorización de Google.')),
    });

    client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
  });
}

export async function disconnectGmail() {
  const connection = getCachedGmailConnection();
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  if (!connection) return;
  try {
    await loadGoogleIdentityServices();
    await new Promise<void>(resolve => window.google.accounts.oauth2.revoke(connection.accessToken, () => resolve()));
  } catch {
    // La sesión local ya está desconectada aunque Google no responda al revoke.
  }
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

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

export async function searchGmailInvoiceCandidates(
  accessToken: string,
  months = 12,
  onProgress?: (message: string) => void,
): Promise<GmailCandidate[]> {
  const period = months >= 12 && months % 12 === 0 ? `${months / 12}y` : `${months}m`;
  const q = encodeURIComponent(`has:attachment newer_than:${period} {filename:pdf filename:jpg filename:jpeg filename:png filename:webp}`);
  onProgress?.('Buscando correos con adjuntos…');
  const list = await gmailFetch<{ messages?: Array<{ id: string; threadId?: string }> }>(accessToken, `messages?maxResults=100&q=${q}`);
  const messages = list.messages || [];
  if (!messages.length) return [];

  let done = 0;
  const groups = await mapWithConcurrency(messages, 6, async message => {
    const full = await gmailFetch<any>(accessToken, `messages/${encodeURIComponent(message.id)}?format=full`);
    done += 1;
    onProgress?.(`Analizando correos ${done} de ${messages.length}…`);
    const headers = full.payload?.headers as Array<{ name?: string; value?: string }> | undefined;
    const subject = headerValue(headers, 'Subject');
    const sender = headerValue(headers, 'From');
    const snippet = String(full.snippet || '');
    const attachments: Array<{ attachmentId: string; partId?: string; filename: string; mimeType: string; size?: number }> = [];
    collectAttachmentParts(full.payload, attachments);
    const receivedAt = full.internalDate ? new Date(Number(full.internalDate)).toISOString() : null;

    return attachments
      .filter(attachment => looksLikeInvoice(attachment.filename, subject, snippet, attachment.mimeType))
      .map(attachment => ({
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
        status: 'found' as const,
        invoiceId: null,
        metadata: { snippet, partId: attachment.partId || null },
      }));
  });

  return groups.flat().sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
}

function mapImportRow(row: any): GmailCandidate {
  const metadata = (row.metadata || {}) as Record<string, unknown>;
  return {
    id: row.id,
    messageId: row.gmail_message_id,
    threadId: row.gmail_thread_id,
    sender: row.sender,
    subject: row.subject,
    receivedAt: row.received_at,
    attachmentId: row.attachment_id || String(metadata.attachmentId || ''),
    attachmentName: row.attachment_name || 'Adjunto',
    mimeType: row.attachment_mime_type || String(metadata.mimeType || 'application/octet-stream'),
    size: row.attachment_size == null ? null : Number(row.attachment_size),
    snippet: typeof metadata.snippet === 'string' ? metadata.snippet : null,
    partId: typeof metadata.partId === 'string' ? metadata.partId : null,
    status: row.status,
    invoiceId: row.invoice_id,
    metadata,
  };
}

export async function loadGmailImports(): Promise<GmailCandidate[]> {
  const { data, error } = await supabase
    .from('gmail_imports')
    .select('*')
    .order('received_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data || []).map(mapImportRow);
}

export async function saveGmailCandidates(candidates: GmailCandidate[]) {
  if (!candidates.length) return loadGmailImports();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Sesión no válida.');

  const rows = candidates.map(candidate => ({
    owner_id: user.id,
    gmail_message_id: candidate.messageId,
    gmail_thread_id: candidate.threadId || null,
    sender: candidate.sender || null,
    subject: candidate.subject || null,
    received_at: candidate.receivedAt || null,
    attachment_id: candidate.attachmentId,
    attachment_name: candidate.attachmentName,
    attachment_mime_type: candidate.mimeType,
    attachment_size: candidate.size || null,
    status: 'found',
    metadata: {
      ...(candidate.metadata || {}),
      snippet: candidate.snippet || null,
      partId: candidate.partId || null,
      mimeType: candidate.mimeType,
      attachmentId: candidate.attachmentId,
    },
  }));

  const { error } = await supabase.from('gmail_imports').upsert(rows, {
    onConflict: 'owner_id,gmail_message_id,attachment_id',
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return loadGmailImports();
}

function decodeBase64Url(data: string) {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function findInlinePart(part: any, partId: string | null | undefined): any | null {
  if (partId && part?.partId === partId && part?.body?.data) return part;
  for (const child of part?.parts || []) {
    const found = findInlinePart(child, partId);
    if (found) return found;
  }
  return null;
}

export async function downloadGmailAttachment(accessToken: string, candidate: GmailCandidate): Promise<File> {
  let encoded = '';
  if (candidate.attachmentId.startsWith('inline:')) {
    const message = await gmailFetch<any>(accessToken, `messages/${encodeURIComponent(candidate.messageId)}?format=full`);
    const part = findInlinePart(message.payload, candidate.partId);
    encoded = part?.body?.data || '';
  } else {
    const attachment = await gmailFetch<{ data?: string }>(
      accessToken,
      `messages/${encodeURIComponent(candidate.messageId)}/attachments/${encodeURIComponent(candidate.attachmentId)}`,
    );
    encoded = attachment.data || '';
  }
  if (!encoded) throw new Error('Gmail no devolvió el contenido del adjunto.');
  const bytes = decodeBase64Url(encoded);
  return new File([bytes], candidate.attachmentName, { type: candidate.mimeType || 'application/octet-stream' });
}

export async function updateGmailImport(
  id: string,
  status: GmailImportStatus,
  invoiceId?: string | null,
  extraMetadata?: Record<string, unknown>,
) {
  const changes: Record<string, unknown> = { status, invoice_id: invoiceId ?? null };
  if (extraMetadata) {
    const { data: current, error: readError } = await supabase.from('gmail_imports').select('metadata').eq('id', id).single();
    if (readError) throw readError;
    changes.metadata = { ...(current?.metadata || {}), ...extraMetadata };
  }
  const { error } = await supabase.from('gmail_imports').update(changes).eq('id', id);
  if (error) throw error;
}

export function gmailMessageUrl(candidate: GmailCandidate) {
  const id = candidate.threadId || candidate.messageId;
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
}

export function gmailOAuthConfigured() {
  return Boolean(GOOGLE_CLIENT_ID);
}
