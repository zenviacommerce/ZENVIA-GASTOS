const compact=(value:string)=>value.replace(/\s+/g,' ').trim();

const headerPattern=/^(?:factura|invoice|abono|credit\s+note)(?:\s+(?:original|copia|copy))?$/i;
const fiscalPattern=/desglose\s+de\s+impuestos|base\s+imponible|\biva\b|\bvat\b|impuesto/i;
const totalPattern=/total\s+factu|importe\s+total|a\s+pagar|total(?:\s+en)?\s+(?:eur|€)/i;
const datePattern=/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:20)?\d{2}\b/;

function looksCompleteInvoiceBlock(text:string){
  const normalized=text.replace(/\r/g,'');
  return fiscalPattern.test(normalized)
    && totalPattern.test(normalized)
    && datePattern.test(normalized);
}

export function splitBundledInvoiceText(text:string):string[]{
  const lines=text.split(/\r?\n/).map(compact).filter(Boolean);
  const headers=lines.map((line,index)=>headerPattern.test(line)?index:-1).filter(index=>index>=0);
  if(headers.length<2)return [];

  const blocks=headers.map((header,index)=>{
    const previousHeader=index>0?headers[index-1]:-1;
    const gap=index>0?header-previousHeader:Number.POSITIVE_INFINITY;
    const start=index===0
      ?0
      :gap>16
        ?Math.max(previousHeader+1,header-12)
        :header;
    const end=index<headers.length-1?headers[index+1]:lines.length;
    return lines.slice(start,end).join('\n').trim();
  }).filter(Boolean);

  if(blocks.length<2)return [];
  if(blocks.every(looksCompleteInvoiceBlock))return blocks;
  return [];
}

export function structuralInvoiceCount(text:string){
  const blocks=splitBundledInvoiceText(text);
  if(blocks.length>=2)return blocks.length;

  const taxSections=(text.match(/desglose\s+de\s+impuestos/gi)||[]).length;
  const totalSections=(text.match(/total\s+factu(?:ra)?/gi)||[]).length;
  if(taxSections>=2&&totalSections>=2)return Math.min(taxSections,totalSections);
  return 0;
}
