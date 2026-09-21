import { useEffect, useMemo, useState } from 'react';
import { Barcode, Building2, Calculator, ChevronRight, Euro, Package, Percent, Search, Tag, Trash2, TrendingDown, TrendingUp, X, Pencil } from 'lucide-react';
import type { Product } from '../types';
import { Pagination } from '../components/Pagination';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { PeriodFilterPanel } from '../components/PeriodFilterPanel';
import { StatCard } from '../components/StatCard';
import { SelectField } from '../components/forms/SelectField';
import { dateFilterForPreset, periodLabel } from '../services/filters';
import { loadProductSalesMap } from '../services/productEditor';
import { productMarginMetrics } from '../services/productMetrics';
import { showError, showSuccess } from '../services/toast';
import { confirmAction, openActionProcess } from '../services/actionDialog';
import { useSettings } from '../context/SettingsContext';
import { persistRememberedFilter, rememberedFilter } from '../services/uiPreferences';
import '../supplier-actions.css';

const money=(value:number|null,decimals=2,maxDecimals=Math.max(decimals,4))=>value==null?'—':`${value.toLocaleString('es-ES',{minimumFractionDigits:decimals,maximumFractionDigits:maxDecimals})} €`;
const dateLabel=(value?:string|null)=>value?new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString('es-ES'):'—';

