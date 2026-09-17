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
  complete:boolean;
  snapshotSource:string|null;
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
  const address2=text(address.address_line_2);
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
    // Límites MRW publicados por Sendcloud: name/address/address_2 50, city 30,
    // postal_code 8, telephone obligatorio y máximo 20, email máximo 50.
    if(name.length>50)issues.push(issue('name_too_long','name','Cliente',`Nombre: ${name.length}/50 caracteres. Reduce el nombre para MRW.`));
    if(street.length>50)issues.push(issue('address_too_long','address','Dirección',`Dirección: ${street.length}/50 caracteres. Acorta la primera línea para MRW.`));
    if(address2.length>50)issues.push(issue('address2_too_long','address2','Dirección 2',`Dirección 2: ${address2.length}/50 caracteres para MRW.`));
    if(postal.length>8)issues.push(issue('postal_too_long','postal_code','Código postal',`Código postal: ${postal.length}/8 caracteres para MRW.`));
    if(city.length>30)issues.push(issue('city_too_long','city','Ciudad',`Ciudad: ${city.length}/30 caracteres para MRW.`));
    if(!phone)issues.push(issue('phone_required','phone','Teléfono','MRW requiere teléfono del destinatario.'));
    else if(phone.length>20)issues.push(issue('phone_too_long','phone','Teléfono',`Teléfono: ${phone.length}/20 caracteres para MRW.`));
    if(email.length>50)issues.push(issue('email_too_long','email','Email',`Email: ${email.length}/50 caracteres para MRW.`));
  }

  return {carrierCode:carrier,issues,blocking:issues.some(item=>item.severity==='error')};
}

