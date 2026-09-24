import type { NewInvoiceLineInput } from '../types';

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

function parseMoney(value: string | undefined | null): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma > lastDot) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma) normalized = cleaned.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyValues(line: string): number[] {
  // No aceptamos espacios como separadores de miles. En tickets como Leroy Merlin
  // aparecen juntos el número de pedido y el importe ("254518 281,95") y unirlos
  // produciría falsos importes como 518.281,95 €.
  return [...line.matchAll(/-?\d{1,3}(?:\.\d{3})*,\d{2,6}|-?\d+\.\d{2,6}/g)]
    .map(match => parseMoney(match[0]));
}

export interface RetailInvoiceCorrection {
  lines: NewInvoiceLineInput[];
  subtotal: number;
  vat: number;
  total: number;
}

function findLeroyTaxSummary(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = compact(lines[index]);
    if (!/^EUR\b/i.test(line)) continue;
    const values = moneyValues(line);
    if (values.length < 3) continue;
    const nearby = lines.slice(Math.max(0, index - 4), index + 1).join(' ');
    if (!/Total\s+IVA|IVA\/IGIC\/IPSI|Total\s+TII/i.test(nearby)) continue;
    return {
      subtotal: values.at(-3) || 0,
      vat: values.at(-2) || 0,
      total: values.at(-1) || 0,
    };
  }
  return null;
}

function findContribution(lines: string[]) {
  for (const raw of [...lines].reverse()) {
    const line = compact(raw);
    if (!/contribuci[oó]n\s+total.*residuo/i.test(line)) continue;
    const values = moneyValues(line);
    if (values.length) return values.at(-1) || 0;
  }
  return 0;
}

function leroyProductLines(lines: string[]): NewInvoiceLineInput[] {
  const result: NewInvoiceLineInput[] = [];
  const excludedDescription = /pago\s+anticipado|ya\s+pagado|entrega\s+a\s+domicilio|contribuci[oó]n|modos?\s+de\s+pago|pendiente\s+de\s+pago/i;
  const ignoredDescription = /^(?:factura|original|tickets?\s+originales?|n[°ºo]?\s+designaci[oó]n|venta\s+si|eur\b|pag\.|ejemplar\s+cliente)/i;
  const rowPattern = /^\s*(\d{1,2})\s+(?:(\d{7,10})\s+)?(\d+(?:[.,]\d+)?)\s+(?:UNID\.?|UDS?\.?|UNIDADES?)\s+(.+)$/i;

  for (let index = 0; index < lines.length - 1; index += 1) {
    const description = compact(lines[index]);
    if (!description || description.length < 4 || ignoredDescription.test(description) || excludedDescription.test(description)) continue;

    const row = compact(lines[index + 1]);
    const match = row.match(rowPattern);
    if (!match) continue;

    const quantity = parseMoney(match[3]);
    const values = moneyValues(match[4]);
    if (!quantity || values.length < 4) continue;

    const listedUnitPrice = values[0] || 0;
    const unitDiscount = Math.max(0, values[1] || 0);
    const effectiveUnitPrice = Math.max(0, Math.round((listedUnitPrice - unitDiscount) * 100) / 100);
    const grossLineTotal = values.at(-1) || 0;

    let sku = match[2] || '';
    if (!sku) {
      const following = compact(lines[index + 2] || '');
      if (/^\d{7,10}$/.test(following)) sku = following;
    }

    result.push({
      description: description.replace(/^\*+/, '').trim().slice(0, 250),
      quantity,
      unit: 'ud',
      supplierSku: sku || null,
      unitPrice: effectiveUnitPrice || listedUnitPrice || null,
      lineTotal: grossLineTotal || null,
    });
  }

  return result.slice(0, 50);
}


const cashSierraProductStart=/\b(?:PAPEL\s+HIGIENICO|BOLSA\s+BASURA|COPA|TENEDOR|CUCHARILLA|CUCHARA|CHAMPU|DELANTAL|SERVILLETAS?|TOALLITA|BARQUETA|CAÑA|VELA|BANDEJA|FOLIOS?|PLATO|BOWL|MANTEL|VASO|TARRINA|ENVASE|FILM|PALILLO|GUANTE|TAPA|BOBINA)\b/gi;

