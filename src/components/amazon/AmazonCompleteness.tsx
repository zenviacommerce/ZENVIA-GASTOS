import { AlertTriangle, Info } from 'lucide-react';
import type { AmazonCompleteness } from '../../services/amazon';

export function AmazonCompleteness({data}:{data:AmazonCompleteness}){
  const syncing=data.syncQueued>0||data.syncRunning>0;
  const issues:string[]=[];
  if(data.unmappedSkuCount)issues.push(`${data.unmappedSkuCount} SKU sin vincular (${data.unmappedUnits} uds.)`);
  if(data.missingHistoricalCostCount)issues.push(`${data.missingHistoricalCostCount} SKU sin coste histórico (${data.missingHistoricalCostUnits} uds.)`);
  if(data.missingFxEventCount)issues.push(`${data.missingFxEventCount} movimientos sin FX`);
  if(data.missingVatOrderCount)issues.push(`${data.missingVatOrderCount} pedidos sin IVA`);
  if(data.missingFbmShippingCostCount)issues.push(`${data.missingFbmShippingCostCount} pedidos FBM sin coste de envío`);
  if(data.syncFailed)issues.push(`${data.syncFailed} trabajos con error`);
  return <div className={`amazonQualityBanner ${data.profitComplete?'isComplete':''}`}>
    <div className="amazonQualityIcon">{data.profitComplete?<Info size={18}/>:<AlertTriangle size={18}/>}</div>
    <div><strong>{syncing?'Sincronización histórica en curso':data.profitComplete?'Datos completos para el periodo':'Beneficio incompleto'}</strong>
      {issues.length>0&&<p>{issues.join(' · ')}</p>}
      {syncing&&<p>{data.syncRunning} en curso · {data.syncQueued} en cola. Los importes conocidos se muestran, pero el periodo no se considera cerrado.</p>}
      {data.adsExcluded&&<p>Ads no incluido: el KPI es Beneficio antes de Ads hasta completar la integración publicitaria.</p>}
    </div>
  </div>;
}