function isMrwOption(option?:ShippingOption|null){
  if(!option)return false;
  return `${option.carrierCode} ${option.carrierName} ${option.name} ${option.code}`.toLowerCase().includes('mrw');
}
function selectedServiceHour(option?:ShippingOption|null){
  if(!option)return '19';
  const raw=`${option.name} ${option.code}`.toLowerCase();
  const slot=raw.match(/timeslot[=:](10|12|14|19)(?::?00)?/)?.[1];if(slot)return slot;
  const friendly=raw.match(/(?:^|\D)(10|12|14|19)(?::?00)?(?:\D|$)/)?.[1];return friendly||'19';
}
function serviceMatchesHour(service:TransportTariffServiceDraft,hour:string){
  const value=`${service.canonicalServiceKey} ${service.serviceName} ${service.externalServiceCode}`.toLowerCase();
  return value.includes(`manana-${hour}`)||value.includes(`mañana ${hour}`)||value.includes(`manana ${hour}`)||value.includes(`${hour}:00`)||value.includes(`timeslot=${hour}`);
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

function estimateFromTariff(order:FulfillmentOrder,tariffs:TransportTariffDocument[],selectedOption?:ShippingOption|null):OrderShippingCostDisplay|null{
  if((selectedOption&&!isMrwOption(selectedOption))||defaultCarrierForOrder(order)!=='mrw'||order.weightKg==null)return null;
  const doc=matchingTariff(order,tariffs);if(!doc)return null;
  const hour=selectedServiceHour(selectedOption);
  const service=doc.services.find(item=>serviceMatchesHour(item,hour))||doc.services.find(item=>serviceMatchesHour(item,'19'));if(!service)return null;
  const country=text(order.shippingAddress.country_code).toUpperCase();
  const bands=service.bands.filter(band=>band.countryCode===country&&band.zoneCode.toLowerCase().includes('peninsular'));
  const weight=order.weightKg;
  const band=bands.find(item=>weight>=item.minWeightKg&&(item.maxWeightKg==null||weight<=item.maxWeightKg));
  if(!band)return null;
  let base=band.basePrice;if(base==null)return null;
  if(band.maxWeightKg==null&&band.extraKgPrice!=null&&weight>band.minWeightKg)base+=Math.ceil(weight-band.minWeightKg)*band.extraKgPrice;
  const missingFuel=!doc.fuelSurchargeIncluded&&doc.fuelSurchargePct==null;
  if(!doc.fuelSurchargeIncluded&&doc.fuelSurchargePct!=null)base*=1+doc.fuelSurchargePct/100;
  const vat=(doc as VatAwareTariff).vatRatePct??(doc.carrierCode.toLowerCase().includes('mrw')?21:null);
  let net:number|null=null,tax:number|null=null,gross:number|null=null;
  if(doc.pricesIncludeVat){gross=base;if(vat!=null){net=gross/(1+vat/100);tax=gross-net}}
  else{net=base;if(vat!=null){tax=net*vat/100;gross=net+tax}}
  const provisional=doc.status!=='active';
  const complete=!provisional&&!missingFuel&&gross!=null&&net!=null&&tax!=null;
  const parts=[provisional?`Tarifa ${doc.status==='draft'?'borrador':'revisada'}`:'Tarifa activa',service.serviceName];
  if(missingFuel)parts.push('sin combustible');if(gross==null)parts.push('IVA pendiente');
  return {gross,net,tax,currency:doc.currencyCode||'EUR',source:'tariff',estimated:true,detail:parts.join(' · '),complete,snapshotSource:complete?'mrw_tariff':'mrw_tariff_estimate'};
}

function quoteDisplay(option:ShippingOption|null|undefined):OrderShippingCostDisplay|null{
  if(!option||option.price==null)return null;
  const raw:any=option.raw||{};const quote=Array.isArray(raw.quotes)?raw.quotes[0]:raw.quotes||null;
  const tax=numeric(quote?.price?.tax?.value??quote?.tax?.value??quote?.tax_amount?.value);
  const net=numeric(quote?.price?.net?.value??quote?.price?.subtotal?.value??quote?.subtotal?.value);
  const total=numeric(quote?.price?.total?.value??quote?.total_price?.value??quote?.price?.value??option.price);
  const complete=tax!=null&&net!=null;
  if(complete)return {gross:total??net+tax,net,tax,currency:option.currency||'EUR',source:'quote',estimated:true,detail:'Cotización Sendcloud',complete:true,snapshotSource:'sendcloud_quote'};
  return {gross:total,net:null,tax:null,currency:option.currency||'EUR',source:'quote',estimated:true,detail:'Cotización · IVA no desglosado',complete:false,snapshotSource:'sendcloud_quote'};
}

export function orderShippingCostDisplay(order:FulfillmentOrder,tariffs:TransportTariffDocument[]=[],previewOption?:ShippingOption|null):OrderShippingCostDisplay{
  if(order.shippingCostAmount!=null){
    const oldDirectMrwZero=order.shippingCostAmount===0&&`${order.carrierCode||''} ${order.carrierName||''}`.toLowerCase().includes('mrw')&&order.shippingCostSource==='sendcloud_quote';
    if(!oldDirectMrwZero){
      const amount=order.shippingCostAmount,net=order.shippingCostNetAmount,tax=order.shippingCostTaxAmount;
      const gross=tax!=null&&tax>0&&net!=null?net+tax:amount;
      const estimated=Boolean(order.shippingCostSource?.includes('estimate'));
      const complete=net!=null&&tax!=null&&!estimated;
      const detail=estimated?'Tarifa aplicada · coste provisional':tax!=null&&tax>0?'Coste real':'Coste seleccionado · IVA no desglosado';
      return {gross,net,tax,currency:order.shippingCostCurrency||'EUR',source:'actual',estimated,detail,complete,snapshotSource:order.shippingCostSource};
    }
  }
  if(previewOption&&!isMrwOption(previewOption)){const quote=quoteDisplay(previewOption);if(quote)return quote}
  const tariff=estimateFromTariff(order,tariffs,previewOption);if(tariff)return tariff;
  const quote=quoteDisplay(previewOption);if(quote)return quote;
  return {gross:null,net:null,tax:null,currency:'EUR',source:'none',estimated:true,detail:'Pendiente de cotizar',complete:false,snapshotSource:null};
}
