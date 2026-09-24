import type { FulfillmentOrder, ShippingOption } from './orders';
import type { TransportTariffDocument } from './transportTariffs';

export type ValidationSeverity='error'|'warning';
export interface OrderValidationIssue{field:string;severity:ValidationSeverity;message:string}
export interface OrderValidationResult{blocking:boolean;issues:OrderValidationIssue[]}
export interface ShippingPricePreview{
  totalAmount:number|null;
  netAmount:number|null;
  taxAmount:number|null;
  currency:string;
  carrierName:string;
  serviceName:string;
  source:'tariff_estimate'|'sendcloud_quote'|'recorded';
  note?:string|null;
}

const clean=(value:unknown)=>String(value??'').trim();
function addLengthIssue(issues:OrderValidationIssue[],field:string,label:string,value:unknown,max:number,required=false){
  const text=clean(value);
  if(required&&!text){issues.push({field,severity:'error',message:`${label}: obligatorio.`});return}
  if(text.length>max)issues.push({field,severity:'error',message:`${label}: ${text.length}/${max} caracteres.`});
}
function normalizedPhoneDigits(value:unknown){return clean(value).replace(/[^0-9]+/g,'')}
function addPhoneIssue(issues:OrderValidationIssue[],value:unknown,countryCode:string,required=false,maxChars=20){
  const raw=clean(value);
  if(required&&!raw){issues.push({field:'phone',severity:'error',message:'Teléfono: obligatorio para este transportista.'});return}
  if(!raw)return;
  if(raw.length>maxChars){issues.push({field:'phone',severity:'error',message:`Teléfono: ${raw.length}/${maxChars} caracteres.`});return}
  const digits=normalizedPhoneDigits(raw);
  if(countryCode==='ES'){
    const national=digits.startsWith('0034')?digits.slice(4):(digits.startsWith('34')&&digits.length===11?digits.slice(2):digits);
    if(national.length!==9){
      issues.push({field:'phone',severity:'error',message:`Teléfono: para España debe tener 9 dígitos, o 34 + 9 dígitos. Ahora tiene ${digits.length} dígitos.`});
    }
    return;
  }
  if(digits.length<7||digits.length>15){
    issues.push({field:'phone',severity:'error',message:`Teléfono: debe contener entre 7 y 15 dígitos internacionales. Ahora tiene ${digits.length}.`});
  }
}
function addEmailIssue(issues:OrderValidationIssue[],value:unknown,required=false,max=254){
  const email=clean(value);
  if(required&&!email){issues.push({field:'email',severity:'error',message:'Email: obligatorio para este transportista.'});return}
  if(!email)return;
  if(email.length>max){issues.push({field:'email',severity:'error',message:`Email: ${email.length}/${max} caracteres.`});return}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))issues.push({field:'email',severity:'error',message:'Email: formato no válido.'});
}

export function validateOrderForCarrier(order:FulfillmentOrder,carrierCode=''):OrderValidationResult{
  const address=order.shippingAddress||{},issues:OrderValidationIssue[]=[];
  const carrierHint=clean(carrierCode||order.carrierCode||order.carrierName||order.shippingOptionCode||order.shippingServiceName).toLowerCase();
  const isMrw=carrierHint.includes('mrw');
  const country=clean(address.country_code).toUpperCase();
  const name=order.customerName||address.name;
  addLengthIssue(issues,'name','Nombre',name,isMrw?50:80,true);
  addLengthIssue(issues,'address_line_1','Dirección',address.address_line_1,isMrw?50:80,true);
  addLengthIssue(issues,'city','Ciudad',address.city,isMrw?30:80,true);
  addLengthIssue(issues,'postal_code','Código postal',address.postal_code,isMrw?8:30,true);
  addLengthIssue(issues,'country_code','País',country,2,true);
  if(country&&country.length!==2)issues.push({field:'country_code',severity:'error',message:'País: debe ser un código ISO de 2 letras.'});
  const postal=clean(address.postal_code).replace(/\s+/g,'');
  if(country==='ES'&&postal&&!/^\d{5}$/.test(postal))issues.push({field:'postal_code',severity:'error',message:'Código postal: en España debe tener 5 dígitos.'});
  addPhoneIssue(issues,order.customerPhone||address.phone_number,country,isMrw,isMrw?20:30);
  addEmailIssue(issues,order.customerEmail||address.email,false,isMrw?50:254);
  if(isMrw){
    addLengthIssue(issues,'address_line_2','Dirección 2',address.address_line_2,50,false);
    addLengthIssue(issues,'house_number','Número',address.house_number,20,false);
  }
  if(order.weightKg==null||!Number.isFinite(order.weightKg)||order.weightKg<=0)issues.push({field:'weight',severity:'error',message:'Peso: debe ser mayor que 0 kg.'});
  return {blocking:issues.some(issue=>issue.severity==='error'),issues};
}

