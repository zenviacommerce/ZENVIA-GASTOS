import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Product } from '../types';

export function ProductModal({open,product,onClose,onSave}:{open:boolean;product?:Product|null;onClose:()=>void;onSave:(v:{name:string;sku?:string;category?:string;unit:string})=>Promise<void>}){
 const [name,setName]=useState(''); const [sku,setSku]=useState(''); const [category,setCategory]=useState(''); const [unit,setUnit]=useState('ud'); const [busy,setBusy]=useState(false); const [error,setError]=useState('');

 useEffect(()=>{
   if(!open)return;
   setName(product?.name??'');
   setSku(product?.sku??'');
   setCategory(product?.category??'');
   setUnit(product?.unit??'ud');
   setError('');
 },[open,product]);

 if(!open)return null;
 const save=async()=>{if(!name.trim())return;setBusy(true);setError('');try{await onSave({name,sku,category,unit});onClose();}catch(e){setError(e instanceof Error?e.message:'Error');}finally{setBusy(false)}};
 const editing=Boolean(product);
 return <div className="modalBackdrop"><div className="modal smallModal"><div className="modalHead"><div><h3>{editing?'Editar producto':'Nuevo producto'}</h3><p>{editing?'Modifica los datos del producto interno.':'Producto interno para controlar costes.'}</p></div><button onClick={onClose}><X/></button></div><div className="stackForm"><label>Nombre *<input value={name} onChange={e=>setName(e.target.value)}/></label><label>SKU interno<input value={sku} onChange={e=>setSku(e.target.value)}/></label><label>Categoría<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Film, bolsas, vasos…"/></label><label>Unidad base<input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="ud, rollo, kg…"/></label></div>{error&&<div className="errorBox">{error}</div>}<div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" onClick={save} disabled={busy||!name.trim()}>{busy?'Guardando…':editing?'Guardar cambios':'Crear producto'}</button></div></div></div>
}
