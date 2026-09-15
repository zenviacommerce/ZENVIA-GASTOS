import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Calculator, CalendarDays, CheckCircle2, ChevronRight, Download, Euro,
  ExternalLink, LoaderCircle, MapPin, PackageCheck, Percent, Plus, Printer, RefreshCw,
  Search, Settings2, ShoppingBag, Store, Trash2, Truck, X,
} from 'lucide-react';
import {
  createManualOrder, createOrderLabel, downloadLabel, fetchOrderLabel, getSavedPrinter,
  getSendcloudStatus, getShippingOptions, labelBlob, listFulfillmentOrders, listLocalPrinters,
  markHistorySyncDone, openLabelForPrint, printLabelWithClient, savePrinter,
  shouldRunHistorySync, syncSendcloudOrders,
  type FulfillmentOrder, type LocalPrinter, type ManualOrderItem, type SendcloudStatus,
  type ShippingOption,
} from '../services/orders';
import { errorMessage, showError, showSuccess } from '../services/toast';

const money=(value:number|null,currency='EUR')=>value==null?'—':new Intl.NumberFormat('es-ES',{style:'currency',currency:currency||'EUR'}).format(value);
const dateLabel=(value?:string|null)=>value?new Date(value).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'}):'—';
const dayLabel=(value?:string|null)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('es-ES'):'—';
const text=(value:unknown)=>typeof value==='string'?value:'';
const iso=(value:Date)=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;

type PeriodPreset='month'|'quarter'|'year'|'all'|'custom';
type OrderFilter='pending'|'labelled'|'shipped'|'cancelled'|'all';

