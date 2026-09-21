import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { isAmazonConnectivityError, loadAmazonMarketplaces, type AmazonAnalyticsFilters, type AmazonMarketplaceAnalytics } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';
import { useSettings } from '../../context/SettingsContext';

export function AmazonMarketplaces({filters,refreshToken=0}:{filters:AmazonAnalyticsFilters;refreshToken?:number}){
  const {settings}=useSettings();
  const money=new Intl.NumberFormat('es-ES',{style:'currency',currency:settings.amazon.consolidatedCurrency});
  const initialKey=stableCacheKey('amazon:marketplaces',filters);
  const [items,setItems]=useState<AmazonMarketplaceAnalytics[]>(()=>readViewCache<AmazonMarketplaceAnalytics[]>(initialKey)||[]);const [error,setError]=useState('');
  const refresh=()=>{const key=stableCacheKey('amazon:marketplaces',filters);const cached=readViewCache<AmazonMarketplaceAnalytics[]>(key);if(cached)setItems(cached);setError('');return loadAmazonMarketplaces(filters).then(result=>{setItems(result.items);writeViewCache(key,result.items);}).catch(e=>{if(!isAmazonConnectivityError(e))setError(errorMessage(e,'No se pudieron cargar los marketplaces.'));});};
  useEffect(()=>{void refresh();},[filters.from,filters.to,filters.marketplaceIds.join(','),refreshToken]);
  return <section className="card amazonTableCard"><div className="amazonTableToolbar"><div><span className="amazonSectionLabel">RENDIMIENTO POR PAÍS</span><strong>Marketplaces</strong></div></div>{error&&<div className="amazonQueryError amazonQueryErrorInline"><span>{error}</span><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={14}/> Reintentar</button></div>}<div className="amazonTableScroll"><table className="amazonTable"><thead><tr><th>Marketplace</th><th>Pedidos</th><th>Unidades</th><th>Ventas</th><th>Tarifas</th><th>Coste</th><th>Beneficio</th><th>Margen</th></tr></thead><tbody>{items.map(row=><tr key={row.marketplaceId}><td><strong>{row.countryCode} · {row.name}</strong><small>{row.marketplaceId}</small></td><td>{row.orders}</td><td>{row.units}</td><td>{money.format(row.netSales)}</td><td>{money.format(row.amazonFees)}</td><td>{money.format(row.productCost)}</td><td>{money.format(row.profitBeforeAds)}{!row.profitComplete&&<small className="amazonIncomplete">Incompleto</small>}</td><td>{row.marginPct==null?'—':`${row.marginPct.toFixed(1)} %`}</td></tr>)}{!items.length&&<tr><td colSpan={8} className="amazonEmptyCell">No hay datos para este periodo.</td></tr>}</tbody></table></div></section>;
}
