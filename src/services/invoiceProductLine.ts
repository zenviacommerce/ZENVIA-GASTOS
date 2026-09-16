const compact=(value:string)=>value.replace(/\s+/g,' ').trim();
const MONEY='-?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{2,6}|-?\\d+\\.\\d{2,6}';

function parseNumber(value:string){
  const cleaned=value.replace(/[^\d,.-]/g,'');
  if(!cleaned)return 0;
  const lastComma=cleaned.lastIndexOf(',');
  const lastDot=cleaned.lastIndexOf('.');
  let normalized=cleaned;
  if(lastComma>lastDot)normalized=cleaned.replace(/\./g,'').replace(',','.');
  else if(lastDot>lastComma)normalized=cleaned.replace(/,/g,'');
  const parsed=Number(normalized);
  return Number.isFinite(parsed)?parsed:0;
}

const round=(value:number,decimals:number)=>Number(value.toFixed(decimals));

export function cleanInvoiceProductDescription(value:string){
  return compact(value
    .replace(/[€£$¥]/g,' ')
    .replace(/\bEUR\b/gi,' ')
    .replace(/\s+/g,' '));
}

export function isNonProductInvoiceLine(value:string){
  const line=compact(value);
  if(!line)return true;
  if(/\b(?:pago\s+anticipado|forma\s+de\s+pago|base\s+imponible|total\s*\(?(?:impuestos?|iva)?(?:\s+incl\.?)?\)?|impuestos?|entregado|cambio|desglose\s+de\s+impuestos|retenci[oó]n|cuota\s+iva)\b/i.test(line))return true;
  if(/^\s*[A-Z]?\s*\d{1,2}(?:[.,]\d{1,2})?\s*%/i.test(line))return true;
  return false;
}

export type InclusiveTaxSummary={taxRate:number;subtotal:number;vat:number;total:number};

export function extractInclusiveTaxSummary(text:string):InclusiveTaxSummary|null{
  if(!/total\s*\(\s*(?:impuestos?|iva)\s+incl\.?\s*\)/i.test(text))return null;
  const pattern=new RegExp(`^\\s*[A-Z]?\\s*(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*%\\s+(${MONEY})\\s*(?:€|EUR)?\\s+(${MONEY})\\s*(?:€|EUR)?\\s+(${MONEY})`,'i');
  const matches=text.split(/\r?\n/).map(line=>line.match(pattern)).filter((match):match is RegExpMatchArray=>Boolean(match));
  if(matches.length!==1)return null;
  const match=matches[0];
  const taxRate=parseNumber(match[1]);
  const subtotal=parseNumber(match[2]);
  const vat=parseNumber(match[3]);
  const total=parseNumber(match[4]);
  if(taxRate<=0||taxRate>100||subtotal<=0||vat<0||total<=0)return null;
  if(Math.abs(subtotal+vat-total)>0.05)return null;
  return {taxRate,subtotal,vat,total};
}

export type SimpleInvoiceProductRow={description:string;quantity:number;unitPrice:number;lineTotal:number};
export type RepairableInvoiceLine={
  description:string;
  quantity:number;
  unit?:string|null;
  supplierSku?:string|null;
  unitPrice?:number|null;
  normalizedUnitPrice?:number|null;
  lineNet?:number|null;
  taxRate?:number|null;
  taxAmount?:number|null;
  lineTotal?:number|null;
};

export function parseSimpleInvoiceProductRow(value:string):SimpleInvoiceProductRow|null{
  const line=compact(value);
  if(isNonProductInvoiceLine(line))return null;
  const pattern=new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s+(.+?)\\s+(${MONEY})\\s*(?:€|EUR)?\\s+(${MONEY})\\s*(?:€|EUR)?$`,'i');
  const match=line.match(pattern);
  if(!match)return null;
  const quantity=parseNumber(match[1]);
  const description=cleanInvoiceProductDescription(match[2]);
  const unitPrice=parseNumber(match[3]);
  const lineTotal=parseNumber(match[4]);
  if(!quantity||quantity>1_000_000||description.length<3||!lineTotal)return null;
  return {description,quantity,unitPrice,lineTotal};
}

function normalizeInclusiveLine(line:RepairableInvoiceLine,summary:InclusiveTaxSummary):RepairableInvoiceLine{
  const factor=1+summary.taxRate/100;
  const unitPrice=line.unitPrice??null;
  const lineTotal=line.lineTotal??null;
  const normalizedUnitPrice=unitPrice==null?line.normalizedUnitPrice??null:round(unitPrice/factor,6);
  const lineNet=lineTotal==null?line.lineNet??null:round(lineTotal/factor,2);
  const taxAmount=lineTotal==null||lineNet==null?line.taxAmount??null:round(lineTotal-lineNet,2);
  return {...line,normalizedUnitPrice,lineNet,taxRate:summary.taxRate,taxAmount};
}

export function repairInvoiceProductLines(text:string,lines:RepairableInvoiceLine[]):RepairableInvoiceLine[]{
  const inclusiveSummary=extractInclusiveTaxSummary(text);
  const simple=text.split(/\r?\n/)
    .map(parseSimpleInvoiceProductRow)
    .filter((line):line is SimpleInvoiceProductRow=>Boolean(line));
  const repaired=simple.length>=2
    ? simple.slice(0,50)
    : lines
      .filter(line=>!isNonProductInvoiceLine(line.description))
      .map(line=>({...line,description:cleanInvoiceProductDescription(line.description)}))
      .filter(line=>line.description.length>=3)
      .slice(0,50);
  return inclusiveSummary?repaired.map(line=>normalizeInclusiveLine(line,inclusiveSummary)):repaired;
}

export function repairInvoiceAmounts(text:string,amounts:{subtotal:number;vat:number;total:number}){
  const summary=extractInclusiveTaxSummary(text);
  if(!summary)return amounts;
  return {subtotal:summary.subtotal,vat:summary.vat,total:summary.total};
}
