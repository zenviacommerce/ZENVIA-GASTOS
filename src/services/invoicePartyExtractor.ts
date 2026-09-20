import { normalizeEmail, normalizePhone, normalizeTaxId, emailError, phoneError, taxIdError } from './validation';

export type InvoicePartyRole='supplier'|'recipient';

export type InvoicePartyData={
  name?:string;
  taxId?:string;
  email?:string;
  phone?:string;
  addressLine1?:string;
  postalCode?:string;
  city?:string;
  province?:string;
  countryCode?:string;
};

type Options={
  role:InvoicePartyRole;
  nameHint?:string;
  invoiceNumber?:string;
  invoiceDate?:string;
};

const compact=(value:string)=>value.replace(/\s+/g,' ').trim();
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

const supplierMarker=/\b(?:proveedor|supplier|vendor|emisor|seller|from)\b/i;
const recipientMarker=/\b(?:cliente|customer|destinatario|receptor|facturar\s+a|bill\s+to|ship\s+to|sold\s+to)\b/i;
const fiscalMarker=/\b(?:cif|nif|nie|vat|tax\s*id|iva)\b/i;
const phoneMarker=/\b(?:tel(?:[ée]fono)?|telf|phone|mobile|m[oó]vil)\b/i;
const addressMarker=/\b(?:direcci[oó]n|address|adresse|indirizzo|anschrift)\b/i;
const streetMarker=/(?:^|\s)(?:c\s*\/|c\.|calle\b|avda?\.?\b|av\.?\b|avenida\b|carretera\b|ctra\.?\b|camino\b|paseo\b|plaza\b|barrio\b|pol[ií]gono\b|nave\b|rua\b|via\b|viale\b|piazza\b|rue\b|place\b|avenue\b|boulevard\b|strasse\b|straße\b|landstrasse\b|landstraße\b|weg\b|street\b|st\.\b|road\b|rd\.\b|lane\b|drive\b|väg\b|\p{L}+vägen\b|gata\b|gate\b)/iu;
const addressAreaMarker=/^(?:zac\b|parc\b|parque\b|park\b|parkea\b|zona\s+(?:industrial|comercial)\b|pol[ií]gono\b)|\b(?:parkea|parque\s+tecnol[oó]gico|technology\s+park|edificio|planta|portal|oficina|local)\b/i;
const postalLocationMarker=/^(?:[A-Z]{2}[-\s]?)?(?:\d{3}\s?\d{2}|\d{4}-\d{3}|\d{4,6})\b/i;