function splitCashSierraDescriptions(value:string){
  const text=compact(value)
    .replace(/\s+\d{1,3}(?:\.\d{3})*,\d{2}(?:\s+\d{1,3}(?:\.\d{3})*,\d{2})+\s*$/,'')
    .trim();
  const matches=[...text.matchAll(cashSierraProductStart)];
  if(!matches.length)return [];
  return matches.map((match,index)=>{
    const start=match.index||0;
    const end=index+1<matches.length?(matches[index+1].index||text.length):text.length;
    return compact(text.slice(start,end))
      .replace(/\s+CARRO\s+N(?:º|°|O)?\s*\d+\s*$/i,'')
      .replace(/^[#·\s]+|[#·\s]+$/g,'')
      .slice(0,250);
  }).filter(description=>description.length>=3);
}

function previousLineIndex(lines:string[],from:number,pattern:RegExp,maxDistance=40){
  for(let index=from-1;index>=Math.max(0,from-maxDistance);index-=1){
    if(pattern.test(lines[index]))return index;
  }
  return -1;
}

function cashSierraPriceValues(lines:string[],facturaIndex:number){
  const priceLabel=previousLineIndex(lines,facturaIndex,/^PRECIO\s+IVA$/i,45);
  if(priceLabel<0)return [];
  const values:number[]=[];
  for(let index=priceLabel+1;index<Math.min(facturaIndex,priceLabel+8);index+=1){
    const line=compact(lines[index]);
    if(/PRADO\s+DEL\s+REY|PRECIO\s+CON\s+TASAS|^PEPE$/i.test(line))break;
    const found=moneyValues(line);
    if(found.length&&/^[\d.,\s-]+$/.test(line))values.push(...found);
  }
  return values;
}

function cashSierraQuantityValues(lines:string[],facturaIndex:number){
  const quantityLabel=previousLineIndex(lines,facturaIndex,/^CANTIDAD$/i,30);
  if(quantityLabel<0)return [];
  const totalLabel=previousLineIndex(lines,quantityLabel,/^TOTAL\s+FACTURA$/i,10);
  const start=totalLabel>=0?totalLabel+1:Math.max(0,quantityLabel-3);
  return lines.slice(start,quantityLabel).flatMap(line=>moneyValues(line));
}

/**
 * Cash Sierra Nevada imprime las columnas de cantidad/precio y los conceptos en
 * bloques separados dentro del PDF. pdf.js conserva esos bloques pero no una fila
 * por producto, así que el parser genérico confundía columnas numéricas con
 * descripciones. Reconstruimos las líneas usando el orden visual de esos bloques.
 */
export function getCashSierraNevadaProductLines(lines:string[],fullText:string):NewInvoiceLineInput[]{
  if(!/(?:cashsierranevada\.es|Cash\s+Sierra\s+Nevada,\s*S\.?L\.?)/i.test(fullText))return [];

  const normalized=lines.map(compact);
  const result:NewInvoiceLineInput[]=[];
  for(let facturaIndex=0;facturaIndex<normalized.length;facturaIndex+=1){
    if(!/^FACTURA\s+VENTA$/i.test(normalized[facturaIndex]))continue;
    let end=facturaIndex+1;
    while(end<normalized.length&&!/^BULTOS$/i.test(normalized[end]))end+=1;
    if(end>=normalized.length)continue;

    const descriptionBlob=normalized.slice(facturaIndex+1,end)
      .filter(line=>line&&!/^Efectivo$/i.test(line)&&!/^[\d.,\s-]+$/.test(line))
      .join(' ');
    const descriptions=splitCashSierraDescriptions(descriptionBlob);
    const quantities=cashSierraQuantityValues(normalized,facturaIndex);
    const prices=cashSierraPriceValues(normalized,facturaIndex);
    if(!descriptions.length||!quantities.length)continue;

    for(let index=0;index<descriptions.length&&index<quantities.length;index+=1){
      const quantity=quantities[index];
      const unitPrice=prices[index]??null;
      if(!(quantity>0))continue;
      result.push({
        description:descriptions[index],
        quantity,
        unit:'ud',
        unitPrice,
        lineTotal:unitPrice==null?null:Math.round(quantity*unitPrice*100)/100,
      });
    }
  }
  return result.slice(0,50);
}

export function getRetailInvoiceCorrection(lines: string[], fullText: string): RetailInvoiceCorrection | null {
  if (!/leroy\s+merlin/i.test(fullText)) return null;

  const summary = findLeroyTaxSummary(lines);
  const contribution = findContribution(lines);
  const subtotal = summary?.subtotal || 0;
  const vat = summary?.vat || 0;
  // En la factura final el anticipo puede dejar base/IVA/total a cero y quedar únicamente
  // una contribución ambiental de céntimos. Ese importe sí es el total real a contabilizar.
  const total = summary && summary.total > 0 ? summary.total : contribution || summary?.total || 0;

  return {
    lines: leroyProductLines(lines),
    subtotal,
    vat,
    total,
  };
}
