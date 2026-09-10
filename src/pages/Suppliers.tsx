import { useState } from 'react';
import { Building2, Pencil, Trash2 } from 'lucide-react';
import type { Supplier } from '../types';

export function Suppliers({suppliers,onAdd,onEdit,onDelete}:{suppliers:Supplier[];onAdd:()=>void;onEdit:(supplier:Supplier)=>void;onDelete:(supplier:Supplier)=>Promise<void>}){
 const [busyId,setBusyId]=useState<string|null>(null);
 const [error,setError]=useState('');

 const remove=async(supplier:Supplier)=>{
   const confirmed=window.confirm(`¿Eliminar el proveedor "${supplier.name}"?\n\nLas facturas existentes no se borrarán; quedarán sin proveedor asignado.`);
   if(!confirmed)return;
   setBusyId(supplier.id);setError('');
   try{await onDelete(supplier)}catch(e){setError(e instanceof Error?e.message:'No se pudo eliminar el proveedor.')}finally{setBusyId(null)}
 };

 return <div className="page">
   <div className="pageHead"><div><div className="eyebrow">MAESTRO</div><h1>Proveedores</h1><p>Proveedores recurrentes y reglas de clasificación.</p></div><button className="primary" onClick={onAdd}>+ Proveedor</button></div>
   {error&&<div className="errorBox supplierPageError">{error}</div>}
   {suppliers.length?<div className="supplierGrid">{suppliers.map(s=><div className="card supplierCard" key={s.id}>
     <div className="supplierBig"><Building2/></div>
     <div className="supplierInfo"><strong>{s.name}</strong><span>{s.supplierType==='goods'?'Mercancía':s.supplierType==='both'?'Mercancía y servicios':'Servicios'}{s.taxId?` · ${s.taxId}`:''}</span>{s.email&&<small>{s.email}</small>}</div>
     <div className="supplierActions">
       <button className="iconAction" title={`Editar ${s.name}`} onClick={()=>onEdit(s)} disabled={busyId===s.id}><Pencil size={16}/></button>
       <button className="iconAction danger" title={`Eliminar ${s.name}`} onClick={()=>remove(s)} disabled={busyId===s.id}><Trash2 size={16}/></button>
     </div>
   </div>)}</div>:<div className="card emptyState large">Los proveedores también se crearán automáticamente al registrar facturas nuevas.</div>}
 </div>
}
