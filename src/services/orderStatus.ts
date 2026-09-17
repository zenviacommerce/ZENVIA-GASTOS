import type { FulfillmentOrder } from './orders';

export function orderStatusCode(order:FulfillmentOrder){
  return String(order.sourceStatus||'').trim().toLowerCase();
}

export function isCancelledOrder(order:FulfillmentOrder){
  return orderStatusCode(order).includes('cancel');
}

export function isReadyForDispatch(order:FulfillmentOrder){
  if(!order.sendcloudParcelId)return false;
  const raw=`${order.trackingStatusCode||''} ${order.trackingStatusMessage||''}`.toLowerCase().replace(/[_-]+/g,' ');
  return raw.includes('ready to send')||raw.includes('ready for shipment')||raw.includes('announced')||raw.includes('being announced')||raw.includes('no label');
}

export function isProcessedOrder(order:FulfillmentOrder){
  if(isReadyForDispatch(order))return false;
  const status=orderStatusCode(order);
  return status==='fulfilled'||status==='shipped'||status==='delivered';
}

export function isLabelledOrder(order:FulfillmentOrder){
  return Boolean(order.sendcloudParcelId)&&!isCancelledOrder(order)&&!isProcessedOrder(order);
}

export function isPendingOrder(order:FulfillmentOrder){
  const status=orderStatusCode(order);
  if(order.sourceChannel==='amazon'){
    if(status==='pending'||status==='pending_availability')return false;
    if(status==='unshipped')return !order.sendcloudParcelId&&!isCancelledOrder(order)&&!isProcessedOrder(order);
  }
  return !order.sendcloudParcelId&&!isCancelledOrder(order)&&!isProcessedOrder(order);
}
