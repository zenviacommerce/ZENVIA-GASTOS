import type { ExpenseCategory, NewInvoiceLineInput } from '../types';

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

export function parseMoneyV2(value: string | undefined | null): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma > lastDot) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma) normalized = cleaned.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyMatches(line: string) {
  // No tratamos espacios como separadores de miles aquí porque en tablas aparecen secuencias
  // como "C/3 360,00" y el 3 pertenece a la descripción, no a la cantidad.
  return [...line.matchAll(/-?\d{1,3}(?:\.\d{3})*,\d{2,6}|-?\d+\.\d{2,6}/g)];
}

function hasLegalSuffix(value: string) {
  return /\b(?:S\.?\s*L\.?\s*U?\.?|S\.?\s*A\.?|SLU|SL|SA|LTD|LIMITED|GMBH|SAS|BV)\b/i.test(value);
}

function normalizeSupplierCandidate(value: string, fullText: string) {
  let result = compact(value)
    .replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, '')
    .replace(/\s+(?:se\s+encuentran|se\s+encuentra|disponibles|en\s+la\s+web).*$/i, '')
    .trim();
  if (!result) return '';

  // Los OCR suelen confundir "C.I.F." con "C.LF.". Si el documento muestra un CIF tipo B
  // y hemos encontrado una razón social clara del emisor, recuperamos el sufijo S.L. perdido.
  const spanishLimitedCompany = /\bC[.\s]*[I1L][.\s]*F[.\s]*[:.\-]?\s*B[\s\-]*\d{7,8}\b/i.test(fullText);
  if (!hasLegalSuffix(result) && spanishLimitedCompany) result += ' S.L.';
  return result.slice(0, 120);
}

export function extractSupplierV2(lines: string[], fullText: string): string {
  for (const line of lines) {
    const labelled = line.match(/(?:proveedor|supplier|emisor|raz[oó]n\s+social)\s*[:.\-]\s*(.{3,100})/i)?.[1];
    if (labelled && !/zenvia\s+commerce/i.test(labelled)) return normalizeSupplierCandidate(labelled, fullText);
  }

  const contextualPatterns = [
    /productos?\s+(?:comercializados|suministrados|vendidos)\s+por\s+([^\n]{3,100}?)(?=\s+(?:se\s+encuentran|se\s+encuentra|est[aá]n|en\s+la\s+web|$))/i,
    /(?:empresa|sociedad)\s+(?:emisora|proveedora)\s*[:.\-]?\s*([^\n]{3,100})/i,
  ];
  for (const pattern of contextualPatterns) {
    const candidate = fullText.match(pattern)?.[1];
    if (candidate && !/zenvia\s+commerce/i.test(candidate)) return normalizeSupplierCandidate(candidate, fullText);
  }

  const legalCandidates = lines
    .map(compact)
    .filter(value => value.length >= 4 && value.length <= 120)
    .filter(value => hasLegalSuffix(value))
    .filter(value => !/zenvia\s+commerce/i.test(value))
    .filter(value => !/factura|invoice|cliente|customer|cif|nif|vat|iva/i.test(value));
  if (legalCandidates.length) return normalizeSupplierCandidate(legalCandidates[0], fullText);

  const ignored = /factura|invoice|fecha|date|cif|nif|vat|iva|total|base|cliente|customer|direcci[oó]n|tel[eé]fono|telf\.?|fax|mail|email|p[aá]gina|www\.|zenvia commerce|medio ambiente|comprometidos/i;
  const address = /\b(avda\.?|avenida|calle|c\/|ctra\.?|carretera|pol[ií]gono|p\.?\s*i\.?|nave|plaza|camino|c\.p\.?|cp)\b/i;
  const candidate = lines.slice(0, 30).map(compact).find(value =>
    value.length >= 4 && value.length <= 90
    && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(value)
    && !ignored.test(value)
    && !address.test(value)
    && !/^\d[\d\s,./-]+$/.test(value)
  );
  return candidate ? normalizeSupplierCandidate(candidate, fullText) : '';
}

type ProductGroup = { sku: string; rest: string; continuation: string[] };

