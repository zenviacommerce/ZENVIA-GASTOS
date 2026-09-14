import { emailError, normalizeEmail, normalizePhone, normalizeTaxId, phoneError, taxIdError } from './validation';

export type SupplierContactData = {
  taxId?: string;
  email?: string;
  phone?: string;
};

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const buyerMarkers = /zenvia\s+commerce|sergio\s+rojas|facturar\s+a|cliente\s*-?\s*receptor|nif\s+del\s+cliente|account\s+billed|bill\s+to|customer/i;
const supplierMarkers = /proveedor|emisor|supplier|vendor|datos\s+de\s+la\s+empresa|company\s+details|receptor\s+imporalia/i;

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function supplierTokens(name: string) {
  return normalizeText(name)
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 5 && !['limited','express','international','sociedad','compost','paper'].includes(token));
}

function supplierContextScore(context: string, supplierName: string) {
  const normalized = normalizeText(context);
  return supplierTokens(supplierName).some(token => normalized.includes(token)) ? 25 : 0;
}

function supplierProximityScore(text: string, index: number, supplierName: string) {
  const normalizedText = normalizeText(text);
  const normalizedName = normalizeText(supplierName).trim();
  if (!normalizedName) return 0;

  let cursor = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  while (cursor < normalizedText.length) {
    const found = normalizedText.indexOf(normalizedName, cursor);
    if (found < 0) break;
    bestDistance = Math.min(bestDistance, Math.abs(found - index));
    cursor = found + Math.max(1, normalizedName.length);
  }

  if (bestDistance <= 60) return 35;
  if (bestDistance <= 150) return 15;
  return 0;
}

function contextAround(text: string, index: number, radius = 180) {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

function extractTaxId(text: string, supplierName: string) {
  const pairedIssuer = text.match(/proveedor\s*-?\s*emisor[\s\S]{0,180}?\b([A-Z]{2}[A-Z0-9]{7,14})\b\s+\b([A-Z]{2}[A-Z0-9]{7,14})\b/i)?.[1];
  if (pairedIssuer) {
    const normalized = normalizeTaxId(pairedIssuer);
    if (!taxIdError(normalized, false)) return normalized;
  }

  const explicitIssuer = text.match(/(?:nif|cif|vat)\s+(?:del\s+)?emisor\s*[:#-]?\s*([A-Z]{0,2}\s*[A-Z0-9](?:[\s.-]*[A-Z0-9]){6,14})/i)?.[1];
  if (explicitIssuer) {
    const normalized = normalizeTaxId(explicitIssuer);
    if (!taxIdError(normalized, false)) return normalized;
  }

  const labelled = /(?:nif|cif|vat(?:\s*(?:id|number|no\.?))?|n[uú]mero\s+de\s+iva|btw\s+nummer)\s*[:#-]?\s*([A-Z]{0,2}\s*[A-Z0-9](?:[\s.-]*[A-Z0-9]){6,14})/gi;
  const candidates: Array<{ value: string; score: number }> = [];
  for (const match of text.matchAll(labelled)) {
    const raw = match[1] || '';
    const value = normalizeTaxId(raw);
    if (taxIdError(value, false)) continue;
    const index = match.index || 0;
    const context = contextAround(text, index);
    let score = supplierContextScore(context, supplierName) + supplierProximityScore(text, index, supplierName);
    if (supplierMarkers.test(context)) score += 20;
    supplierMarkers.lastIndex = 0;
    if (buyerMarkers.test(context)) score -= 55;
    buyerMarkers.lastIndex = 0;
    candidates.push({ value, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= -10 ? candidates[0].value : undefined;
}

function extractEmail(text: string, supplierName: string) {
  const candidates: Array<{ value: string; score: number }> = [];
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  for (const match of text.matchAll(emailRegex)) {
    const value = normalizeEmail(match[0]);
    if (emailError(value, false)) continue;
    const index = match.index || 0;
    const context = contextAround(text, index);
    let score = supplierContextScore(context, supplierName) + supplierProximityScore(text, index, supplierName);
    if (/e-?mail|correo|contacto|contact/i.test(context)) score += 12;
    if (supplierMarkers.test(context)) score += 10;
    supplierMarkers.lastIndex = 0;
    if (buyerMarkers.test(context) || /@zenviacommerce\./i.test(value)) score -= 70;
    buyerMarkers.lastIndex = 0;

    const domain = value.split('@')[1]?.toLowerCase() || '';
    if (supplierTokens(supplierName).some(token => domain.replace(/[^a-z0-9]/g, '').includes(token.replace(/[^a-z0-9]/g, '')))) score += 30;
    candidates.push({ value, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= 0 ? candidates[0].value : undefined;
}

function extractPhone(text: string, supplierName: string) {
  const lines = text.split(/\r?\n/).map(compact).filter(Boolean);
  const candidates: Array<{ value: string; score: number }> = [];
  let offset = 0;

  for (const line of lines) {
    const looksLikeContactLine = /(?:tel(?:[ée]fono)?|telf|phone|m[oó]vil|mobile|atenci[oó]n\s+al\s+cliente|)/i.test(line)
      || (/@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line) && /\b\d[\d\s().-]{7,}\d\b/.test(line));
    if (!looksLikeContactLine) { offset += line.length + 1; continue; }

    const phoneRegex = /(?:\+?\d[\d\s().-]{5,}\d)/g;
    for (const match of line.matchAll(phoneRegex)) {
      const raw = match[0].trim();
      const digits = raw.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) continue;
      if (/^20\d{6}$/.test(digits)) continue;
      const value = normalizePhone(raw);
      if (phoneError(value, false)) continue;
      const index = offset + (match.index || 0);
      const context = contextAround(text, index);
      let score = supplierContextScore(context, supplierName) + supplierProximityScore(text, index, supplierName);
      if (/tel(?:[ée]fono)?|telf|phone|m[oó]vil|mobile|atenci[oó]n\s+al\s+cliente|/i.test(line)) score += 20;
      if (supplierMarkers.test(context)) score += 10;
      supplierMarkers.lastIndex = 0;
      if (buyerMarkers.test(context)) score -= 45;
      buyerMarkers.lastIndex = 0;
      candidates.push({ value, score });
    }
    offset += line.length + 1;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= 10 ? candidates[0].value : undefined;
}

export function extractSupplierContactData(text: string, supplierName: string): SupplierContactData {
  if (!text.trim() || !supplierName.trim()) return {};
  return {
    taxId: extractTaxId(text, supplierName),
    email: extractEmail(text, supplierName),
    phone: extractPhone(text, supplierName),
  };
}
