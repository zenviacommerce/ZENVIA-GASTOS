export type FiscalAmounts={
  subtotal:number;
  vat:number;
  total:number;
  withholding?:number;
  equivalenceSurcharge?:number;
};

export type FiscalReconciliation={
  subtotal:number;
  vat:number;
  total:number;
  confidence:number;
  corrected:boolean;
  reason:string;
};

type Observation={value:number;line:number;raw:string};

const moneyToken=/-?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.]\d{2}\b/g;
const baseMarker=/\b(?:base(?:\s+imponible)?|subtotal|importe\s+neto|net\s+amount|taxable\s+(?:base|amount))\b/i;
const taxMarker=/\b(?:i\.?v\.?a\.?|vat|tax|impuesto(?:s)?|importe\s+i\.?v\.?a\.?)\b/i;
const totalMarker=/\b(?:total\s+factura|importe\s+total|total\s+a\s+pagar|a\s+pagar|amount\s+due|invoice\s+total|grand\s+total|total)\b/i;

function round2(value:number){return Math.round((value+Number.EPSILON)*100)/100;}

function parseMoney(raw:string){
  const compact=raw.replace(/\s/g,'');
  const comma=compact.lastIndexOf(',');
  const dot=compact.lastIndexOf('.');
  let normalized=compact;
  if(comma>dot)normalized=compact.replace(/\./g,'').replace(',','.');
  else if(dot>comma)normalized=compact.replace(/,/g,'');
  const value=Number(normalized);
  return Number.isFinite(value)?value:0;
}

function observations(lines:string[]){
  const result:Observation[]=[];
  lines.forEach((line,index)=>{
    for(const match of line.matchAll(moneyToken)){
      const value=parseMoney(match[0]);
      if(!Number.isFinite(value)||value<=0||value>=10_000_000)continue;
      result.push({value:round2(value),line:index,raw:line});
    }
  });
  return result;
}

function markerDistance(lines:string[],line:number,marker:RegExp,maxDistance=6){
  let best=Infinity;
  const start=Math.max(0,line-maxDistance);
  const end=Math.min(lines.length-1,line+maxDistance);
  for(let index=start;index<=end;index+=1){
    marker.lastIndex=0;
    if(marker.test(lines[index]))best=Math.min(best,Math.abs(index-line));
  }
  marker.lastIndex=0;
  return best;
}

function roleScore(lines:string[],obs:Observation,role:'base'|'tax'|'total'){
  const marker=role==='base'?baseMarker:role==='tax'?taxMarker:totalMarker;
  const distance=markerDistance(lines,obs.line,marker);
  let score=Number.isFinite(distance)?Math.max(0,28-distance*4):0;
  if(/%/.test(obs.raw)&&obs.value<=100)score-=18;
  if(/\b(?:cp|c\.p\.|postal|tel(?:e|é)fono|fax|iban|bic|swift|c[oó]digo|cod\.)\b/i.test(obs.raw))score-=8;
  return score;
}

function consistent(amounts:FiscalAmounts){
  if(!(amounts.total>0)||amounts.subtotal<0||amounts.vat<0)return false;
  const expected=round2(
    amounts.subtotal+
    amounts.vat+
    Number(amounts.equivalenceSurcharge||0)+
    Number(amounts.withholding||0)
  );
  const tolerance=Math.max(.08,Math.abs(amounts.total)*.0025);
  return Math.abs(expected-amounts.total)<=tolerance;
}

export function invoiceAmountsConsistent(amounts:FiscalAmounts){
  return consistent(amounts);
}

export function reconcileInvoiceFiscalAmounts(text:string,current:FiscalAmounts):FiscalReconciliation{
  const lines=text.split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean);
  const currentResult:FiscalReconciliation={
    subtotal:round2(current.subtotal||0),
    vat:round2(current.vat||0),
    total:round2(current.total||0),
    confidence:consistent(current)?.86:.35,
    corrected:false,
    reason:consistent(current)?'Los importes actuales cuadran matemáticamente.':'Los importes actuales no cuadran.',
  };
  if(!lines.length)return currentResult;

  const obs=observations(lines);
  if(obs.length<3)return currentResult;

  const baseCandidates=obs
    .map(item=>({item,score:roleScore(lines,item,'base')}))
    .filter(entry=>entry.score>0)
    .sort((a,b)=>b.score-a.score)
    .slice(0,14);
  const taxCandidates=obs
    .map(item=>({item,score:roleScore(lines,item,'tax')}))
    .filter(entry=>entry.score>0)
    .sort((a,b)=>b.score-a.score)
    .slice(0,14);
  const totalCandidates=obs
    .map(item=>({item,score:roleScore(lines,item,'total')}))
    .filter(entry=>entry.score>0)
    .sort((a,b)=>b.score-a.score)
    .slice(0,14);

  let best:{subtotal:number;vat:number;total:number;score:number}|null=null;
  const fixedAdjustments=Number(current.equivalenceSurcharge||0)+Number(current.withholding||0);

  for(const base of baseCandidates){
    for(const tax of taxCandidates){
      if(base.item===tax.item)continue;
      const rate=base.item.value>0?tax.item.value/base.item.value:0;
      if(rate>.35)continue;
      for(const total of totalCandidates){
        if(total.item===base.item||total.item===tax.item)continue;
        const expected=round2(base.item.value+tax.item.value+fixedAdjustments);
        const tolerance=Math.max(.06,Math.abs(total.item.value)*.0015);
        const difference=Math.abs(expected-total.item.value);
        if(difference>tolerance)continue;

        const span=Math.max(base.item.line,tax.item.line,total.item.line)-Math.min(base.item.line,tax.item.line,total.item.line);
        let score=base.score+tax.score+total.score+50;
        score-=Math.min(18,span*.7);
        score-=Math.min(10,difference*100);
        if(rate>=.035&&rate<=.30)score+=8;
        if(Math.abs(total.item.value-Math.max(base.item.value,tax.item.value,total.item.value))<.001)score+=5;
        if(!best||score>best.score)best={
          subtotal:base.item.value,
          vat:tax.item.value,
          total:total.item.value,
          score,
        };
      }
    }
  }

  if(!best||best.score<92)return currentResult;
  const changed=
    Math.abs(best.subtotal-currentResult.subtotal)>.02||
    Math.abs(best.vat-currentResult.vat)>.02||
    Math.abs(best.total-currentResult.total)>.02;

  return {
    subtotal:best.subtotal,
    vat:best.vat,
    total:best.total,
    confidence:Math.min(.99,.78+(best.score-92)/140),
    corrected:changed,
    reason:changed
      ?'Cierre fiscal reconciliado mediante base + IVA = total.'
      :'El cierre fiscal etiquetado confirma los importes actuales.',
  };
}
