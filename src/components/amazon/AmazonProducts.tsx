import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ImageOff, Link2, RefreshCw, Search } from 'lucide-react';
import { isAmazonConnectivityError, loadAmazonProductMetadata, loadAmazonProducts, type AmazonAnalyticsFilters, type AmazonPageResult, type AmazonProductAnalytics, type AmazonProductMetadata, type AmazonProductSort, type AmazonSortDirection } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { AmazonMappingModal } from './AmazonMappingModal';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';
import { useSettings } from '../../context/SettingsContext';

const integer=new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
type SortableHeader={key:AmazonProductSort;label:string};

const sortableHeaders:SortableHeader[]=[
  {key:'product_name',label:'Producto'},
  {key:'orders',label:'Pedidos'},
  {key:'units',label:'Unidades'},
  {key:'gross_sales',label:'Ventas'},
  {key:'net_sales',label:'Venta neta'},
  {key:'product_cost',label:'Coste producto'},
  {key:'amazon_fees',label:'Tarifas'},
  {key:'refunds',label:'Reembolsos'},
  {key:'profit_before_ads',label:'Beneficio*'},
  {key:'margin_pct',label:'Margen*'},
];

function SortIcon({active,direction}:{active:boolean;direction:AmazonSortDirection}){
  if(!active)return <ArrowUpDown size={13}/>;
  return direction==='asc'?<ArrowUp size={13}/>:<ArrowDown size={13}/>;
}

