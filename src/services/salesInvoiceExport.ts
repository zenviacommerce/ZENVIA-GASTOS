import JSZip from 'jszip';
import type { BusinessSettings, SalesInvoice } from './sales';
import type { GeneralSettings, SalesSettings } from './settingsSchema';
import { formatAppMoney } from './formatting';
import { createSalesInvoicePdfBlob, salesInvoicePdfFilename, type InvoicePdfBranding } from './salesInvoicePdf';
import { startActivity } from './activity';

function escapeCsv(value:unknown){return `"${String(value??'').replaceAll('"','""')}"`;}
function safePart(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');}
function statusLabel(status:SalesInvoice['status']){return ({draft:'Borrador',issued:'Emitida',sent:'Enviada',partially_paid:'Cobro parcial',paid:'Cobrada',rectified:'Rectificada'} as const)[status]||status;}

export async function exportSalesInvoices(selected:SalesInvoice[],settings:BusinessSettings,branding:InvoicePdfBranding,salesSettings:SalesSettings,generalSettings:GeneralSettings,label='seleccion'){
  const activity=startActivity({
    label:'Exportando facturas de venta',
    detail:selected.length?`Generando ${selected.length} PDF…`:'Preparando exportación…',
    progress:0,
    current:0,
    total:selected.length,
  });
  const zip=new JSZip();
  const header=['Fecha','Número','Cliente','NIF/CIF','Tipo','Estado','Base','IVA','Total','Pendiente','Moneda'];
  const rows=selected.map(invoice=>[
    invoice.issueDate,invoice.invoiceNumber||'Borrador',invoice.clientName,invoice.clientTaxId||'',invoice.invoiceType==='rectifying'?'Rectificativa':'Ordinaria',statusLabel(invoice.status),
    invoice.subtotal.toFixed(2),invoice.taxAmount.toFixed(2),invoice.totalAmount.toFixed(2),invoice.status==='draft'?'':Math.max(0,invoice.totalAmount-invoice.paidAmount).toFixed(2),invoice.currency,
  ]);
  const exportLabel=safePart(label)||'seleccion';
  zip.file(`resumen_${exportLabel}.csv`,'\ufeff'+[header,...rows].map(row=>row.map(escapeCsv).join(';')).join('\n'));
  const folder=zip.folder('facturas');
  try{
    let processed=0;
    for(const invoice of selected){
      const blob=createSalesInvoicePdfBlob(invoice,settings,branding,salesSettings,generalSettings);
      const date=invoice.issueDate||'sin-fecha';
      const client=safePart(invoice.clientName)||'cliente';
      const filename=salesInvoicePdfFilename(invoice);
      folder?.file(`${date}_${client}_${filename}`,blob);
      processed+=1;
      activity.update({
        current:processed,
        progress:selected.length?processed/selected.length*80:80,
        detail:`Generando PDF · ${processed} de ${selected.length}`,
      });
      // Yield periodically so the global progress indicator can repaint during
      // large client-side PDF exports instead of appearing only at the end.
      if(processed%4===0)await new Promise<void>(resolve=>window.setTimeout(resolve,0));
    }
    const exportTotal=selected.reduce((sum,invoice)=>sum+invoice.totalAmount,0);
    zip.file('LEEME.txt',`ZENVIA Gestión · ${label}\nFacturas: ${selected.length}\nTotal: ${formatAppMoney(exportTotal,generalSettings.currencyCode,generalSettings,{minimumFractionDigits:2,maximumFractionDigits:2})}\n`);
    activity.update({current:selected.length,progress:80,detail:'Comprimiendo el ZIP…'});
    return await zip.generateAsync({type:'blob'},metadata=>{
      activity.update({
        current:selected.length,
        progress:80+Math.min(100,Math.max(0,metadata.percent))*0.2,
        detail:`Comprimiendo el ZIP · ${Math.round(metadata.percent)}%`,
      });
    });
  }finally{
    activity.finish();
  }
}
