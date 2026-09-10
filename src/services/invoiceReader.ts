import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ExpenseCategory, NewInvoiceLineInput } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface InvoiceReadResult {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  categoryId?: string;
  subtotal: number;
  vat: number;
  withholding: number;
  total: number;
  lines: NewInvoiceLineInput[];
  text: string;
  confidence: number;
  usedOcr: boolean;
}

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

function parseMoney(value: string | undefined | null): number {
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

function moneyTokens(line: string): string[] {
  return line.match(/-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2,6})|-?\d+(?:[.,]\d{2,6})/g) ?? [];
}

function lastMoney(line: string): number {
  const values = moneyTokens(line);
  return parseMoney(values.at(-1));
}

function parseDate(value: string): string {
  const iso = value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const es = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
  if (!es) return '';
  const year = es[3].length === 2 ? `20${es[3]}` : es[3];
  const day = Number(es[1]);
  const month = Number(es[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function findAmount(lines: string[], terms: RegExp, excluded?: RegExp): number {
  for (const line of [...lines].reverse()) {
    if (!terms.test(line)) continue;
    terms.lastIndex = 0;
    if (excluded?.test(line)) { excluded.lastIndex = 0; continue; }
    if (excluded) excluded.lastIndex = 0;
    const amount = lastMoney(line);
    if (amount) return amount;
  }
  return 0;
}

function extractInvoiceNumber(lines: string[], fullText: string): string {
  const patterns = [
    /(?:n[ºo°]\.?\s*(?:factura)?|n[uú]mero\s*(?:de\s*)?factura|factura\s*(?:n[ºo°]\.?|núm(?:ero)?\.?)?|invoice\s*(?:no\.?|number)?)[\s:#-]*([A-Z0-9][A-Z0-9._\/-]{2,})/i,
    /(?:serie\s*\/\s*n[uú]mero|n[uú]m\.?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = fullText.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  for (const line of lines.slice(0, 20)) {
    if (!/factura|invoice/i.test(line)) continue;
    const candidate = line.match(/\b[A-Z0-9]{1,8}[-/]?[A-Z0-9._/-]{2,}\b/i)?.[0];
    if (candidate && !/^20\d{2}$/.test(candidate)) return candidate;
  }
  return '';
}

function extractSupplier(lines: string[]): string {
  for (const line of lines.slice(0, 30)) {
    const labelled = line.match(/(?:proveedor|supplier|emisor|raz[oó]n\s+social)\s*[:.-]\s*(.{3,80})/i)?.[1];
    if (labelled) return compact(labelled);
  }
  const ignored = /factura|invoice|fecha|date|cif|nif|vat|iva|total|base imponible|direcci[oó]n|tel[eé]fono|email|p[aá]gina|www\.|zenvia commerce/i;
  const candidate = lines.slice(0, 18).find(line => {
    const value = compact(line);
    return value.length >= 4 && value.length <= 80 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(value) && !ignored.test(value) && !/^\d[\d\s,./-]+$/.test(value);
  });
  return candidate ? compact(candidate) : '';
}

function inferCategoryId(categories: ExpenseCategory[], text: string, supplier: string): string | undefined {
  const haystack = `${supplier} ${text}`.toLowerCase();
  const rules: Array<[string[], string[]]> = [
    [['mercancía'], ['mercancía', 'producto', 'artículo', 'caja', 'rollo', 'bolsa', 'vaso', 'film', 'aluminio']],
    [['transporte', 'logística'], ['transporte', 'portes', 'envío', 'shipping', 'ups', 'mrw', 'dhl', 'gls', 'seur']],
    [['publicidad', 'marketing'], ['google ads', 'meta ads', 'publicidad', 'marketing', 'facebook ads', 'instagram ads']],
    [['software', 'suscripciones'], ['software', 'suscripción', 'hosting', 'vercel', 'shopify', 'google workspace', 'microsoft 365']],
    [['embalaje', 'consumibles'], ['embalaje', 'consumible', 'cartón', 'etiqueta', 'cinta adhesiva']],
    [['servicios profesionales'], ['asesoría', 'gestoría', 'abogado', 'consultoría', 'honorarios']],
    [['suministros'], ['electricidad', 'agua', 'gas', 'suministro']],
    [['viajes', 'dietas'], ['hotel', 'alojamiento', 'restaurante', 'viaje', 'dietas', 'renfe', 'iberia']],
    [['comisiones', 'marketplaces'], ['amazon', 'marketplace', 'comisión', 'seller']],
  ];
  for (const [categoryTerms, keywords] of rules) {
    if (!keywords.some(keyword => haystack.includes(keyword))) continue;
    const category = categories.find(c => categoryTerms.some(term => c.name.toLowerCase().includes(term)));
    if (category) return category.id;
  }
  return undefined;
}

function extractLines(lines: string[]): NewInvoiceLineInput[] {
  const result: NewInvoiceLineInput[] = [];
  const skip = /total|subtotal|base imponible|iva|irpf|retenci[oó]n|forma de pago|vencimiento|factura|invoice/i;
  for (const raw of lines) {
    const line = compact(raw);
    if (line.length < 8 || skip.test(line)) continue;
    const values = moneyTokens(line);
    if (values.length < 2) continue;

    const quantityMatch = line.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:ud|uds|u|kg|g|l|ml|caja|cajas|rollo|rollos|x)?\s+/i);
    const quantity = quantityMatch ? parseMoney(quantityMatch[1]) : 1;
    const lineTotal = parseMoney(values.at(-1));
    const unitPrice = values.length >= 2 ? parseMoney(values.at(-2)) : null;
    if (!lineTotal || lineTotal > 1_000_000) continue;

    let description = line;
    for (const token of values) description = description.replace(token, ' ');
    if (quantityMatch?.[0]) description = description.replace(quantityMatch[0], ' ');
    description = compact(description.replace(/\b(?:ud|uds|unidad(?:es)?|kg|g|l|ml)\b/gi, ' '));
    if (description.length < 3) continue;

    result.push({ description: description.slice(0, 250), quantity: quantity || 1, unitPrice, lineTotal });
    if (result.length >= 30) break;
  }
  return result;
}

function parseInvoiceText(text: string, categories: ExpenseCategory[], usedOcr: boolean): InvoiceReadResult {
  const lines = text.split(/\r?\n/).map(compact).filter(Boolean);
  const fullText = lines.join('\n');
  const supplierName = extractSupplier(lines);
  const invoiceNumber = extractInvoiceNumber(lines, fullText);

  let invoiceDate = '';
  for (const line of lines) {
    if (!/fecha|date/i.test(line)) continue;
    invoiceDate = parseDate(line);
    if (invoiceDate) break;
  }
  if (!invoiceDate) invoiceDate = parseDate(fullText);

  const subtotal = findAmount(lines, /base\s+imponible|subtotal|importe\s+neto|total\s+neto/i);
  const vat = findAmount(lines, /\biva\b|i\.v\.a\.|vat/i, /cif|nif|vat\s*(?:id|number|no)/i);
  const withholding = findAmount(lines, /retenci[oó]n|\birpf\b/i);
  let total = findAmount(lines, /\btotal\b|total\s+factura|importe\s+total|a\s+pagar/i, /subtotal|base\s+imponible/i);
  if (!total) {
    const candidates = lines.slice(-20).flatMap(line => moneyTokens(line).map(parseMoney)).filter(v => v > 0);
    total = candidates.length ? Math.max(...candidates) : 0;
  }

  const categoryId = inferCategoryId(categories, fullText, supplierName);
  const extractedLines = extractLines(lines);
  const hits = [supplierName, invoiceNumber, invoiceDate, subtotal, vat, total].filter(Boolean).length;
  const confidence = Math.min(0.98, Math.max(0.25, hits / 6 - (usedOcr ? 0.04 : 0)));

  return { supplierName, invoiceNumber, invoiceDate, categoryId, subtotal, vat, withholding, total, lines: extractedLines, text: fullText, confidence, usedOcr };
}

async function extractPdfText(file: File): Promise<{ text: string; pdf: any }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  const maxPages = Math.min(pdf.numPages, 10);
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items as Array<any>)
      .filter(item => typeof item.str === 'string' && item.str.trim())
      .map(item => ({ text: item.str.trim(), x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0 }))
      .sort((a, b) => Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x);

    const grouped: string[] = [];
    let currentY: number | null = null;
    let current: string[] = [];
    for (const item of items) {
      if (currentY === null || Math.abs(item.y - currentY) <= 2.5) {
        currentY ??= item.y;
        current.push(item.text);
      } else {
        if (current.length) grouped.push(current.join(' '));
        currentY = item.y;
        current = [item.text];
      }
    }
    if (current.length) grouped.push(current.join(' '));
    pages.push(grouped.join('\n'));
  }
  return { text: pages.join('\n'), pdf };
}

async function ocrPdf(pdf: any, onProgress?: (message: string) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  onProgress?.('Iniciando OCR…');
  const worker = await createWorker('spa');
  const pages: string[] = [];
  try {
    const maxPages = Math.min(pdf.numPages, 4);
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      onProgress?.(`Leyendo página ${pageNumber} de ${maxPages}…`);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) continue;
      await page.render({ canvasContext: context, viewport } as any).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo preparar la página para OCR.')), 'image/jpeg', 0.9));
      const { data } = await worker.recognize(blob);
      pages.push(data.text);
    }
  } finally {
    await worker.terminate();
  }
  return pages.join('\n');
}

async function ocrImage(file: File, onProgress?: (message: string) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  onProgress?.('Iniciando OCR…');
  const worker = await createWorker('spa');
  try {
    onProgress?.('Leyendo imagen…');
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export async function readInvoiceDocument(file: File, categories: ExpenseCategory[], onProgress?: (message: string) => void): Promise<InvoiceReadResult> {
  onProgress?.('Analizando documento…');
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const { text, pdf } = await extractPdfText(file);
    const enoughText = text.replace(/\s/g, '').length >= 80;
    if (enoughText) return parseInvoiceText(text, categories, false);
    const ocrText = await ocrPdf(pdf, onProgress);
    return parseInvoiceText(ocrText, categories, true);
  }

  if (file.type.startsWith('image/')) {
    const text = await ocrImage(file, onProgress);
    return parseInvoiceText(text, categories, true);
  }

  throw new Error('Formato no compatible para lectura automática.');
}
