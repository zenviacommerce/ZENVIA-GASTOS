import { useCallback, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertCircle, Calculator, CheckCircle2, ChevronRight, Download, Euro,
  ExternalLink, ImageOff, LoaderCircle, MapPin, PackageCheck, Percent, Pencil, Plus, Printer, RefreshCw,
  Search, Settings2, ShoppingBag, Store, Trash2, Truck, X,
} from 'lucide-react';
import { OrderEditModal } from '../components/OrderEditModal';
import { SelectField } from '../components/forms/SelectField';
import { SearchableSelect } from '../components/forms/SearchableSelect';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { PeriodFilterPanel } from '../components/PeriodFilterPanel';
import { defaultDateFilter, periodLabel } from '../services/filters';
import {
  createManualOrder, createOrderLabel, fetchOrderLabel,
  getSendcloudStatus, getShippingOptions, labelBlob, listFulfillmentOrders, listLocalPrinters,
  markHistorySyncDone, openLabelForPrint, printLabelWithClient,
  shouldRunHistorySync, syncSendcloudOrders, updateFulfillmentOrder,
  type FulfillmentOrder, type LocalPrinter, type ManualOrderItem, type OrderChannel, type OrderUpdateInput,
  type SendcloudStatus, type ShippingOption,
} from '../services/orders';
import { bulkLabelZipFilename, labelPdfFilename, uniqueLabelPdfFilename } from '../services/orderLabelFiles';
import { selectShippingOptionByRules } from '../services/shippingRuleCore';
import { defaultShippingRules, loadShippingRules, type ShippingRule } from '../services/shippingRules';
import { prepareLabelPdf } from '../services/labelPdf';
import { useSettings } from '../context/SettingsContext';
import { loadAmazonProductImages } from '../services/amazon';
import { listTransportTariffs, type TransportTariffDocument } from '../services/transportTariffs';
import {
  calculateDefaultShippingPreview, defaultCarrierCode, previewFromShippingOption, shippingPriceForOrder, validateOrderForCarrier,
  type OrderValidationIssue, type ShippingPricePreview,
} from '../services/orderShipping';
import { errorMessage, showError, showSuccess } from '../services/toast';

const money=(value:number|null,currency='EUR')=>value==null?'—':new Intl.NumberFormat('es-ES',{style:'currency',currency:currency||'EUR'}).format(value);
const dateLabel=(value?:string|null)=>value?new Date(value).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'}):'—';
const dayLabel=(value?:string|null)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('es-ES'):'—';
const regionNames=typeof Intl!=='undefined'&&'DisplayNames' in Intl?new Intl.DisplayNames(['es'],{type:'region'}):null;
const countryName=(code:string)=>regionNames?.of(code)||code;
const text=(value:unknown)=>typeof value==='string'?value:'';
const iso=(value:Date)=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;

