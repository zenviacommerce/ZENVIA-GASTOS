import type { FulfillmentOrder, ShippingOption } from './orders';
import type { TransportTariffDocument, TransportTariffServiceDraft } from './transportTariffs';

export type OrderValidationSeverity='error'|'warning';
export interface OrderValidationIssue{
  code:string;
  field:string;
  label:string;
  message:string;
  severity:OrderValidationSeverity;
}
export interface OrderValidationResult{
  carrierCode:string;
  issues:OrderValidationIssue[];
  blocking:boolean;
}
export interface OrderShippingCostDisplay{
  gross:number|null;
  net:number|null;
  tax:number|null;
  currency:string;
  source:'actual'|'tariff'|'quote'|'none';
  estimated:boolean;
  detail:string;
}
type VatAwareTariff=TransportTariffDocument&{vatRatePct?:number|null};

const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const numeric=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)?n:null};

export function isBalearicFulfillmentOrder(order:Pick<FulfillmentOrder,'shippingAddress'>){
  const country=text(order.shippingAddress?.country_code).toUpperCase();
  const postal=text(order.shippingAddress?.postal_code).replace(/\s+/g,'');
  return country==='ES'&&/^07\d{3}$/.test(postal);
}

export function defaultCarrierForOrder(order:Pick<FulfillmentOrder,'shippingAddress'>){
  return isBalearicFulfillmentOrder(order)?'correos':'mrw';
}

function issue(code:string,field:string,label:string,message:string,severity:OrderValidationSeverity='error'):OrderValidationIssue{
  return {code,field,label,message,severity};
}

export function validateOrderForCarrier(order:FulfillmentOrder,carrierCode=defaultCarrierForOrder(order)):OrderValidationResult{
  const carrier=carrierCode.toLowerCase();
  const address=order.shippingAddress||{};
  const name=text(order.customerName)||text(address.name);
  const street=text(address.address_line_1);
  const house=text(address.house_number);
  const postal=text(address.postal_code);
  const city=text(address.city);
  const country=text(address.country_code).toUpperCase();
  const phone=text(order.customerPhone)||text(address.phone_number);
  const email=text(order.customerEmail)||text(address.email);
  const issues:OrderValidationIssue[]=[];

  if(!name)issues.push(issue('name_required','name','Cliente','Falta el nombre del destinatario.'));
  if(!street)issues.push(issue('address_required','address','Dirección','Falta la dirección de entrega.'));
  if(!postal)issues.push(issue('postal_required','postal_code','Código postal','Falta el código postal.'));
  if(!city)issues.push(issue('city_required','city','Ciudad','Falta la ciudad.'));
  if(country.length!==2)issues.push(issue('country_required','country_code','País','El país debe tener un código ISO de 2 letras.'));
  if(order.weightKg==null||order.weightKg<=0)issues.push(issue('weight_required','weight','Peso','El peso debe ser mayor que 0.'));

  if(carrier.includes('mrw')){
    // Límites operativos MRW publicados por Sendcloud.
    if(name.length>50)issues.push(issue('name_too_long','name','Cliente',`Nombre: ${name.length}/50 caracteres. Reduce el nombre para MRW.`));
    if(street.length>50)issues.push(issue('address_too_long','address','Dirección',`Dirección: ${street.length}/50 caracteres. Acorta la primera línea para MRW.`));
    if(house.length>10)issues.push(issue('house_too_long','house_number','Número',`Número: ${house.length}/10 caracteres para MRW.`));
    if(postal.length>8)issues.push(issue('postal_too_long','postal_code','Código postal',`Código postal: ${postal.length}/8 caracteres para MRW.`));
    if(city.length>30)issues.push(issue('city_too_long','city','Ciudad',`Ciudad: ${city.length}/30 caracteres para MRW.`));
    if(!phone)issues.push(issue('phone_required','phone','Teléfono','MRW requiere teléfono del destinatario.'));
    else if(phone.length>20)issues.push(issue('phone_too_long','phone','Teléfono',`Teléfono: ${phone.length}/20 caracteres para MRW.`));
    if(email.length>50)issues.push(issue('email_too_long','email','Email',`Email: ${email.length}/50 caracteres para MRW.`));
  }

  return {carrierCode:carrier,issues,blocking:issues.some(item=>item.severity==='error')};
}

function serviceIsMrw19(service:TransportTariffServiceDraft){
  const value=`${service.canonicalServiceKey} ${service.serviceName} ${service.externalServiceCode}`.toLowerCase();
  return value.includes('manana-19')||value.includes('mañana 19')||value.includes('manana 19')||value.includes('19:00')||value.includes('timeslot=19');
}

function tariffPriority(status:TransportTariffDocument['status']){
  if(status==='active')return 3;if(status==='reviewed')return 2;if(status==='draft')return 1;return 0;
}

