const ECB_API='https://data-api.ecb.europa.eu/service/data/EXR';
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

type Observation={date:string;currency:string;rate:number};
export type FxRateRow={
  rate_date:string;
  currency_code:string;
  rate_to_eur:number;
  source:'ECB';
  updated_at:string;
};

function csvLine(line:string){
  const values:string[]=[];
  let current='';
  let quoted=false;
  for(let index=0;index<line.length;index+=1){
    const char=line[index];
    if(char==='"'){
      if(quoted&&line[index+1]==='"'){current+='"';index+=1;continue;}
      quoted=!quoted;
      continue;
    }
    if(char===','&&!quoted){values.push(current);current='';continue;}
    current+=char;
  }
  values.push(current);
  return values;
}

export function parseEcbCsv(text:string):Observation[]{
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());
  if(lines.length<2)return [];
  const headers=csvLine(lines[0]).map(value=>value.trim().toUpperCase());
  const currencyIndex=headers.indexOf('CURRENCY');
  const dateIndex=headers.indexOf('TIME_PERIOD');
  const valueIndex=headers.indexOf('OBS_VALUE');
  if(currencyIndex<0||dateIndex<0||valueIndex<0)throw new Error('Formato CSV del BCE no reconocido.');

  const observations:Observation[]=[];
  for(const line of lines.slice(1)){
    const values=csvLine(line);
    const currency=String(values[currencyIndex]||'').trim().toUpperCase();
    const date=String(values[dateIndex]||'').trim();
    const rate=Number(values[valueIndex]);
    if(!currency||!DATE_RE.test(date)||!Number.isFinite(rate)||rate<=0)continue;
    observations.push({date,currency,rate});
  }
  return observations;
}

export function toRateRows(observations:Observation[]):FxRateRow[]{
  const now=new Date().toISOString();
  const rows:FxRateRow[]=observations
    .filter(row=>row.currency&&row.date&&Number.isFinite(row.rate)&&row.rate>0)
    .map(row=>({
      rate_date:row.date,
      currency_code:row.currency.toUpperCase(),
      rate_to_eur:1/row.rate,
      source:'ECB',
      updated_at:now,
    }));
  const dates=[...new Set(rows.map(row=>row.rate_date))];
  for(const date of dates)rows.push({rate_date:date,currency_code:'EUR',rate_to_eur:1,source:'ECB',updated_at:now});
  return rows;
}

function validateDate(value:string,label:string){
  if(!DATE_RE.test(value)||Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()))throw new Error(`${label} no es una fecha válida.`);
}

export async function fetchEcbObservations(currencies:string[],from:string,to:string){
  validateDate(from,'from');
  validateDate(to,'to');
  if(from>to)throw new Error('El rango FX no es válido.');
  const codes=[...new Set(currencies.map(value=>String(value||'').trim().toUpperCase()).filter(value=>value&&value!=='EUR'))].sort();
  if(!codes.length)return [];

  const key=`D.${codes.join('+')}.EUR.SP00.A`;
  const url=new URL(`${ECB_API}/${key}`);
  url.searchParams.set('startPeriod',from);
  url.searchParams.set('endPeriod',to);
  url.searchParams.set('format','csvdata');
  url.searchParams.set('detail','dataonly');
  const response=await fetch(url,{headers:{Accept:'text/csv'}});
  if(!response.ok)throw new Error(`BCE FX respondió ${response.status}.`);
  return parseEcbCsv(await response.text());
}

export async function syncFxRates(admin:any,currencies:string[],from:string,to:string){
  const observations=await fetchEcbObservations(currencies,from,to);
  const rows=toRateRows(observations);
  if(!rows.length)return {observations:0,rows:0,currencies:[] as string[]};
  const {error}=await admin.from('amazon_fx_rates').upsert(rows,{onConflict:'rate_date,currency_code'});
  if(error)throw error;
  return {
    observations:observations.length,
    rows:rows.length,
    currencies:[...new Set(rows.map(row=>row.currency_code))].sort(),
  };
}