function looksLikeAddress(value:string){
  const clean=compact(value);
  if(!clean)return false;
  if(/^\d{1,5}\s+[A-Za-zÁÉÍÓÚÑÜÄÖÅÆØáéíóúñüäöåæø]/.test(clean))return true;
  if(postalLocationMarker.test(clean)&&/[A-Za-zÁÉÍÓÚÑÜÄÖÅÆØáéíóúñüäöåæø]{2}/.test(clean.replace(postalLocationMarker,'')))return true;
  if(streetMarker.test(clean)&&(/[\/#,]/.test(clean)||/\b\d{1,5}[A-Z]?\b/i.test(clean)))return true;
  if(addressAreaMarker.test(clean)&&(/\b\d{1,5}[A-Z]?\b/i.test(clean)||/[,#]/.test(clean)||/^(?:zac|parc|parque|park|parkea)\b/i.test(clean)))return true;
  if(/\b\d{4,6}\b/.test(clean)&&/(?:,|\b(?:madrid|barcelona|valencia|sevilla|lisboa|leipzig|francia|españa|italia|alemania|suecia)\b)/i.test(clean))return true;
  return false;
}
const metadataLine=/\b(?:factura|invoice|fecha|date|pedido|order|n[uú]mero\s+factura|invoice\s+(?:no|number)|base\s+imponible|subtotal|total|iva|vat|cantidad|quantity|precio|price|concepto|description|forma\s+de\s+pago)\b/i;

const countryNames:Array<[RegExp,string]>=[
  [/\b(?:españa|spain|espagne|spanien)\b/i,'ES'],
  [/\b(?:italia|italy|italie|italien)\b/i,'IT'],
  [/\b(?:francia|france|frankreich)\b/i,'FR'],
  [/\b(?:alemania|germany|deutschland|allemagne)\b/i,'DE'],
  [/\b(?:portugal)\b/i,'PT'],
  [/\b(?:irlanda|ireland|eire)\b/i,'IE'],
  [/\b(?:bélgica|belgica|belgium|belgië|belgique)\b/i,'BE'],
  [/\b(?:países\s+bajos|paises\s+bajos|netherlands|nederland)\b/i,'NL'],
  [/\b(?:suecia|sweden|sverige)\b/i,'SE'],
  [/\b(?:dinamarca|denmark|danmark)\b/i,'DK'],
  [/\b(?:austria|österreich)\b/i,'AT'],
  [/\b(?:polonia|poland|polska)\b/i,'PL'],
  [/\b(?:suiza|switzerland|schweiz|suisse|svizzera)\b/i,'CH'],
  [/\b(?:reino\s+unido|united\s+kingdom|great\s+britain|uk)\b/i,'GB'],
];

const knownTaxPrefixes=new Set(['ES','IT','FR','DE','PT','IE','BE','NL','SE','DK','AT','PL','CH','GB','CZ','SK','SI','RO','BG','HR','HU','FI','EE','LV','LT','LU','MT','CY','GR']);

function validName(value:string){
  const clean=compact(value).replace(/^[-:·]+|[-:·]+$/g,'');
  if(clean.length<4||clean.length>140)return '';
  if(/^[0-9a-f]{8}(?:[-_][0-9a-f]{4}){3}[-_][0-9a-f]{12}$/i.test(clean))return '';
  if(/^[0-9a-f_-]{20,}$/i.test(clean))return '';
  if(metadataLine.test(clean)||fiscalMarker.test(clean)||phoneMarker.test(clean))return '';
  if(/^(?:transferencia|tarjeta|paypal|bizum|contado|efectivo|iban|swift|bic|cuenta\s+bancaria|vencimiento)\b/i.test(clean))return '';
  if(looksLikeAddress(clean))return '';
  if(!/[A-Za-zÁÉÍÓÚÑÜÄÖÅÆØáéíóúñüäöåæø]{3}/.test(clean))return '';
  return clean;
}

function locateBlock(lines:string[],options:Options){
  const marker=options.role==='supplier'?supplierMarker:recipientMarker;
  const markerIndex=lines.findIndex(line=>marker.test(line));
  if(markerIndex>=0)return lines.slice(markerIndex,Math.min(lines.length,markerIndex+12));

  if(options.nameHint){
    const hint=normalize(options.nameHint);
    const hintIndex=lines.findIndex(line=>{
      const key=normalize(line);
      return key.includes(hint)||hint.includes(key);
    });
    if(hintIndex>=0)return lines.slice(hintIndex,Math.min(lines.length,hintIndex+10));
  }

  return lines.slice(0,Math.min(lines.length,24));
}

function extractName(block:string[],options:Options){
  const marker=options.role==='supplier'?supplierMarker:recipientMarker;
  const cleanCandidate=(value:string)=>validName(
    compact(value)
      .replace(/\s+(?:n(?:º|°|o)\.?\s*(?:de\s+)?factura|n[uú]mero\s+(?:de\s+)?factura|invoice\s+(?:no\.?|number)|fecha\s+factura|invoice\s+date)\b.*$/i,'')
      .replace(/\s+FACTURA\s*$/i,''),
  );

  const candidates:{value:string;score:number}[]=[];
  for(let index=0;index<block.length;index+=1){
    const line=block[index];
    if(!marker.test(line))continue;

    const inline=cleanCandidate(line.replace(marker,'').replace(/^\s*[:.-]?\s*/,''));
    if(inline)candidates.push({value:inline,score:120});

    for(let offset=1;offset<=5;offset+=1){
      const candidate=cleanCandidate(block[index+offset]||'');
      if(!candidate)continue;
      let score=100-offset*8;
      if(/\b(?:s\.?l\.?u?|s\.?a\.?|s\.?c\.?|ltd\.?|limited|gmbh|sarl|sas|bv|ab)\b/i.test(candidate))score+=35;
      if(/^[A-ZÁÉÍÓÚÑÜÄÖÅÆØ][A-Za-zÁÉÍÓÚÑÜÄÖÅÆØáéíóúñüäöåæø.'-]+(?:\s+[A-ZÁÉÍÓÚÑÜÄÖÅÆØ][A-Za-zÁÉÍÓÚÑÜÄÖÅÆØáéíóúñüäöåæø.'-]+){1,4}$/.test(candidate))score+=18;
      if(/\d/.test(candidate))score-=30;
      candidates.push({value:candidate,score});
    }
  }

  if(candidates.length)return candidates.sort((a,b)=>b.score-a.score)[0].value;
  const hinted=validName(options.nameHint||'');
  return hinted||undefined;
}

function validTaxIdCandidate(raw:string|undefined|null){
  if(!raw)return undefined;
  const value=normalizeTaxId(raw);
  if(!value||taxIdError(value,false))return undefined;
  return value;
}

function extractTaxId(block:string[]){
  const joined=block.join(' ');
  const labelled=joined.match(/\b(?:CIF|NIF|NIE|VAT(?:\s*(?:ID|NO|NUMBER))?|TAX\s*ID|TVA|UST[-\s]?ID|UID)\s*[:#-]?\s*([A-Z]{0,2}\s*[A-Z0-9](?:[\s.-]*[A-Z0-9]){6,14})/i)?.[1];
  const labelledValue=validTaxIdCandidate(labelled);
  if(labelledValue)return labelledValue;

  // Muchas facturas B2B muestran el CIF/VAT como una línea independiente justo
  // debajo del nombre del cliente, sin prefijo "CIF:" o "VAT:". El importador
  // anterior ignoraba esos casos. Como este bloque ya está acotado al receptor,
  // podemos buscar identificadores fiscales válidos sin confundirlos con el emisor.
  const candidatePatterns=[
    /\b(?:[ABCDEFGHJNPQRSUVW]\s*\d(?:[\s.-]*\d){6}[\s.-]*[0-9A-J])\b/gi,
    /\b(?:\d(?:[\s.-]*\d){7}[\s.-]*[A-Z])\b/gi,
    /\b(?:[XYZ]\s*\d(?:[\s.-]*\d){6}[\s.-]*[A-Z])\b/gi,
    /\b(?:[A-Z]{2}\s*[A-Z0-9](?:[\s.-]*[A-Z0-9]){5,11})\b/gi,
  ];
  for(const pattern of candidatePatterns){
    for(const match of joined.matchAll(pattern)){
      const value=validTaxIdCandidate(match[0]);
      if(value)return value;
    }
  }
  return undefined;
}

function extractEmail(block:string[]){
  for(const line of block){
    const raw=line.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
    if(!raw)continue;
    const value=normalizeEmail(raw);
    if(!emailError(value,false))return value;
  }
  return undefined;
}

function extractPhone(block:string[]){
  for(const line of block){
    if(!phoneMarker.test(line))continue;
    for(const match of line.matchAll(/(?:\+?\d[\d\s().-]{5,}\d)/g)){
      const raw=match[0].trim();
      const digits=raw.replace(/\D/g,'');
      if(digits.length<7||digits.length>15)continue;
      if(/^20\d{6,}$/.test(digits))continue;
      const value=normalizePhone(raw);
      if(!phoneError(value,false))return value;
    }
  }
  return undefined;
}

function detectCountry(block:string[],taxId?:string){
  const joined=block.join(' ');
  for(const [pattern,code] of countryNames)if(pattern.test(joined))return code;
  const prefix=taxId?.slice(0,2).toUpperCase();
  if(prefix&&knownTaxPrefixes.has(prefix))return prefix;
  for(const line of block){
    const code=compact(line).toUpperCase();
    if(knownTaxPrefixes.has(code))return code;
  }
  return undefined;
}

function cleanAddressCandidate(line:string,options:Options){
  const value=compact(line);
  if(!value||value.length<4||value.length>140)return '';
  if(metadataLine.test(value)||fiscalMarker.test(value)||phoneMarker.test(value)||/@/.test(value))return '';
  if(options.invoiceNumber&&normalize(value).includes(normalize(options.invoiceNumber)))return '';
  if(options.invoiceDate&&normalize(value).includes(normalize(options.invoiceDate)))return '';
  if(/^\d+(?:[.,]\d+)?$/.test(value))return '';
  return value;
}

function extractAddress(block:string[],options:Options){
  let addressLine1='';
  let postalCode='';
  let city='';
  let province='';

  for(let index=0;index<block.length;index+=1){
    const line=block[index];
    if(addressMarker.test(line)){
      const inline=cleanAddressCandidate(line.replace(addressMarker,'').replace(/^\s*[:.-]?\s*/,''),options);
      if(inline&&streetMarker.test(inline))addressLine1=inline;
    }

    const postal=line.match(/\b((?:[A-Z]{2}[-\s]?)?(?:\d{3}\s?\d{2}|\d{4}-\d{3}|\d{4,6}))\b\s*[,;-]?\s*([A-Za-zÁÉÍÓÚÑÜÄÖÅÆØáéíóúñüäöåæø][A-Za-zÁÉÍÓÚÑÜÄÖÅÆØáéíóúñüäöåæø .'-]{1,60})/i);
    if(postal){
      postalCode=postal[1].replace(/[\s-]/g,'').replace(/^[A-Z]{2}/i,'');
      city=compact(postal[2])
        .replace(/\s+(?:CIF|NIF|VAT|Tel[eé]fono|Email).*$/i,'')
        .replace(/\s*[,;-]?\s*(?:españa|spain|francia|france|italia|italy|alemania|germany|deutschland|portugal|suecia|sweden|sverige|dinamarca|denmark|danmark|b[eé]lgica|belgium|netherlands|nederland|austria|polonia|poland|suiza|switzerland)\s*$/i,'');
      if(!addressLine1){
        for(let back=1;back<=2;back+=1){
          const previous=cleanAddressCandidate(block[index-back]||'',options);
          if(previous&&streetMarker.test(previous)){addressLine1=previous;break;}
        }
      }
      break;
    }
  }

  if(!addressLine1){
    const street=block.map(line=>cleanAddressCandidate(line,options)).find(line=>line&&streetMarker.test(line));
    if(street)addressLine1=street;
  }

  return {addressLine1:addressLine1||undefined,postalCode:postalCode||undefined,city:city||undefined,province:province||undefined};
}

export function extractInvoiceParty(text:string,options:Options):InvoicePartyData{
  const lines=text.split(/\r?\n/).map(compact).filter(Boolean);
  if(!lines.length)return {};
  const block=locateBlock(lines,options);
  const name=extractName(block,options);
  const taxId=extractTaxId(block);
  const email=extractEmail(block);
  const phone=extractPhone(block);
  const countryCode=detectCountry(block,taxId);
  const address=extractAddress(block,options);
  return {name,taxId,email,phone,countryCode,...address};
}

export function formatInvoicePartyAddress(party:InvoicePartyData){
  return [
    party.addressLine1,
    [party.postalCode,party.city].filter(Boolean).join(' '),
    party.province,
    party.countryCode,
  ].filter(Boolean).join(', ');
}