function currentRange(preset:Exclude<PeriodPreset,'custom'>){
  const now=new Date();
  if(preset==='all')return {from:'',to:''};
  if(preset==='month')return {from:iso(new Date(now.getFullYear(),now.getMonth(),1)),to:iso(new Date(now.getFullYear(),now.getMonth()+1,0))};
  if(preset==='year')return {from:`${now.getFullYear()}-01-01`,to:`${now.getFullYear()}-12-31`};
  const start=Math.floor(now.getMonth()/3)*3;
  return {from:iso(new Date(now.getFullYear(),start,1)),to:iso(new Date(now.getFullYear(),start+3,0))};
}
function periodText(preset:PeriodPreset,from:string,to:string){
  if(preset==='month')return 'Mes actual'; if(preset==='quarter')return 'Trimestre actual';
  if(preset==='year')return 'Año actual'; if(preset==='all')return 'Todo el histórico sincronizado';
  if(from&&to)return `${dayLabel(from)} – ${dayLabel(to)}`; if(from)return `Desde ${dayLabel(from)}`; if(to)return `Hasta ${dayLabel(to)}`;
  return 'Periodo personalizado';
}
function orderDateKey(order:FulfillmentOrder){
  if(!order.orderCreatedAt)return ''; const date=new Date(order.orderCreatedAt);
  return Number.isNaN(date.getTime())?order.orderCreatedAt.slice(0,10):iso(date);
}
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
function orderStatusCode(order:FulfillmentOrder){return String(order.sourceStatus||'').trim().toLowerCase();}
function isCancelledOrder(order:FulfillmentOrder){return orderStatusCode(order).includes('cancel');}
function isProcessedOrder(order:FulfillmentOrder){const status=orderStatusCode(order);return status==='fulfilled'||status==='shipped'||status==='delivered'||status.includes('shipped');}
function isPendingOrder(order:FulfillmentOrder){return !order.sendcloudParcelId&&!isCancelledOrder(order)&&!isProcessedOrder(order);}
function canPrepareOrder(order:FulfillmentOrder){return isPendingOrder(order);}
function orderState(order:FulfillmentOrder){
  if(isCancelledOrder(order))return {label:'Cancelado',className:'cancelled'};
  if(isProcessedOrder(order))return {label:'Enviado',className:'closed'};
  if(order.sendcloudParcelId)return {label:'Etiquetado',className:'ready'};
  return {label:'Pendiente',className:'pending'};
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

function OrderDrawer({order,onClose,onPrepare,onPrint,onDownload,busy}:{order:FulfillmentOrder;onClose:()=>void;onPrepare:()=>void;onPrint:()=>void;onDownload:()=>void;busy:boolean}){
  const labelled=Boolean(order.sendcloudParcelId),state=orderState(order),canPrepare=canPrepareOrder(order);
  return <div className="ordersDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="ordersDrawer">
    <div className="ordersDrawerHead"><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span><h2>Pedido {order.orderNumber||order.orderId||order.sendcloudId}</h2><p>{dateLabel(order.orderCreatedAt)} · {order.integrationName||'Sendcloud'}</p></div><button className="iconBtn" onClick={onClose}><X size={18}/></button></div>
    <div className="ordersDrawerKpis"><div><span>Estado</span><strong>{state.label}</strong></div><div><span>Total</span><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></div><div><span>Transportista</span><strong>{carrierLabel(order)}</strong></div></div>
    <section className="ordersDrawerSection"><h3>Entrega</h3><div className="ordersAddress"><MapPin size={17}/><div><strong>{order.customerName||text(order.shippingAddress.name)||'Cliente'}</strong><span>{addressLine(order.shippingAddress)}</span>{order.customerPhone&&<small>{order.customerPhone}</small>}{order.customerEmail&&<small>{order.customerEmail}</small>}</div></div></section>
    <section className="ordersDrawerSection"><div className="ordersSectionHead"><h3>Contenido</h3><span>{order.items.length} línea{order.items.length===1?'':'s'}</span></div>{order.items.length?<div className="ordersItems">{order.items.map((item,index)=><div key={`${itemLabel(item)}-${index}`}><div><strong>{itemLabel(item)}</strong><span>{text(item.sku)||text(item.product_id)||''}</span></div><b>x{itemQty(item)}</b></div>)}</div>:<div className="masterEmptyMini">Sin líneas de producto.</div>}</section>
    {(labelled||isProcessedOrder(order))&&<section className="ordersDrawerSection"><h3>Expedición</h3><div className="ordersShipmentInfo"><div><span>Transportista</span><strong>{carrierLabel(order)}</strong></div><div><span>Servicio</span><strong>{order.shippingServiceName||order.shippingOptionCode||'—'}</strong></div><div><span>Tracking</span><strong>{order.trackingNumber||'—'}</strong></div>{order.trackingUrl&&<a href={order.trackingUrl} target="_blank" rel="noreferrer">Abrir seguimiento <ExternalLink size={14}/></a>}</div></section>}
    <div className="ordersDrawerActions">{labelled?<><button className="secondary" disabled={busy} onClick={onDownload}><Download size={16}/> Descargar</button><button className="primary" disabled={busy} onClick={onPrint}><Printer size={16}/> Imprimir</button></>:canPrepare?<button className="primary full" disabled={busy} onClick={onPrepare}>{busy?<LoaderCircle className="spin" size={16}/>:<Truck size={16}/>} Preparar etiqueta</button>:<div className={`ordersNoAction ${state.className}`}><AlertCircle size={16}/><span>{isCancelledOrder(order)?'Pedido cancelado. No se puede generar etiqueta.':'Este pedido ya está procesado.'}</span></div>}</div>
  </aside></div>;
}

function LabelModal({order,options,loading,onClose,onCreate}:{order:FulfillmentOrder;options:ShippingOption[];loading:boolean;onClose:()=>void;onCreate:(option:ShippingOption|null)=>void}){
  const preferred=options.filter(option=>preferredCarrier(option));
  const grouped={correos:preferred.filter(option=>preferredCarrier(option)==='correos'),mrw:preferred.filter(option=>preferredCarrier(option)==='mrw')};
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal ordersLabelModal">
    <div className="modalHead"><div><h3>Crear etiqueta · {order.orderNumber||order.orderId}</h3><p>Elige Correos o MRW, o deja que Sendcloud aplique tus reglas.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="ordersLabelBody">{loading?<div className="ordersOptionsLoading"><LoaderCircle className="spin"/><span>Consultando servicios…</span></div>:<><div className="ordersCarrierGrid">{(['correos','mrw'] as const).map(carrier=><section className="ordersCarrierCard" key={carrier}><div className="ordersCarrierHead"><Truck size={18}/><div><strong>{carrier==='correos'?'Correos':'MRW'}</strong><span>{carrier==='correos'?'Tarifas de Sendcloud':'Contrato propio conectado'}</span></div></div>{grouped[carrier].length?<div className="ordersOptionList">{grouped[carrier].map(option=><button key={`${option.code}-${option.contractId||''}`} onClick={()=>onCreate(option)}><div><strong>{option.name}</strong><small>{option.code}</small></div><span>{option.price==null?'Elegir':money(option.price,option.currency||'EUR')}</span></button>)}</div>:<div className="ordersNoOption">No hay servicios disponibles para este pedido.</div>}</section>)}</div><button className="secondary ordersRulesButton" onClick={()=>onCreate(null)}><Settings2 size={16}/><span><strong>Usar reglas de Sendcloud</strong><small>Respeta tus métodos y reglas configuradas.</small></span><ChevronRight size={17}/></button></>}</div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button></div>
  </section></div>;
}

function ManualOrderModal({status,saving,onClose,onSave}:{status:SendcloudStatus;saving:boolean;onClose:()=>void;onSave:(value:any)=>void}){
  const apiIntegrations=status.integrations.filter(item=>item.channel==='other');
  const suggested=apiIntegrations.find(item=>item.isApi)||apiIntegrations[0];
  const [integrationId,setIntegrationId]=useState(suggested?.id||0);
  const [orderNumber,setOrderNumber]=useState(`MAN-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(Date.now()).slice(-5)}`);
  const [customerName,setCustomerName]=useState(''); const [email,setEmail]=useState(''); const [phone,setPhone]=useState('');
  const [address,setAddress]=useState(''); const [houseNumber,setHouseNumber]=useState(''); const [postalCode,setPostalCode]=useState(''); const [city,setCity]=useState(''); const [countryCode,setCountryCode]=useState('ES');
  const [weightKg,setWeightKg]=useState(1); const [items,setItems]=useState<ManualOrderItem[]>([{name:'',sku:'',quantity:1,unitPrice:0}]);
  const updateItem=(index:number,key:keyof ManualOrderItem,value:string|number)=>setItems(prev=>prev.map((item,i)=>i===index?{...item,[key]:value}:item));
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal ordersManualModal">
    <div className="modalHead"><div><h3>Nuevo pedido manual</h3><p>Se creará también en Sendcloud para que puedas generar la etiqueta desde aquí.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="ordersManualBody">
      {!apiIntegrations.length&&<div className="errorBox"><AlertCircle size={16}/> No encuentro una integración API de Sendcloud. La integración de Amazon/Shopify no debe usarse para pedidos manuales.</div>}
      <div className="ordersManualGrid"><label><span>N.º pedido</span><input value={orderNumber} onChange={e=>setOrderNumber(e.target.value)}/></label><label><span>Integración Sendcloud</span><select value={integrationId} onChange={e=>setIntegrationId(Number(e.target.value))}><option value={0}>Seleccionar…</option>{apiIntegrations.map(item=><option key={item.id} value={item.id}>{item.shopName} · {item.type||'API'}</option>)}</select></label><label><span>Cliente *</span><input value={customerName} onChange={e=>setCustomerName(e.target.value)}/></label><label><span>Teléfono</span><input value={phone} onChange={e=>setPhone(e.target.value)}/></label><label className="wide"><span>Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="wide"><span>Dirección *</span><input value={address} onChange={e=>setAddress(e.target.value)}/></label><label><span>Número</span><input value={houseNumber} onChange={e=>setHouseNumber(e.target.value)}/></label><label><span>Código postal *</span><input value={postalCode} onChange={e=>setPostalCode(e.target.value)}/></label><label><span>Ciudad *</span><input value={city} onChange={e=>setCity(e.target.value)}/></label><label><span>País *</span><input maxLength={2} value={countryCode} onChange={e=>setCountryCode(e.target.value.toUpperCase())}/></label><label><span>Peso total (kg)</span><input type="number" min="0.01" step="0.01" value={weightKg} onChange={e=>setWeightKg(Number(e.target.value)||0)}/></label></div>
      <div className="ordersManualItems"><div className="ordersSectionHead"><h3>Productos</h3><button className="link" onClick={()=>setItems(prev=>[...prev,{name:'',sku:'',quantity:1,unitPrice:0}])}><Plus size={14}/> Añadir línea</button></div>{items.map((item,index)=><div className="ordersManualItem" key={index}><input placeholder="Producto" value={item.name} onChange={e=>updateItem(index,'name',e.target.value)}/><input placeholder="SKU" value={item.sku||''} onChange={e=>updateItem(index,'sku',e.target.value)}/><input type="number" min="1" placeholder="Uds" value={item.quantity} onChange={e=>updateItem(index,'quantity',Math.max(1,Number(e.target.value)||1))}/><input type="number" min="0" step="0.01" placeholder="€/ud" value={item.unitPrice} onChange={e=>updateItem(index,'unitPrice',Math.max(0,Number(e.target.value)||0))}/><button className="iconBtn dangerText" disabled={items.length===1} onClick={()=>setItems(prev=>prev.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>)}</div>
    </div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving||!apiIntegrations.length} onClick={()=>onSave({integrationId,orderNumber,customerName,email,phone,address,houseNumber,postalCode,city,countryCode,weightKg,items})}>{saving?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>} Crear pedido</button></div>
  </section></div>;
}

export function Orders(){
  const initialRange=currentRange('quarter');
  const [orders,setOrders]=useState<FulfillmentOrder[]>([]),[status,setStatus]=useState<SendcloudStatus|null>(null);
  const [loading,setLoading]=useState(true),[syncing,setSyncing]=useState(false),[error,setError]=useState('');
  const [query,setQuery]=useState(''),[channel,setChannel]=useState<'all'|'amazon'|'shopify'>('all'),[state,setState]=useState<OrderFilter>('pending');
  const [selected,setSelected]=useState<FulfillmentOrder|null>(null),[labelOrder,setLabelOrder]=useState<FulfillmentOrder|null>(null),[options,setOptions]=useState<ShippingOption[]>([]),[optionsLoading,setOptionsLoading]=useState(false),[busyOrder,setBusyOrder]=useState<string|null>(null);
  const [printers,setPrinters]=useState<LocalPrinter[]>([]),[printer,setPrinter]=useState(getSavedPrinter()),[printerChecking,setPrinterChecking]=useState(false);
  const [period,setPeriod]=useState<PeriodPreset>('quarter'),[dateFrom,setDateFrom]=useState(initialRange.from),[dateTo,setDateTo]=useState(initialRange.to);
  const [manualOpen,setManualOpen]=useState(false),[manualSaving,setManualSaving]=useState(false);

  const refresh=useCallback(async()=>{try{setOrders(await listFulfillmentOrders())}catch(e){setError(errorMessage(e,'No se pudieron cargar los pedidos.'))}},[]);
  const refreshStatus=useCallback(async()=>{try{setStatus(await getSendcloudStatus())}catch(e){setStatus({configured:false,integrations:[],message:errorMessage(e,'No se pudo comprobar Sendcloud.')})}},[]);
  useEffect(()=>{(async()=>{setLoading(true);await Promise.all([refresh(),refreshStatus()]);setLoading(false)})()},[refresh,refreshStatus]);

  const sync=useCallback(async(silent=false,history=false)=>{if(syncing)return;setSyncing(true);if(!silent)setError('');try{const result=await syncSendcloudOrders(history);setStatus({configured:true,integrations:result.integrations});await refresh();if(history)markHistorySyncDone();if(!silent)showSuccess(`${result.synced} pedidos actualizados desde Sendcloud.`)}catch(e){const message=errorMessage(e,'No se pudieron actualizar los pedidos.');if(!silent){setError(message);showError(message)}}finally{setSyncing(false)}},[refresh,syncing]);
  useEffect(()=>{if(!status?.configured)return;void sync(true,shouldRunHistorySync());const timer=window.setInterval(()=>void sync(true,false),60000);return()=>window.clearInterval(timer)},[status?.configured]);

  const applyPreset=(preset:Exclude<PeriodPreset,'custom'>)=>{const range=currentRange(preset);setPeriod(preset);setDateFrom(range.from);setDateTo(range.to);};
  const periodLabel=periodText(period,dateFrom,dateTo);
  const periodOrders=useMemo(()=>orders.filter(order=>{const key=orderDateKey(order);return Boolean(key)&&(!dateFrom||key>=dateFrom)&&(!dateTo||key<=dateTo)}),[orders,dateFrom,dateTo]);
  const salesKpis=useMemo(()=>{const sales=periodOrders.filter(order=>!isCancelledOrder(order)&&order.totalAmount!=null&&(order.currency==null||order.currency==='EUR'));let gross=0,net=0,vat=0;for(const order of sales){const parts=taxParts(order);gross+=parts.gross;net+=parts.net;vat+=parts.vat}return {gross,net,vat,count:sales.length,average:sales.length?gross/sales.length:0}},[periodOrders]);
  const pending=periodOrders.filter(isPendingOrder).length,amazon=periodOrders.filter(o=>o.sourceChannel==='amazon'&&isPendingOrder(o)).length,shopify=periodOrders.filter(o=>o.sourceChannel==='shopify'&&isPendingOrder(o)).length,labelled=periodOrders.filter(o=>Boolean(o.sendcloudParcelId)).length,shipped=periodOrders.filter(isProcessedOrder).length,cancelled=periodOrders.filter(isCancelledOrder).length;
  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return periodOrders.filter(order=>{if(channel!=='all'&&order.sourceChannel!==channel)return false;if(state==='pending'&&!isPendingOrder(order))return false;if(state==='labelled'&&!order.sendcloudParcelId)return false;if(state==='shipped'&&!isProcessedOrder(order))return false;if(state==='cancelled'&&!isCancelledOrder(order))return false;if(q&&!`${order.orderNumber||''} ${order.orderId||''} ${order.customerName||''} ${order.trackingNumber||''} ${carrierLabel(order)}`.toLowerCase().includes(q))return false;return true})},[periodOrders,query,channel,state]);

  const prepare=async(order:FulfillmentOrder)=>{if(!canPrepareOrder(order)){showError('Este pedido ya no admite una nueva etiqueta.');return}setLabelOrder(order);setOptions([]);setOptionsLoading(true);try{setOptions(await getShippingOptions(order.id))}catch(e){showError(errorMessage(e,'No se pudieron consultar los servicios.'))}finally{setOptionsLoading(false)}};
  const handleBlob=async(blob:Blob,order:FulfillmentOrder,mode:'print'|'download')=>{if(mode==='download'){downloadLabel(blob,order.orderNumber);return}if(printer){try{await printLabelWithClient(blob,printer);showSuccess('Etiqueta enviada a la impresora.');return}catch{/* PDF */}}openLabelForPrint(blob)};
  const createLabel=async(option:ShippingOption|null)=>{if(!labelOrder)return;const order=labelOrder;setBusyOrder(order.id);setLabelOrder(null);try{const result=await createOrderLabel(order.id,option),blob=labelBlob(result);await refresh();const fresh=(await listFulfillmentOrders()).find(item=>item.id===order.id)||order;setOrders(await listFulfillmentOrders());setSelected(fresh);showSuccess(`Etiqueta creada${result.trackingNumber?` · ${result.trackingNumber}`:''}.`);await handleBlob(blob,fresh,'print')}catch(e){showError(errorMessage(e,'No se pudo crear la etiqueta.'))}finally{setBusyOrder(null)}};
  const existingLabel=async(order:FulfillmentOrder,mode:'print'|'download')=>{setBusyOrder(order.id);try{const result=await fetchOrderLabel(order.id);await handleBlob(labelBlob(result),order,mode)}catch(e){showError(errorMessage(e,'No se pudo recuperar la etiqueta.'))}finally{setBusyOrder(null)}};
  const detectPrinters=async()=>{setPrinterChecking(true);try{const found=await listLocalPrinters();setPrinters(found);const chosen=printer||found.find(item=>item.default)?.id||found[0]?.id||'';setPrinter(chosen);savePrinter(chosen);showSuccess(found.length?`${found.length} impresora${found.length===1?'':'s'} detectada${found.length===1?'':'s'}.`:'No se han encontrado impresoras.')}catch{setPrinters([]);showError('No se detecta el Print Client de Sendcloud. Puedes imprimir desde PDF.')}finally{setPrinterChecking(false)}};
  const saveManual=async(value:any)=>{setManualSaving(true);try{const result=await createManualOrder(value);await refresh();setManualOpen(false);showSuccess(`Pedido ${result.orderNumber} creado en ZENVIA y Sendcloud.`)}catch(e){showError(errorMessage(e,'No se pudo crear el pedido manual.'))}finally{setManualSaving(false)}};

  return <div className="page ordersPage">
    <div className="pageHead"><div><div className="eyebrow">LOGÍSTICA</div><h1>Pedidos</h1><p>Amazon, Shopify y pedidos manuales, etiquetas y seguimiento desde un único sitio.</p></div><div className="actions"><button className="secondary" onClick={detectPrinters} disabled={printerChecking}>{printerChecking?<LoaderCircle className="spin" size={16}/>:<Printer size={16}/>} Impresora</button><button className="secondary" onClick={()=>setManualOpen(true)} disabled={!status?.configured}><Plus size={16}/> Nuevo pedido</button><button className="primary" onClick={()=>sync(false,false)} disabled={syncing||!status?.configured}>{syncing?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} Actualizar pedidos</button></div></div>
    {status?.configured&&<section className="ordersConnection"><CheckCircle2 size={16}/><span>Sendcloud conectado</span><small>{status.integrations.filter(item=>item.channel==='amazon'||item.channel==='shopify').map(item=>item.shopName||item.type).join(' · ')||'Integraciones disponibles'}</small></section>}
    {status&&!status.configured&&<section className="card ordersSetup"><AlertCircle/><div><h3>Falta conectar Sendcloud</h3><p>Configura las claves API para sincronizar pedidos y generar etiquetas.</p></div></section>}{error&&<div className="errorBox"><AlertCircle size={17}/>{error}</div>}

    <div className="masterPeriodPanel ordersPeriodPanel"><div className="masterPeriodTop"><div><CalendarDays size={17}/><div><strong>Periodo global</strong><span>{periodLabel}</span></div></div><div className="masterPeriodQuick"><button className={period==='month'?'active':''} onClick={()=>applyPreset('month')}>Mes actual</button><button className={period==='quarter'?'active':''} onClick={()=>applyPreset('quarter')}>Trimestre actual</button><button className={period==='year'?'active':''} onClick={()=>applyPreset('year')}>Año actual</button><button className={period==='all'?'active':''} onClick={()=>applyPreset('all')}>Todo</button></div></div><div className="masterPeriodDates"><label>Desde<input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPeriod('custom')}}/></label><label>Hasta<input type="date" value={dateTo} min={dateFrom||undefined} onChange={e=>{setDateTo(e.target.value);setPeriod('custom')}}/></label>{period==='custom'&&<button className="secondary" onClick={()=>applyPreset('quarter')}>Restablecer trimestre</button>}</div><small className="ordersTaxNote">Este periodo se aplica a todos los KPIs y al listado. El IVA es una estimación por país de entrega hasta conectar el desglose fiscal directo de Amazon/Shopify.</small></div>

    <div className="stats ordersSalesStats"><div className="stat"><div className="statIcon"><Euro/></div><div><span>Total vendido</span><strong>{money(salesKpis.gross)}</strong><small>{salesKpis.count} pedidos · {periodLabel}</small></div></div><div className="stat"><div className="statIcon"><Percent/></div><div><span>IVA estimado</span><strong>{money(salesKpis.vat)}</strong><small>{periodLabel}</small></div></div><div className="stat"><div className="statIcon"><Calculator/></div><div><span>Neto sin IVA</span><strong>{money(salesKpis.net)}</strong><small>{periodLabel}</small></div></div><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Ticket medio</span><strong>{money(salesKpis.average)}</strong><small>{periodLabel}</small></div></div></div>
    <div className="stats ordersStats"><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Pendientes</span><strong>{pending}</strong><small>{periodLabel}</small></div></div><div className="stat"><div className="statIcon"><Store/></div><div><span>Amazon pendientes</span><strong>{amazon}</strong><small>{periodLabel}</small></div></div><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Shopify pendientes</span><strong>{shopify}</strong><small>{periodLabel}</small></div></div><div className="stat"><div className="statIcon"><PackageCheck/></div><div><span>Etiquetados</span><strong>{labelled}</strong><small>{periodLabel}</small></div></div><div className="stat"><div className="statIcon"><Truck/></div><div><span>Enviados</span><strong>{shipped}</strong><small>{periodLabel}</small></div></div><div className="stat"><div className="statIcon"><AlertCircle/></div><div><span>Cancelados</span><strong>{cancelled}</strong><small>{periodLabel}</small></div></div></div>

    <div className="ordersToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar pedido, cliente, tracking o transportista…"/></div><div className="ordersFilterGroup"><button className={state==='pending'?'active':''} onClick={()=>setState('pending')}>Pendientes</button><button className={state==='labelled'?'active':''} onClick={()=>setState('labelled')}>Etiquetados</button><button className={state==='shipped'?'active':''} onClick={()=>setState('shipped')}>Enviados</button><button className={state==='cancelled'?'active':''} onClick={()=>setState('cancelled')}>Cancelados</button><button className={state==='all'?'active':''} onClick={()=>setState('all')}>Todos</button></div><div className="ordersFilterGroup"><button className={channel==='all'?'active':''} onClick={()=>setChannel('all')}>Todos</button><button className={channel==='amazon'?'active':''} onClick={()=>setChannel('amazon')}>Amazon</button><button className={channel==='shopify'?'active':''} onClick={()=>setChannel('shopify')}>Shopify</button></div></div>
    {printer&&<div className="ordersPrinterBar"><Printer size={15}/><span>Impresora directa:</span>{printers.length?<select value={printer} onChange={e=>{setPrinter(e.target.value);savePrinter(e.target.value)}}>{printers.map(item=><option key={item.id} value={item.id}>{item.name}{item.default?' · predeterminada':''}</option>)}</select>:<strong>{printer}</strong>}<button className="link" onClick={()=>{setPrinter('');savePrinter('')}}>Usar PDF</button></div>}

    <section className="card tableCard ordersTableCard">{loading?<div className="emptyState large"><LoaderCircle className="spin"/> Cargando pedidos…</div>:filtered.length?<table className="ordersTable"><thead><tr><th>Canal</th><th>Pedido</th><th>Cliente</th><th>Destino</th><th>Transportista</th><th className="right">Unidades</th><th className="right">Total</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>{filtered.map(order=>{const stateInfo=orderState(order);return <tr key={order.id} className="clickableRow" onClick={()=>setSelected(order)}><td><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span></td><td><strong>{order.orderNumber||order.orderId||order.sendcloudId}</strong><small>{order.integrationName||''}</small></td><td>{order.customerName||text(order.shippingAddress.name)||'—'}</td><td>{text(order.shippingAddress.country_code)||'—'} · {text(order.shippingAddress.postal_code)||''}</td><td><strong className="ordersCarrierText">{carrierLabel(order)}</strong></td><td className="right"><strong>{order.items.reduce((sum,item)=>sum+itemQty(item),0)}</strong></td><td className="right"><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></td><td><span className={`ordersState ${stateInfo.className}`}>{stateInfo.className==='ready'?<PackageCheck size={13}/>:stateInfo.className==='pending'?<Truck size={13}/>:<AlertCircle size={13}/>} {stateInfo.label}</span></td><td>{dateLabel(order.orderCreatedAt)}</td><td className="right"><ChevronRight size={17}/></td></tr>})}</tbody></table>:<div className="emptyState large">No hay pedidos para estos filtros y fechas.</div>}</section>
    <div className="ordersMobileList">{filtered.map(order=>{const stateInfo=orderState(order);return <button className="card ordersMobileRow" key={order.id} onClick={()=>setSelected(order)}><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span><strong>{order.orderNumber||order.orderId}</strong><small>{order.customerName||'Cliente'} · {carrierLabel(order)}</small></div><div><b>{money(order.totalAmount,order.currency||'EUR')}</b><span className={`ordersState ${stateInfo.className}`}>{stateInfo.label}</span></div><ChevronRight size={18}/></button>})}</div>

    {selected&&<OrderDrawer order={orders.find(item=>item.id===selected.id)||selected} onClose={()=>setSelected(null)} onPrepare={()=>prepare(orders.find(item=>item.id===selected.id)||selected)} onPrint={()=>existingLabel(orders.find(item=>item.id===selected.id)||selected,'print')} onDownload={()=>existingLabel(orders.find(item=>item.id===selected.id)||selected,'download')} busy={busyOrder===selected.id}/>} 
    {labelOrder&&<LabelModal order={labelOrder} options={options} loading={optionsLoading} onClose={()=>setLabelOrder(null)} onCreate={createLabel}/>} 
    {manualOpen&&status&&<ManualOrderModal status={status} saving={manualSaving} onClose={()=>setManualOpen(false)} onSave={saveManual}/>} 
  </div>;
}