function matchingTariff(order:FulfillmentOrder,tariffs:TransportTariffDocument[]){
  const orderDate=(order.orderCreatedAt||new Date().toISOString()).slice(0,10);
  return tariffs
    .filter(doc=>doc.carrierCode.toLowerCase().includes('mrw')&&doc.status!=='superseded')
    .filter(doc=>(!doc.effectiveFrom||doc.effectiveFrom<=orderDate)&&(!doc.effectiveTo||doc.effectiveTo>=orderDate))
    .sort((a,b)=>tariffPriority(b.status)-tariffPriority(a.status)||b.createdAt.localeCompare(a.createdAt))[0]||null;
}

function estimateFromTariff(order:FulfillmentOrder,tariffs:TransportTariffDocument[]):OrderShippingCostDisplay|null{
  if(defaultCarrierForOrder(order)!=='mrw'||order.weightKg==null)return null;
  const doc=matchingTariff(order,tariffs);if(!doc)return null;
  const service=doc.services.find(serviceIsMrw19);if(!service)return null;
  const country=text(order.shippingAddress.country_code).toUpperCase();
  const bands=service.bands.filter(band=>band.countryCode===country&&band.zoneCode.toLowerCase().includes('peninsular'));
  const weight=order.weightKg;
  const band=bands.find(item=>weight>=item.minWeightKg&&(item.maxWeightKg==null||weight<=item.maxWeightKg));
  if(!band)return null;
  let base=band.basePrice;
  if(base==null)return null;
  if(band.maxWeightKg==null&&band.extraKgPrice!=null&&weight>band.minWeightKg){base+=Math.ceil(weight-band.minWeightKg)*band.extraKgPrice}
  if(!doc.fuelSurchargeIncluded&&doc.fuelSurchargePct!=null)base*=1+doc.fuelSurchargePct/100;
  // MRW factura este contrato con IVA 21 %. La columna existe en BBDD para poder parametrizarlo;
  // mientras el mapper antiguo no la expone, 21 % mantiene compatible la tarifa actual importada.
  const vat=(doc as VatAwareTariff).vatRatePct??(doc.carrierCode.toLowerCase().includes('mrw')?21:null);
  let net:number|null=null,tax:number|null=null,gross:number|null=null;
  if(doc.pricesIncludeVat){
    gross=base;
    if(vat!=null){net=gross/(1+vat/100);tax=gross-net}
  }else{
    net=base;
    if(vat!=null){tax=net*vat/100;gross=net+tax}
  }
  const provisional=doc.status!=='active';
  const missingFuel=!doc.fuelSurchargeIncluded&&doc.fuelSurchargePct==null;
  const parts=[provisional?`Tarifa ${doc.status==='draft'?'borrador':'revisada'}`:'Tarifa activa'];
  if(missingFuel)parts.push('sin combustible');
  if(gross==null)parts.push('IVA pendiente');
  return {gross,net,tax,currency:doc.currencyCode||'EUR',source:'tariff',estimated:true,detail:parts.join(' · ')};
}

function quoteDisplay(option:ShippingOption|null|undefined):OrderShippingCostDisplay|null{
  if(!option||option.price==null)return null;
  const raw:any=option.raw||{};
  const quote=Array.isArray(raw.quotes)?raw.quotes[0]:raw.quotes||null;
  const tax=numeric(quote?.price?.tax?.value??quote?.tax?.value??quote?.tax_amount?.value);
  const net=numeric(quote?.price?.net?.value??quote?.price?.subtotal?.value??quote?.subtotal?.value);
  const total=numeric(quote?.price?.total?.value??quote?.total_price?.value??quote?.price?.value??option.price);
  if(tax!=null&&net!=null)return {gross:total??net+tax,net,tax,currency:option.currency||'EUR',source:'quote',estimated:true,detail:'Cotización Sendcloud'};
  return {gross:total,net:null,tax:null,currency:option.currency||'EUR',source:'quote',estimated:true,detail:'Cotización · IVA no desglosado'};
}

export function orderShippingCostDisplay(order:FulfillmentOrder,tariffs:TransportTariffDocument[]=[],previewOption?:ShippingOption|null):OrderShippingCostDisplay{
  if(order.shippingCostAmount!=null){
    const amount=order.shippingCostAmount;
    const net=order.shippingCostNetAmount;
    const tax=order.shippingCostTaxAmount;
    const gross=tax!=null&&tax>0&&net!=null?net+tax:amount;
    return {gross,net,tax,currency:order.shippingCostCurrency||'EUR',source:'actual',estimated:false,detail:tax!=null&&tax>0?'Coste real':'Coste seleccionado · IVA no desglosado'};
  }
  const tariff=estimateFromTariff(order,tariffs);if(tariff)return tariff;
  const quote=quoteDisplay(previewOption);if(quote)return quote;
  return {gross:null,net:null,tax:null,currency:'EUR',source:'none',estimated:true,detail:'Pendiente de cotizar'};
}
