import jsPDF from 'jspdf';
import type { BusinessSettings, SalesInvoice } from './sales';

export type InvoicePdfBranding = {
  logoDataUrl?: string | null;
};

const money=(value:number)=>`${value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} €`;
const dateLabel=(value:string)=>new Date(`${value}T12:00:00`).toLocaleDateString('es-ES');

export function salesInvoicePdfFilename(invoice:SalesInvoice){
  const number=invoice.invoiceNumber||'BORRADOR';
  return `${number.replace(/[^A-Za-z0-9_-]+/g,'_')}.pdf`;
}

function addLogo(doc:jsPDF,logoDataUrl?:string|null){
  if(!logoDataUrl)return 0;
  try{
    const image=doc.getImageProperties(logoDataUrl);
    const maxWidth=56;
    const maxHeight=20;
    const ratio=image.width/image.height;
    let width=maxWidth;
    let height=width/ratio;
    if(height>maxHeight){height=maxHeight;width=height*ratio;}
    doc.addImage(logoDataUrl,'PNG',14,11,width,height,undefined,'FAST');
    return height;
  }catch{
    return 0;
  }
}

export function createSalesInvoicePdfBlob(invoice:SalesInvoice,settings?:BusinessSettings|null,branding?:InvoicePdfBranding|null){
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const issuerName=invoice.issuerName||settings?.legalName||'ZENVIA COMMERCE SL';
  const issuerTaxId=invoice.issuerTaxId||settings?.taxId||'';
  const issuerAddress=invoice.issuerAddress||[settings?.addressLine1,settings?.addressLine2,[settings?.postalCode,settings?.city].filter(Boolean).join(' '),settings?.province,settings?.countryCode].filter(Boolean).join(', ');
  const number=invoice.invoiceNumber||'BORRADOR';
  const title=invoice.status==='draft'
    ? (invoice.invoiceType==='rectifying'?'BORRADOR RECTIFICATIVA':'BORRADOR DE FACTURA')
    : (invoice.invoiceType==='rectifying'?'FACTURA RECTIFICATIVA':'FACTURA');

  const logoHeight=addLogo(doc,branding?.logoDataUrl);
  let issuerY=logoHeight?14+logoHeight+4:16;
  doc.setFont('helvetica','bold');doc.setFontSize(10.5);doc.text(issuerName,14,issuerY);
  issuerY+=5;doc.setFont('helvetica','normal');doc.setFontSize(8.5);
  if(issuerTaxId){doc.text(`NIF/CIF: ${issuerTaxId}`,14,issuerY);issuerY+=4.5;}
  const issuerLines=doc.splitTextToSize(issuerAddress||'',78);
  if(issuerLines.length){doc.text(issuerLines,14,issuerY);issuerY+=issuerLines.length*4;}
  if(settings?.email){doc.text(settings.email,14,issuerY);issuerY+=4;}

  doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text(title,196,16,{align:'right'});
  doc.setFontSize(11);doc.text(number,196,24,{align:'right'});doc.setFont('helvetica','normal');doc.setFontSize(9);
  doc.text(`Fecha: ${dateLabel(invoice.issueDate)}`,196,31,{align:'right'});
  if(invoice.dueDate)doc.text(`Vencimiento: ${dateLabel(invoice.dueDate)}`,196,37,{align:'right'});
  if(invoice.operationDate)doc.text(`Operación: ${dateLabel(invoice.operationDate)}`,196,43,{align:'right'});

  const blockY=Math.max(58,issuerY+7);
  doc.setDrawColor(210);doc.line(14,blockY-5,196,blockY-5);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('FACTURAR A',14,blockY);doc.setFont('helvetica','normal');
  doc.setFontSize(10);doc.text(invoice.clientName,14,blockY+7);doc.setFontSize(8.8);
  if(invoice.clientTaxId)doc.text(`NIF/CIF: ${invoice.clientTaxId}`,14,blockY+13);
  const clientAddress=doc.splitTextToSize(invoice.clientAddress||'',90);if(clientAddress.length)doc.text(clientAddress,14,blockY+19);
  if(invoice.clientEmail)doc.text(invoice.clientEmail,14,blockY+25+Math.max(0,clientAddress.length-1)*4);

  let y=blockY+38+Math.max(0,clientAddress.length-1)*4;
  doc.setFillColor(245,247,249);doc.rect(14,y-5,182,8,'F');doc.setFont('helvetica','bold');doc.setFontSize(8.5);
  doc.text('Descripción',16,y);doc.text('Cant.',112,y,{align:'right'});doc.text('Precio',135,y,{align:'right'});doc.text('IVA',153,y,{align:'right'});doc.text('Total',194,y,{align:'right'});y+=7;doc.setFont('helvetica','normal');
  for(const line of invoice.lines){
    if(y>258){doc.addPage();y=20;}
    const description=doc.splitTextToSize(line.description,85);doc.text(description,16,y);doc.text(line.quantity.toLocaleString('es-ES'),112,y,{align:'right'});doc.text(money(line.unitPrice),135,y,{align:'right'});doc.text(`${line.taxRate.toLocaleString('es-ES')} %`,153,y,{align:'right'});doc.text(money(line.lineTotal??0),194,y,{align:'right'});y+=Math.max(7,description.length*4.5+2);
  }

  if(y>250){doc.addPage();y=24;}else y+=4;
  doc.line(115,y,196,y);y+=7;doc.setFontSize(9);
  doc.text('Base imponible:',150,y,{align:'right'});doc.text(money(invoice.subtotal),194,y,{align:'right'});y+=6;
  if(invoice.discountAmount!==0){doc.text('Descuentos:',150,y,{align:'right'});doc.text(money(-invoice.discountAmount),194,y,{align:'right'});y+=6;}
  doc.text('IVA:',150,y,{align:'right'});doc.text(money(invoice.taxAmount),194,y,{align:'right'});y+=8;doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text('TOTAL:',150,y,{align:'right'});doc.text(money(invoice.totalAmount),194,y,{align:'right'});

  doc.setFont('helvetica','normal');doc.setFontSize(8.5);
  let footerY=Math.max(y+16,265);
  if(footerY>278){doc.addPage();footerY=24;}
  if(invoice.paymentMethod){doc.text(`Forma de pago: ${invoice.paymentMethod}`,14,footerY);footerY+=5;}
  if(settings?.iban){doc.text(`IBAN: ${settings.iban}`,14,footerY);footerY+=5;}
  if(invoice.notes){doc.text(doc.splitTextToSize(`Notas: ${invoice.notes}`,180),14,footerY);footerY+=8;}
  if(settings?.invoiceFooter)doc.text(doc.splitTextToSize(settings.invoiceFooter,180),14,footerY);

  return doc.output('blob');
}

export function downloadSalesInvoicePdf(invoice:SalesInvoice,settings?:BusinessSettings|null,branding?:InvoicePdfBranding|null){
  const blob=createSalesInvoicePdfBlob(invoice,settings,branding);
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=salesInvoicePdfFilename(invoice);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function printSalesInvoicePdf(invoice:SalesInvoice,settings?:BusinessSettings|null,branding?:InvoicePdfBranding|null){
  const blob=createSalesInvoicePdfBlob(invoice,settings,branding);
  const url=URL.createObjectURL(blob);
  const printWindow=window.open(url,'_blank','noopener,noreferrer');
  if(!printWindow){
    URL.revokeObjectURL(url);
    throw new Error('El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes para ZENVIA Gestión e inténtalo de nuevo.');
  }
  const cleanup=()=>window.setTimeout(()=>URL.revokeObjectURL(url),60000);
  printWindow.addEventListener('load',()=>{
    window.setTimeout(()=>{
      try{printWindow.focus();printWindow.print();}catch{/* El visor PDF mantiene disponible el botón de imprimir. */}
      cleanup();
    },700);
  },{once:true});
  window.setTimeout(cleanup,65000);
}