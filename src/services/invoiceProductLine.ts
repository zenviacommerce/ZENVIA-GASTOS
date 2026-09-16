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

export type SimpleInvoiceProductRow={description:string;quantity:number;unitPrice:number;lineTotal:number};
export type RepairableInvoiceLine={description:string;quantity:number;unit?:string|null;supplierSku?:string|null;unitPrice?:number|null;lineTotal?:number|null};

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

export function repairInvoiceProductLines(text:string,lines:RepairableInvoiceLine[]):RepairableInvoiceLine[]{
  const simple=text.split(/\r?\n/)
    .map(parseSimpleInvoiceProductRow)
    .filter((line):line is SimpleInvoiceProductRow=>Boolean(line));
  if(simple.length>=2)return simple.slice(0,50);
  return lines
    .filter(line=>!isNonProductInvoiceLine(line.description))
    .map(line=>({...line,description:cleanInvoiceProductDescription(line.description)}))
    .filter(line=>line.description.length>=3)
    .slice(0,50);
}
