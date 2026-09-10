import type { Invoice } from '../types';

export type PeriodPreset = 'current_month' | 'current_quarter' | 'current_year' | 'all' | 'custom' | `quarter:${number}:${number}`;

export interface InvoiceFilter {
  preset: PeriodPreset;
  from: string;
  to: string;
  supplierId: string;
}

const pad = (value: number) => String(value).padStart(2, '0');
const ymd = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function quarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3;
  const from = new Date(year, startMonth, 1);
  const to = new Date(year, startMonth + 3, 0);
  return { from: ymd(from), to: ymd(to) };
}

export function rangeForPreset(preset: PeriodPreset, now = new Date()) {
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'custom') return null;
  if (preset === 'current_month') {
    return {
      from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  if (preset === 'current_quarter') {
    return quarterRange(now.getFullYear(), Math.floor(now.getMonth() / 3) + 1);
  }
  if (preset === 'current_year') {
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  }
  if (preset.startsWith('quarter:')) {
    const [, yearRaw, quarterRaw] = preset.split(':');
    return quarterRange(Number(yearRaw), Number(quarterRaw));
  }
  return { from: '', to: '' };
}

export function filterForPreset(preset: PeriodPreset, supplierId = '', now = new Date()): InvoiceFilter {
  const range = rangeForPreset(preset, now);
  return { preset, from: range?.from || '', to: range?.to || '', supplierId };
}

export function defaultInvoiceFilter(): InvoiceFilter {
  return filterForPreset('current_quarter');
}

export function filterInvoices(invoices: Invoice[], filter: InvoiceFilter) {
  return invoices.filter(invoice => {
    if (filter.supplierId && invoice.supplierId !== filter.supplierId) return false;
    const date = invoice.invoiceDate || '';
    if (filter.from && (!date || date < filter.from)) return false;
    if (filter.to && (!date || date > filter.to)) return false;
    return true;
  });
}

export function quarterOptions(invoices: Invoice[]) {
  const currentYear = new Date().getFullYear();
  const years = new Set<number>([currentYear]);
  invoices.forEach(invoice => {
    const year = invoice.fiscalYear || Number(invoice.invoiceDate?.slice(0, 4));
    if (year) years.add(year);
  });
  return [...years]
    .sort((a, b) => b - a)
    .flatMap(year => [4, 3, 2, 1].map(quarter => ({
      value: `quarter:${year}:${quarter}` as PeriodPreset,
      label: `${quarter}T ${year}`,
    })));
}

function formatDate(date: string) {
  if (!date) return '';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export function periodLabel(filter: InvoiceFilter, now = new Date()) {
  if (filter.preset === 'current_month') {
    const label = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (filter.preset === 'current_quarter') return `${Math.floor(now.getMonth() / 3) + 1}T ${now.getFullYear()}`;
  if (filter.preset === 'current_year') return `Año ${now.getFullYear()}`;
  if (filter.preset === 'all') return 'Todo el histórico';
  if (filter.preset.startsWith('quarter:')) {
    const [, year, quarter] = filter.preset.split(':');
    return `${quarter}T ${year}`;
  }
  if (filter.from && filter.to) return `${formatDate(filter.from)} – ${formatDate(filter.to)}`;
  if (filter.from) return `Desde ${formatDate(filter.from)}`;
  if (filter.to) return `Hasta ${formatDate(filter.to)}`;
  return 'Periodo personalizado';
}

export function safeExportLabel(label: string) {
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
