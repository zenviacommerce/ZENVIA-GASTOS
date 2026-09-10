import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Supplier } from '../types';

type SupplierInput = {name:string;taxId?:string;email?:string;supplierType:'goods'|'service'|'both'};

export function SupplierModal({open,onClose,onSave,supplier}:{open:boolean;onClose:()=>void;onSave:(v:SupplierInput)=>Promise<void>;supplier?:Supplier|null}){
 const [name,setName]=useState('');
 const [taxId,setTaxId]=useState('');
 const [email,setEmail]=useState('');
 const [supplierType,setSupplierType]=useState<'goods'|'service'|'both'>('service');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');

 useEffect(()=>{
   if(!open) return;
   setName(supplier?.name ?? '');
   setTaxId(supplier?.taxId ?? '');
   setEmail(supplier?.email ?? '');
   setSupplierType(supplier?.supplierType ?? 'service');
   setError('');
 },[open,supplier]);

 if(!open)return null;
 const editing=Boolean(supplier);
 const save=async()=>{
   if(!name.trim())return;
   setBusy(true);setError('');
   try{
     await onSave({name:name.trim(),taxId:taxId.trim()||undefined,email:email.trim()||undefined,supplierType});
     onClose();
   }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar el proveedor.');}
   finally{setBusy(false)}
 };

 return <div className="modalBackdrop"><div className="modal smallModal">
   <div className="modalHead"><div><h3>{editing?'Editar proveedor':'Nuevo proveedor'}</h3><p>{editing?'Modifica los datos del proveedor.':'Se usará para clasificar facturas y productos.'}</p></div><button onClick={onClose}><X/></button></div>
   <div className="stackForm">
     <label>Nombre *<input value={name} onChange={e=>setName(e.target.value)}/></label>
     <label>CIF/NIF<input value={taxId} onChange={e=>setTaxId(e.target.value)}/></label>
     <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
     <label>Tipo<select value={supplierType} onChange={e=>setSupplierType(e.target.value as 'goods'|'service'|'both')}><option value="service">Servicios</option><option value="goods">Mercancía</option><option value="both">Ambos</option></select></label>
   </div>
   {error&&<div className="errorBox">{error}</div>}
   <div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={save} disabled={busy||!name.trim()}>{busy?'Guardando…':editing?'Guardar cambios':'Crear proveedor'}</button></div>
 </div></div>
}