type ProductSalesInfo={salePrice:number|null;salesTaxRate:number;invoiceDescription:string;ean:string};
type ProductScope='all'|'with_sale'|'without_sale'|'missing_cost'|'negative_margin'|'cost_up'|'cost_down';

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
        <div><span><Building2 size={15}/> Proveedor</span><strong>{product.supplier&&product.supplier!=='—'?product.supplier:'Sin proveedor'}</strong></div>
        <div><span><Package size={15}/> Última compra</span><strong>{dateLabel(product.lastPurchaseDate)}</strong></div>
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
 const {settings,preferences,updatePreferences}=useSettings();
 const pageSize=preferences.pageSize;
 const marginAlertThreshold=Math.max(settings.products.minimumMarginPct,settings.products.marginAlertPct);
 const costIncreaseThreshold=settings.products.costIncreaseAlertPct;
 const costMoney=(value:number|null)=>money(value,Math.min(settings.products.costDecimals,8),Math.min(settings.products.costDecimals,8));
 const remembered=rememberedFilter<{query:string;dateFilter:ReturnType<typeof dateFilterForPreset>;categoryFilter:string;supplierFilter:string;scope:ProductScope;taxFilter:string}>(preferences,'products.filters',{query:'',dateFilter:dateFilterForPreset(preferences.defaultPeriod),categoryFilter:'all',supplierFilter:'all',scope:'all',taxFilter:'all'});
 const [query,setQuery]=useState(remembered.query);
 const [dateFilter,setDateFilter]=useState(remembered.dateFilter);
 const [categoryFilter,setCategoryFilter]=useState(remembered.categoryFilter);
 const [supplierFilter,setSupplierFilter]=useState(remembered.supplierFilter);
 const [scope,setScope]=useState<ProductScope>(remembered.scope);
 const [taxFilter,setTaxFilter]=useState(remembered.taxFilter);
 const [busyId,setBusyId]=useState<string|null>(null);
 const [error,setError]=useState('');
 const [page,setPage]=useState(1);
 const [selected,setSelected]=useState<Product|null>(null);
 const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
 const [bulkBusy,setBulkBusy]=useState(false);
 const [salesMap,setSalesMap]=useState<Map<string,ProductSalesInfo>>(new Map());
 useEffect(()=>{loadProductSalesMap(products.map(p=>p.id)).then(setSalesMap).catch(()=>setSalesMap(new Map()))},[products]);
 const selectedPeriod=periodLabel(dateFilter);
 const categoryOptions=useMemo(()=>{
   const values=[...new Set(products.map(product=>product.category?.trim()).filter((value):value is string=>Boolean(value)))].sort((a,b)=>a.localeCompare(b,'es')).map(value=>({value,label:value}));
   return products.some(product=>!product.category?.trim())?[...values,{value:'__none__',label:'Sin categoría'}]:values;
 },[products]);
 const supplierOptions=useMemo(()=>{
   const values=[...new Set(products.map(product=>product.supplier?.trim()).filter(value=>Boolean(value)&&value!=='—'))].sort((a,b)=>a.localeCompare(b,'es')).map(value=>({value,label:value}));
   return products.some(product=>!product.supplier?.trim()||product.supplier==='—')?[...values,{value:'__none__',label:'Sin proveedor'}]:values;
 },[products]);
 const taxOptions=useMemo(()=>[...new Set([...salesMap.values()].map(item=>Number(item.salesTaxRate)).filter(value=>Number.isFinite(value)))].sort((a,b)=>a-b).map(value=>({value:String(value),label:`${value.toLocaleString('es-ES')} %`})),[salesMap]);
 const periodProducts=useMemo(()=>products.filter(product=>{
   if(dateFilter.preset==='all')return true;
   const date=(product.lastPurchaseDate||'').slice(0,10);
   if(!date)return false;
   if(dateFilter.from&&date<dateFilter.from)return false;
   if(dateFilter.to&&date>dateFilter.to)return false;
   return true;
 }),[products,dateFilter]);
 const shown=useMemo(()=>{
   const q=query.toLowerCase().trim();
   return periodProducts.filter(product=>{
     const extra=salesMap.get(product.id);
     const metric=productMetrics(product,extra);
     if(categoryFilter!=='all'){
       if(categoryFilter==='__none__'&&product.category?.trim())return false;
       if(categoryFilter!=='__none__'&&(product.category||'')!==categoryFilter)return false;
     }
     if(supplierFilter!=='all'){
       const hasSupplier=Boolean(product.supplier?.trim()&&product.supplier!=='—');
       if(supplierFilter==='__none__'&&hasSupplier)return false;
       if(supplierFilter!=='__none__'&&(product.supplier||'')!==supplierFilter)return false;
     }
     if(taxFilter!=='all'&&String(extra?.salesTaxRate??'')!==taxFilter)return false;
     if(scope==='with_sale'&&extra?.salePrice==null)return false;
     if(scope==='without_sale'&&extra?.salePrice!=null)return false;
     if(scope==='missing_cost'&&metric.cost!=null)return false;
     if(scope==='negative_margin'&&!(metric.marginPct!=null&&metric.marginPct<marginAlertThreshold))return false;
     if(scope==='cost_up'&&!(metric.delta!=null&&metric.delta>=costIncreaseThreshold))return false;
     if(scope==='cost_down'&&!(metric.delta!=null&&metric.delta<0))return false;
     if(q&&![product.name,product.sku??'',extra?.ean??'',product.supplier,product.category??''].some(value=>value.toLowerCase().includes(q)))return false;
     return true;
   });
 },[periodProducts,query,salesMap,categoryFilter,supplierFilter,taxFilter,scope,marginAlertThreshold,costIncreaseThreshold]);
 const selectedProducts=shown.filter(product=>checkedIds.has(product.id));
 const allShownSelected=shown.length>0&&shown.every(product=>checkedIds.has(product.id));
 const toggleProduct=(id:string,checked:boolean)=>setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
 const toggleAllProducts=(checked:boolean)=>setCheckedIds(checked?new Set(shown.map(product=>product.id)):new Set());
 const totalPages=Math.max(1,Math.ceil(shown.length/pageSize));
 const paged=useMemo(()=>shown.slice((page-1)*pageSize,page*pageSize),[shown,page]);
 useEffect(()=>{setPage(1);setCheckedIds(new Set())},[query,dateFilter,categoryFilter,supplierFilter,taxFilter,scope]);
 useEffect(()=>{const timer=window.setTimeout(()=>{void persistRememberedFilter(preferences,updatePreferences,'products.filters',{query,dateFilter,categoryFilter,supplierFilter,scope,taxFilter})},350);return()=>window.clearTimeout(timer)},[query,dateFilter,categoryFilter,supplierFilter,scope,taxFilter,preferences.rememberFilters]);
 useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);
 useEffect(()=>{if(selected&&!products.some(product=>product.id===selected.id))setSelected(null)},[products,selected]);
 const totals=useMemo(()=>{
   const withSale=shown.filter(product=>salesMap.get(product.id)?.salePrice!=null).length;
   const margins=shown.map(product=>productMetrics(product,salesMap.get(product.id)).marginPct).filter((value):value is number=>value!=null);
   const costs=shown.map(product=>product.lastPrice).filter((value):value is number=>value!=null);
   const costUp=shown.filter(product=>{const delta=productMetrics(product,salesMap.get(product.id)).delta;return delta!=null&&delta>=costIncreaseThreshold}).length;
   const lowMargin=shown.filter(product=>{const margin=productMetrics(product,salesMap.get(product.id)).marginPct;return margin!=null&&margin<marginAlertThreshold}).length;
   return {
     count:shown.length,
     withSale,
     avgMargin:margins.length?margins.reduce((a,b)=>a+b,0)/margins.length:null,
     avgCost:costs.length?costs.reduce((a,b)=>a+b,0)/costs.length:null,
     costUp,
     lowMargin,
   };
 },[shown,salesMap,costIncreaseThreshold,marginAlertThreshold]);
 const remove=async(product:Product)=>{
   const confirmed=await confirmAction({title:'Eliminar producto',message:`Se eliminará “${product.name}”.`,confirmLabel:'Eliminar',tone:'danger',details:['Las facturas existentes no se borrarán; sus líneas quedarán sin producto asociado.']});
   if(!confirmed)return;
   setBusyId(product.id);setError('');
   try{await onDelete(product);setSelected(null);showSuccess('Producto eliminado correctamente.')}
   catch(e){showError(e instanceof Error?e.message:'No se pudo eliminar el producto.')}
   finally{setBusyId(null)}
 };
 const removeSelected=async()=>{
   if(!selectedProducts.length)return;
   const confirmed=await confirmAction({title:`Eliminar ${selectedProducts.length} producto${selectedProducts.length===1?'':'s'}`,message:'Se eliminarán los productos seleccionados.',confirmLabel:'Eliminar seleccionados',tone:'danger',details:['Las líneas históricas de factura no se borrarán.']});
   if(!confirmed)return;
   setBulkBusy(true);setError('');
   const process=openActionProcess({title:'Eliminando productos',description:'El resultado permanecerá visible al terminar.',items:selectedProducts.map(product=>({id:product.id,label:product.name}))});
   let removed=0;let failed=0;
   try{
     for(const product of selectedProducts){
       process.setItem(product.id,'running','Eliminando…');
       try{await onDelete(product);removed+=1;process.setItem(product.id,'success','Eliminado correctamente.');}
       catch(e){failed+=1;process.setItem(product.id,'error',e instanceof Error?e.message:'No se pudo eliminar.');}
     }
     setCheckedIds(new Set());
     process.finish(`${removed} eliminado${removed===1?'':'s'}.${failed?` ${failed} con error.`:''}`,failed?(removed?'warning':'error'):'success');
   }finally{setBulkBusy(false);}
 };
 const edit=(product:Product)=>{setSelected(null);onEdit(product)};
 return (
    <div className="page masterPage">
      <div className="pageHead">
        <div>
          <div className="eyebrow">CATÁLOGO · COMPRAS Y VENTAS</div>
          <h1>Productos</h1>
          <p>Coste de compra, precio de venta, margen y datos reutilizables en las facturas.</p>
        </div>
        <button className="primary" onClick={onAdd}>+ Nuevo producto</button>
      </div>

      <PeriodFilterPanel
        filter={dateFilter}
        onChange={setDateFilter}
        title="Periodo de actividad"
        note="En Productos, el periodo se aplica a la fecha de la última compra o actualización de coste registrada."
      />

      <div className="stats masterStats productStats">
        <StatCard label="Productos visibles" value={String(totals.count)} sub={selectedPeriod} icon={<Package/>}/>
        <StatCard label="Con precio de venta" value={String(totals.withSale)} sub={`de ${totals.count} visibles`} icon={<Euro/>}/>
        <StatCard label="Margen medio" value={totals.avgMargin==null?'—':`${totals.avgMargin.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1})} %`} sub="Sobre coste" icon={<Percent/>}/>
        <StatCard label="Coste medio" value={costMoney(totals.avgCost)} sub={selectedPeriod} icon={<Calculator/>}/>
        <StatCard label="Margen bajo" value={String(totals.lowMargin)} sub={`Por debajo de ${marginAlertThreshold.toLocaleString('es-ES')} %`} icon={<Percent/>}/>
        <StatCard label="Subidas de coste" value={String(totals.costUp)} sub={`Desde +${costIncreaseThreshold.toLocaleString('es-ES')} %`} icon={<TrendingUp/>}/>
      </div>

      {error&&<div className="errorBox supplierPageError">{error}</div>}

      <div className="businessFilterBar productFilterToolbar">
        <div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar producto, SKU, EAN o proveedor…"/></div>
        <div className="businessFilterFields">
          <label className="filterField"><span>Categoría</span><SelectField value={categoryFilter} onChange={setCategoryFilter} ariaLabel="Filtrar por categoría" options={[{value:'all',label:'Todas las categorías'},...categoryOptions]}/></label>
          <label className="filterField"><span>Proveedor</span><SelectField value={supplierFilter} onChange={setSupplierFilter} ariaLabel="Filtrar por proveedor" options={[{value:'all',label:'Todos los proveedores'},...supplierOptions]}/></label>
          <label className="filterField"><span>IVA venta</span><SelectField value={taxFilter} onChange={setTaxFilter} ariaLabel="Filtrar por IVA de venta" options={[{value:'all',label:'Todos los tipos'},...taxOptions]}/></label>
          <label className="filterField"><span>Situación</span><SelectField value={scope} onChange={value=>setScope(value as ProductScope)} ariaLabel="Filtrar productos" options={[{value:'all',label:'Todos los productos'},{value:'with_sale',label:'Con precio de venta'},{value:'without_sale',label:'Sin precio de venta'},{value:'missing_cost',label:'Sin coste de compra'},{value:'negative_margin',label:`Margen bajo (< ${marginAlertThreshold.toLocaleString('es-ES')} %)`},{value:'cost_up',label:`Subida coste (≥ ${costIncreaseThreshold.toLocaleString('es-ES')} %)`},{value:'cost_down',label:'Coste a la baja'}]}/></label>
        </div>
        <span className="filterResultCount">{shown.length} producto{shown.length===1?'':'s'} · {selectedPeriod}</span>
      </div>

      {shown.length>0&&(
        <BulkSelectionToolbar selectedCount={selectedProducts.length} totalCount={shown.length} allSelected={allShownSelected} onToggleAll={toggleAllProducts} label="productos">
          <button className="secondary dangerText" type="button" disabled={!selectedProducts.length||bulkBusy} onClick={()=>void removeSelected()}>
            <Trash2 size={15}/> {bulkBusy?'Eliminando…':`Eliminar seleccionados (${selectedProducts.length})`}
          </button>
        </BulkSelectionToolbar>
      )}

      <section className="card tableCard masterTableCard">
        {shown.length?(
          <table className="masterTable">
            <thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allShownSelected} onChange={toggleAllProducts} label={allShownSelected?'Deseleccionar productos visibles':'Seleccionar productos visibles'}/></th><th>Producto</th><th>SKU / EAN</th><th>Proveedor</th><th>Última compra</th><th className="right">Coste</th><th className="right">P. venta</th><th className="right">Margen</th><th className="right">Var. coste</th><th></th></tr></thead>
            <tbody>{paged.map(p=>{const extra=salesMap.get(p.id);const metric=productMetrics(p,extra);return <tr key={p.id} className={`clickableRow ${checkedIds.has(p.id)?'bulkSelectedRow':''}`} onClick={()=>setSelected(p)}>
                <td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={checkedIds.has(p.id)} onChange={checked=>toggleProduct(p.id,checked)} label={`Seleccionar ${p.name}`}/></td>
                <td><div className="masterEntityCell"><div className="masterAvatar"><Package size={17}/></div><div><strong>{p.name}</strong><small>{p.category||'Sin categoría'} · por {p.unit}</small></div></div></td>
                <td><span className="mono">{p.sku||'—'}</span>{extra?.ean&&<div className="muted mono">{extra.ean}</div>}</td>
                <td>{p.supplier&&p.supplier!=='—'?p.supplier:<span className="muted">Sin proveedor</span>}</td>
                <td>{dateLabel(p.lastPurchaseDate)}</td>
                <td className="right"><strong>{metric.cost==null?'—':costMoney(metric.cost)}</strong></td>
                <td className="right"><strong>{money(metric.sale)}</strong></td>
                <td className="right">{metric.margin==null?<span className="muted">—</span>:<><strong className={metric.marginPct!=null&&metric.marginPct<marginAlertThreshold?'warnText':undefined}>{money(metric.margin)}</strong>{metric.marginPct!=null&&<div className={metric.marginPct<settings.products.minimumMarginPct?'warnText':'muted'}>{metric.marginPct.toFixed(1)} %</div>}</>}</td>
                <td className="right">{metric.delta==null?<span className="muted">Sin histórico</span>:<span className={metric.delta>=costIncreaseThreshold?'delta up':metric.delta>0?'delta up':'delta down'}>{metric.delta>0?<TrendingUp size={15}/>:<TrendingDown size={15}/>} {metric.delta>0?'+':''}{metric.delta.toFixed(1)}%</span>}</td>
                <td className="right"><ChevronRight size={17}/></td>
              </tr>})}</tbody>
          </table>
        ):<div className="emptyState large">No hay productos para los filtros seleccionados.</div>}
      </section>

      {shown.length>0&&(
        <div className="masterMobileList">
          {paged.map(p=>{const extra=salesMap.get(p.id);const metric=productMetrics(p,extra);return <div className={`bulkMobileSelectableRow ${checkedIds.has(p.id)?'selected':''}`} key={p.id}>
              <BulkSelectCheckbox checked={checkedIds.has(p.id)} onChange={checked=>toggleProduct(p.id,checked)} label={`Seleccionar ${p.name}`}/>
              <button className="card masterMobileRow" onClick={()=>setSelected(p)}>
                <div className="masterEntityCell"><div className="masterAvatar"><Package size={17}/></div><div><strong>{p.name}</strong><small>{p.sku||extra?.ean||'Sin SKU / EAN'} · {p.category||'Sin categoría'} · Última compra {dateLabel(p.lastPurchaseDate)}</small></div></div>
                <div className="masterMobileAmounts"><span>Coste <strong>{money(metric.cost,metric.cost!=null&&metric.cost<1?3:2)}</strong></span><span>P. venta <strong>{money(metric.sale)}</strong></span><span>Margen <strong>{metric.marginPct==null?'—':`${metric.marginPct.toFixed(1)} %`}</strong></span></div>
                <ChevronRight size={18}/>
              </button>
            </div>})}
        </div>
      )}

      {shown.length>0&&<Pagination page={page} totalItems={shown.length} pageSize={pageSize} onPageChange={setPage}/>}
      {!products.length&&<div className="card emptyState large">Crea el primer producto. El mismo catálogo servirá para compras, costes y facturación de ventas.</div>}
      {selected&&<ProductDrawer product={selected} extra={salesMap.get(selected.id)} onClose={()=>setSelected(null)} onEdit={()=>edit(selected)} onDelete={()=>remove(selected)} busy={busyId===selected.id}/>}
    </div>
 );
}
