import JSZip from 'jszip';
import type { Invoice } from '../types';
import { downloadInvoiceFile } from './repository';
import { safeExportLabel } from './filters';
import { startActivity } from './activity';

function escapeCsv(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function safePart(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function fileExtension(invoice: Invoice) {
  const match = invoice.fileName?.match(/(\.[a-zA-Z0-9]{2,5})$/);
  return match?.[1]?.toLowerCase() || '.pdf';
}

export async function exportInvoices(selected: Invoice[], label: string) {
  const activity=startActivity({
    label:'Exportando facturas de gastos',
    detail:selected.length?`Preparando ${selected.length} factura${selected.length===1?'':'s'}…`:'Preparando exportación…',
    progress:0,
    current:0,
    total:selected.length,
  });
  const zip = new JSZip();
  const header = ['Fecha','Proveedor','Nº factura','Categoría','Base','IVA','Retención','Total','Estado','Origen','Archivo'];
  const rows = selected.map(i => [i.invoiceDate,i.supplierName,i.invoiceNumber,i.category,i.subtotal.toFixed(2),i.vat.toFixed(2),i.withholding.toFixed(2),i.total.toFixed(2),i.status,i.source,i.fileName ?? '']);
  const exportLabel = safeExportLabel(label) || 'seleccion';
  zip.file(`resumen_${exportLabel}.csv`, '\ufeff' + [header, ...rows].map(r => r.map(escapeCsv).join(';')).join('\n'));

  const folder = zip.folder('facturas');
  const errors: string[] = [];
  let processed=0;
  try{
    for (const invoice of selected) {
      activity.update({
        current:processed,
        progress:selected.length?processed/selected.length*85:85,
        detail:`Preparando documentos · ${processed} de ${selected.length}`,
      });
      if (invoice.filePath) {
        try {
          const blob = await downloadInvoiceFile(invoice.filePath);
          const date = invoice.invoiceDate || 'sin-fecha';
          const supplier = safePart(invoice.supplierName) || 'proveedor';
          const number = safePart(invoice.invoiceNumber || invoice.id) || invoice.id;
          folder?.file(`${date}_${supplier}_${number}_${invoice.id.slice(0, 8)}${fileExtension(invoice)}`, blob);
        } catch (error) {
          errors.push(`${invoice.invoiceNumber}: ${error instanceof Error ? error.message : 'error de descarga'}`);
        }
      }
      processed+=1;
      activity.update({
        current:processed,
        progress:selected.length?processed/selected.length*85:85,
        detail:`Preparando documentos · ${processed} de ${selected.length}`,
      });
    }
    if (errors.length) zip.file('ERRORES_DESCARGA.txt', errors.join('\n'));
    zip.file('LEEME.txt', `ZENVIA Gestión · ${label}\nFacturas: ${selected.length}\nTotal: ${selected.reduce((s, i) => s + i.total, 0).toFixed(2)} EUR\n`);
    activity.update({current:selected.length,progress:85,detail:'Comprimiendo el ZIP…'});
    return await zip.generateAsync({ type: 'blob' },metadata=>{
      activity.update({
        current:selected.length,
        progress:85+Math.min(100,Math.max(0,metadata.percent))*0.15,
        detail:`Comprimiendo el ZIP · ${Math.round(metadata.percent)}%`,
      });
    });
  }finally{
    activity.finish();
  }
}

export async function exportQuarter(invoices: Invoice[], quarter: number, year: number) {
  const selected = invoices.filter(i => i.fiscalYear === year && i.fiscalQuarter === quarter);
  return exportInvoices(selected, `${quarter}T ${year}`);
}
