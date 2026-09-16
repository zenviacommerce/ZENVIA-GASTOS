import type { ExpenseCategory, Invoice, InvoiceImportCandidate, InvoiceSource, NewInvoiceInput } from '../types';
import { readInvoiceDocumentEnhanced } from './invoiceReaderEnhanced';
import { repairInvoiceAmounts, repairInvoiceProductLines } from './invoiceProductLine';
import { extractSupplierContactData } from './supplierContactExtractor';
import { extractSupplierInvoiceDetails } from './supplierInvoiceDetails';
import { validateInvoiceRecipient } from './invoiceRecipientRules';

async function sha256File(file:File){
  const buffer=await file.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function normalizeKey(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

export async function prepareInvoiceCandidate(
  file:File,
  categories:ExpenseCategory[],
  onProgress?:(message:string)=>void,
):Promise<InvoiceImportCandidate>{
  const [read,fileHash]=await Promise.all([
    readInvoiceDocumentEnhanced(file,categories,onProgress),
    sha256File(file),
  ]);
  const repairedAmounts=repairInvoiceAmounts(read.text,{subtotal:read.subtotal,vat:read.vat,total:read.total});
  const repairedLines=repairInvoiceProductLines(read.text,read.lines);
  const contact=extractSupplierContactData(read.text,read.supplierName);
  const details=extractSupplierInvoiceDetails(read.text,read.supplierName);
  const recipient=validateInvoiceRecipient(read.text,read.invoiceDate);
  const equivalenceSurcharge='equivalenceSurcharge' in repairedAmounts ? Number(repairedAmounts.equivalenceSurcharge||0) : 0;

  let status:InvoiceImportCandidate['status']='ready';
  let reviewReason:string|undefined;
  if(!read.supplierName.trim()){
    status='needs_review';
    reviewReason='No se ha podido identificar el proveedor.';
  }else if(!read.invoiceDate){
    status='needs_review';
    reviewReason='No se ha podido identificar la fecha de la factura.';
  }else if(recipient.needsReview){
    status='needs_review';
    reviewReason=recipient.reason;
  }

  return {
    id:crypto.randomUUID(),
    file,
    fileHash,
    status,
    reviewReason,
    supplierName:read.supplierName,
    supplierTaxId:contact.taxId||details.taxId,
    supplierEmail:contact.email,
    supplierPhone:contact.phone,
    supplierAddress:details.address,
    supplierWebsite:details.website,
    recipientTaxId:recipient.detectedTaxId,
    recipientName:recipient.detectedName,
    invoiceNumber:read.invoiceNumber,
    invoiceDate:read.invoiceDate,
    categoryId:read.categoryId,
    subtotal:repairedAmounts.subtotal,
    vat:repairedAmounts.vat,
    equivalenceSurcharge,
    withholding:read.withholding,
    total:repairedAmounts.total,
    text:read.text,
    confidence:read.confidence,
    usedOcr:read.usedOcr,
    lines:repairedLines,
  };
}

export function classifyInvoiceCandidate(candidate:InvoiceImportCandidate,existingInvoices:Invoice[]):InvoiceImportCandidate{
  const supplierName=normalizeKey(candidate.supplierName);
  const invoiceNumber=normalizeKey(candidate.invoiceNumber);
  const duplicate=existingInvoices.find(existing=>
    Boolean(existing.fileHash && existing.fileHash === candidate.fileHash)
    || Boolean(
      invoiceNumber
      && supplierName
      && normalizeKey(existing.supplierName)===supplierName
      && normalizeKey(existing.invoiceNumber)===invoiceNumber
    )
  );
  if(duplicate){
    return {...candidate,status:'duplicate',reviewReason:`Factura duplicada${duplicate.invoiceNumber&&duplicate.invoiceNumber!=='—'?` (${duplicate.invoiceNumber})`:''}.`};
  }
  return candidate;
}

export function invoiceCandidateToInput(candidate:InvoiceImportCandidate,source:InvoiceSource='manual'):NewInvoiceInput{
  return {
    file:candidate.file,
    source,
    supplierName:candidate.supplierName,
    supplierTaxId:candidate.supplierTaxId,
    supplierEmail:candidate.supplierEmail,
    supplierPhone:candidate.supplierPhone,
    supplierAddress:candidate.supplierAddress,
    supplierWebsite:candidate.supplierWebsite,
    invoiceNumber:candidate.invoiceNumber,
    invoiceDate:candidate.invoiceDate,
    categoryId:candidate.categoryId,
    subtotal:candidate.subtotal,
    vat:candidate.vat,
    equivalenceSurcharge:candidate.equivalenceSurcharge,
    withholding:candidate.withholding,
    total:candidate.total,
    ocrText:candidate.text,
    extraction:{
      parser:candidate.usedOcr?'browser-ocr-v2':'pdf-text-v2',
      recipientTaxId:candidate.recipientTaxId??null,
      recipientName:candidate.recipientName??null,
      equivalenceSurcharge:candidate.equivalenceSurcharge,
      lineCount:candidate.lines.length,
    },
    extractionConfidence:candidate.confidence,
    lines:candidate.lines,
  };
}
