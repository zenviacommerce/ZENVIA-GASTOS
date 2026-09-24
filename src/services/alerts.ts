import type { NotificationsSettings, NotificationSetting } from './settingsSchema';
import type { IntegrationHealth } from './integrations';

export type AlertType=keyof NotificationsSettings;
export type AlertPage='sales'|'invoices'|'orders'|'amazon'|'products'|'clients'|'suppliers'|'settings';

export type AlertSalesInvoice={
  id:string;
  invoiceNumber?:string|null;
  clientName?:string|null;
  status:string;
  dueDate?:string|null;
  totalAmount:number;
  paidAmount:number;
};

export type AlertExpenseInvoice={
  id:string;
  invoiceNumber?:string|null;
  supplierName?:string|null;
  status:string;
  invoiceDate?:string|null;
};

export type AlertOrder={
  id:string;
  orderNumber?:string|null;
  sourceChannel?:string|null;
  sourceStatus?:string|null;
  orderCreatedAt?:string|null;
  trackingNumber?:string|null;
  labelCreatedAt?:string|null;
  fulfilledAt?:string|null;
};

export type AlertProduct={
  id:string;
  name:string;
  lastPrice?:number|null;
  previousPrice?:number|null;
  salePrice?:number|null;
};

export type AlertParty={id:string;name:string;taxId?:string|null};

export type AlertContext={
  now?:Date|string;
  salesInvoices:AlertSalesInvoice[];
  expenseInvoices:AlertExpenseInvoice[];
  orders:AlertOrder[];
  products:AlertProduct[];
  clients:AlertParty[];
  suppliers:AlertParty[];
  integrations:IntegrationHealth[];
};

export type AppAlert={
  id:string;
  type:AlertType;
  entityId:string;
  severity:'info'|'warning'|'error';
  title:string;
  message:string;
  page:AlertPage;
};

function dateValue(value:Date|string|undefined|null){
  if(value instanceof Date)return Number.isFinite(value.getTime())?value:null;
  if(!value)return null;
  const parsed=new Date(value);
  return Number.isFinite(parsed.getTime())?parsed:null;
}

export function daysBetween(from:Date|string,to:Date|string){
  const start=dateValue(from),end=dateValue(to);
  if(!start||!end)return 0;
  return Math.max(0,Math.floor((end.getTime()-start.getTime())/86400000));
}

export function hoursBetween(from:Date|string,to:Date|string){
  const start=dateValue(from),end=dateValue(to);
  if(!start||!end)return 0;
  return Math.max(0,(end.getTime()-start.getTime())/3600000);
}

export function stableAlertId(type:AlertType,entityId:string){
  return `${type}:${entityId}`;
}
export function alertFingerprint(alert:Pick<AppAlert,'severity'|'title'|'message'|'page'>){
  return [alert.severity,alert.page,alert.title,alert.message].join('|');
}


function settingEnabled(setting:NotificationSetting){
  return setting.enabled&&setting.inApp;
}

function threshold(setting:NotificationSetting,fallback:number){
  return setting.threshold==null?fallback:Number(setting.threshold);
}

function addAlert(
  output:AppAlert[],
  settings:NotificationsSettings,
  type:AlertType,
  entityId:string,
  alert:Omit<AppAlert,'id'|'type'|'entityId'>,
){
  const setting=settings[type];
  if(!setting.enabled||!setting.inApp)return;
  output.push({id:stableAlertId(type,entityId),type,entityId,...alert});
}

