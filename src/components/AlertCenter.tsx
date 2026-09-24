import { useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, CircleAlert, RefreshCw, Trash2, X } from 'lucide-react';
import type { Invoice, Product, Supplier } from '../types';
import type { NotificationsSettings } from '../services/settingsSchema';
import { loadClients, loadSalesInvoices } from '../services/sales';
import { listFulfillmentOrders } from '../services/orders';
import { loadIntegrationHealth } from '../services/integrations';
import { alertFingerprint, evaluateAlerts, type AlertPage, type AppAlert } from '../services/alerts';
import { useSettings } from '../context/SettingsContext';
import { formatAppDateTime } from '../services/formatting';

export function AlertCenter({
  notifications,
  invoices,
  products,
  suppliers,
  onNavigate,
  canNavigate,
}:{
  notifications:NotificationsSettings;
  invoices:Invoice[];
  products:Product[];
  suppliers:Supplier[];
  onNavigate:(page:AlertPage)=>void;
  canNavigate?:(page:AlertPage)=>boolean;
}){
  const {settings,preferences,patchPreferences}=useSettings();
  const [open,setOpen]=useState(false);
  const [alerts,setAlerts]=useState<AppAlert[]>([]);
  const [loading,setLoading]=useState(false);
  const [lastRefresh,setLastRefresh]=useState<string|null>(null);

  const refresh=async()=>{
    setLoading(true);
    try{
      const [salesInvoices,orders,clients,integrations]=await Promise.all([
        loadSalesInvoices(),
        listFulfillmentOrders(),
        loadClients(),
        loadIntegrationHealth(settings.integrations),
      ]);
      const next=evaluateAlerts({
        salesInvoices:salesInvoices.map(invoice=>({
          id:invoice.id,invoiceNumber:invoice.invoiceNumber,clientName:invoice.clientName,status:invoice.status,
          dueDate:invoice.dueDate,totalAmount:invoice.totalAmount,paidAmount:invoice.paidAmount,
        })),
        expenseInvoices:invoices.map(invoice=>({
          id:invoice.id,invoiceNumber:invoice.invoiceNumber,supplierName:invoice.supplierName,status:invoice.status,invoiceDate:invoice.invoiceDate,
        })),
        orders:orders.map(order=>({
          id:order.id,orderNumber:order.orderNumber,sourceChannel:order.sourceChannel,sourceStatus:order.sourceStatus,
          orderCreatedAt:order.orderCreatedAt,trackingNumber:order.trackingNumber,labelCreatedAt:order.labelCreatedAt,fulfilledAt:order.fulfilledAt,
        })),
        products:products.map(product=>({
          id:product.id,name:product.name,lastPrice:product.lastPrice,previousPrice:product.previousPrice,salePrice:product.salePrice,
        })),
        clients:clients.map(client=>({id:client.id,name:client.name,taxId:client.taxId})),
        suppliers:suppliers.map(supplier=>({id:supplier.id,name:supplier.name,taxId:supplier.taxId})),
        integrations,
      },notifications);
      setAlerts(next);
      setLastRefresh(new Date().toISOString());
    }catch{
      // Keep the latest valid set if one source has a transient failure.
    }finally{setLoading(false);}
  };

  useEffect(()=>{
    let cancelled=false;
    const run=async()=>{if(!cancelled)await refresh();};
    void run();
    const timer=window.setInterval(()=>void run(),300000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[notifications,invoices,products,suppliers,settings.integrations]);

  const visibleAlerts=useMemo(()=>alerts.filter(item=>preferences.dismissedAlerts[item.id]!==alertFingerprint(item)),[alerts,preferences.dismissedAlerts]);
  const counts=useMemo(()=>({
    errors:visibleAlerts.filter(item=>item.severity==='error').length,
    warnings:visibleAlerts.filter(item=>item.severity==='warning').length,
  }),[visibleAlerts]);

  const clearAlerts=async()=>{
    if(!visibleAlerts.length)return;
    const dismissed={...preferences.dismissedAlerts};
    for(const alert of visibleAlerts)dismissed[alert.id]=alertFingerprint(alert);
    await patchPreferences({dismissedAlerts:dismissed});
  };

  const navigate=(alert:AppAlert)=>{
    if(canNavigate&&!canNavigate(alert.page))return;
    onNavigate(alert.page);
    setOpen(false);
  };

  return <div className="alertCenter">
    <button
      type="button"
      className="alertCenterTrigger"
      aria-label={visibleAlerts.length?String(visibleAlerts.length)+' alertas':'Sin alertas'}
      title="Alertas"
      onClick={()=>setOpen(value=>!value)}
    >
      <Bell size={19}/>
      {visibleAlerts.length>0&&<span className="alertCenterCount">{visibleAlerts.length>99?'99+':visibleAlerts.length}</span>}
    </button>
    {open&&<div className="alertCenterPanel" role="dialog" aria-label="Centro de alertas">
      <div className="alertCenterHeader">
        <div>
          <strong>Alertas</strong>
          <small>{visibleAlerts.length?String(visibleAlerts.length)+' activas · '+String(counts.errors)+' críticas · '+String(counts.warnings)+' avisos':'Todo al día'}</small>
        </div>
        <div className="alertCenterHeaderActions">
          <button type="button" onClick={()=>void refresh()} disabled={loading} aria-label="Actualizar alertas"><RefreshCw size={16} className={loading?'spin':undefined}/></button>
          <button type="button" onClick={()=>setOpen(false)} aria-label="Cerrar alertas"><X size={17}/></button>
        </div>
      </div>
      <div className="alertCenterBody">
        {!visibleAlerts.length?<div className="alertCenterEmpty"><CheckCircle2 size={22}/><strong>Sin alertas activas</strong><span>No hay incidencias que cumplan los criterios configurados.</span></div>:
        visibleAlerts.map(alert=>{
          const actionable=!canNavigate||canNavigate(alert.page);
          return <button
            type="button"
            key={alert.id}
            className={'alertCenterItem alertCenterItem--'+alert.severity}
            disabled={!actionable}
            onClick={()=>navigate(alert)}
          >
            <CircleAlert size={17}/>
            <span><strong>{alert.title}</strong><small>{alert.message}</small></span>
          </button>;
        })}
      </div>
      <div className="alertCenterFooter">
        <small>{lastRefresh?'Actualizado '+formatAppDateTime(lastRefresh,settings.general):'Sin actualizar'}</small>
        <div className="alertCenterFooterActions">
          <button type="button" className="alertCenterClear" disabled={!visibleAlerts.length} onClick={()=>void clearAlerts()}><Trash2 size={14}/> Limpiar alertas</button>
          <button type="button" onClick={()=>{onNavigate('settings');setOpen(false)}}>Configurar alertas</button>
        </div>
      </div>
    </div>}
  </div>;
}
