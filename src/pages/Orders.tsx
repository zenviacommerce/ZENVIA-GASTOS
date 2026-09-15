import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronRight, Download, ExternalLink, LoaderCircle,
  MapPin, PackageCheck, Printer, RefreshCw, Search, Settings2, ShoppingBag,
  Store, Truck, X,
} from 'lucide-react';
import {
  createOrderLabel, downloadLabel, fetchOrderLabel, getSavedPrinter, getSendcloudStatus,
  getShippingOptions, labelBlob, listFulfillmentOrders, listLocalPrinters, openLabelForPrint,
  printLabelWithClient, savePrinter, syncSendcloudOrders,
  type FulfillmentOrder, type LocalPrinter, type SendcloudStatus, type ShippingOption,
} from '../services/orders';
import { errorMessage, showError, showSuccess } from '../services/toast';

const money=(value:number|null,currency='EUR')=>value==null?'—':new Intl.NumberFormat('es-ES',{style:'currency',currency:currency||'EUR'}).format(value);
const dateLabel=(value?:string|null)=>value?new Date(value).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'}):'—';
const text=(value:unknown)=>typeof value==='string'?value:'';

function channelLabel(channel:FulfillmentOrder['sourceChannel']){
  if(channel==='amazon')return 'Amazon';
  if(channel==='shopify')return 'Shopify';
  return 'Otro';
}

function addressLine(address:Record<string,unknown>){
  const first=[text(address.address_line_1),text(address.house_number)].filter(Boolean).join(' ');
  const second=[text(address.postal_code),text(address.city)].filter(Boolean).join(' ');
  return [first,text(address.address_line_2),second,text(address.country_code)].filter(Boolean).join(' · ')||'Dirección no disponible';
}

function itemLabel(item:Record<string,unknown>){
  return text(item.name)||text(item.description)||text(item.sku)||'Producto';
}
function itemQty(item:Record<string,unknown>){return Number(item.quantity||1)||1;}

function orderStatusCode(order:FulfillmentOrder){return String(order.sourceStatus||'').trim().toLowerCase();}
function isCancelledOrder(order:FulfillmentOrder){return orderStatusCode(order).includes('cancel');}
function isProcessedOrder(order:FulfillmentOrder){const status=orderStatusCode(order);return status==='fulfilled'||status==='shipped';}
function isPendingOrder(order:FulfillmentOrder){return !order.sendcloudParcelId&&!isCancelledOrder(order)&&!isProcessedOrder(order);}
function canPrepareOrder(order:FulfillmentOrder){return isPendingOrder(order);}
function orderState(order:FulfillmentOrder){
  if(order.sendcloudParcelId)return {label:'Etiquetado',className:'ready'};
  if(isCancelledOrder(order))return {label:'Cancelado',className:'cancelled'};
  if(isProcessedOrder(order))return {label:'Procesado',className:'closed'};
  return {label:'Pendiente',className:'pending'};
}

function preferredCarrier(option:ShippingOption){
  const haystack=`${option.carrierCode} ${option.carrierName} ${option.name} ${option.code}`.toLowerCase();
  if(haystack.includes('mrw'))return 'mrw';
  if(haystack.includes('correos'))return 'correos';
  return '';
}