function downloadBlob(blob:Blob,fileName:string){
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName;document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function downloadLabel(blob:Blob,fileName:string){
  const clean=(fileName||'etiqueta.pdf').replace(/[^a-z0-9._-]+/gi,'_');
  downloadBlob(blob,clean.toLowerCase().endsWith('.pdf')?clean:`${clean}.pdf`);
}

type OrderFilter='pending'|'labelled'|'shipped'|'cancelled'|'all';
type TrackingFilter='all'|'none'|'ready'|'transit'|'route'|'pickup'|'delivered'|'issue'|'cancelled';

function timestampDateKey(value?:string|null){
  if(!value)return ''; const date=new Date(value);
  return Number.isNaN(date.getTime())?value.slice(0,10):iso(date);
}
function inPeriod(key:string,from:string,to:string){return Boolean(key)&&(!from||key>=from)&&(!to||key<=to);}
function orderDateKey(order:FulfillmentOrder){return timestampDateKey(order.orderCreatedAt);}
function labelTimestamp(order:FulfillmentOrder){return order.labelCreatedAt||order.fulfilledAt||order.trackingUpdatedAt||null;}
function labelDateKey(order:FulfillmentOrder){return timestampDateKey(labelTimestamp(order));}
function shippedDateKey(order:FulfillmentOrder){return timestampDateKey(order.fulfilledAt||order.trackingUpdatedAt||order.labelCreatedAt||order.orderUpdatedAt||order.orderCreatedAt);}
function channelLabel(order:FulfillmentOrder){
  if(order.sourceChannel==='amazon')return 'Amazon'; if(order.sourceChannel==='shopify')return 'Shopify';
  const source=`${order.integrationName||''} ${order.integrationType||''}`.toLowerCase();
  return source.includes('api')||source.includes('zenvia')?'Manual':'Otro';
}
function addressLine(address:Record<string,unknown>){
  const first=[text(address.address_line_1),text(address.house_number)].filter(Boolean).join(' ');
  const second=[text(address.postal_code),text(address.city)].filter(Boolean).join(' ');
  return [first,text(address.address_line_2),second,text(address.country_code)].filter(Boolean).join(' · ')||'Dirección no disponible';
}
function itemLabel(item:Record<string,unknown>){return text(item.name)||text(item.description)||text(item.sku)||'Producto';}
function itemQty(item:Record<string,unknown>){return Number(item.quantity||1)||1;}
function itemAsin(item:Record<string,unknown>){return text(item.product_id)||text(item.asin);}
function itemImageUrl(item:Record<string,unknown>,fallbackImages:Record<string,string>){
  const direct=text(item.image_url).trim();
  if(direct)return direct;
  const asin=itemAsin(item);
  return asin?fallbackImages[asin]||'':'';
}
function productsText(order:FulfillmentOrder){return order.items.map(item=>`${itemLabel(item)} ${text(item.sku)} x${itemQty(item)}`).join(' · ');}
function weightLabel(order:FulfillmentOrder){return order.weightKg==null?'—':`${order.weightKg.toLocaleString('es-ES',{minimumFractionDigits:0,maximumFractionDigits:3})} kg`;}
function orderStatusCode(order:FulfillmentOrder){return String(order.sourceStatus||'').trim().toLowerCase();}
function isCancelledOrder(order:FulfillmentOrder){return orderStatusCode(order).includes('cancel');}
function isReadyForDispatch(order:FulfillmentOrder){
  if(!order.sendcloudParcelId)return false;
  const raw=`${order.trackingStatusCode||''} ${order.trackingStatusMessage||''}`.toLowerCase().replace(/[_-]+/g,' ');
  return raw.includes('ready to send')||raw.includes('ready for shipment')||raw.includes('announced')||raw.includes('being announced')||raw.includes('no label');
}
function isProcessedOrder(order:FulfillmentOrder){
  if(isReadyForDispatch(order))return false;
  const status=orderStatusCode(order);return status==='fulfilled'||status==='shipped'||status==='delivered';
}
function isLabelledOrder(order:FulfillmentOrder){return Boolean(order.sendcloudParcelId)&&!isCancelledOrder(order)&&!isProcessedOrder(order);}
function isPendingOrder(order:FulfillmentOrder){return !order.sendcloudParcelId&&!isCancelledOrder(order)&&!isProcessedOrder(order);}
function canPrepareOrder(order:FulfillmentOrder){return isPendingOrder(order);}
function orderState(order:FulfillmentOrder){
  if(isCancelledOrder(order))return {label:'Cancelado',className:'cancelled'};
  if(isLabelledOrder(order))return {label:'Etiquetado',className:'ready'};
  if(isProcessedOrder(order))return {label:'Enviado',className:'closed'};
  return {label:'Pendiente',className:'pending'};
}
function trackingState(order:FulfillmentOrder){
  if(!order.sendcloudParcelId)return {label:'Sin etiqueta',className:'none'};
  const raw=`${order.trackingStatusCode||''} ${order.trackingStatusMessage||''}`.toLowerCase().replace(/[_-]+/g,' ');
  if(raw.includes('delivered')||raw.includes('shipment collected by customer'))return {label:'Entregado',className:'delivered'};
  if(raw.includes('driver en route')||raw.includes('out for delivery'))return {label:'En reparto',className:'route'};
  if(raw.includes('awaiting customer pickup'))return {label:'En punto de recogida',className:'pickup'};
  if(raw.includes('sorting centre')||raw.includes('sorting center')||raw.includes('being sorted')||raw.includes(' sorted'))return {label:'En centro de distribución',className:'transit'};
  if(raw.includes('parcel en route')||raw.includes('en route to sorting')||raw.includes('picked up by driver')||raw.includes('shipment picked up')||raw.includes('in transit'))return {label:'En tránsito',className:'transit'};
  if(raw.includes('address invalid')||raw.includes('attempt failed')||raw.includes('announcement failed')||raw.includes('unable to deliver')||raw.includes('exception')||raw.includes('error collecting')||raw.includes('refused')||raw.includes('returned to sender')||raw.includes('delivery delayed'))return {label:'Incidencia',className:'issue'};
  if(raw.includes('cancel'))return {label:'Cancelado',className:'cancelled'};
  if(raw.includes('ready to send')||raw.includes('ready for shipment')||raw.includes('announced')||raw.includes('being announced')||raw.includes('no label'))return {label:'Preparado',className:'ready'};
  if(order.trackingStatusMessage)return {label:order.trackingStatusMessage,className:'transit'};
  return {label:'Pendiente de seguimiento',className:'none'};
}
function trackingFilterCode(order:FulfillmentOrder):Exclude<TrackingFilter,'all'>{
  const tracking=trackingState(order);
  if(tracking.className==='delivered')return 'delivered';
  if(tracking.className==='route')return 'route';
  if(tracking.className==='pickup')return 'pickup';
  if(tracking.className==='issue')return 'issue';
  if(tracking.className==='cancelled')return 'cancelled';
  if(tracking.className==='ready')return 'ready';
  if(tracking.className==='transit')return 'transit';
  return 'none';
}
function matchesOrderContext(order:FulfillmentOrder,query:string,channel:'all'|OrderChannel,trackingFilter:TrackingFilter,countryFilter:string,carrierFilter:string){
  if(channel!=='all'&&order.sourceChannel!==channel)return false;
  if(trackingFilter!=='all'&&trackingFilterCode(order)!==trackingFilter)return false;
  const country=text(order.shippingAddress.country_code).trim().toUpperCase()||'XX';
  if(countryFilter!=='all'&&country!==countryFilter)return false;
  const carrier=carrierLabel(order).trim().toLowerCase();
  if(carrierFilter!=='all'&&carrier!==carrierFilter)return false;
  const q=query.trim().toLowerCase();
  const haystack=[order.orderNumber||'',order.orderId||'',order.customerName||'',order.trackingNumber||'',order.trackingStatusMessage||'',carrierLabel(order),productsText(order),country].join(' ').toLowerCase();
  return !q||haystack.includes(q);
}
function carrierLabel(order:FulfillmentOrder){
  if(order.carrierName)return order.carrierName;
  const raw=(order.carrierCode||order.shippingOptionCode?.split(':')[0]||'').toLowerCase();
  if(raw.includes('correos'))return 'Correos'; if(raw.includes('mrw'))return 'MRW';
  return raw?raw.toUpperCase():'—';
}

const VAT_RATES:Record<string,number>={ES:21,PT:23,FR:20,DE:19,IT:22,NL:21,BE:21,AT:20,IE:23,PL:23,CZ:21,GR:24,HU:27,RO:21,FI:25.5,SE:25,DK:25,HR:25,SI:22,SK:23,LT:21,LV:21,EE:24,BG:20,CY:19,MT:18,LU:17,GB:20};
function taxParts(order:FulfillmentOrder){
  const gross=order.totalAmount||0,rate=VAT_RATES[text(order.shippingAddress.country_code).trim().toUpperCase()]||0;
  if(!rate)return {gross,net:gross,vat:0}; const net=gross/(1+rate/100); return {gross,net,vat:gross-net};
}
function preferredCarrier(option:ShippingOption){const h=`${option.carrierCode} ${option.carrierName} ${option.name} ${option.code}`.toLowerCase();if(h.includes('mrw'))return 'mrw';if(h.includes('correos'))return 'correos';return '';}

function OrderDrawer({order,shippingPrice,validationIssues,onClose,onPrepare,onEdit,onPrint,onDownload,busy}:{order:FulfillmentOrder;shippingPrice:ShippingPricePreview|null;validationIssues:OrderValidationIssue[];onClose:()=>void;onPrepare:()=>void;onEdit:()=>void;onPrint:()=>void;onDownload:()=>void;busy:boolean}){
  const labelled=Boolean(order.sendcloudParcelId),state=orderState(order),tracking=trackingState(order),canPrepare=canPrepareOrder(order);
  return <div className="ordersDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="ordersDrawer">
    <div className="ordersDrawerHead"><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span><h2>Pedido {order.orderNumber||order.orderId||order.sendcloudId}</h2><p>{dateLabel(order.orderCreatedAt)} · {order.integrationName||'Sendcloud'}</p></div><button className="iconBtn" onClick={onClose}><X size={18}/></button></div>
    <div className="ordersDrawerKpis"><div><span>Estado</span><strong>{state.label}</strong></div><div><span>Total</span><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></div><div><span>Peso</span><strong>{weightLabel(order)}</strong></div><div><span>Transportista</span><strong>{carrierLabel(order)}</strong></div><div><span>Envío</span><strong>{shippingPrice?money(shippingPrice.totalAmount,shippingPrice.currency):'—'}</strong></div></div>
    {validationIssues.length>0&&<section className="ordersDrawerSection"><div className="errorBox ordersValidationBox"><AlertCircle size={17}/><div><strong>Revisar antes de generar la etiqueta</strong>{validationIssues.map((issue,index)=><span key={`${issue.field}-${index}`}>{issue.message}</span>)}</div></div></section>}
    <section className="ordersDrawerSection"><h3>Entrega</h3><div className="ordersAddress"><MapPin size={17}/><div><strong>{order.customerName||text(order.shippingAddress.name)||'Cliente'}</strong><span>{addressLine(order.shippingAddress)}</span>{order.customerPhone&&<small>{order.customerPhone}</small>}{order.customerEmail&&<small>{order.customerEmail}</small>}</div></div></section>
    <section className="ordersDrawerSection"><div className="ordersSectionHead"><h3>Contenido</h3><span>{order.items.length} línea{order.items.length===1?'':'s'}</span></div>{order.items.length?<div className="ordersItems">{order.items.map((item,index)=><div key={`${itemLabel(item)}-${index}`}><div><strong>{itemLabel(item)}</strong><span>{text(item.sku)||text(item.product_id)||''}</span></div><b>x{itemQty(item)}</b></div>)}</div>:<div className="masterEmptyMini">Sin líneas de producto.</div>}</section>
    {shippingPrice&&<section className="ordersDrawerSection"><h3>Coste de envío</h3><div className="ordersShipmentInfo"><div><span>Total</span><strong>{money(shippingPrice.totalAmount,shippingPrice.currency)}</strong></div><div><span>Base</span><strong>{shippingPrice.netAmount==null?'—':money(shippingPrice.netAmount,shippingPrice.currency)}</strong></div><div><span>IVA</span><strong>{shippingPrice.taxAmount==null?'—':money(shippingPrice.taxAmount,shippingPrice.currency)}</strong></div><div><span>Origen</span><strong>{shippingPrice.source==='recorded'?'Coste seleccionado':shippingPrice.source==='tariff_estimate'?'Tarifa estimada':'Cotización Sendcloud'}</strong></div>{shippingPrice.note&&<div><span>Nota</span><strong>{shippingPrice.note}</strong></div>}</div></section>}
    {(labelled||isProcessedOrder(order))&&<section className="ordersDrawerSection"><h3>Expedición</h3><div className="ordersShipmentInfo"><div><span>Transportista</span><strong>{carrierLabel(order)}</strong></div><div><span>Servicio</span><strong>{order.shippingServiceName||order.shippingOptionCode||'—'}</strong></div><div><span>Fecha pedido</span><strong>{dateLabel(order.orderCreatedAt)}</strong></div><div><span>Fecha etiqueta</span><strong>{dateLabel(labelTimestamp(order))}</strong></div><div><span>Seguimiento</span><strong><span className={`ordersTracking ${tracking.className}`} aria-label={order.trackingStatusMessage||tracking.label}>{tracking.label}</span></strong></div>{order.trackingUpdatedAt&&<div><span>Última actualización</span><strong>{dateLabel(order.trackingUpdatedAt)}</strong></div>}<div><span>Tracking</span><strong>{order.trackingNumber||'—'}</strong></div>{order.trackingUrl&&<a href={order.trackingUrl} target="_blank" rel="noreferrer">Abrir seguimiento <ExternalLink size={14}/></a>}</div></section>}
    <div className="ordersDrawerActions">{labelled?<><button className="secondary" disabled={busy} onClick={onDownload}><Download size={16}/> Descargar</button><button className="primary" disabled={busy} onClick={onPrint}><Printer size={16}/> Imprimir</button></>:canPrepare?<><button className="secondary" disabled={busy} onClick={onEdit}><Pencil size={16}/> Editar pedido</button><button className="primary" disabled={busy} onClick={onPrepare}>{busy?<LoaderCircle className="spin" size={16}/>:<Truck size={16}/>} Preparar etiqueta</button></>:<div className={`ordersNoAction ${state.className}`}><AlertCircle size={16}/><span>{isCancelledOrder(order)?'Pedido cancelado. No se puede generar etiqueta.':'Este pedido ya está procesado.'}</span></div>}</div>
  </aside></div>;
}

function LabelModal({order,options,loading,onClose,onCreate}:{order:FulfillmentOrder;options:ShippingOption[];loading:boolean;onClose:()=>void;onCreate:(option:ShippingOption|null)=>void}){
  const preferred=options.filter(option=>preferredCarrier(option));
  const grouped={correos:preferred.filter(option=>preferredCarrier(option)==='correos'),mrw:preferred.filter(option=>preferredCarrier(option)==='mrw')};
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal ordersLabelModal">
    <div className="modalHead"><div><h3>Crear etiqueta · {order.orderNumber||order.orderId}</h3><p>Elige Correos o MRW. Los precios se consultan directamente a Sendcloud con el peso y destino del pedido.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="ordersLabelBody"><div className="ordersLabelContext"><div><span>Peso del paquete</span><strong>{weightLabel(order)}</strong></div><div><span>Destino</span><strong>{text(order.shippingAddress.postal_code)||'—'} · {text(order.shippingAddress.city)||text(order.shippingAddress.country_code)||'—'}</strong></div></div>{loading?<div className="ordersOptionsLoading"><LoaderCircle className="spin"/><span>Consultando servicios y precios…</span></div>:<><div className="ordersCarrierGrid">{(['correos','mrw'] as const).map(carrier=><section className="ordersCarrierCard" key={carrier}><div className="ordersCarrierHead"><Truck size={18}/><div><strong>{carrier==='correos'?'Correos':'MRW'}</strong><span>{carrier==='correos'?'Tarifas de Sendcloud':'Contrato propio conectado'}</span></div></div>{grouped[carrier].length?<div className="ordersOptionList">{grouped[carrier].map(option=><button key={`${option.code}-${option.contractId||''}`} onClick={()=>onCreate(option)}><div><strong>{option.name}</strong><small>{option.billedWeightKg?`Peso facturable ${option.billedWeightKg.toLocaleString('es-ES',{maximumFractionDigits:3})} kg · `:''}{option.code}</small></div><span className={option.price==null?'noPrice':''}>{option.price==null?'Precio no disponible':money(option.price,option.currency||'EUR')}</span></button>)}</div>:<div className="ordersNoOption">No hay servicios disponibles para este pedido.</div>}</section>)}</div><button className="secondary ordersRulesButton" onClick={()=>onCreate(null)}><Settings2 size={16}/><span><strong>Usar reglas de Sendcloud</strong><small>Respeta tus métodos y reglas configuradas.</small></span><ChevronRight size={17}/></button></>}</div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button></div>
  </section></div>;
}

function ManualOrderModal({status,saving,defaultCountryCode,fallbackWeightKg,onClose,onSave}:{status:SendcloudStatus;saving:boolean;defaultCountryCode:string;fallbackWeightKg:number;onClose:()=>void;onSave:(value:any)=>void}){
  const apiIntegrations=status.integrations.filter(item=>item.channel==='other');
  const suggested=apiIntegrations.find(item=>item.isApi)||apiIntegrations[0];
  const [integrationId,setIntegrationId]=useState(suggested?.id||0);
  const [orderNumber,setOrderNumber]=useState(`MAN-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(Date.now()).slice(-5)}`);
  const [customerName,setCustomerName]=useState(''); const [email,setEmail]=useState(''); const [phone,setPhone]=useState('');
  const [address,setAddress]=useState(''); const [houseNumber,setHouseNumber]=useState(''); const [postalCode,setPostalCode]=useState(''); const [city,setCity]=useState(''); const [countryCode,setCountryCode]=useState(defaultCountryCode||'ES');
  const [weightKg,setWeightKg]=useState(fallbackWeightKg||1); const [items,setItems]=useState<ManualOrderItem[]>([{name:'',sku:'',quantity:1,unitPrice:0}]);
  const updateItem=(index:number,key:keyof ManualOrderItem,value:string|number)=>setItems(prev=>prev.map((item,i)=>i===index?{...item,[key]:value}:item));
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal ordersManualModal">
    <div className="modalHead"><div><h3>Nuevo pedido manual</h3><p>Se creará también en Sendcloud para que puedas generar la etiqueta desde aquí.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="ordersManualBody">
      {!apiIntegrations.length&&<div className="errorBox"><AlertCircle size={16}/> No encuentro una integración API de Sendcloud. La integración de Amazon/Shopify no debe usarse para pedidos manuales.</div>}
      <div className="ordersManualGrid"><label><span>N.º pedido</span><input value={orderNumber} onChange={e=>setOrderNumber(e.target.value)}/></label><label><span>Integración Sendcloud</span><SearchableSelect value={integrationId?String(integrationId):''} options={apiIntegrations.map(item=>({value:String(item.id),label:`${item.shopName} · ${item.type||'API'}`,searchText:`${item.shopName} ${item.type||''}`}))} onChange={value=>setIntegrationId(Number(value)||0)} allowEmpty emptyLabel="Seleccionar…" searchPlaceholder="Buscar integración…" ariaLabel="Integración Sendcloud"/></label><label><span>Cliente *</span><input value={customerName} onChange={e=>setCustomerName(e.target.value)}/></label><label><span>Teléfono</span><input value={phone} onChange={e=>setPhone(e.target.value)}/></label><label className="wide"><span>Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="wide"><span>Dirección *</span><input value={address} onChange={e=>setAddress(e.target.value)}/></label><label><span>Número</span><input value={houseNumber} onChange={e=>setHouseNumber(e.target.value)}/></label><label><span>Código postal *</span><input value={postalCode} onChange={e=>setPostalCode(e.target.value)}/></label><label><span>Ciudad *</span><input value={city} onChange={e=>setCity(e.target.value)}/></label><label><span>País *</span><input maxLength={2} value={countryCode} onChange={e=>setCountryCode(e.target.value.toUpperCase())}/></label><label><span>Peso total (kg)</span><input type="number" min="0.01" step="0.01" value={weightKg} onChange={e=>setWeightKg(Number(e.target.value)||0)}/></label></div>
      <div className="ordersManualItems"><div className="ordersSectionHead"><h3>Productos</h3><button className="link" onClick={()=>setItems(prev=>[...prev,{name:'',sku:'',quantity:1,unitPrice:0}])}><Plus size={14}/> Añadir línea</button></div>{items.map((item,index)=><div className="ordersManualItem" key={index}><input placeholder="Producto" value={item.name} onChange={e=>updateItem(index,'name',e.target.value)}/><input placeholder="SKU" value={item.sku||''} onChange={e=>updateItem(index,'sku',e.target.value)}/><input type="number" min="1" placeholder="Uds" value={item.quantity} onChange={e=>updateItem(index,'quantity',Math.max(1,Number(e.target.value)||1))}/><input type="number" min="0" step="0.01" placeholder="€/ud" value={item.unitPrice} onChange={e=>updateItem(index,'unitPrice',Math.max(0,Number(e.target.value)||0))}/><button className="iconBtn dangerText" disabled={items.length===1} onClick={()=>setItems(prev=>prev.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>)}</div>
    </div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving||!apiIntegrations.length} onClick={()=>onSave({integrationId,orderNumber,customerName,email,phone,address,houseNumber,postalCode,city,countryCode,weightKg,items})}>{saving?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>} Crear pedido</button></div>
  </section></div>;
}

export function Orders(){
  const {settings,preferences,updatePreferences}=useSettings();
  const initialChannel=settings.orders.defaultChannel==='amazon'?'amazon':settings.orders.defaultChannel==='shopify'?'shopify':settings.orders.defaultChannel==='manual'||settings.orders.defaultChannel==='other'?'other':'all';
  const [orders,setOrders]=useState<FulfillmentOrder[]>([]),[status,setStatus]=useState<SendcloudStatus|null>(null);
  const [loading,setLoading]=useState(true),[syncing,setSyncing]=useState(false),[error,setError]=useState('');
  const [query,setQuery]=useState(''),[channel,setChannel]=useState<'all'|OrderChannel>(initialChannel),[state,setState]=useState<OrderFilter>('pending'),[trackingFilter,setTrackingFilter]=useState<TrackingFilter>('all'),[countryFilter,setCountryFilter]=useState('all'),[carrierFilter,setCarrierFilter]=useState('all');
  const [selected,setSelected]=useState<FulfillmentOrder|null>(null),[labelOrder,setLabelOrder]=useState<FulfillmentOrder|null>(null),[options,setOptions]=useState<ShippingOption[]>([]),[optionsLoading,setOptionsLoading]=useState(false),[busyOrder,setBusyOrder]=useState<string|null>(null);
  const [printers,setPrinters]=useState<LocalPrinter[]>([]),[printer,setPrinter]=useState(preferences.labelPrinterId||''),[printerChecking,setPrinterChecking]=useState(false);
  const [dateFilter,setDateFilter]=useState(defaultDateFilter);
  const [manualOpen,setManualOpen]=useState(false),[manualSaving,setManualSaving]=useState(false);
  const [editOrder,setEditOrder]=useState<FulfillmentOrder|null>(null),[editSaving,setEditSaving]=useState(false);
  const [bulkGenerating,setBulkGenerating]=useState(false),[bulkProgress,setBulkProgress]=useState('');
  const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
  const [tariffs,setTariffs]=useState<TransportTariffDocument[]>([]),[shippingPreviews,setShippingPreviews]=useState<Record<string,ShippingPricePreview>>({});
  const [editValidationIssues,setEditValidationIssues]=useState<OrderValidationIssue[]>([]);
  const [amazonImages,setAmazonImages]=useState<Record<string,string>>({});
  useEffect(()=>{setPrinter(preferences.labelPrinterId||'')},[preferences.labelPrinterId]);
  const [shippingRules,setShippingRules]=useState<ShippingRule[]>(()=>defaultShippingRules());

  const refresh=useCallback(async()=>{try{setOrders(await listFulfillmentOrders())}catch(e){setError(errorMessage(e,'No se pudieron cargar los pedidos.'))}},[]);
  const refreshStatus=useCallback(async()=>{try{setStatus(await getSendcloudStatus())}catch(e){setStatus({configured:false,integrations:[],message:errorMessage(e,'No se pudo comprobar Sendcloud.')})}},[]);
  const refreshTariffs=useCallback(async()=>{try{setTariffs(await listTransportTariffs())}catch{/* El precio real seleccionado seguirá disponible aunque no haya tarifa estimada. */}},[]);
  useEffect(()=>{(async()=>{setLoading(true);await Promise.all([refresh(),refreshStatus(),refreshTariffs()]);setLoading(false)})()},[refresh,refreshStatus,refreshTariffs]);
  useEffect(()=>{let active=true;loadShippingRules({ensureDefaults:false}).then(rows=>{if(active)setShippingRules(rows.length?rows:defaultShippingRules())}).catch(()=>{if(active)setShippingRules(defaultShippingRules())});return()=>{active=false}},[]);
  useEffect(()=>{
    const asins=Array.from(new Set(orders
      .filter(order=>order.sourceChannel==='amazon')
      .flatMap(order=>order.items)
      .filter(item=>!text(item.image_url).trim())
      .map(item=>itemAsin(item))
      .filter(Boolean)));
    if(!asins.length)return;
    let cancelled=false;
    void loadAmazonProductImages(asins).then(images=>{
      if(!cancelled)setAmazonImages(current=>({...current,...images}));
    }).catch(()=>{});
    return()=>{cancelled=true};
  },[orders]);

  const sync=useCallback(async(silent=false,history=false,automatic=false)=>{if(syncing)return;setSyncing(true);if(!silent)setError('');try{const result=await syncSendcloudOrders(history,settings.orders.retryTrackingConfirmation,automatic);setStatus({configured:true,integrations:result.integrations});await refresh();if(history)markHistorySyncDone();if(!silent)showSuccess(`${result.synced} pedidos actualizados desde Sendcloud.`)}catch(e){const message=errorMessage(e,'No se pudieron actualizar los pedidos.');if(!silent)showError(message)}finally{setSyncing(false)}},[refresh,syncing,settings.orders.retryTrackingConfirmation]);
  useEffect(()=>{if(!status?.configured||!settings.integrations.sendcloudEnabled)return;void sync(true,shouldRunHistorySync(),true);const timer=window.setInterval(()=>void sync(true,false,true),Math.max(30,settings.orders.refreshSeconds)*1000);return()=>window.clearInterval(timer)},[status?.configured,sync,settings.orders.refreshSeconds,settings.integrations.sendcloudEnabled]);

  const dateFrom=dateFilter.from,dateTo=dateFilter.to;
  const selectedPeriod=periodLabel(dateFilter);
  const orderPeriodOrders=useMemo(()=>orders.filter(order=>inPeriod(orderDateKey(order),dateFrom,dateTo)),[orders,dateFrom,dateTo]);
  const labelPeriodOrders=useMemo(()=>orders.filter(order=>isLabelledOrder(order)&&inPeriod(labelDateKey(order),dateFrom,dateTo)),[orders,dateFrom,dateTo]);
  const shippedPeriodOrders=useMemo(()=>orders.filter(order=>isProcessedOrder(order)&&inPeriod(shippedDateKey(order),dateFrom,dateTo)),[orders,dateFrom,dateTo]);
  const countryOptions=useMemo(()=>[...new Set(orders.map(order=>text(order.shippingAddress.country_code).trim().toUpperCase()||'XX'))].sort((a,b)=>countryName(a).localeCompare(countryName(b),'es')).map(code=>({value:code,label:code==='XX'?'País pendiente':`${countryName(code)} · ${code}`})),[orders]);
  const carrierOptions=useMemo(()=>[...new Set(orders.map(order=>carrierLabel(order)).filter(value=>value&&value!=='—'))].sort((a,b)=>a.localeCompare(b,'es')).map(value=>({value:value.toLowerCase(),label:value})),[orders]);
  const orderContextOrders=useMemo(()=>orderPeriodOrders.filter(order=>matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter)),[orderPeriodOrders,query,channel,trackingFilter,countryFilter,carrierFilter]);
  const labelContextOrders=useMemo(()=>labelPeriodOrders.filter(order=>matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter)),[labelPeriodOrders,query,channel,trackingFilter,countryFilter,carrierFilter]);
  const shippedContextOrders=useMemo(()=>shippedPeriodOrders.filter(order=>matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter)),[shippedPeriodOrders,query,channel,trackingFilter,countryFilter,carrierFilter]);
  const pendingOrders=useMemo(()=>orderContextOrders.filter(isPendingOrder),[orderContextOrders]);
  const tariffPreviews=useMemo(()=>{const map:Record<string,ShippingPricePreview>={};for(const order of orders){const preview=calculateDefaultShippingPreview(order,tariffs);if(preview)map[order.id]=preview}return map},[orders,tariffs]);
  const transportKpis=useMemo(()=>{
    let total=0,net=0,tax=0,valued=0,missing=0,mrw=0,correos=0,other=0;
    const shipments=orders.filter(order=>Boolean(order.sendcloudParcelId)&&inPeriod(timestampDateKey(order.shippingCostRecordedAt||order.fulfilledAt||order.labelCreatedAt||order.trackingUpdatedAt||order.orderCreatedAt),dateFrom,dateTo)&&matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter));
    for(const order of shipments){
      const shipping=shippingPriceForOrder(order,tariffPreviews[order.id]||shippingPreviews[order.id]);
      if(!shipping||shipping.totalAmount==null||!Number.isFinite(shipping.totalAmount)||shipping.currency.toUpperCase()!=='EUR'){missing+=1;continue}
      total+=shipping.totalAmount;net+=shipping.netAmount??shipping.totalAmount;tax+=shipping.taxAmount??0;valued+=1;
      const carrier=carrierLabel(order).toLowerCase();
      if(carrier.includes('mrw'))mrw+=shipping.totalAmount;else if(carrier.includes('correos'))correos+=shipping.totalAmount;else other+=shipping.totalAmount;
    }
    return {total,net,tax,valued,missing,mrw,correos,other,shipments:shipments.length};
  },[orders,dateFrom,dateTo,query,channel,trackingFilter,countryFilter,carrierFilter,tariffPreviews,shippingPreviews]);
  useEffect(()=>{let cancelled=false;const targets=orders.filter(order=>isPendingOrder(order)&&!order.shippingCostAmount);if(!targets.length)return;void(async()=>{const next:Record<string,ShippingPricePreview>={};const enabled=settings.shipping.enabledCarriers.map(value=>value.toLowerCase()).filter(Boolean);for(const order of targets.slice(0,30)){try{const result=await getShippingOptions(order.id);const allowed=enabled.length?result.options.filter(option=>enabled.some(value=>`${option.carrierCode||''} ${option.carrierName||''}`.toLowerCase().includes(value))):result.options;let option=selectShippingOptionByRules(order,allowed,shippingRules);if(!option&&settings.orders.defaultCarrier){const carrier=settings.orders.defaultCarrier.toLowerCase();option=allowed.find(item=>`${item.carrierCode||''} ${item.carrierName||''}`.toLowerCase().includes(carrier))||null}const preview=previewFromShippingOption(option);if(preview)next[order.id]=preview}catch{/* La cotización se mostrará cuando el usuario prepare la etiqueta. */}}if(!cancelled&&Object.keys(next).length)setShippingPreviews(current=>({...current,...next}))})();return()=>{cancelled=true}},[orders,shippingRules,settings.shipping.enabledCarriers,settings.orders.defaultCarrier]);
  const salesKpis=useMemo(()=>{const sales=orderContextOrders.filter(order=>!isCancelledOrder(order)&&order.totalAmount!=null&&(order.currency==null||order.currency==='EUR'));let gross=0,net=0,vat=0;for(const order of sales){const parts=taxParts(order);gross+=parts.gross;net+=parts.net;vat+=parts.vat}return {gross,net,vat,count:sales.length,average:sales.length?gross/sales.length:0}},[orderContextOrders]);
  const pending=pendingOrders.length,amazon=pendingOrders.filter(o=>o.sourceChannel==='amazon').length,shopify=pendingOrders.filter(o=>o.sourceChannel==='shopify').length,manual=pendingOrders.filter(o=>o.sourceChannel==='other').length,labelled=labelContextOrders.length,shipped=shippedContextOrders.length,cancelled=orderContextOrders.filter(isCancelledOrder).length;
  const filtered=useMemo(()=>{const base=state==='labelled'?labelContextOrders:state==='shipped'?shippedContextOrders:orderContextOrders;return base.filter(order=>{if(state==='pending'&&!isPendingOrder(order))return false;if(state==='labelled'&&!isLabelledOrder(order))return false;if(state==='shipped'&&!isProcessedOrder(order))return false;if(state==='cancelled'&&!isCancelledOrder(order))return false;return true})},[orderContextOrders,labelContextOrders,shippedContextOrders,state]);
  const selectableOrders=filtered.filter(canPrepareOrder);
  const selectedOrders=selectableOrders.filter(order=>checkedIds.has(order.id));
  const allSelectableSelected=selectableOrders.length>0&&selectableOrders.every(order=>checkedIds.has(order.id));
  const toggleOrder=(id:string,checked:boolean)=>setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
  const toggleAllOrders=(checked:boolean)=>setCheckedIds(checked?new Set(selectableOrders.map(order=>order.id)):new Set());
  useEffect(()=>{setCheckedIds(new Set())},[query,channel,state,trackingFilter,countryFilter,carrierFilter,dateFrom,dateTo]);

  const labelFilenameOptions={strategy:settings.orders.labelFilenameStrategy,template:settings.orders.customLabelFilenameTemplate};
  const enabledShippingOptions=(available:ShippingOption[])=>{
    const enabled=settings.shipping.enabledCarriers.map(value=>value.trim().toLowerCase()).filter(Boolean);
    if(!enabled.length)return available;
    return available.filter(option=>{
      const haystack=`${option.carrierCode||''} ${option.carrierName||''}`.toLowerCase();
      return enabled.some(value=>haystack.includes(value));
    });
  };
  const automaticShippingOption=(order:FulfillmentOrder,available:ShippingOption[])=>{
    const allowed=enabledShippingOptions(available);
    const byRules=selectShippingOptionByRules(order,allowed,shippingRules);
    if(byRules)return byRules;
    const fallback=settings.orders.defaultCarrier?.trim().toLowerCase();
    return fallback?allowed.find(option=>`${option.carrierCode||''} ${option.carrierName||''}`.toLowerCase().includes(fallback))||null:null;
  };
  const validationCarrier=(order:FulfillmentOrder)=>settings.orders.defaultCarrier||defaultCarrierCode(order);

  const prepare=async(order:FulfillmentOrder)=>{
    if(!canPrepareOrder(order)){showError('Este pedido ya no admite una nueva etiqueta.');return}
    setOptions([]);setOptionsLoading(true);
    try{
      const result=await getShippingOptions(order.id);
      const allowed=enabledShippingOptions(result.options);
      const automatic=automaticShippingOption(order,allowed);
      const carrier=automatic?.carrierCode||validationCarrier(order);
      const local=validateOrderForCarrier(order,carrier);
      if(local.blocking){setEditValidationIssues(local.issues);setEditOrder(order);showError('El pedido tiene datos obligatorios incompletos. Revísalos antes de continuar.');return}
      if(!allowed.length){showError('No hay servicios disponibles entre los transportistas habilitados.');return}
      if(settings.orders.generateLabelAutomatically){
        if(automatic){await createLabel(automatic,order);return}
        if(settings.shipping.noValidMethodBehavior==='error'){showError('Ninguna regla automática encuentra un servicio válido para este pedido.');return}
      }
      setLabelOrder(order);
      setOptions(allowed);
    }catch(e){
      showError(errorMessage(e,'No se pudieron consultar los servicios y precios.'));
    }finally{setOptionsLoading(false)}
  };
  const handleBlob=async(blob:Blob,order:FulfillmentOrder,mode:'print'|'download')=>{
    const prepared=await prepareLabelPdf(blob,settings.shipping);
    if(mode==='download'){downloadLabel(prepared,labelPdfFilename(order,labelFilenameOptions));return}
    if(preferences.labelPrinterId){try{await printLabelWithClient(prepared,preferences.labelPrinterId);showSuccess('Etiqueta enviada a la impresora.');return}catch{/* PDF */}}
    openLabelForPrint(prepared);
  };
  const createLabel=async(option:ShippingOption|null,explicitOrder:FulfillmentOrder|null=labelOrder)=>{if(!explicitOrder)return;const order=explicitOrder;setBusyOrder(order.id);setLabelOrder(null);try{
    const result=await createOrderLabel(order.id,option,settings.orders.pushTrackingToMarketplace),blob=labelBlob(result);
    const freshOrders=await listFulfillmentOrders();const fresh=freshOrders.find(item=>item.id===order.id)||order;setOrders(freshOrders);setSelected(fresh);
    if(result.automation?.downloadPdf!==false&&settings.orders.downloadLabelAfterCreation&&settings.shipping.autoDownload){
      const prepared=await prepareLabelPdf(blob,settings.shipping);
      downloadLabel(prepared,labelPdfFilename(fresh,labelFilenameOptions));
    }
    showSuccess(`Etiqueta creada${result.trackingNumber?` · ${result.trackingNumber}`:''}.`);
  }catch(e){showError(errorMessage(e,'No se pudo crear la etiqueta.'))}finally{setBusyOrder(null)}};
  const existingLabel=async(order:FulfillmentOrder,mode:'print'|'download')=>{setBusyOrder(order.id);try{const result=await fetchOrderLabel(order.id);await handleBlob(labelBlob(result),order,mode)}catch(e){showError(errorMessage(e,'No se pudo recuperar la etiqueta.'))}finally{setBusyOrder(null)}};
  const generateLabels=async(targets:FulfillmentOrder[],scope:'pendientes'|'seleccionadas')=>{
    if(!targets.length){showSuccess(scope==='seleccionadas'?'No hay pedidos seleccionados que admitan etiqueta.':'No hay pedidos pendientes en el periodo seleccionado.');return;}
    setBulkGenerating(true);setBulkProgress(`0/${targets.length}`);setError('');
    const zip=new JSZip(),usedNames=new Set<string>(),failed:string[]=[];
    let processed=0,generated=0;
    for(const order of targets){
      try{
        const local=validateOrderForCarrier(order);if(local.blocking)throw new Error(local.issues[0]?.message||'El pedido necesita revisión antes de generar la etiqueta.');
        const shipping=await getShippingOptions(order.id);
        const option=automaticShippingOption(order,shipping.options);
        if(!option)throw new Error('No se encontró un servicio válido según las reglas automáticas de envío.');
        const result=await createOrderLabel(order.id,option,settings.orders.pushTrackingToMarketplace);
        const prepared=await prepareLabelPdf(labelBlob(result),settings.shipping);
        zip.file(uniqueLabelPdfFilename(order,usedNames,labelFilenameOptions),prepared);
        generated+=1;
      }catch(e){failed.push(`${order.orderNumber||order.orderId||order.id}: ${errorMessage(e,'Error al generar etiqueta')}`)}
      finally{processed+=1;setBulkProgress(`${processed}/${targets.length}`)}
    }
    try{
      if(generated){const blob=await zip.generateAsync({type:'blob'});downloadBlob(blob,bulkLabelZipFilename(settings.orders.bulkZipFilenameTemplate,scope,iso(new Date())))}
      const freshOrders=await listFulfillmentOrders();setOrders(freshOrders);setCheckedIds(new Set());setSelected(current=>current?freshOrders.find(item=>item.id===current.id)||null:null);
      if(failed.length){const detail=failed.slice(0,3).join(' · ');showError(`${generated} etiquetas generadas. ${failed.length} no se pudieron generar${detail?`: ${detail}`:''}`)}
      else showSuccess(`${generated} etiquetas generadas y descargadas en un ZIP.`);
    }catch(e){showError(errorMessage(e,'Las etiquetas se generaron, pero no se pudo preparar el ZIP.'))}
    finally{setBulkGenerating(false);setBulkProgress('')}
  };
  const generatePendingLabels=()=>generateLabels(pendingOrders,'pendientes');
  const generateSelectedLabels=()=>generateLabels(selectedOrders,'seleccionadas');
  const detectPrinters=async()=>{setPrinterChecking(true);try{const found=await listLocalPrinters();setPrinters(found);const chosen=preferences.labelPrinterId||found.find(item=>item.default)?.id||found[0]?.id||'';setPrinter(chosen);if(chosen)await updatePreferences({...preferences,labelPrinterId:chosen});showSuccess(found.length?`${found.length} impresora${found.length===1?'':'s'} detectada${found.length===1?'':'s'}.`:'No se han encontrado impresoras.')}catch{setPrinters([]);showError('No se detecta el Print Client de Sendcloud. Puedes imprimir desde PDF.')}finally{setPrinterChecking(false)}};
  const saveManual=async(value:any)=>{setManualSaving(true);try{const result=await createManualOrder(value);await refresh();setManualOpen(false);showSuccess(`Pedido ${result.orderNumber} creado en ZENVIA y Sendcloud.`)}catch(e){showError(errorMessage(e,'No se pudo crear el pedido manual.'))}finally{setManualSaving(false)}};
  const saveEdit=async(value:OrderUpdateInput)=>{if(!editOrder)return;setEditSaving(true);try{await updateFulfillmentOrder(editOrder.id,value);const freshOrders=await listFulfillmentOrders();setOrders(freshOrders);const fresh=freshOrders.find(item=>item.id===editOrder.id)||editOrder;setSelected(fresh);setEditValidationIssues([]);setEditOrder(null);showSuccess('Pedido actualizado en ZENVIA y Sendcloud.')}catch(e){showError(errorMessage(e,'No se pudo actualizar el pedido.'))}finally{setEditSaving(false)}};

  return <div className="page ordersPage">
    <div className="pageHead"><div><div className="eyebrow">LOGÍSTICA</div><h1>Pedidos</h1><p>Amazon, Shopify y pedidos manuales, etiquetas y seguimiento desde un único sitio.</p></div><div className="actions"><button className="secondary" onClick={detectPrinters} disabled={printerChecking}>{printerChecking?<LoaderCircle className="spin" size={16}/>:<Printer size={16}/>} Impresora</button><button className="secondary" onClick={()=>setManualOpen(true)} disabled={!status?.configured}><Plus size={16}/> Nuevo pedido</button><button className="secondary" onClick={generatePendingLabels} disabled={bulkGenerating||syncing||!status?.configured||pending===0}>{bulkGenerating?<LoaderCircle className="spin" size={16}/>:<Download size={16}/>} {bulkGenerating?`Generando ${bulkProgress}`:`Generar etiquetas pendientes (${pending})`}</button><button className="primary" onClick={()=>sync(false,false)} disabled={syncing||bulkGenerating||!status?.configured}>{syncing?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} Actualizar pedidos</button></div></div>
    {status?.configured&&<section className="ordersConnection"><CheckCircle2 size={16}/><span>Sendcloud conectado</span><small>{status.integrations.filter(item=>item.channel==='amazon'||item.channel==='shopify').map(item=>item.shopName||item.type).join(' · ')||'Integraciones disponibles'}</small></section>}
    {status&&!status.configured&&<section className="card ordersSetup"><AlertCircle/><div><h3>Falta conectar Sendcloud</h3><p>Configura las claves API para sincronizar pedidos y generar etiquetas.</p></div></section>}{error&&<div className="errorBox"><AlertCircle size={17}/>{error}</div>}

    <PeriodFilterPanel filter={dateFilter} onChange={setDateFilter} title="Periodo global" className="ordersPeriodPanel" note="Ventas y pendientes se filtran por fecha del pedido. Etiquetados se filtran por fecha de etiqueta; enviados y coste de transportistas, por fecha de expedición."/>

    <div className="stats ordersSalesStats"><div className="stat"><div className="statIcon"><Euro/></div><div><span>Total vendido</span><strong>{money(salesKpis.gross)}</strong><small>{salesKpis.count} pedidos · {selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><Percent/></div><div><span>IVA estimado</span><strong>{money(salesKpis.vat)}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><Calculator/></div><div><span>Neto sin IVA</span><strong>{money(salesKpis.net)}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Ticket medio</span><strong>{money(salesKpis.average)}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><Truck/></div><div><span>Coste transportistas (IVA incl.)</span><strong>{money(transportKpis.total)}</strong><small>MRW {money(transportKpis.mrw)} · Correos {money(transportKpis.correos)}</small><small>{transportKpis.valued}/{transportKpis.shipments} envíos con coste{transportKpis.missing?` · ${transportKpis.missing} sin valorar`:``}</small></div></div></div>
    <div className="stats ordersStats"><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Pendientes</span><strong>{pending}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><Store/></div><div><span>Amazon pendientes</span><strong>{amazon}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Shopify pendientes</span><strong>{shopify}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Manual / API pendientes</span><strong>{manual}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><PackageCheck/></div><div><span>Etiquetados</span><strong>{labelled}</strong><small>Fecha etiqueta · {selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><Truck/></div><div><span>Enviados</span><strong>{shipped}</strong><small>Fecha expedición · {selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><AlertCircle/></div><div><span>Cancelados</span><strong>{cancelled}</strong><small>{selectedPeriod}</small></div></div></div>

    <div className="ordersToolbar businessFilterBar">
      <div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar pedido, cliente, producto, tracking o transportista…"/></div>
      <div className="ordersFilterGroup"><button className={state==='pending'?'active':''} onClick={()=>setState('pending')}>Pendientes</button><button className={state==='labelled'?'active':''} onClick={()=>setState('labelled')}>Etiquetados</button><button className={state==='shipped'?'active':''} onClick={()=>setState('shipped')}>Enviados</button><button className={state==='cancelled'?'active':''} onClick={()=>setState('cancelled')}>Cancelados</button><button className={state==='all'?'active':''} onClick={()=>setState('all')}>Todos</button></div>
      <div className="businessFilterFields">
        <label className="filterField"><span>Canal</span><SelectField value={channel} onChange={value=>setChannel(value as 'all'|OrderChannel)} ariaLabel="Filtrar por canal" options={[{value:'all',label:'Todos los canales'},{value:'amazon',label:'Amazon'},{value:'shopify',label:'Shopify'},{value:'other',label:'Manual / API'}]}/></label>
        <label className="filterField"><span>Destino</span><SelectField value={countryFilter} onChange={setCountryFilter} ariaLabel="Filtrar por país de destino" options={[{value:'all',label:'Todos los países'},...countryOptions]}/></label>
        <label className="filterField"><span>Transportista</span><SelectField value={carrierFilter} onChange={setCarrierFilter} ariaLabel="Filtrar por transportista" options={[{value:'all',label:'Todos los transportistas'},...carrierOptions]}/></label>
        <label className="filterField"><span>Seguimiento</span><SelectField value={trackingFilter} onChange={value=>setTrackingFilter(value as TrackingFilter)} ariaLabel="Filtrar por seguimiento" options={[{value:'all',label:'Todos'},{value:'none',label:'Sin etiqueta / pendiente'},{value:'ready',label:'Preparado'},{value:'transit',label:'En tránsito'},{value:'route',label:'En reparto'},{value:'pickup',label:'Punto de recogida'},{value:'delivered',label:'Entregado'},{value:'issue',label:'Incidencia'},{value:'cancelled',label:'Cancelado'}]}/></label>
      </div>
    </div>
    {selectableOrders.length>0&&<BulkSelectionToolbar selectedCount={selectedOrders.length} totalCount={selectableOrders.length} allSelected={allSelectableSelected} onToggleAll={toggleAllOrders} label="pedidos con etiqueta pendiente">
      <button className="primary" type="button" disabled={!selectedOrders.length||bulkGenerating||syncing||!status?.configured} onClick={()=>void generateSelectedLabels()}><Download size={15}/> {bulkGenerating&&selectedOrders.length?`Generando ${bulkProgress}`:`Generar etiquetas seleccionadas (${selectedOrders.length})`}</button>
    </BulkSelectionToolbar>}
    {printer&&<div className="ordersPrinterBar"><Printer size={15}/><span>Impresora directa:</span>{printers.length?<SearchableSelect value={printer} options={printers.map(item=>({value:item.id,label:`${item.name}${item.default?' · predeterminada':''}`,searchText:item.name}))} onChange={value=>{setPrinter(value);void updatePreferences({...preferences,labelPrinterId:value})}} searchPlaceholder="Buscar impresora…" ariaLabel="Impresora directa"/>:<strong>{printer}</strong>}<button className="link" onClick={()=>{setPrinter('');void updatePreferences({...preferences,labelPrinterId:null})}}>Usar PDF</button></div>}

    <section className="card tableCard ordersTableCard">{loading?<div className="emptyState large"><LoaderCircle className="spin"/> Cargando pedidos…</div>:filtered.length?<table className="ordersTable"><thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allSelectableSelected} disabled={!selectableOrders.length} onChange={toggleAllOrders} label={allSelectableSelected?'Deseleccionar pedidos pendientes':'Seleccionar pedidos pendientes'}/></th><th>Canal</th><th>Pedido</th><th>Cliente</th><th>Productos</th><th>Destino</th><th>Transportista</th><th>Envío</th><th>Peso</th><th className="right">Unidades</th><th className="right">Total</th><th>Estado</th><th>Seguimiento</th><th>Fecha pedido</th><th>Fecha etiqueta</th><th></th></tr></thead><tbody>{filtered.map(order=>{const stateInfo=orderState(order),tracking=trackingState(order),validation=validateOrderForCarrier(order),shipping=shippingPriceForOrder(order,shippingPreviews[order.id]||tariffPreviews[order.id]),first=order.items[0],rest=order.items.slice(1,3);return <tr key={order.id} className={`clickableRow ${checkedIds.has(order.id)?'bulkSelectedRow':''}`} onClick={()=>setSelected(order)}><td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={checkedIds.has(order.id)} disabled={!canPrepareOrder(order)} onChange={checked=>toggleOrder(order.id,checked)} label={canPrepareOrder(order)?`Seleccionar pedido ${order.orderNumber||order.orderId}`:'Este pedido ya no admite una nueva etiqueta'}/></td><td><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span></td><td><strong>{order.orderNumber||order.orderId||order.sendcloudId}</strong><small>{order.integrationName||''}</small></td><td>{order.customerName||text(order.shippingAddress.name)||'—'}{validation.blocking&&<small className="ordersValidationWarn"><AlertCircle size={12}/> Revisar</small>}</td><td className="ordersProductsCell" aria-label={productsText(order)}>{first?<div className="ordersProductIdentity">{order.sourceChannel==='amazon'&&(itemImageUrl(first,amazonImages)?<img className="ordersProductThumb" src={itemImageUrl(first,amazonImages)} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="ordersProductThumb ordersProductThumbPlaceholder"><ImageOff size={16}/></span>)}<div><strong>{itemLabel(first)}{itemQty(first)>1?` ×${itemQty(first)}`:''}</strong>{rest.length>0&&<small>{rest.map(item=>`${itemLabel(item)}${itemQty(item)>1?` ×${itemQty(item)}`:''}`).join(' · ')}{order.items.length>3?` · +${order.items.length-3} más`:''}</small>}</div></div>:'—'}</td><td>{text(order.shippingAddress.country_code)||'—'} · {text(order.shippingAddress.postal_code)||''}</td><td><strong className="ordersCarrierText">{carrierLabel(order)}</strong></td><td><strong className="ordersShippingPrice">{shipping?money(shipping.totalAmount,shipping.currency):'—'}</strong>{shipping&&shipping.source!=='recorded'&&<small>estimado</small>}</td><td><strong>{weightLabel(order)}</strong></td><td className="right"><strong>{order.items.reduce((sum,item)=>sum+itemQty(item),0)}</strong></td><td className="right"><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></td><td><span className={`ordersState ${stateInfo.className}`}>{stateInfo.className==='ready'?<PackageCheck size={13}/>:stateInfo.className==='pending'?<Truck size={13}/>:<AlertCircle size={13}/>} {stateInfo.label}</span></td><td><span className={`ordersTracking ${tracking.className}`} aria-label={order.trackingStatusMessage||tracking.label}>{tracking.label}</span></td><td>{dateLabel(order.orderCreatedAt)}</td><td>{dateLabel(labelTimestamp(order))}</td><td className="right"><ChevronRight size={17}/></td></tr>})}</tbody></table>:<div className="emptyState large">No hay pedidos para estos filtros y fechas.</div>}</section>
    <div className="ordersMobileList">{filtered.map(order=>{const stateInfo=orderState(order),tracking=trackingState(order),validation=validateOrderForCarrier(order),shipping=shippingPriceForOrder(order,shippingPreviews[order.id]||tariffPreviews[order.id]);return <div className={`bulkMobileSelectableRow ${checkedIds.has(order.id)?'selected':''}`} key={order.id}><BulkSelectCheckbox checked={checkedIds.has(order.id)} disabled={!canPrepareOrder(order)} onChange={checked=>toggleOrder(order.id,checked)} label={canPrepareOrder(order)?`Seleccionar pedido ${order.orderNumber||order.orderId}`:'Este pedido ya no admite una nueva etiqueta'}/><button className="card ordersMobileRow" onClick={()=>setSelected(order)}><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span><strong>{order.orderNumber||order.orderId}</strong><small>{order.customerName||'Cliente'} · {weightLabel(order)} · {carrierLabel(order)} · Envío {shipping?money(shipping.totalAmount,shipping.currency):'—'}</small>{validation.blocking&&<small className="ordersValidationWarn"><AlertCircle size={12}/> Revisar pedido</small>}<small>Pedido {dateLabel(order.orderCreatedAt)} · Etiqueta {dateLabel(labelTimestamp(order))}</small>{order.items[0]&&<div className="ordersMobileProductRow">{order.sourceChannel==='amazon'&&(itemImageUrl(order.items[0],amazonImages)?<img className="ordersProductThumb" src={itemImageUrl(order.items[0],amazonImages)} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="ordersProductThumb ordersProductThumbPlaceholder"><ImageOff size={15}/></span>)}<small className="ordersMobileProduct">{itemLabel(order.items[0])}{order.items.length>1?` · +${order.items.length-1} producto${order.items.length-1===1?'':'s'}`:''}</small></div>}</div><div><b>{money(order.totalAmount,order.currency||'EUR')}</b><span className={`ordersState ${stateInfo.className}`}>{stateInfo.label}</span><span className={`ordersTracking ${tracking.className}`}>{tracking.label}</span></div><ChevronRight size={18}/></button></div>})}</div>

    {selected&&(()=>{const current=orders.find(item=>item.id===selected.id)||selected;const validation=validateOrderForCarrier(current);const shipping=shippingPriceForOrder(current,shippingPreviews[current.id]||tariffPreviews[current.id]);return <OrderDrawer order={current} shippingPrice={shipping} validationIssues={validation.issues} onClose={()=>setSelected(null)} onEdit={()=>{setEditValidationIssues(validation.issues);setEditOrder(current)}} onPrepare={()=>prepare(current)} onPrint={()=>existingLabel(current,'print')} onDownload={()=>existingLabel(current,'download')} busy={busyOrder===selected.id}/>})()} 
    {labelOrder&&<LabelModal order={labelOrder} options={options} loading={optionsLoading} onClose={()=>setLabelOrder(null)} onCreate={createLabel}/>} 
    {manualOpen&&status&&<ManualOrderModal status={status} saving={manualSaving} defaultCountryCode={settings.orders.originCountryCode} fallbackWeightKg={settings.shipping.fallbackWeightKg} onClose={()=>setManualOpen(false)} onSave={saveManual}/>} 
    {editOrder&&<OrderEditModal order={editOrder} fallbackWeightKg={settings.shipping.fallbackWeightKg} saving={editSaving} validationIssues={editValidationIssues} onClose={()=>{setEditValidationIssues([]);setEditOrder(null)}} onSave={saveEdit}/>} 
  </div>;
}
