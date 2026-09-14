import jsPDF from 'jspdf';
import type { BusinessSettings, SalesInvoice } from './sales';

const money=(value:number)=>`${value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} €`;

export function salesInvoicePdfFilename(invoice:SalesInvoice){
  const number=invoice.invoiceNumber||'BORRADOR';
  return `${number.replace(/[^A-Za-z0-9_-]+/g,'_')}.pdf`;
}

export function createSalesInvoicePdfBlob(invoice:SalesInvoice,settings?:BusinessSettings|null){
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const issuerName=invoice.issuerName||settings?.legalName||'ZENVIA COMMERCE SL';
  const issuerTaxId=invoice.issuerTaxId||settings?.taxId||'';
  const issuerAddress=invoice.issuerAddress||[settings?.addressLine1,settings?.addressLine2,[settings?.postalCode,settings?.city].filter(Boolean).join(' '),settings?.province,settings?.countryCode].filter(Boolean).join(', ');
  const number=invoice.invoiceNumber||'BORRADOR';
  const title=invoice.invoiceType==='rectifying'?'FACTURA RECTIFICATIVA':'FACTURA';

  doc.setFont('helvetica','bold');doc.setFontSize(20);doc.text(title,14,18);
  doc.setFontSize(11);doc.text(number,14,25);doc.setFont('helvetica','normal');
  doc.text(`Fecha: ${new Date(`${invoice.issueDate}T12:00:00`).toLocaleDateString('es-ES')}`,14,31);
  if(invoice.dueDate)doc.text(`Vencimiento: ${new Date(`${invoice.dueDate}T12:00:00`).toLocaleDateString('es-ES')}`,14,37);

  doc.setFont('helvetica','bold');doc.text(issuerName,120,18);doc.setFont('helvetica','normal');
  if(issuerTaxId)doc.text(`NIF/CIF: ${issuerTaxId}`,120,24);
  const issuerLines=doc.splitTextToSize(issuerAddress||'',74);if(issuerLines.length)doc.text(issuerLines,120,30);
  const blockY=Math.max(52,30+issuerLines.length*5);
  doc.setDrawColor(210);doc.line(14,blockY-5,196,blockY-5);doc.setFont('helvetica','bold');doc.text('FACTURAR A',14,blockY);doc.setFont('helvetica','normal');
  doc.text(invoice.clientName,14,blockY+7);if(invoice.clientTaxId)doc.text(`NIF/CIF: ${invoice.clientTaxId}`,14,blockY+13);
  const clientAddress=doc.splitTextToSize(invoice.clientAddress||'',85);if(clientAddress.length)doc.text(clientAddress,14,blockY+19);

  let y=blockY+35+Math.max(0,clientAddress.length-1)*5;
  doc.setFillColor(245,245,245);doc.rect(14,y-5,182,8,'F');doc.setFont('helvetica','bold');doc.setFontSize(9);
  doc.text('Descripción',16,y);doc.text('Cant.',112,y,{align:'right'});doc.text('Precio',135,y,{align:'right'});doc.text('IVA',153,y,{align:'right'});doc.text('Total',194,y,{align:'right'});y+=7;doc.setFont('helvetica','normal');
  for(const line of invoice.lines){
    if(y>270){doc.addPage();y=20;}
    const description=doc.splitTextToSize(line.description,85);doc.text(description,16,y);doc.text(line.quantity.toLocaleString('es-ES'),112,y,{align:'right'});doc.text(money(line.unitPrice),135,y,{align:'right'});doc.text(`${line.taxRate.toLocaleString('es-ES')} %`,153,y,{align:'right'});doc.text(money(line.lineTotal??0),194,y,{align:'right'});y+=Math.max(7,description.length*4.5+2);
  }
  y=Math.min(275,y+4);doc.line(115,y,196,y);y+=7;doc.text('Base imponible:',150,y,{align:'right'});doc.text(money(invoice.subtotal),194,y,{align:'right'});y+=6;
  if(invoice.discountAmount!==0){doc.text('Descuentos:',150,y,{align:'right'});doc.text(money(-invoice.discountAmount),194,y,{align:'right'});y+=6;}
  doc.text('IVA:',150,y,{align:'right'});doc.text(money(invoice.taxAmount),194,y,{align:'right'});y+=7;doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text('TOTAL:',150,y,{align:'right'});doc.text(money(invoice.totalAmount),194,y,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(9);const footerY=286;if(invoice.paymentMethod)doc.text(`Forma de pago: ${invoice.paymentMethod}`,14,footerY);if(settings?.iban)doc.text(`IBAN: ${settings.iban}`,14,footerY+5);if(settings?.invoiceFooter)doc.text(doc.splitTextToSize(settings.invoiceFooter,180),14,footerY+10);
  return doc.output('blob');
}
