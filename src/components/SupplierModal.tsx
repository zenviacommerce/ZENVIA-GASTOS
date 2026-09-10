import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Supplier } from '../types';
import { emailError, nameError, normalizeEmail, normalizeTaxId, taxIdError } from '../services/validation';

type SupplierInput = {name:string;taxId?:string;email?:string;supplierType:'goods'|'service'|'both'};
type FieldErrors = {name?:string;taxId?:string;email?:string};

export function SupplierModal({open,onClose,onSave,supplier}:{open:boolean;onClose:()=>void;onSave:(v:SupplierInput)=>Promise<void>;supplier?:Supplier|null}){
 const [name,setName]=useState('');
 const [taxId,setTaxId]=useState('');
 const [email,setEmail]=useState('');
 const [supplierType,setSupplierType]=useState<'goods'|'service'|'both'>('service');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [fieldErrors,setFieldErrors]=useState<FieldErrors>({});

 useEffect(()=>{
   if(!open) return;
   setName(supplier?.name ?? '');
   setTaxId(supplier?.taxId ?? '');
   setEmail(supplier?.email ?? '');
   setSupplierType(supplier?.supplierType ?? 'service');
   setError('');
   setFieldErrors({});
 },[open,supplier]);

 if(!open)return null;
 const editing=Boolean(supplier);
 const validate=()=>{
   const next:FieldErrors={};
   const nameMessage=nameError(name,'El nombre del proveedor');
   const taxMessage=taxIdError(taxId,false);
   const emailMessage=emailError(email,false);
   if(nameMessage)next.name=nameMessage;
   if(taxMessage)next.taxId=taxMessage;
   if(emailMessage)next.email=emailMessage;
   setFieldErrors(next);
   return !Object.keys(next).length;
 };
 const save=async()=>{
   if(!validate())return;
   setBusy(true);setError('');
   try{
     await onSave({name:name.trim(),taxId:taxId.trim()?normalizeTaxId(taxId):undefined,email:email.trim()?normalizeEmail(email):undefined,supplierType});
     onClose();
   }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar el proveedor.');}
   finally{setBusy(false)}
 };

 return <div className="modalBackdrop"><div className="modal smallModal">
   <div className="modalHead"><div><h3>{editing?'Editar proveedor':'Nuevo proveedor'}</h3><p>{editing?'Modifica los datos del proveedor.':'Se usará para clasificar facturas y productos.'}</p></div><button onClick={onClose}><X/></button></div>
   <div className="stackForm">
     <label>Nombre *<input aria-invalid={Boolean(fieldErrors.name)} value={name} onChange={e=>{setName(e.target.value);if(fieldErrors.name)setFieldErrors(current=>({...current,name:undefined}))}}/>{fieldErrors.name&&<small className="fieldValidationError">{fieldErrors.name}</small>}</label>
     <label>CIF/NIF<input aria-invalid={Boolean(fieldErrors.taxId)} autoCapitalize="characters" value={taxId} onChange={e=>{setTaxId(e.target.value);if(fieldErrors.taxId)setFieldErrors(current=>({...current,taxId:undefined}))}} placeholder="B12345678 / 12345678Z / ESB12345678"/>{fieldErrors.taxId&&<small className="fieldValidationError">{fieldErrors.taxId}</small>}</label>
     <label>Email<input aria-invalid={Boolean(fieldErrors.email)} type="email" inputMode="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);if(fieldErrors.email)setFieldErrors(current=>({...current,email:undefined}))}} placeholder="facturacion@empresa.com"/>{fieldErrors.email&&<small className="fieldValidationError">{fieldErrors.email}</small>}</label>
     <label>Tipo<select value={supplierType} onChange={e=>setSupplierType(e.target.value as 'goods'|'service'|'both')}><option value="service">Servicios</option><option value="goods">Mercancía</option><option value="both">Ambos</option></select></label>
   </div>
   {error&&<div className="errorBox">{error}</div>}
   <div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={save} disabled={busy||!name.trim()}>{busy?'Guardando…':editing?'Guardar cambios':'Crear proveedor'}</button></div>
 </div></div>
}
