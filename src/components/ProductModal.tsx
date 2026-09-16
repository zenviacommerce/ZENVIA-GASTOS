import { useEffect, useMemo, useState } from 'react';
import { FileText, Package, ShoppingCart, Store } from 'lucide-react';
import type { Product, Supplier } from '../types';
import { getProductSalesDetails, type ProductInput } from '../services/productEditor';
import { productMarginMetrics } from '../services/productMetrics';
import { FormGrid, FormModal, FormSection } from './forms/FormPrimitives';
import { SearchableSelect } from './forms/SearchableSelect';

function parsePrice(value:string){
 const clean=value.trim().replace(',','.');
 if(!clean)return null;
 const parsed=Number(clean);
 return Number.isFinite(parsed)&&parsed>=0?parsed:NaN;
}
function defaultSalePrice(value:string){
 const cost=parsePrice(value);
 if(cost==null||Number.isNaN(cost))return '';
 return (cost*1.25).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
}
function followsDefault(cost:number|null|undefined,sale:number|null|undefined){
 if(cost==null||sale==null)return sale==null;
 return Math.abs(sale-cost*1.25)<0.00011;
}

export function ProductModal({open,product,suppliers,onClose,onSave}:{open:boolean;product?:Product|null;suppliers:Supplier[];onClose:()=>void;onSave:(v:ProductInput)=>Promise<void>}){
 const [name,setName]=useState('');
 const [sku,setSku]=useState('');
 const [ean,setEan]=useState('');
 const [category,setCategory]=useState('');
 const [unit,setUnit]=useState('ud');
 const [supplierId,setSupplierId]=useState('');
 const [price,setPrice]=useState('');
 const [salePrice,setSalePrice]=useState('');
 const [autoSalePrice,setAutoSalePrice]=useState(true);
 const [salesTaxRate,setSalesTaxRate]=useState('21');
 const [invoiceDescription,setInvoiceDescription]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');

 useEffect(()=>{
   if(!open)return;
   const initialCost=product?.lastPrice??null;
   const initialSale=product?.salePrice??null;
   setName(product?.name??'');
   setSku(product?.sku??'');
   setEan(product?.ean??'');
   setCategory(product?.category??'');
   setUnit(product?.unit??'ud');
   setSupplierId(product?.supplierId??'');
   setPrice(initialCost!=null?String(initialCost):'');
   setSalePrice(initialSale!=null?String(initialSale):(initialCost!=null?String(initialCost*1.25):''));
   setAutoSalePrice(!product||followsDefault(initialCost,initialSale));
   setSalesTaxRate(product?.salesTaxRate!=null?String(product.salesTaxRate):'21');
   setInvoiceDescription(product?.invoiceDescription??'');
   setError('');
   if(product?.id){
     getProductSalesDetails(product.id).then(details=>{
       const automatic=followsDefault(product.lastPrice,details.salePrice);
       setSalePrice(details.salePrice!=null?String(details.salePrice):defaultSalePrice(String(product.lastPrice??'')));
       setAutoSalePrice(automatic);
       setSalesTaxRate(String(details.salesTaxRate));
       setInvoiceDescription(details.invoiceDescription);
       setEan(details.ean);
     }).catch(()=>undefined);
   }
 },[open,product]);

 const supplierOptions=useMemo(()=>suppliers.map(supplier=>({value:supplier.id,label:supplier.name,searchText:`${supplier.name} ${supplier.taxId||''}`,description:supplier.taxId||undefined})),[suppliers]);
 if(!open)return null;
 const save=async()=>{
   if(!name.trim())return;
   const parsedPrice=parsePrice(price);
   const parsedSalePrice=parsePrice(salePrice);
   const parsedTax=Number(String(salesTaxRate).replace(',','.'));
   if(Number.isNaN(parsedPrice)){setError('Indica un coste válido igual o superior a 0.');return;}
   if(Number.isNaN(parsedSalePrice)){setError('Indica un precio de venta válido igual o superior a 0.');return;}
   if(!Number.isFinite(parsedTax)||parsedTax<0||parsedTax>100){setError('El IVA de venta debe estar entre 0 y 100.');return;}
   setBusy(true);setError('');
   try{await onSave({name,sku,ean,category,unit,price:parsedPrice,salePrice:parsedSalePrice,salesTaxRate:parsedTax,invoiceDescription,supplierId:supplierId||null});onClose();}
   catch(e){setError(e instanceof Error?e.message:'Error');}
   finally{setBusy(false)}
 };
 const editing=Boolean(product);
 const parsedCost=parsePrice(price);
 const parsedSale=parsePrice(salePrice);
 const metrics=productMarginMetrics(parsedCost!=null&&!Number.isNaN(parsedCost)?parsedCost:null,parsedSale!=null&&!Number.isNaN(parsedSale)?parsedSale:null);
 return <FormModal open={open} eyebrow="PRODUCTOS" title={editing?'Editar producto':'Nuevo producto'} subtitle={editing?'Coste de compra, proveedor y datos comerciales del producto.':'Producto único para compras, costes y facturación de ventas.'} onClose={onClose} actions={<><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={save} disabled={busy||!name.trim()}>{busy?'Guardando…':editing?'Guardar cambios':'Crear producto'}</button></>}>
   <FormSection icon={<Package size={18}/>} title="Identificación" subtitle="Datos internos para localizar y clasificar el producto">
     <FormGrid>
       <label className="formSpan2">Nombre *<input value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre del producto"/></label>
       <label>SKU interno<input value={sku} onChange={e=>setSku(e.target.value)} placeholder="SKU"/></label>
       <label>EAN<input value={ean} onChange={e=>setEan(e.target.value)} inputMode="numeric" placeholder="843…"/></label>
       <label>Categoría<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Film, bolsas, vasos…"/></label>
       <label>Unidad base<input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="ud, rollo, kg…"/></label>
     </FormGrid>
   </FormSection>

   <FormSection icon={<ShoppingCart size={18}/>} title="Compra y proveedor" subtitle="Corrige el proveedor actual sin alterar facturas ni histórico de compra">
     <FormGrid>
       <label>Proveedor<SearchableSelect value={supplierId} options={supplierOptions} onChange={setSupplierId} allowEmpty emptyLabel="Sin proveedor" placeholder="Sin proveedor" searchPlaceholder="Buscar proveedor…" ariaLabel="Proveedor del producto"/><span className="fieldHint">Cambiarlo aquí no crea una compra ni una variación de coste. Una compra real posterior podrá actualizarlo.</span></label>
       <label>Coste actual (€ / {unit.trim()||'ud'})<input value={price} onChange={e=>{const next=e.target.value;setPrice(next);if(autoSalePrice)setSalePrice(defaultSalePrice(next))}} inputMode="decimal" placeholder="0,00"/></label>
     </FormGrid>
   </FormSection>

   <FormSection icon={<Store size={18}/>} title="Venta" subtitle="Precio comercial e impuestos aplicables al facturar">
     <FormGrid>
       <label>Precio de venta (€ / {unit.trim()||'ud'})<input value={salePrice} onChange={e=>{setSalePrice(e.target.value);setAutoSalePrice(false)}} inputMode="decimal" placeholder="Coste + 25 %"/><span className="fieldHint">Por defecto se calcula como coste + 25 %. Si lo modificas manualmente, se respeta tu precio.</span></label>
       <label>IVA de venta<select value={salesTaxRate} onChange={e=>setSalesTaxRate(e.target.value)}><option value="21">21 %</option><option value="10">10 %</option><option value="4">4 %</option><option value="0">0 %</option></select></label>
       {metrics.margin!=null&&<div className="formSpan2 aiNote"><div><strong>Margen unitario</strong><span>{metrics.margin.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} €{metrics.marginPct!=null?` · ${metrics.marginPct.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1})} % sobre coste`:''}.</span></div></div>}
     </FormGrid>
   </FormSection>

   <FormSection icon={<FileText size={18}/>} title="Facturación" subtitle="Texto que verá el cliente cuando añadas este producto a una factura">
     <FormGrid><label className="formSpan2">Descripción para factura<textarea rows={3} value={invoiceDescription} onChange={e=>setInvoiceDescription(e.target.value)} placeholder="Descripción comercial que verá el cliente"/></label></FormGrid>
   </FormSection>

   {editing&&<div className="aiNote"><div><strong>Histórico de coste</strong><span>Si cambias el coste manualmente, el valor anterior se conserva para calcular la variación. Cambiar solo el proveedor no modifica ese histórico.</span></div></div>}
   {error&&<div className="errorBox">{error}</div>}
 </FormModal>;
}
