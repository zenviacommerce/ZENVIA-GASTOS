import { useEffect, useState } from 'react';
import { Link2, Search } from 'lucide-react';
import { loadAmazonProducts, type AmazonAnalyticsFilters, type AmazonPageResult, type AmazonProductAnalytics } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { AmazonMappingEditor } from './AmazonMappingEditor';

const money=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'});
export function AmazonProducts({filters}:{filters:AmazonAnalyticsFilters}){
  const [data,setData]=useState<AmazonPageResult<AmazonProductAnalytics>>({items:[],page:1,pageSize:25,total:0});const [search,setSearch]=useState('');const [page,setPage]=useState(1);const [editing,setEditing]=useState<string|null>(null);const [error,setError]=useState('');
  const refresh=()=>loadAmazonProducts(filters,search,page,25).then(setData).catch(e=>setError(errorMessage(e,'No se pudieron cargar los productos.')));
  useEffect(()=>{void refresh();},[filters.from,filters.to,filters.marketplaceIds.join(','),search,page]);
  const editingRow=editing?data.items.find(row=>row.sellerSku===editing):undefined;
  return <section className="card amazonTableCard"><div className="amazonTableToolbar"><div><span className="amazonSectionLabel">RENTABILIDAD POR PRODUCTO</span><strong>Productos</strong></div><label className="amazonSearch"><Search size={16}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Buscar SKU, ASIN o producto"/></label></div>{error&&<p className="amazonError">{error}</p>}<div className="amazonTableScroll"><table className="amazonTable"><thead><tr><th>SKU</th><th>Producto</th><th>Unidades</th><th>Ventas</th><th>Coste</th><th>Tarifas</th><th>Reembolsos</th><th>Beneficio</th><th>Margen</th><th></th></tr></thead><tbody>{data.items.map(row=><tr key={`${row.sellerSku}-${row.asin}`}><td><strong>{row.sellerSku}</strong><small>{row.asin||'—'}</small></td><td>{row.productName||<span className="amazonIncomplete">Sin vincular</span>}</td><td>{row.units}</td><td>{money.format(row.netSales)}</td><td>{money.format(row.productCost)}</td><td>{money.format(row.amazonFees)}</td><td>{money.format(row.refunds)}</td><td>{money.format(row.profitBeforeAds)}{!row.profitComplete&&<small className="amazonIncomplete">Incompleto</small>}</td><td>{row.marginPct==null?'—':`${row.marginPct.toFixed(1)} %`}</td><td><button className="amazonInlineAction" onClick={()=>setEditing(editing===row.sellerSku?null:row.sellerSku)}><Link2 size={14}/>{row.productId?'Cambiar vínculo':'Vincular'}</button></td></tr>)}{!data.items.length&&<tr><td colSpan={10} className="amazonEmptyCell">No hay productos para este periodo.</td></tr>}</tbody></table></div>
    {editing&&<div className="amazonInlineEditor"><AmazonMappingEditor sellerSku={editing} initialProductId={editingRow?.productId} initialFactor={editingRow?.consumptionFactor||1} allowDelete={Boolean(editingRow?.productId)} onSaved={()=>{setEditing(null);void refresh();}} onCancel={()=>setEditing(null)}/></div>}
    <div className="amazonPagination"><span>{data.total} productos</span><div><button disabled={page<=1} onClick={()=>setPage(value=>value-1)}>Anterior</button><span>Página {page}</span><button disabled={page*25>=data.total} onClick={()=>setPage(value=>value+1)}>Siguiente</button></div></div>
  </section>;
}