function inDateRange(document:TransportTariffDocument,order:FulfillmentOrder){
  const raw=(order.orderCreatedAt||new Date().toISOString()).slice(0,10);
  return (!document.effectiveFrom||raw>=document.effectiveFrom)&&(!document.effectiveTo||raw<=document.effectiveTo);
}

export function calculateDefaultShippingPreview(order:FulfillmentOrder,tariffs:TransportTariffDocument[],carrierCode='',vatRate=21):ShippingPricePreview|null{
  if(!clean(carrierCode).toLowerCase().includes('mrw')||order.weightKg==null)return null;
  const country=clean(order.shippingAddress?.country_code).toUpperCase();
  if(!['ES','PT'].includes(country))return null;
  const document=tariffs.filter(item=>(item.status==='active'||item.status==='superseded')&&item.carrierCode==='mrw'&&inDateRange(item,order)).sort((a,b)=>(b.effectiveFrom||'').localeCompare(a.effectiveFrom||''))[0];
  if(!document)return null;
  const orderDate=(order.orderCreatedAt||new Date().toISOString()).slice(0,10);
  const revision=(document.revisions||[]).filter(item=>item.effectiveFrom<=orderDate).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const config=revision?.snapshot||document;
  const service=config.services.find(item=>item.canonicalServiceKey==='manana-19h'||/19\s*h/i.test(item.serviceName));
  if(!service)return null;
  const zoneCode='peninsular';
  const candidates=service.bands.filter(band=>band.countryCode===country&&band.zoneCode===zoneCode).sort((a,b)=>a.minWeightKg-b.minWeightKg);
  const weight=order.weightKg;
  let band=candidates.find(item=>weight>item.minWeightKg&&(item.maxWeightKg==null||weight<=item.maxWeightKg));
  if(!band)band=candidates.find(item=>weight===0&&item.minWeightKg===0);
  if(!band||band.basePrice==null)return null;
  let base=band.basePrice;
  if(band.maxWeightKg==null&&band.extraKgPrice!=null&&weight>band.minWeightKg){
    base+=Math.ceil(weight-band.minWeightKg)*band.extraKgPrice;
  }
  const fuelPct=config.fuelSurchargeIncluded?0:(config.fuelSurchargePct??0);
  const priced=base*(1+fuelPct/100);
  let netAmount:number,totalAmount:number,taxAmount:number;
  if(config.pricesIncludeVat){
    totalAmount=priced;netAmount=priced/(1+vatRate/100);taxAmount=totalAmount-netAmount;
  }else{
    netAmount=priced;taxAmount=netAmount*(vatRate/100);totalAmount=netAmount+taxAmount;
  }
  const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
  return {
    totalAmount:round(totalAmount),netAmount:round(netAmount),taxAmount:round(taxAmount),currency:config.currencyCode||'EUR',
    carrierName:'MRW',serviceName:service.serviceName,source:'tariff_estimate',
    note:config.fuelSurchargeIncluded||config.fuelSurchargePct!=null?null:'Combustible pendiente de configurar',
  };
}

export function previewFromShippingOption(option:ShippingOption|null):ShippingPricePreview|null{
  if(!option||option.price==null)return null;
  return {totalAmount:option.price,netAmount:null,taxAmount:null,currency:option.currency||'EUR',carrierName:option.carrierName||option.carrierCode,serviceName:option.name,source:'sendcloud_quote',note:'Cotización Sendcloud'};
}

export function shippingPriceForOrder(order:FulfillmentOrder,preview:ShippingPricePreview|null|undefined):ShippingPricePreview|null{
  if(order.shippingCostSource==='tariff_estimate'&&preview)return preview;
  if(order.shippingCostAmount!=null){
    return {
      totalAmount:order.shippingCostAmount,
      netAmount:order.shippingCostNetAmount,
      taxAmount:order.shippingCostTaxAmount,
      currency:order.shippingCostCurrency||'EUR',
      carrierName:order.carrierName||'Transportista',
      serviceName:order.shippingServiceName||order.shippingOptionCode||'Servicio seleccionado',
      source:'recorded',
      note:null,
    };
  }
  return preview||null;
}
