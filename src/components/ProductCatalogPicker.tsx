import { useMemo, useState } from 'react';
import { PackagePlus, Search, X } from 'lucide-react';
import type { BillableProduct } from '../services/billableProducts';

const money=(value:number|null)=>value==null?'Sin PVP':`${value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} €`;

export function ProductCatalogPicker({products,onAdd}:{products:BillableProduct[];onAdd:(product:BillableProduct)=>void}){
  const [query,setQuery]=useState('');
  const matches=useMemo(()=>{
    const q=query.trim().toLowerCase();
    const base=q?products.filter(product=>[product.name,product.sku||'',product.description].some(value=>value.toLowerCase().includes(q))):products;
    return base.slice(0,10);
  },[products,query]);

  return <div className="productCatalogPicker">
    <div className="productCatalogPickerHead">
      <div><strong>Añadir desde productos</strong><span>Busca por nombre, SKU o descripción</span></div>
      <span className="productCatalogCount">{products.length} producto{products.length===1?'':'s'}</span>
    </div>
    <div className="productCatalogSearch">
      <Search size={17}/>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar producto existente…" />
      {query&&<button type="button" onClick={()=>setQuery('')} title="Limpiar búsqueda"><X size={15}/></button>}
    </div>
    <div className="productCatalogResults">
      {!products.length?<div className="productCatalogEmpty">Todavía no hay productos activos.</div>:matches.length?matches.map(product=><button type="button" className="productCatalogItem" key={product.id} onClick={()=>{onAdd(product);setQuery('')}}>
        <span className="productCatalogIcon"><PackagePlus size={17}/></span>
        <span className="productCatalogMain"><strong>{product.name}</strong><small>{product.sku||'Sin SKU'} · {product.unit} · IVA {product.taxRate.toLocaleString('es-ES')} %</small></span>
        <span className={product.salePrice==null?'productCatalogPrice muted':'productCatalogPrice'}>{money(product.salePrice)}</span>
      </button>):<div className="productCatalogEmpty">No hay productos que coincidan con “{query}”.</div>}
    </div>
  </div>;
}