function OrderDrawer({order,onClose,onPrepare,onPrint,onDownload,busy}:{
  order:FulfillmentOrder;onClose:()=>void;onPrepare:()=>void;onPrint:()=>void;onDownload:()=>void;busy:boolean;
}){
  const labelled=Boolean(order.sendcloudParcelId);
  const state=orderState(order);
  const canPrepare=canPrepareOrder(order);
  return <div className="ordersDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <aside className="ordersDrawer">
      <div className="ordersDrawerHead"><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order.sourceChannel)}</span><h2>Pedido {order.orderNumber||order.orderId||order.sendcloudId}</h2><p>{dateLabel(order.orderCreatedAt)} · {order.integrationName||'Sendcloud'}</p></div><button className="iconBtn" onClick={onClose}><X size={18}/></button></div>
      <div className="ordersDrawerKpis"><div><span>Estado</span><strong>{state.label}</strong></div><div><span>Total</span><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></div><div><span>Productos</span><strong>{order.items.reduce((sum,item)=>sum+itemQty(item),0)}</strong></div></div>
      <section className="ordersDrawerSection"><h3>Entrega</h3><div className="ordersAddress"><MapPin size={17}/><div><strong>{order.customerName||text(order.shippingAddress.name)||'Cliente'}</strong><span>{addressLine(order.shippingAddress)}</span>{order.customerPhone&&<small>{order.customerPhone}</small>}</div></div></section>
      <section className="ordersDrawerSection"><div className="ordersSectionHead"><h3>Contenido</h3><span>{order.items.length} línea{order.items.length===1?'':'s'}</span></div>{order.items.length?<div className="ordersItems">{order.items.map((item,index)=><div key={`${itemLabel(item)}-${index}`}><div><strong>{itemLabel(item)}</strong><span>{text(item.sku)||text(item.ean)||text(item.product_id)||''}</span></div><b>x{itemQty(item)}</b></div>)}</div>:<div className="masterEmptyMini">Sendcloud no ha devuelto líneas para este pedido.</div>}</section>
      {labelled&&<section className="ordersDrawerSection"><h3>Expedición</h3><div className="ordersShipmentInfo"><div><span>Tracking</span><strong>{order.trackingNumber||'Pendiente'}</strong></div><div><span>Servicio</span><strong>{order.shippingOptionCode||'Sendcloud'}</strong></div>{order.trackingUrl&&<a href={order.trackingUrl} target="_blank" rel="noreferrer">Abrir seguimiento <ExternalLink size={14}/></a>}</div></section>}
      <div className="ordersDrawerActions">{labelled?<><button className="secondary" disabled={busy} onClick={onDownload}><Download size={16}/> Descargar</button><button className="primary" disabled={busy} onClick={onPrint}><Printer size={16}/> Imprimir</button></>:canPrepare?<button className="primary full" disabled={busy} onClick={onPrepare}>{busy?<LoaderCircle className="spin" size={16}/>:<Truck size={16}/>} Preparar etiqueta</button>:<div className={`ordersNoAction ${state.className}`}><AlertCircle size={16}/><span>{isCancelledOrder(order)?'Pedido cancelado en la tienda. No se puede generar etiqueta.':'Este pedido ya está procesado y no necesita una nueva etiqueta.'}</span></div>}</div>
    </aside>
  </div>;
}

function LabelModal({order,options,loading,onClose,onCreate}:{order:FulfillmentOrder;options:ShippingOption[];loading:boolean;onClose:()=>void;onCreate:(option:ShippingOption|null)=>void}){
  const preferred=options.filter(option=>preferredCarrier(option));
  const grouped={correos:preferred.filter(option=>preferredCarrier(option)==='correos'),mrw:preferred.filter(option=>preferredCarrier(option)==='mrw')};
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal ordersLabelModal">
    <div className="modalHead"><div><h3>Crear etiqueta · {order.orderNumber||order.orderId}</h3><p>Elige Correos o MRW. También puedes dejar que Sendcloud aplique las reglas y valores predeterminados que ya tienes configurados.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="ordersLabelBody">{loading?<div className="ordersOptionsLoading"><LoaderCircle className="spin"/><span>Consultando servicios disponibles…</span></div>:<>
      <div className="ordersCarrierGrid">
        {(['correos','mrw'] as const).map(carrier=><section className="ordersCarrierCard" key={carrier}><div className="ordersCarrierHead"><Truck size={18}/><div><strong>{carrier==='correos'?'Correos':'MRW'}</strong><span>{carrier==='correos'?'Tarifas de Sendcloud':'Contrato propio conectado en Sendcloud'}</span></div></div>{grouped[carrier].length?<div className="ordersOptionList">{grouped[carrier].map(option=><button key={`${option.code}-${option.contractId||''}`} onClick={()=>onCreate(option)}><div><strong>{option.name}</strong><small>{option.code}</small></div><span>{option.price==null?'Elegir':money(option.price,option.currency||'EUR')}</span></button>)}</div>:<div className="ordersNoOption">No aparece ningún servicio {carrier==='correos'?'de Correos':'de MRW'} disponible para este pedido.</div>}</section>)}
      </div>
      <button className="secondary ordersRulesButton" onClick={()=>onCreate(null)}><Settings2 size={16}/><span><strong>Usar reglas de Sendcloud</strong><small>Respeta el método del pedido, reglas de envío y valores predeterminados.</small></span><ChevronRight size={17}/></button>
    </>}</div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button></div>
  </section></div>;
}

