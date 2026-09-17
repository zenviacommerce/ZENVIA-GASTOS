import { useEffect, useState } from 'react';
import { loadAmazonMarketplaces, type AmazonAnalyticsFilters, type AmazonMarketplaceAnalytics } from '../../services/amazon';
import { errorMessage } from '../../services/toast';

const money=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'});
export function AmazonMarketplaces({filters}:{filters:AmazonAnalyticsFilters}){
  const [items,setItems]=useState<AmazonMarketplaceAnalytics[]>([]);const [error,setError]=useState('');
  useEffect(()=>{loadAmazonMarketplaces(filters).then(result=>setItems(result.items)).catch(e=>setError(errorMessage(e,'No se pudieron cargar los marketplaces.')));},[filters.from,filters.to,filters.marketplaceIds.join(',')]);
  return <section className="card amazonTableCard"><div className="amazonTableToolbar"><div><span className="amazonSectionLabel">RENDIMIENTO POR PAÍS</span><strong>Marketplaces</strong></div></div>{error&&<p className="amazonError">{error}</p>}<div className="amazonTableScroll"><table className="amazonTable"><thead><tr><th>Marketplace</th><th>Pedidos</th><th>Unidades</th><th>Ventas</th><th>Tarifas</th><th>Coste</th><th>Beneficio</th><th>Margen</th></tr></thead><tbody>{items.map(row=><tr key={row.marketplaceId}><td><strong>{row.countryCode} · {row.name}</strong><small>{row.marketplaceId}</small></td><td>{row.orders}</td><td>{row.units}</td><td>{money.format(row.netSales)}</td><td>{money.format(row.amazonFees)}</td><td>{money.format(row.productCost)}</td><td>{money.format(row.profitBeforeAds)}{!row.profitComplete&&<small className="amazonIncomplete">Incompleto</small>}</td><td>{row.marginPct==null?'—':`${row.marginPct.toFixed(1)} %`}</td></tr>)}{!items.length&&<tr><td colSpan={8} className="amazonEmptyCell">No hay datos para este periodo.</td></tr>}</tbody></table></div></section>;
}
