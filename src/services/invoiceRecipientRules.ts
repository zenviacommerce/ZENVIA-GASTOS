const HISTORICAL_NAME='CRISTIAN JESUS PEREZ GARRIDO';
const HISTORICAL_TAX_ID='15436385G';
const HISTORICAL_LAST_DATE='2026-06-30';

function normalizeText(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
}

function normalizeTaxId(value:string){
  return value.toUpperCase().replace(/[^A-Z0-9]/g,'');
}

export type InvoiceRecipientValidation={
  accepted:boolean;
  needsReview:boolean;
  reason?:string;
  detectedTaxId?:string;
  detectedName?:string;
};

export function validateInvoiceRecipient(text:string,invoiceDate:string):InvoiceRecipientValidation{
  const normalized=normalizeText(text);
  const hasHistoricalName=normalized.includes(HISTORICAL_NAME);
  const detectedHistoricalTaxId=normalizeTaxId(normalized).includes(HISTORICAL_TAX_ID);

  if(!hasHistoricalName&&!detectedHistoricalTaxId){
    return {accepted:true,needsReview:false};
  }

  if(!detectedHistoricalTaxId){
    return {
      accepted:false,
      needsReview:true,
      reason:'Destinatario histórico detectado sin NIF verificable.',
      detectedName:HISTORICAL_NAME,
    };
  }

  if(!invoiceDate||invoiceDate>HISTORICAL_LAST_DATE){
    return {
      accepted:false,
      needsReview:true,
      reason:'Destinatario no válido para esta fecha.',
      detectedTaxId:HISTORICAL_TAX_ID,
      detectedName:HISTORICAL_NAME,
    };
  }

  return {
    accepted:true,
    needsReview:false,
    detectedTaxId:HISTORICAL_TAX_ID,
    detectedName:HISTORICAL_NAME,
  };
}
