import { useEffect, useMemo, useState } from 'react';
import { Barcode, Building2, ChevronRight, Euro, Package, Percent, Search, Tag, Trash2, TrendingDown, TrendingUp, X, Pencil } from 'lucide-react';
import type { Product } from '../types';
import { Pagination } from '../components/Pagination';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { loadProductSalesMap } from '../services/productEditor';
import { productMarginMetrics } from '../services/productMetrics';
import '../supplier-actions.css';

const PAGE_SIZE=20;
const money=(value:number|null,decimals=2)=>value==null?'—':`${value.toLocaleString('es-ES',{minimumFractionDigits:decimals,maximumFractionDigits:4})} €`;

type ProductSalesInfo={salePrice:number|null;salesTaxRate:number;invoiceDescription:string;ean:string};

function productMetrics(product:Product,extra?:ProductSalesInfo){
  const cost=product.lastPrice??null;
  const sale=extra?.salePrice??null;
  const {margin,marginPct}=productMarginMetrics(cost,sale);
  const delta=product.previousPrice&&product.lastPrice!=null?((product.lastPrice-product.previousPrice)/product.previousPrice)*100:null;
  return {cost,sale,margin,marginPct,delta};
}

function ProductDrawer({product,extra,onClose,onEdit,onDelete,busy}:{product:Product;extra?:ProductSalesInfo;onClose:()=>void;onEdit:()=>void;onDelete:()=>void;busy:boolean}){
  const metric=productMetrics(product,extra);
  return <div className="masterDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <aside className="masterDrawer">
      <div className="masterDrawerHead"><div><div className="eyebrow">PRODUCTO</div><h2>{product.name}</h2><p>{product.sku||extra?.ean||'Sin SKU / EAN'}</p></div><button className="iconBtn" onClick={onClose}><X size={18}/></button></div>
      <div className="masterDrawerKpis"><div><span>Coste</span><strong>{money(metric.cost,metric.cost!=null&&metric.cost<1?3:2)}</strong></div><div><span>P. venta</span><strong>{money(metric.sale)}</strong></div><div><span>Margen</span><strong>{metric.margin==null?'—':money(metric.margin)}</strong></div></div>
      <section className="masterDrawerSection"><h3>Datos del producto</h3><div className="masterInfoList">
        <div><span><Tag size={15}/> Categoría</span><strong>{product.category||'Sin categoría'}</strong></div>
        <div><span><Package size={15}/> Unidad</span><strong>{product.unit||'—'}</strong></div>
        <div><span><Building2 size={15}/> Proveedor</span><strong>{product.supplier||'Sin proveedor'}</strong></div>
        <div><span><Barcode size={15}/> SKU</span><strong>{product.sku||'Sin SKU'}</strong></div>
        <div><span><Barcode size={15}/> EAN</span><strong>{extra?.ean||'Sin EAN'}</strong></div>
        <div><span><Percent size={15}/> IVA venta</span><strong>{extra?.salesTaxRate!=null?`${extra.salesTaxRate} %`:'—'}</strong></div>
        <div><span><Euro size={15}/> Margen sobre coste</span><strong>{metric.marginPct==null?'—':`${metric.marginPct.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1})} %`}</strong></div>
      </div></section>
      <section className="masterDrawerSection"><h3>Evolución de coste</h3>{metric.delta==null?<div className="masterEmptyMini">Todavía no hay histórico suficiente para calcular la variación de coste.</div>:<div className="masterInfoList"><div><span>{metric.delta>0?<TrendingUp size={15}/>:<TrendingDown size={15}/>} Variación</span><strong className={metric.delta>0?'delta up':'delta down'}>{metric.delta>0?'+':''}{metric.delta.toFixed(1)} %</strong></div><div><span>Coste anterior</span><strong>{money(product.previousPrice??null)}</strong></div><div><span>Coste actual</span><strong>{money(product.lastPrice??null)}</strong></div></div>}</section>
      <div className="masterDrawerActions"><button className="secondary" onClick={onEdit}><Pencil size={16}/> Editar</button><button className="secondary dangerText" disabled={busy} onClick={onDelete}><Trash2 size={16}/> Eliminar</button></div>
    </aside>
  </div>;
}

