const compact=(value:string)=>value.replace(/\s+/g,' ').trim();
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export type SupplierInvoiceDetails={taxId?:string;address?:string;website?:string};

function supplierBlock(text:string,supplierName:string){
  const lines=text.split(/\r?\n/).map(compact).filter(Boolean);
  const nameKey=normalized(supplierName);
  const supplierIndex=lines.findIndex(line=>{
    const key=normalized(line);
    return Boolean(nameKey)&&(key.includes(nameKey)||nameKey.includes(key));
  });
  if(supplierIndex<0)return lines.slice(0,12);
  const result:string[]=[];
  for(let index=supplierIndex;index<Math.min(lines.length,supplierIndex+12);index+=1){
    const line=lines[index];
    if(index>supplierIndex&&/^(?:factura|invoice|cliente\b|customer\b|bill\s+to\b|facturar\s+a\b|zenvia\s+commerce\b)/i.test(line))break;
    result.push(line);
  }
  return result;
}

function normalizeTaxId(value:string){return value.toUpperCase().replace(/[\s.-]/g,'').trim();}

function extractTaxId(lines:string[]){
  const label=/(?:C\.?\s*I\.?\s*F\.?|N\.?\s*I\.?\s*F\.?|VAT(?:\s*(?:ID|NO\.?|NUMBER))?)\s*[:#-]?\s*([A-Z]{0,2}\s*[A-Z0-9](?:[\s.-]*[A-Z0-9]){6,14})/i;
  for(const line of lines){
    const value=line.match(label)?.[1];
    if(value)return normalizeTaxId(value);
  }
  return undefined;
}

function extractWebsite(lines:string[]){
  const website=/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s]*)?)\b/i;
  for(const line of lines){
    if(line.includes('@'))continue;
    const value=line.match(website)?.[1];
    if(!value)continue;
    return /^https?:\/\//i.test(value)?value:`https://${value}`;
  }
  return undefined;
}

function isAddressLine(line:string){
  if(/\b\d{5}\b/.test(line))return true;
  return /\b(?:c\/?|calle|avda\.?|avenida|ctra\.?|carretera|camino|paseo|plaza|pol[ií]gono|nave|km\.?|merc[a-záéíóúñ]+)\b/i.test(line);
}

function extractAddress(lines:string[],supplierName:string){
  const nameKey=normalized(supplierName);
  const addressLines:string[]=[];
  for(const line of lines){
    const key=normalized(line);
    if(key===nameKey||key.includes(nameKey)||nameKey.includes(key))continue;
    if(/(?:C\.?\s*I\.?\s*F\.?|N\.?\s*I\.?\s*F\.?|VAT)/i.test(line))continue;
    if(/@|www\.|https?:\/\//i.test(line))continue;
    if(isAddressLine(line))addressLines.push(line);
  }
  return addressLines.length?addressLines.join(', '):undefined;
}

export function extractSupplierInvoiceDetails(text:string,supplierName:string):SupplierInvoiceDetails{
  if(!text.trim()||!supplierName.trim())return {};
  const block=supplierBlock(text,supplierName);
  return {
    taxId:extractTaxId(block),
    address:extractAddress(block,supplierName),
    website:extractWebsite(block),
  };
}
