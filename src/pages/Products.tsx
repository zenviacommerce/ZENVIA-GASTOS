import { useEffect, useMemo, useState } from 'react';
import { Search, TrendingUp, TrendingDown, AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import type { Product } from '../types';
import { Pagination } from '../components/Pagination';
import { loadProductSalesMap } from '../services/productEditor';
import '../supplier-actions.css';

const PAGE_SIZE=20;

export function Products({products,onAdd,onEdit,onDelete}:{products:Product[];onAdd:()=>void;onEdit:(product:Product)=>void;onDelete:(product:Product)=>Promise<void>}){
 const [query,setQuery]=useState(''); const [busyId,setBusyId]=useState<string|null>(null); const [error,setError]=useState(''); const [page,setPage]=useState(1);
 const [salesMap,setSalesMap]=useState<Map<string,{salePrice:number|null;salesTaxRate:number;invoiceDescription:string;ean:string}>>(new Map());
 useEffect(()=>{loadProductSalesMap(products.map(p=>p.id)).then(setSalesMap).catch(()=>setSalesMap(new Map()))},[products]);
 const shown=useMemo(()=>{const q=query.toLowerCase().trim();return !q?products:products.filter(p=>{const extra=salesMap.get(p.id);return [p.name,p.sku??'',extra?.ean??'',p.supplier,p.category??''].some(x=>x.toLowerCase().includes(q))})},[products,query,salesMap]);
 const totalPages=Math.max(1,Math.ceil(shown.length/PAGE_SIZE));
 const paged=useMemo(()=>shown.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[shown,page]);
 useEffect(()=>{setPage(1)},[query]);
 useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);
 const remove=async(product:Product)=>{
   const confirmed=window.confirm(`¿Eliminar el producto "${product.name}"?\n\nLas facturas existentes no se borrarán; sus líneas quedarán sin producto asociado.`);
   if(!confirmed)return;
   setBusyId(product.id);setError('');
   try{await onDelete(product)}catch(e){setError(e instanceof Error?e.message:'No se pudo eliminar el producto.')}finally{setBusyId(null)}
 };
 return <div className="page"><div className="pageHead"><div><div className="eyebrow">CATÁLOGO · COMPRAS Y VENTAS</div><h1>Productos</h1><p>Coste de compra, precio de venta, margen y datos reutilizables en las facturas.</p></div><button className="primary" onClick={onAdd}>+ Nuevo producto</button></div>
 {error&&<div className="errorBox supplierPageError">{error}</div>}
 <div className="toolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar producto, SKU, EAN o proveedor…"/></div><span className="filterResultCount">{shown.length} producto{shown.length===1?'':'s'}</span></div>
 <section className="card tableCard">{shown.length?<><table><thead><tr><th>Producto</th><th>SKU / EAN</th><th>Proveedor</th><th className="right">Coste</th><th className="right">P. venta</th><th className="right">Margen</th><th className="right">Var. coste</th><th className="right">Acciones</th></tr></thead><tbody>{paged.map(p=>{const extra=salesMap.get(p.id);const delta=p.previousPrice&&p.lastPrice!=null?((p.lastPrice-p.previousPrice)/p.previousPrice)*100:null;const margin=p.lastPrice!=null&&extra?.salePrice!=null?extra.salePrice-p.lastPrice:null;const marginPct=margin!=null&&extra?.salePrice?margin/extra.salePrice*100:null; return <tr key={p.id} className="clickableRow" onClick={()=>onEdit(p)} tabIndex={0} role="button" aria-label={`Editar ${p.name}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onEdit(p)}}}><td><strong>{p.name}</strong><div className="muted">{p.category||'Sin categoría'} · por {p.unit}{extra?.salesTaxRate!=null?` · IVA ${extra.salesTaxRate}%`:''}</div></td><td><span className="mono">{p.sku||'—'}</span>{extra?.ean&&<div className="muted mono">{extra.ean}</div>}</td><td>{p.supplier}</td><td className="right"><strong>{p.lastPrice!=null?`${p.lastPrice.toLocaleString('es-ES',{maximumFractionDigits:4})} €`:'—'}</strong></td><td className="right"><strong>{extra?.salePrice!=null?`${extra.salePrice.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:4})} €`:'—'}</strong></td><td className="right">{margin==null?<span className="muted">—</span>:<><strong>{margin.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} €</strong>{marginPct!=null&&<div className="muted">{marginPct.toFixed(1)} %</div>}</>}</td><td className="right">{delta==null?<span className="muted">Sin histórico</span>:<span className={delta>0?'delta up':'delta down'}>{delta>0?<TrendingUp size={15}/>:<TrendingDown size={15}/>} {delta>0?'+':''}{delta.toFixed(1)}%</span>}</td><td className="right"><div className="statusActions" style={{justifyContent:'flex-end'}}><button className="iconAction" title={`Editar ${p.name}`} aria-label={`Editar ${p.name}`} onClick={e=>{e.stopPropagation();onEdit(p)}} disabled={busyId===p.id}><Pencil size={15}/></button><button className="iconAction danger" title={`Eliminar ${p.name}`} aria-label={`Eliminar ${p.name}`} onClick={e=>{e.stopPropagation();void remove(p)}} disabled={busyId===p.id}><Trash2 size={15}/></button></div></td></tr>})}</tbody></table><Pagination page={page} totalItems={shown.length} pageSize={PAGE_SIZE} onPageChange={setPage}/></>:<div className="emptyState large">Crea el primer producto. El mismo catálogo servirá para compras, costes y facturación de ventas.</div>}</section>
 <div className="card alertCard"><div className="trendIcon warning"><AlertTriangle/></div><div><h3>Un único catálogo</h3><p>El coste seguirá actualizándose desde las facturas de proveedores y el precio de venta se utilizará al añadir el producto a una factura de cliente.</p></div></div></div>
}
