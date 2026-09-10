import JSZip from 'jszip';
import type { Invoice } from '../types';
import { downloadInvoiceFile } from './repository';

function escapeCsv(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export async function exportQuarter(invoices: Invoice[], quarter: number, year: number) {
  const selected = invoices.filter(i => i.fiscalYear === year && i.fiscalQuarter === quarter);
  const zip = new JSZip();
  const header = ['Fecha','Proveedor','Nº factura','Categoría','Base','IVA','Retención','Total','Estado','Origen','Archivo'];
  const rows = selected.map(i => [i.invoiceDate,i.supplierName,i.invoiceNumber,i.category,i.subtotal.toFixed(2),i.vat.toFixed(2),i.withholding.toFixed(2),i.total.toFixed(2),i.status,i.source,i.fileName ?? '']);
  zip.file(`resumen_${quarter}T_${year}.csv`, '\ufeff' + [header, ...rows].map(r => r.map(escapeCsv).join(';')).join('\n'));

  const folder = zip.folder('facturas');
  const errors: string[] = [];
  for (const invoice of selected) {
    if (!invoice.filePath) continue;
    try {
      const blob = await downloadInvoiceFile(invoice.filePath);
      const date = invoice.invoiceDate || 'sin-fecha';
      const supplier = invoice.supplierName.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ._-]+/g, '-');
      const number = (invoice.invoiceNumber || invoice.id).replace(/[^a-zA-Z0-9._-]+/g, '-');
      folder?.file(`${date}_${supplier}_${number}.pdf`, blob);
    } catch (error) {
      errors.push(`${invoice.invoiceNumber}: ${error instanceof Error ? error.message : 'error de descarga'}`);
    }
  }
  if (errors.length) zip.file('ERRORES_DESCARGA.txt', errors.join('\n'));
  zip.file('LEEME.txt', `ZENVIA Gastos · ${quarter}T ${year}\nFacturas: ${selected.length}\nTotal: ${selected.reduce((s, i) => s + i.total, 0).toFixed(2)} EUR\n`);
  return zip.generateAsync({ type: 'blob' });
}
