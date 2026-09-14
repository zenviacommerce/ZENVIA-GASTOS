import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Product } from '../types';
import { getProductSalesDetails, type ProductInput } from '../services/productEditor';

function parsePrice(value:string){
 const clean=value.trim().replace(',','.');
 if(!clean)return null;
 const parsed=Number(clean);
 return Number.isFinite(parsed)&&parsed>=0?parsed:NaN;
}

export function ProductModal({open,product,onClose,onSave}:{open:boolean;product?:Product|null;onClose:()=>void;onSave:(v:ProductInput)=>Promise<void>}){
 const [name,setName]=useState(''); const [sku,setSku]=useState(''); const [ean,setEan]=useState(''); const [category,setCategory]=useState(''); const [unit,setUnit]=useState('ud'); const [price,setPrice]=useState(''); const [salePrice,setSalePrice]=useState(''); const [salesTaxRate,setSalesTaxRate]=useState('21'); const [invoiceDescription,setInvoiceDescription]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');

 useEffect(()=>{
   if(!open)return;
   setName(product?.name??'');
   setSku(product?.sku??'');
   setEan(product?.ean??'');
   setCategory(product?.category??'');
   setUnit(product?.unit??'ud');
   setPrice(product?.lastPrice!=null?String(product.lastPrice):'');
   setSalePrice(product?.salePrice!=null?String(product.salePrice):'');
   setSalesTaxRate(product?.salesTaxRate!=null?String(product.salesTaxRate):'21');
   setInvoiceDescription(product?.invoiceDescription??'');
   setError('');
   if(product?.id){
     getProductSalesDetails(product.id).then(details=>{
       setSalePrice(details.salePrice!=null?String(details.salePrice):'');
       setSalesTaxRate(String(details.salesTaxRate));
       setInvoiceDescription(details.invoiceDescription);
       setEan(details.ean);
     }).catch(()=>undefined);
   }
 },[open,product]);

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
   try{await onSave({name,sku,ean,category,unit,price:parsedPrice,salePrice:parsedSalePrice,salesTaxRate:parsedTax,invoiceDescription});onClose();}
   catch(e){setError(e instanceof Error?e.message:'Error');}
   finally{setBusy(false)}
 };
 const editing=Boolean(product);
 const margin=price.trim()&&salePrice.trim()&&Number(salePrice.replace(',','.'))>0&&Number(price.replace(',','.'))>=0?Number(salePrice.replace(',','.'))-Number(price.replace(',','.')):null;
 return <div className="modalBackdrop"><div className="modal smallModal"><div className="modalHead"><div><h3>{editing?'Editar producto':'Nuevo producto'}</h3><p>{editing?'Coste de compra y datos comerciales del producto.':'Producto único para compras, costes y facturación de ventas.'}</p></div><button onClick={onClose}><X/></button></div><div className="stackForm"><label>Nombre *<input value={name} onChange={e=>setName(e.target.value)}/></label><label>SKU interno<input value={sku} onChange={e=>setSku(e.target.value)}/></label><label>EAN<input value={ean} onChange={e=>setEan(e.target.value)} inputMode="numeric" placeholder="843…"/></label><label>Categoría<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Film, bolsas, vasos…"/></label><label>Unidad base<input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="ud, rollo, kg…"/></label><label>Coste actual (€ / {unit.trim()||'ud'})<input value={price} onChange={e=>setPrice(e.target.value)} inputMode="decimal" placeholder="0,00"/></label><label>Precio de venta (€ / {unit.trim()||'ud'})<input value={salePrice} onChange={e=>setSalePrice(e.target.value)} inputMode="decimal" placeholder="0,00"/></label><label>IVA de venta<select value={salesTaxRate} onChange={e=>setSalesTaxRate(e.target.value)}><option value="21">21 %</option><option value="10">10 %</option><option value="4">4 %</option><option value="0">0 %</option></select></label><label>Descripción para factura<textarea rows={3} value={invoiceDescription} onChange={e=>setInvoiceDescription(e.target.value)} placeholder="Descripción comercial que verá el cliente"/></label>{margin!=null&&<div className="aiNote"><div><strong>Margen unitario actual</strong><span>{margin.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} € antes de otros costes e impuestos.</span></div></div>}{editing&&<div className="aiNote"><div><strong>Histórico de coste</strong><span>Si cambias el coste manualmente, el valor anterior se conserva para calcular la variación.</span></div></div>}</div>{error&&<div className="errorBox">{error}</div>}<div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" onClick={save} disabled={busy||!name.trim()}>{busy?'Guardando…':editing?'Guardar cambios':'Crear producto'}</button></div></div></div>
}
