import { jsPDF } from 'jspdf';
import type { BusinessSettings, SalesInvoice } from './sales';
import type { CompanyBranding } from './companyBranding';

const money=(value:number)=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(value);
const treatmentLabel=(value:SalesInvoice['fiscalTreatment'])=>({
  taxable:'Sujeta a IVA',exempt:'Exenta de IVA',non_taxable:'No sujeta a IVA',out_of_scope:'Fuera del ámbito de IVA',
}[value]);

export function createSalesReceiptPdfBlob(receipt:SalesInvoice,business:BusinessSettings,branding:CompanyBranding){
  const pdf=new jsPDF({unit:'mm',format:'a4'});
  let y=18;
  if(branding.logoDataUrl){
    try{pdf.addImage(branding.logoDataUrl,'PNG',15,y,48,18,undefined,'FAST');y+=24;}catch{/* logo format fallback: continue without image */}
  }
  pdf.setFont('helvetica','bold');pdf.setFontSize(17);pdf.text('RECIBO',15,y);y+=8;
  pdf.setFontSize(10);pdf.setFont('helvetica','normal');
  pdf.text(receipt.invoiceNumber||'Borrador',15,y);pdf.text(receipt.issueDate,150,y);y+=9;
  pdf.setDrawColor(220);pdf.line(15,y,195,y);y+=8;

  pdf.setFont('helvetica','bold');pdf.text(business.legalName||receipt.issuerName||'',15,y);y+=5;
  pdf.setFont('helvetica','normal');
  if(business.taxId||receipt.issuerTaxId){pdf.text(`NIF/CIF: ${business.taxId||receipt.issuerTaxId}`,15,y);y+=5;}
  pdf.text(`Cliente: ${receipt.clientName}`,15,y);y+=5;
  if(receipt.clientTaxId){pdf.text(`NIF/CIF cliente: ${receipt.clientTaxId}`,15,y);y+=7;}else y+=2;

  pdf.setFont('helvetica','bold');
  pdf.text('Concepto',15,y);pdf.text('Cant.',120,y,{align:'right'});pdf.text('Precio',150,y,{align:'right'});pdf.text('Total',195,y,{align:'right'});y+=4;
  pdf.line(15,y,195,y);y+=6;
  pdf.setFont('helvetica','normal');
  for(const line of receipt.lines){
    if(y>255){pdf.addPage();y=18;}
    const description=(line.description||'').slice(0,70);
    pdf.text(description,15,y);
    pdf.text(String(line.quantity),120,y,{align:'right'});
    pdf.text(money(line.unitPrice),150,y,{align:'right'});
    pdf.text(money(line.lineTotal??line.quantity*line.unitPrice),195,y,{align:'right'});
    y+=7;
  }
  y+=3;pdf.line(120,y,195,y);y+=7;
  pdf.text('Base',150,y,{align:'right'});pdf.text(money(receipt.subtotal),195,y,{align:'right'});y+=6;
  pdf.text('IVA',150,y,{align:'right'});pdf.text(money(receipt.taxAmount),195,y,{align:'right'});y+=7;
  pdf.setFont('helvetica','bold');pdf.setFontSize(12);pdf.text('TOTAL',150,y,{align:'right'});pdf.text(money(receipt.totalAmount),195,y,{align:'right'});y+=10;

  pdf.setFontSize(9);pdf.setFont('helvetica','normal');
  pdf.text(`Tratamiento fiscal: ${treatmentLabel(receipt.fiscalTreatment)}`,15,y);y+=5;
  if(receipt.fiscalReason){const lines=pdf.splitTextToSize(`Motivo: ${receipt.fiscalReason}`,175);pdf.text(lines,15,y);y+=lines.length*4.5;}
  if(receipt.paymentMethod){pdf.text(`Forma de cobro: ${receipt.paymentMethod}`,15,y);y+=5;}
  if(receipt.notes){const lines=pdf.splitTextToSize(receipt.notes,175);pdf.text(lines,15,y);}
  return pdf.output('blob');
}

export function salesReceiptPdfFilename(receipt:SalesInvoice){
  const safe=(receipt.invoiceNumber||'recibo').replace(/[^a-zA-Z0-9._-]+/g,'-');
  return `${safe}.pdf`;
}