export function Products({products,onAdd,onEdit,onDelete}:{products:Product[];onAdd:()=>void;onEdit:(product:Product)=>void;onDelete:(product:Product)=>Promise<void>}){
 const [query,setQuery]=useState('');
 const [busyId,setBusyId]=useState<string|null>(null);
 const [error,setError]=useState('');
 const [page,setPage]=useState(1);
 const [selected,setSelected]=useState<Product|null>(null);
 const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
 const [bulkBusy,setBulkBusy]=useState(false);
 const [salesMap,setSalesMap]=useState<Map<string,ProductSalesInfo>>(new Map());
 useEffect(()=>{loadProductSalesMap(products.map(p=>p.id)).then(setSalesMap).catch(()=>setSalesMap(new Map()))},[products]);
 const shown=useMemo(()=>{const q=query.toLowerCase().trim();return !q?products:products.filter(p=>{const extra=salesMap.get(p.id);return [p.name,p.sku??'',extra?.ean??'',p.supplier,p.category??''].some(x=>x.toLowerCase().includes(q))})},[products,query,salesMap]);
 const selectedProducts=shown.filter(product=>checkedIds.has(product.id));
 const allShownSelected=shown.length>0&&shown.every(product=>checkedIds.has(product.id));
 const toggleProduct=(id:string,checked:boolean)=>setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
 const toggleAllProducts=(checked:boolean)=>setCheckedIds(checked?new Set(shown.map(product=>product.id)):new Set());
 const totalPages=Math.max(1,Math.ceil(shown.length/PAGE_SIZE));
 const paged=useMemo(()=>shown.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[shown,page]);
 useEffect(()=>{setPage(1);setCheckedIds(new Set())},[query]);
 useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);
 useEffect(()=>{if(selected&&!products.some(product=>product.id===selected.id))setSelected(null)},[products,selected]);
 const totals=useMemo(()=>{
   const withSale=products.filter(p=>salesMap.get(p.id)?.salePrice!=null).length;
   const margins=products.map(p=>productMetrics(p,salesMap.get(p.id)).marginPct).filter((value):value is number=>value!=null);
   return {count:products.length,withSale,avgMargin:margins.length?margins.reduce((a,b)=>a+b,0)/margins.length:null};
 },[products,salesMap]);
 const remove=async(product:Product)=>{
   const confirmed=window.confirm(`¿Eliminar el producto "${product.name}"?\n\nLas facturas existentes no se borrarán; sus líneas quedarán sin producto asociado.`);
   if(!confirmed)return;
   setBusyId(product.id);setError('');
   try{await onDelete(product);setSelected(null)}catch(e){setError(e instanceof Error?e.message:'No se pudo eliminar el producto.')}finally{setBusyId(null)}
 };
 const removeSelected=async()=>{
   if(!selectedProducts.length)return;
   if(!window.confirm(`¿Eliminar ${selectedProducts.length} producto${selectedProducts.length===1?'':'s'} seleccionado${selectedProducts.length===1?'':'s'}?\n\nLas líneas históricas de factura no se borrarán.`))return;
   setBulkBusy(true);setError('');
   const failed:string[]=[];
   for(const product of selectedProducts){
     try{await onDelete(product);}
     catch(e){failed.push(`${product.name}: ${e instanceof Error?e.message:'No se pudo eliminar'}`);}
   }
   setCheckedIds(new Set());
   setBulkBusy(false);
   const removed=selectedProducts.length-failed.length;
   if(failed.length)setError(`${removed} eliminados · ${failed.length} con error: ${failed.slice(0,3).join(' · ')}`);
 };
 const edit=(product:Product)=>{setSelected(null);onEdit(product)};
 return <div className="page masterPage"><div className="pageHead"><div><div className="eyebrow">CATÁLOGO · COMPRAS Y VENTAS</div><h1>Productos</h1><p>Coste de compra, precio de venta, margen y datos reutilizables en las facturas.</p></div><button className="primary" onClick={onAdd}>+ Nuevo producto</button></div>
 <div className="stats masterStats"><div className="stat"><div className="statIcon"><Package/></div><div><span>Productos</span><strong>{totals.count}</strong><small>Catálogo activo</small></div></div><div className="stat"><div className="statIcon"><Euro/></div><div><span>Con precio de venta</span><strong>{totals.withSale}</strong><small>de {totals.count} productos</small></div></div><div className="stat"><div className="statIcon"><Percent/></div><div><span>Margen medio</span><strong>{totals.avgMargin==null?'—':`${totals.avgMargin.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1})} %`}</strong><small>Sobre coste</small></div></div></div>
 {error&&<div className="errorBox supplierPageError">{error}</div>}
 <div className="masterToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar producto, SKU, EAN o proveedor…"/></div><span className="filterResultCount">{shown.length} producto{shown.length===1?'':'s'}</span></div>
 {shown.length>0&&<BulkSelectionToolbar selectedCount={selectedProducts.length} totalCount={shown.length} allSelected={allShownSelected} onToggleAll={toggleAllProducts} label="productos">
   <button className="secondary dangerText" type="button" disabled={!selectedProducts.length||bulkBusy} onClick={()=>void removeSelected()}><Trash2 size={15}/> {bulkBusy?'Eliminando…':`Eliminar seleccionados (${selectedProducts.length})`}</button>
 </BulkSelectionToolbar>
 <section className="card tableCard masterTableCard">{shown.length?<table className="masterTable"><thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allShownSelected} onChange={toggleAllProducts} label={allShownSelected?'Deseleccionar productos visibles':'Seleccionar productos visibles'}/></th><th>Producto</th><th>SKU / EAN</th><th>Proveedor</th><th className="right">Coste</th><th className="right">P. venta</th><th className="right">Margen</th><th className="right">Var. coste</th><th></th></tr></thead><tbody>{paged.map(p=>{const extra=salesMap.get(p.id);const metric=productMetrics(p,extra);return <tr key={p.id} className={`clickableRow ${checkedIds.has(p.id)?'bulkSelectedRow':''}`} onClick={()=>setSelected(p)}><td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={checkedIds.has(p.id)} onChange={checked=>toggleProduct(p.id,checked)} label={`Seleccionar ${p.name}`}/></td><td><div className="masterEntityCell"><div className="masterAvatar"><Package size={17}/></div><div><strong>{p.name}</strong><small>{p.category||'Sin categoría'} · por {p.unit}</small></div></div></td><td><span className="mono">{p.sku||'—'}</span>{extra?.ean&&<div className="muted mono">{extra.ean}</div>}</td><td>{p.supplier}</td><td className="right"><strong>{money(metric.cost,metric.cost!=null&&metric.cost<1?3:2)}</strong></td><td className="right"><strong>{money(metric.sale)}</strong></td><td className="right">{metric.margin==null?<span className="muted">—</span>:<><strong>{money(metric.margin)}</strong>{metric.marginPct!=null&&<div className="muted">{metric.marginPct.toFixed(1)} %</div>}</>}</td><td className="right">{metric.delta==null?<span className="muted">Sin histórico</span>:<span className={metric.delta>0?'delta up':'delta down'}>{metric.delta>0?<TrendingUp size={15}/>:<TrendingDown size={15}/>} {metric.delta>0?'+':''}{metric.delta.toFixed(1)}%</span>}</td><td className="right"><ChevronRight size={17}/></td></tr>})}</tbody></table>:<div className="emptyState large">No hay productos para la búsqueda seleccionada.</div>}</section>
 {shown.length>0&&<div className="masterMobileList">{paged.map(p=>{const extra=salesMap.get(p.id);const metric=productMetrics(p,extra);return <div className={`bulkMobileSelectableRow ${checkedIds.has(p.id)?'selected':''}`} key={p.id}><BulkSelectCheckbox checked={checkedIds.has(p.id)} onChange={checked=>toggleProduct(p.id,checked)} label={`Seleccionar ${p.name}`}/><button className="card masterMobileRow" onClick={()=>setSelected(p)}><div className="masterEntityCell"><div className="masterAvatar"><Package size={17}/></div><div><strong>{p.name}</strong><small>{p.sku||extra?.ean||'Sin SKU / EAN'} · {p.category||'Sin categoría'}</small></div></div><div className="masterMobileAmounts"><span>Coste <strong>{money(metric.cost,metric.cost!=null&&metric.cost<1?3:2)}</strong></span><span>P. venta <strong>{money(metric.sale)}</strong></span><span>Margen <strong>{metric.marginPct==null?'—':`${metric.marginPct.toFixed(1)} %`}</strong></span></div><ChevronRight size={18}/></button></div>})}</div>}
 {shown.length>0&&<Pagination page={page} totalItems={shown.length} pageSize={PAGE_SIZE} onPageChange={setPage}/>}
 {!products.length&&<div className="card emptyState large">Crea el primer producto. El mismo catálogo servirá para compras, costes y facturación de ventas.</div>}
 {selected&&<ProductDrawer product={selected} extra={salesMap.get(selected.id)} onClose={()=>setSelected(null)} onEdit={()=>edit(selected)} onDelete={()=>remove(selected)} busy={busyId===selected.id}/>} 
 </div>
}
