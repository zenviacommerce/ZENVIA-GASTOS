import type { FulfillmentOrder, ShippingOption } from './orders';

type LabelOrder = Pick<FulfillmentOrder, 'orderNumber' | 'shippingAddress' | 'items'>;
type LabelOption = Pick<ShippingOption, 'code' | 'name' | 'carrierCode' | 'carrierName' | 'contractId'>;

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function labelPdfBaseName(order: LabelOrder) {
  const first = order.items?.[0] || {};
  const raw = text(first.name) || text(first.description) || text(first.sku) || order.orderNumber || 'pedido';
  const parts = raw.split('|').map(part => part.trim()).filter(Boolean);
  const candidate = (parts.length > 1 ? parts[1] : raw).replace(/^zenic\b[\s|:–—-]*/i, '').trim();
  const words = normalized(candidate)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const short = words.slice(0, 3).join('_');
  if (short) return short;
  return normalized(order.orderNumber || 'pedido').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'pedido';
}

export function uniqueLabelPdfFilename(order: LabelOrder, used: Set<string>) {
  const base = labelPdfBaseName(order);
  let suffix = 1;
  let fileName = `${base}.pdf`;
  while (used.has(fileName)) {
    suffix += 1;
    fileName = `${base}_${suffix}.pdf`;
  }
  used.add(fileName);
  return fileName;
}

export function isBalearicOrder(order: LabelOrder) {
  const country = text(order.shippingAddress?.country_code).trim().toUpperCase();
  const postal = text(order.shippingAddress?.postal_code).replace(/\s+/g, '').trim();
  return country === 'ES' && /^07\d{3}$/.test(postal);
}

function isCorreos(option: LabelOption) {
  return normalized(`${option.carrierCode || ''} ${option.carrierName || ''} ${option.name || ''} ${option.code || ''}`).includes('correos');
}

function isMrwUrgent1900(option: LabelOption) {
  const raw = `${option.carrierCode || ''} ${option.carrierName || ''} ${option.name || ''} ${option.code || ''}`.toLowerCase();
  const friendly = normalized(raw);
  const friendlyMatch = friendly.includes('mrw') && friendly.includes('urgent') && (friendly.includes('19:00') || friendly.includes('19 00')) && friendly.includes('expedition');
  const technicalMatch = raw.includes('mrw:') && (raw.includes('timeslot=19') || raw.includes('timeslot=19:00')) && raw.includes('expedition');
  return friendlyMatch || technicalMatch;
}

export function selectAutomaticShippingOption<T extends LabelOption>(order: LabelOrder, options: T[]): T | null {
  if (isBalearicOrder(order)) return options.find(isCorreos) || null;
  return options.find(isMrwUrgent1900) || null;
}