export function Orders(){
  const [orders,setOrders]=useState<FulfillmentOrder[]>([]);
  const [status,setStatus]=useState<SendcloudStatus|null>(null);
  const [loading,setLoading]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [channel,setChannel]=useState<'all'|'amazon'|'shopify'>('all');
  const [state,setState]=useState<'pending'|'labelled'|'cancelled'|'all'>('pending');
  const [selected,setSelected]=useState<FulfillmentOrder|null>(null);
  const [labelOrder,setLabelOrder]=useState<FulfillmentOrder|null>(null);
  const [options,setOptions]=useState<ShippingOption[]>([]);
  const [optionsLoading,setOptionsLoading]=useState(false);
  const [busyOrder,setBusyOrder]=useState<string|null>(null);
  const [printers,setPrinters]=useState<LocalPrinter[]>([]);
  const [printer,setPrinter]=useState(getSavedPrinter());
  const [printerChecking,setPrinterChecking]=useState(false);

  const refresh=useCallback(async()=>{try{setOrders(await listFulfillmentOrders())}catch(e){setError(errorMessage(e,'No se pudieron cargar los pedidos.'))}},[]);
  const refreshStatus=useCallback(async()=>{try{setStatus(await getSendcloudStatus())}catch(e){setStatus({configured:false,integrations:[],message:errorMessage(e,'No se pudo comprobar Sendcloud.')})}},[]);

  useEffect(()=>{(async()=>{setLoading(true);await Promise.all([refresh(),refreshStatus()]);setLoading(false)})()},[refresh,refreshStatus]);

  const sync=useCallback(async(silent=false)=>{
    if(syncing)return;
    setSyncing(true);if(!silent)setError('');
    try{const result=await syncSendcloudOrders();setStatus({configured:true,integrations:result.integrations});await refresh();if(!silent)showSuccess(`${result.synced} pedido${result.synced===1?'':'s'} sincronizado${result.synced===1?'':'s'} desde Sendcloud.`)}
    catch(e){const message=errorMessage(e,'No se pudieron actualizar los pedidos desde Sendcloud.');if(!silent){setError(message);showError(message)}}finally{setSyncing(false)}
  },[refresh,syncing]);

  useEffect(()=>{if(!status?.configured)return;void sync(true);const timer=window.setInterval(()=>void sync(true),60000);return()=>window.clearInterval(timer)},[status?.configured]);

  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return orders.filter(order=>{
      if(channel!=='all'&&order.sourceChannel!==channel)return false;
      if(state==='pending'&&!isPendingOrder(order))return false;
      if(state==='labelled'&&!order.sendcloudParcelId)return false;
      if(state==='cancelled'&&!isCancelledOrder(order))return false;
      if(q&&!`${order.orderNumber||''} ${order.orderId||''} ${order.customerName||''} ${order.trackingNumber||''}`.toLowerCase().includes(q))return false;
      return true;
    });
  },[orders,query,channel,state]);

  const pending=orders.filter(isPendingOrder).length;
  const amazon=orders.filter(order=>order.sourceChannel==='amazon'&&isPendingOrder(order)).length;
  const shopify=orders.filter(order=>order.sourceChannel==='shopify'&&isPendingOrder(order)).length;
  const labelled=orders.filter(order=>Boolean(order.sendcloudParcelId)).length;
  const cancelled=orders.filter(isCancelledOrder).length;

  const prepare=async(order:FulfillmentOrder)=>{
    if(!canPrepareOrder(order)){showError('Este pedido ya no admite una nueva etiqueta.');return;}
    setLabelOrder(order);setOptions([]);setOptionsLoading(true);setError('');
    try{setOptions(await getShippingOptions(order.id))}catch(e){const message=errorMessage(e,'No se pudieron consultar los servicios de envío.');setError(message);showError(message)}finally{setOptionsLoading(false)}
  };

  const handleBlob=async(blob:Blob,order:FulfillmentOrder,mode:'print'|'download')=>{
    if(mode==='download'){downloadLabel(blob,order.orderNumber);return;}
    if(printer){try{await printLabelWithClient(blob,printer);showSuccess('Etiqueta enviada a la impresora.');return}catch{/* usamos visor PDF como respaldo */}}
    openLabelForPrint(blob);
  };

  const createLabel=async(option:ShippingOption|null)=>{
    if(!labelOrder)return;
    const order=labelOrder;setBusyOrder(order.id);setLabelOrder(null);setError('');
    try{const result=await createOrderLabel(order.id,option);const blob=labelBlob(result);await refresh();const updated=(await listFulfillmentOrders()).find(item=>item.id===order.id)||order;setOrders(await listFulfillmentOrders());setSelected(updated);showSuccess(`Etiqueta creada${result.trackingNumber?` · ${result.trackingNumber}`:''}.`);await handleBlob(blob,updated,'print')}
    catch(e){const message=errorMessage(e,'No se pudo crear la etiqueta.');setError(message);showError(message)}finally{setBusyOrder(null)}
  };

  const getExistingLabel=async(order:FulfillmentOrder,mode:'print'|'download')=>{
    setBusyOrder(order.id);setError('');
    try{const result=await fetchOrderLabel(order.id);await handleBlob(labelBlob(result),order,mode)}catch(e){const message=errorMessage(e,'No se pudo recuperar la etiqueta.');setError(message);showError(message)}finally{setBusyOrder(null)}
  };

  const detectPrinters=async()=>{
    setPrinterChecking(true);
    try{const found=await listLocalPrinters();setPrinters(found);const chosen=printer||found.find(item=>item.default)?.id||found[0]?.id||'';setPrinter(chosen);savePrinter(chosen);showSuccess(found.length?`${found.length} impresora${found.length===1?'':'s'} detectada${found.length===1?'':'s'}.`:'No se han encontrado impresoras.')}
    catch{setPrinters([]);showError('No se detecta el Print Client de Sendcloud. Puedes seguir imprimiendo desde el PDF.')}finally{setPrinterChecking(false)}
  };

  return <div className="page ordersPage">
    <div className="pageHead"><div><div className="eyebrow">LOGÍSTICA</div><h1>Pedidos</h1><p>Pedidos de Amazon y Shopify, preparación de etiquetas y seguimiento desde un único sitio.</p></div><div className="actions"><button className="secondary" onClick={detectPrinters} disabled={printerChecking}>{printerChecking?<LoaderCircle className="spin" size={16}/>:<Printer size={16}/>} Impresora</button><button className="primary" onClick={()=>sync(false)} disabled={syncing||!status?.configured}>{syncing?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} Actualizar pedidos</button></div></div>

    {status&&!status.configured&&<section className="card ordersSetup"><AlertCircle/><div><h3>Falta conectar la API de Sendcloud</h3><p>El módulo ya está preparado para leer los pedidos que Sendcloud recibe de Amazon y Shopify y generar sus etiquetas. Solo faltan las claves <strong>Public</strong> y <strong>Secret</strong> de una integración “Sendcloud API”.</p><small>Se guardarán como secretos del backend; nunca se expondrán en el navegador.</small></div></section>}
    {status?.configured&&<section className="ordersConnection"><CheckCircle2 size={16}/><span>Sendcloud conectado</span><small>{status.integrations.filter(item=>item.channel==='amazon'||item.channel==='shopify').map(item=>item.shopName||item.type).join(' · ')||'Integraciones disponibles'}</small></section>}
    {error&&<div className="errorBox"><AlertCircle size={17}/>{error}</div>}

    <div className="stats ordersStats"><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Pendientes</span><strong>{pending}</strong><small>Sin etiqueta</small></div></div><div className="stat"><div className="statIcon"><Store/></div><div><span>Amazon</span><strong>{amazon}</strong><small>Pendientes</small></div></div><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Shopify</span><strong>{shopify}</strong><small>Pendientes</small></div></div><div className="stat"><div className="statIcon"><PackageCheck/></div><div><span>Etiquetados</span><strong>{labelled}</strong><small>Preparados desde ZENVIA</small></div></div><div className="stat"><div className="statIcon"><AlertCircle/></div><div><span>Cancelados</span><strong>{cancelled}</strong><small>Últimos 30 días</small></div></div></div>

    <div className="ordersToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar pedido, cliente o tracking…"/></div><div className="ordersFilterGroup"><button className={state==='pending'?'active':''} onClick={()=>setState('pending')}>Pendientes</button><button className={state==='labelled'?'active':''} onClick={()=>setState('labelled')}>Etiquetados</button><button className={state==='cancelled'?'active':''} onClick={()=>setState('cancelled')}>Cancelados</button><button className={state==='all'?'active':''} onClick={()=>setState('all')}>Todos</button></div><div className="ordersFilterGroup"><button className={channel==='all'?'active':''} onClick={()=>setChannel('all')}>Todos</button><button className={channel==='amazon'?'active':''} onClick={()=>setChannel('amazon')}>Amazon</button><button className={channel==='shopify'?'active':''} onClick={()=>setChannel('shopify')}>Shopify</button></div></div>

    {printer&&<div className="ordersPrinterBar"><Printer size={15}/><span>Impresora directa:</span>{printers.length?<select value={printer} onChange={e=>{setPrinter(e.target.value);savePrinter(e.target.value)}}>{printers.map(item=><option key={item.id} value={item.id}>{item.name}{item.default?' · predeterminada':''}</option>)}</select>:<strong>{printer}</strong>}<button className="link" onClick={()=>{setPrinter('');savePrinter('')}}>Usar PDF</button></div>}

    <section className="card tableCard ordersTableCard">{loading?<div className="emptyState large"><LoaderCircle className="spin"/> Cargando pedidos…</div>:filtered.length?<table className="ordersTable"><thead><tr><th>Canal</th><th>Pedido</th><th>Cliente</th><th>Destino</th><th className="right">Unidades</th><th className="right">Total</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>{filtered.map(order=>{const stateInfo=orderState(order);return <tr key={order.id} className="clickableRow" onClick={()=>setSelected(order)}><td><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order.sourceChannel)}</span></td><td><strong>{order.orderNumber||order.orderId||order.sendcloudId}</strong><small>{order.integrationName||''}</small></td><td>{order.customerName||text(order.shippingAddress.name)||'—'}</td><td>{text(order.shippingAddress.country_code)||'—'} · {text(order.shippingAddress.postal_code)||''}</td><td className="right"><strong>{order.items.reduce((sum,item)=>sum+itemQty(item),0)}</strong></td><td className="right"><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></td><td><span className={`ordersState ${stateInfo.className}`}>{stateInfo.className==='ready'?<PackageCheck size={13}/>:stateInfo.className==='pending'?<Truck size={13}/>:<AlertCircle size={13}/>} {stateInfo.label}</span></td><td>{dateLabel(order.orderCreatedAt)}</td><td className="right"><ChevronRight size={17}/></td></tr>})}</tbody></table>:<div className="emptyState large">{status?.configured?'No hay pedidos para estos filtros.':'Cuando conectemos Sendcloud aparecerán aquí los pedidos de Amazon y Shopify.'}</div>}</section>

    <div className="ordersMobileList">{filtered.map(order=>{const stateInfo=orderState(order);return <button className="card ordersMobileRow" key={order.id} onClick={()=>setSelected(order)}><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order.sourceChannel)}</span><strong>{order.orderNumber||order.orderId}</strong><small>{order.customerName||text(order.shippingAddress.name)||'Cliente'} · {text(order.shippingAddress.country_code)}</small></div><div><b>{money(order.totalAmount,order.currency||'EUR')}</b><span className={`ordersState ${stateInfo.className}`}>{stateInfo.label}</span></div><ChevronRight size={18}/></button>})}</div>

    {selected&&<OrderDrawer order={orders.find(item=>item.id===selected.id)||selected} onClose={()=>setSelected(null)} onPrepare={()=>prepare(orders.find(item=>item.id===selected.id)||selected)} onPrint={()=>getExistingLabel(orders.find(item=>item.id===selected.id)||selected,'print')} onDownload={()=>getExistingLabel(orders.find(item=>item.id===selected.id)||selected,'download')} busy={busyOrder===selected.id}/>} 
    {labelOrder&&<LabelModal order={labelOrder} options={options} loading={optionsLoading} onClose={()=>setLabelOrder(null)} onCreate={createLabel}/>} 
  </div>;
}