function clean(value:unknown){return String(value??'').trim();}
function money(value:number){return value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';}
function isClosedOrder(status:unknown){
  const value=clean(status).toLowerCase();
  return value.includes('cancel')||['fulfilled','shipped','delivered','processed','completed'].includes(value);
}
function orderLabel(order:AlertOrder){return clean(order.orderNumber)||order.id;}
function invoiceLabel(number:unknown,id:string){return clean(number)||id;}

export function evaluateAlerts(context:AlertContext,settings:NotificationsSettings):AppAlert[]{
  const output:AppAlert[]=[];
  const now=dateValue(context.now)||new Date();

  const overdueSetting=settings.overdueSalesInvoice;
  if(settingEnabled(overdueSetting)){
    const minimumDays=Math.max(0,threshold(overdueSetting,0));
    for(const invoice of context.salesInvoices){
      if(['draft','paid','rectified'].includes(clean(invoice.status).toLowerCase()))continue;
      const due=dateValue(invoice.dueDate);
      const outstanding=Math.max(0,Number(invoice.totalAmount||0)-Number(invoice.paidAmount||0));
      if(!due||due.getTime()>=now.getTime()||outstanding<=0.009)continue;
      const overdueDays=daysBetween(due,now);
      if(overdueDays<minimumDays)continue;
      addAlert(output,settings,'overdueSalesInvoice',invoice.id,{
        severity:'warning',page:'sales',
        title:'Factura de venta vencida',
        message:`${invoiceLabel(invoice.invoiceNumber,invoice.id)} · ${clean(invoice.clientName)||'Cliente'} · ${money(outstanding)} pendientes · ${overdueDays} día${overdueDays===1?'':'s'} de retraso.`,
      });
    }
  }

  const reviewSetting=settings.pendingExpenseReview;
  if(settingEnabled(reviewSetting)){
    const minimumDays=Math.max(0,threshold(reviewSetting,0));
    for(const invoice of context.expenseInvoices){
      if(clean(invoice.status).toLowerCase()!=='pending')continue;
      const age=invoice.invoiceDate?daysBetween(invoice.invoiceDate,now):0;
      if(age<minimumDays)continue;
      addAlert(output,settings,'pendingExpenseReview',invoice.id,{
        severity:'info',page:'invoices',
        title:'Gasto pendiente de revisión',
        message:`${invoiceLabel(invoice.invoiceNumber,invoice.id)} · ${clean(invoice.supplierName)||'Proveedor'}${invoice.invoiceDate?` · ${age} día${age===1?'':'s'} pendiente`:''}.`,
      });
    }
  }

  const pendingSetting=settings.pendingOrder;
  if(settingEnabled(pendingSetting)){
    const minimumHours=Math.max(0,threshold(pendingSetting,24));
    for(const order of context.orders){
      if(isClosedOrder(order.sourceStatus)||order.fulfilledAt)continue;
      const created=dateValue(order.orderCreatedAt);
      if(!created)continue;
      const age=hoursBetween(created,now);
      if(age<minimumHours)continue;
      addAlert(output,settings,'pendingOrder',order.id,{
        severity:'warning',page:'orders',
        title:'Pedido pendiente',
        message:`${orderLabel(order)} · ${Math.floor(age)} h sin completar${order.sourceChannel?` · ${order.sourceChannel}`:''}.`,
      });
    }
  }

  const trackingSetting=settings.missingTracking;
  if(settingEnabled(trackingSetting)){
    const minimumHours=Math.max(0,threshold(trackingSetting,0));
    for(const order of context.orders){
      if(clean(order.trackingNumber))continue;
      const reference=order.labelCreatedAt||order.fulfilledAt||
        (['shipped','fulfilled','delivered','processed','completed'].includes(clean(order.sourceStatus).toLowerCase())?order.orderCreatedAt:null);
      if(!reference)continue;
      const age=hoursBetween(reference,now);
      if(age<minimumHours)continue;
      addAlert(output,settings,'missingTracking',order.id,{
        severity:'warning',page:'orders',
        title:'Pedido sin seguimiento',
        message:`${orderLabel(order)} tiene etiqueta o estado de envío, pero no número de seguimiento.`,
      });
    }
  }

  const integrationAlert=(id:'amazon'|'sendcloud'|'gmail',type:'amazonError'|'sendcloudError'|'gmailError')=>{
    const integration=context.integrations.find(item=>item.id===id);
    if(!integration?.enabled||!integration.lastError)return;
    addAlert(output,settings,type,id,{
      severity:'error',page:id==='amazon'?'amazon':'settings',
      title:`Error de ${id==='amazon'?'Amazon':id==='sendcloud'?'Sendcloud':'Gmail'}`,
      message:integration.lastError,
    });
  };
  integrationAlert('amazon','amazonError');
  integrationAlert('sendcloud','sendcloudError');
  integrationAlert('gmail','gmailError');

  if(settingEnabled(settings.productWithoutCost)){
    for(const product of context.products){
      if(product.lastPrice!=null&&Number(product.lastPrice)>0)continue;
      addAlert(output,settings,'productWithoutCost',product.id,{
        severity:'warning',page:'products',
        title:'Producto sin coste',
        message:`${product.name||product.id} no tiene un coste de compra válido.`,
      });
    }
  }

  if(settingEnabled(settings.negativeMargin)){
    const minimumMargin=threshold(settings.negativeMargin,0);
    for(const product of context.products){
      const cost=Number(product.lastPrice),sale=Number(product.salePrice);
      if(!Number.isFinite(cost)||!Number.isFinite(sale)||sale<=0||cost<0)continue;
      const marginPct=((sale-cost)/sale)*100;
      if(marginPct>minimumMargin)continue;
      addAlert(output,settings,'negativeMargin',product.id,{
        severity:'warning',page:'products',
        title:'Margen bajo o negativo',
        message:`${product.name||product.id} · margen estimado ${marginPct.toFixed(1)} % (umbral ${minimumMargin.toFixed(1)} %).`,
      });
    }
  }

  if(settingEnabled(settings.costIncrease)){
    const minimumIncrease=Math.max(0,threshold(settings.costIncrease,10));
    for(const product of context.products){
      const current=Number(product.lastPrice),previous=Number(product.previousPrice);
      if(!Number.isFinite(current)||!Number.isFinite(previous)||previous<=0||current<=previous)continue;
      const increasePct=((current-previous)/previous)*100;
      if(increasePct<minimumIncrease)continue;
      addAlert(output,settings,'costIncrease',product.id,{
        severity:'warning',page:'products',
        title:'Subida de coste',
        message:`${product.name||product.id} · +${increasePct.toFixed(1)} % respecto al coste anterior.`,
      });
    }
  }

  if(settingEnabled(settings.clientMissingTaxId)){
    for(const client of context.clients){
      if(clean(client.taxId))continue;
      addAlert(output,settings,'clientMissingTaxId',client.id,{
        severity:'info',page:'clients',
        title:'Cliente sin identificación fiscal',
        message:`${client.name||client.id} no tiene NIF/VAT informado.`,
      });
    }
  }

  if(settingEnabled(settings.supplierMissingTaxId)){
    for(const supplier of context.suppliers){
      if(clean(supplier.taxId))continue;
      addAlert(output,settings,'supplierMissingTaxId',supplier.id,{
        severity:'info',page:'suppliers',
        title:'Proveedor sin identificación fiscal',
        message:`${supplier.name||supplier.id} no tiene NIF/VAT informado.`,
      });
    }
  }

  return output.sort((a,b)=>{
    const weight={error:0,warning:1,info:2};
    const bySeverity=weight[a.severity]-weight[b.severity];
    return bySeverity||a.id.localeCompare(b.id);
  });
}