function parseProductGroup(group: ProductGroup): NewInvoiceLineInput | null {
  const matches = moneyMatches(group.rest);
  if (matches.length < 3) return null;
  const first = matches[0];
  const quantity = parseMoneyV2(first[0]);
  if (!quantity || quantity > 1_000_000) return null;

  const values = matches.map(match => parseMoneyV2(match[0]));
  const rawLineTotal = values.at(-1) || 0;
  const unitPrice = values.length >= 3 ? values.at(-2) || null : null;

  const descriptionHead = compact(group.rest.slice(0, first.index ?? 0));
  const continuations = group.continuation
    .map(compact)
    .filter(value => value && !/^(?:basado en entregas|desglose|%\s*iva|total bruto|registro mercantil|forma pago)/i.test(value));
  const description = compact([descriptionHead, ...continuations].join(' '))
    .replace(/\b(?:ud|uds|unidad(?:es)?|kg|g|l|ml)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (description.length < 3) return null;

  const afterQuantity = group.rest.slice((first.index ?? 0) + first[0].length);
  const unit = afterQuantity.match(/^\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,14})\b/)?.[1] || null;
  const expectedTotal = unitPrice && quantity ? Math.round(quantity * unitPrice * 100) / 100 : 0;
  let lineTotal = rawLineTotal;
  if (expectedTotal > 0 && rawLineTotal > 0) {
    const difference = Math.abs(rawLineTotal - expectedTotal) / expectedTotal;
    if (difference > 0.15) lineTotal = expectedTotal;
  }

  return {
    supplierSku: group.sku,
    description: description.slice(0, 250),
    quantity,
    unit,
    unitPrice,
    lineTotal: lineTotal || expectedTotal || null,
  };
}

export function extractStructuredProductLines(lines: string[]): NewInvoiceLineInput[] {
  const groups: ProductGroup[] = [];
  let current: ProductGroup | null = null;
  const rowStart = /^\s*([A-Z0-9][A-Z0-9._\/-]{7,})\s+\d{1,4}\s+(.+)$/i;
  const stop = /^(?:basado\s+en\s+entregas|desglose\s+de\s+impuestos|registro\s+mercantil|importe\s+base|total\s+factura)/i;

  const flush = () => {
    if (current) groups.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = compact(raw);
    if (!line) continue;
    if (stop.test(line)) { flush(); break; }
    const match = line.match(rowStart);
    if (match) {
      flush();
      const sku = match[1];
      const restWithPackages = line.slice(match[0].indexOf(sku) + sku.length).trim();
      const rest = restWithPackages.replace(/^\d{1,4}\s+/, '');
      current = { sku, rest, continuation: [] };
      continue;
    }
    if (current && moneyMatches(line).length === 0 && line.length <= 120) current.continuation.push(line);
  }
  flush();

  return groups.map(parseProductGroup).filter((line): line is NewInvoiceLineInput => Boolean(line)).slice(0, 50);
}

export function detectMerchandiseCategory(categories: ExpenseCategory[], fullText: string, lines: NewInvoiceLineInput[]): string | undefined {
  const tableHeader = /(?:n[º°o]?\s*)?art[ií]culo[\s\S]{0,80}descripci[oó]n[\s\S]{0,80}cantidad[\s\S]{0,80}precio/i.test(fullText);
  const hasSkus = lines.filter(line => line.supplierSku).length >= 2;
  if (!tableHeader && !hasSkus) return undefined;
  return categories.find(category => category.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes('mercancia'))?.id;
}

export function repairInvoiceAmounts(subtotal: number, vat: number, withholding: number, total: number, lines: string[]) {
  const tailValues = lines.slice(-45)
    .flatMap(line => moneyMatches(line).map(match => parseMoneyV2(match[0])))
    .filter(value => value > 0 && value < 10_000_000);

  let repairedTotal = total;
  const maxTail = tailValues.length ? Math.max(...tailValues) : 0;
  if (!repairedTotal || (vat > 0 && repairedTotal <= vat) || (subtotal > 0 && repairedTotal < subtotal)) repairedTotal = maxTail;

  let repairedSubtotal = subtotal;
  if (!repairedSubtotal && repairedTotal > vat) repairedSubtotal = Math.round((repairedTotal - vat + withholding) * 100) / 100;

  return { subtotal: repairedSubtotal, total: repairedTotal };
}