export function AmazonProducts({filters,embedded=false,refreshToken=0}:{filters:AmazonAnalyticsFilters;embedded?:boolean;refreshToken?:number}){
  const {settings}=useSettings();
  const money=new Intl.NumberFormat('es-ES',{style:'currency',currency:settings.amazon.consolidatedCurrency});
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);
  const initialProductsKey=stableCacheKey('amazon:products',{filters,search:'',page:1,pageSize:50,sortBy:'profit_before_ads',sortDir:'desc'});
  const initialProducts=readViewCache<AmazonPageResult<AmazonProductAnalytics>>(initialProductsKey);
  const [data,setData]=useState<AmazonPageResult<AmazonProductAnalytics>>(()=>initialProducts||{items:[],page:1,pageSize:50,total:0});
  const [loading,setLoading]=useState(()=>!initialProducts);
  const [editing,setEditing]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [sortBy,setSortBy]=useState<AmazonProductSort>('profit_before_ads');
  const [sortDir,setSortDir]=useState<AmazonSortDirection>('desc');
  const [metadata,setMetadata]=useState<Record<string,AmazonProductMetadata>>({});
  const pageSize=50;

  const refresh=()=>{
    const key=stableCacheKey('amazon:products',{filters,search,page,pageSize,sortBy,sortDir});
    const cached=readViewCache<AmazonPageResult<AmazonProductAnalytics>>(key);
    if(cached)setData(cached);
    setLoading(!cached);
    setError('');
    return loadAmazonProducts(filters,search,page,pageSize,sortBy,sortDir)
      .then(next=>{setData(next);writeViewCache(key,next);})
      .catch(e=>{if(!isAmazonConnectivityError(e))setError(errorMessage(e,'No se pudieron cargar los productos.'));})
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{void refresh();},[filters.from,filters.to,filters.marketplaceIds.join(','),search,page,sortBy,sortDir,refreshToken]);
  useEffect(()=>{const asins=data.items.map(row=>row.asin).filter((value):value is string=>Boolean(value));if(!asins.length){setMetadata({});return}void loadAmazonProductMetadata(asins).then(setMetadata).catch(()=>setMetadata({}));},[data.items]);
  const editingRow=editing?data.items.find(row=>row.sellerSku===editing):undefined;

  const changeSort=(key:AmazonProductSort)=>{
    setPage(1);
    if(sortBy===key)setSortDir(value=>value==='desc'?'asc':'desc');
    else{setSortBy(key);setSortDir(key==='product_name'?'asc':'desc');}
  };

  return <section className={embedded?'card amazonTableCard amazonEmbeddedProducts':'card amazonTableCard'}>
    <div className="amazonTableToolbar">
      <div>
        <span className="amazonSectionLabel">RENTABILIDAD POR PRODUCTO</span>
        <strong>Productos</strong>
        <p>Ordena por cualquier métrica. Beneficio y margen por producto se muestran antes de publicidad y costes globales no atribuibles.</p>
      </div>
      <label className="amazonSearch"><Search size={16}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Buscar SKU, ASIN o producto"/></label>
    </div>
    {error&&!embedded&&<div className="amazonQueryError amazonQueryErrorInline"><span>{error}</span><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={14}/> Reintentar</button></div>}
    <div className="amazonTableScroll">
      <table className="amazonTable amazonProductTable">
        <thead>
          <tr>
            <th>SKU / ASIN</th>
            {sortableHeaders.map(header=><th key={header.key}>
              <button className={sortBy===header.key?'amazonSortHeader isActive':'amazonSortHeader'} onClick={()=>changeSort(header.key)}>
                <span>{header.label}</span><SortIcon active={sortBy===header.key} direction={sortDir}/>
              </button>
            </th>)}
            <th>IVA venta</th>
            <th>IVA tarifas</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.items.map(row=><tr key={`${row.sellerSku}-${row.asin}`}>
            <td className="amazonSkuCell"><strong>{row.sellerSku}</strong><small>{row.asin||'—'}</small>{row.businessOrders>0&&<span className="amazonB2bBadge">{row.businessOrders} B2B</span>}</td>
            <td className="amazonProductNameCell"><div className="amazonProductIdentity">{row.asin&&metadata[row.asin]?.imageUrl?<img className="amazonProductThumb" src={metadata[row.asin].imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="amazonProductThumb amazonProductThumbPlaceholder"><ImageOff size={18}/></span>}<div><strong>{(row.asin&&metadata[row.asin]?.productName)||'Nombre Amazon pendiente'}</strong>{row.productName?<small className="amazonInternalProduct">ZENVIA: {row.productName}</small>:<small className="amazonIncomplete">Sin vincular</small>}</div></div></td>
            <td>{integer.format(row.orders)}</td>
            <td>{integer.format(row.units)}</td>
            <td>{money.format(row.grossSales)}</td>
            <td>{money.format(row.netSales)}{row.missingVatOrders>0&&<small className="amazonIncomplete">{row.missingVatOrders} con IVA pendiente</small>}</td>
            <td>{money.format(row.productCost)}</td>
            <td>{money.format(row.amazonFees)}</td>
            <td>{money.format(row.refunds)}</td>
            <td className={row.profitBeforeAds>=0?'amazonPositive':'amazonNegative'}>{money.format(row.profitBeforeAds)}{!row.profitComplete&&<small className="amazonIncomplete">Provisional</small>}</td>
            <td className={row.marginPct!=null&&row.marginPct>=0?'amazonPositive':'amazonNegative'}>{row.marginPct==null?'—':`${row.marginPct.toFixed(1)} %`}</td>
            <td>{money.format(row.salesVat)}</td>
            <td>{money.format(row.amazonFeeVat)}</td>
            <td><button className="amazonInlineAction" onClick={()=>setEditing(editing===row.sellerSku?null:row.sellerSku)}><Link2 size={14}/>{row.productId?'Cambiar vínculo':'Vincular'}</button></td>
          </tr>)}
          {!data.items.length&&<tr><td colSpan={14} className="amazonEmptyCell">{loading?'Cargando productos de Amazon…':'No hay productos para este periodo.'}</td></tr>}
        </tbody>
      </table>
    </div>
    {editing&&<AmazonMappingModal sellerSku={editing} asin={editingRow?.asin} imageUrl={editingRow?.asin?metadata[editingRow.asin]?.imageUrl||null:null} initialProductId={editingRow?.productId} initialFactor={editingRow?.consumptionFactor||1} allowDelete={Boolean(editingRow?.productId)} onSaved={()=>{setEditing(null);void refresh();}} onClose={()=>setEditing(null)}/>}
    <div className="amazonPagination"><span>{loading&&!data.items.length?'Cargando productos…':`${data.total} productos · ${Math.min((page-1)*pageSize+1,data.total)}–${Math.min(page*pageSize,data.total)}`}</span><div><button disabled={page<=1} onClick={()=>setPage(value=>value-1)}>Anterior</button><span>Página {page}</span><button disabled={page*pageSize>=data.total} onClick={()=>setPage(value=>value+1)}>Siguiente</button></div></div>
  </section>;
}
