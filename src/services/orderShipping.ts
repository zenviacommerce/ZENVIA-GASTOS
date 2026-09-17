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
const isBalearic=(order:FulfillmentOrder)=>clean(order.shippingAddress?.country_code).toUpperCase()==='ES'&&/^07\d{3}$/.test(clean(order.shippingAddress?.postal_code).replace(/\s+/g,''));

export function defaultCarrierCode(order:FulfillmentOrder){return isBalearic(order)?'correos':'mrw'}

function addLengthIssue(issues:OrderValidationIssue[],field:string,label:string,value:unknown,max:number,required=false){
  const text=clean(value);
  if(required&&!text){issues.push({field,severity:'error',message:`${label}: obligatorio.`});return}
  if(text.length>max)issues.push({field,severity:'error',message:`${label}: ${text.length}/${max} caracteres.`});
}

export function validateOrderForCarrier(order:FulfillmentOrder,carrierCode=defaultCarrierCode(order)):OrderValidationResult{
  const address=order.shippingAddress||{},issues:OrderValidationIssue[]=[];
  const name=order.customerName||address.name;
  addLengthIssue(issues,'name','Nombre',name,carrierCode==='mrw'?50:80,true);
  addLengthIssue(issues,'address_line_1','Dirección',address.address_line_1,carrierCode==='mrw'?50:80,true);
  addLengthIssue(issues,'city','Ciudad',address.city,carrierCode==='mrw'?30:80,true);
  addLengthIssue(issues,'postal_code','Código postal',address.postal_code,carrierCode==='mrw'?8:30,true);
  addLengthIssue(issues,'country_code','País',address.country_code,2,true);
  if(carrierCode==='mrw'){
    addLengthIssue(issues,'phone','Teléfono',order.customerPhone||address.phone_number,20,true);
    addLengthIssue(issues,'email','Email',order.customerEmail||address.email,50,true);
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

export function calculateDefaultShippingPreview(order:FulfillmentOrder,tariffs:TransportTariffDocument[],vatRate=21):ShippingPricePreview|null{
  if(defaultCarrierCode(order)!=='mrw'||order.weightKg==null)return null;
  const country=clean(order.shippingAddress?.country_code).toUpperCase();
  if(!['ES','PT'].includes(country))return null;
  const document=tariffs.filter(item=>(item.status==='active'||item.status==='superseded')&&item.carrierCode==='mrw'&&inDateRange(item,order)).sort((a,b)=>(b.effectiveFrom||'').localeCompare(a.effectiveFrom||''))[0];
  if(!document)return null;
  const service=document.services.find(item=>item.canonicalServiceKey==='manana-19h'||/19\s*h/i.test(item.serviceName));
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
  const orderDate=(order.orderCreatedAt||new Date().toISOString()).slice(0,10);
  const fuelPeriod=(document.fuelPeriods||[]).filter(item=>orderDate>=item.effectiveFrom&&(!item.effectiveTo||orderDate<=item.effectiveTo)).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const fuelPct=document.fuelSurchargeIncluded?0:(fuelPeriod?.fuelSurchargePct??document.fuelSurchargePct??0);
  const priced=base*(1+fuelPct/100);
  let netAmount:number,totalAmount:number,taxAmount:number;
  if(document.pricesIncludeVat){
    totalAmount=priced;netAmount=priced/(1+vatRate/100);taxAmount=totalAmount-netAmount;
  }else{
    netAmount=priced;taxAmount=netAmount*(vatRate/100);totalAmount=netAmount+taxAmount;
  }
  const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
  return {
    totalAmount:round(totalAmount),netAmount:round(netAmount),taxAmount:round(taxAmount),currency:document.currencyCode||'EUR',
    carrierName:'MRW',serviceName:service.serviceName,source:'tariff_estimate',
    note:document.fuelSurchargeIncluded||fuelPeriod||document.fuelSurchargePct!=null?null:'Combustible pendiente de configurar',
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
