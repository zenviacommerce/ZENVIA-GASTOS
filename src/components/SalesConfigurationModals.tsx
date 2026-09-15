import { useEffect, useState } from 'react';
import { BadgeEuro, Check, CirclePlus, Pencil, ReceiptText, Save, Trash2, X } from 'lucide-react';
import {
  addSalesSeries, addTaxRegistration, deleteSalesSeries, deleteTaxRegistration,
  loadManagedSalesSeries, loadTaxRegistrations, updateSalesSeries, updateTaxRegistration,
  type ManagedSalesSeries, type SalesSeriesInput, type TaxRegistration, type TaxRegistrationInput,
} from '../services/salesConfig';
import { errorMessage, showError, showSuccess } from '../services/toast';

const countryName=(code:string)=>({ES:'España',FR:'Francia',DE:'Alemania',IT:'Italia',PT:'Portugal',IE:'Irlanda',NL:'Países Bajos',BE:'Bélgica',PL:'Polonia',CZ:'Chequia',SE:'Suecia',AT:'Austria'}[code.toUpperCase()]||code.toUpperCase());

const emptyTax=():TaxRegistrationInput=>({label:'',countryCode:'ES',vatNumber:'',fiscalName:'',addressText:'',isDefault:false,active:true,notes:''});

export function TaxRegistrationsPanel({onChanged}:{onChanged?:()=>void|Promise<void>}){
  const [items,setItems]=useState<TaxRegistration[]>([]);const [editing,setEditing]=useState<string|null>(null);const [form,setForm]=useState<TaxRegistrationInput>(emptyTax());const [busy,setBusy]=useState(false);
  const refresh=async()=>{try{setItems(await loadTaxRegistrations());}catch(e){showError(errorMessage(e,'No se pudieron cargar los registros IVA.'));}};
  useEffect(()=>{void refresh();},[]);
  const edit=(item:TaxRegistration)=>{setEditing(item.id);setForm({label:item.label,countryCode:item.countryCode,vatNumber:item.vatNumber,fiscalName:item.fiscalName||'',addressText:item.addressText||'',isDefault:item.isDefault,active:item.active,notes:item.notes||''});};
  const reset=()=>{setEditing(null);setForm(emptyTax());};
  const save=async()=>{
    if(!form.label.trim()||form.countryCode.trim().length!==2||!form.vatNumber.trim()){showError('Completa nombre, país y número de IVA.');return;}
    setBusy(true);
    try{if(editing)await updateTaxRegistration(editing,form);else await addTaxRegistration(form);await refresh();await onChanged?.();showSuccess(editing?'Registro IVA actualizado.':'Registro IVA añadido.');reset();}
    catch(e){showError(errorMessage(e,'No se pudo guardar el registro IVA.'));}finally{setBusy(false);}
  };
  const remove=async(item:TaxRegistration)=>{if(!window.confirm(`¿Eliminar el registro IVA ${item.label} (${item.vatNumber})?`))return;setBusy(true);try{await deleteTaxRegistration(item.id);await refresh();await onChanged?.();showSuccess('Registro IVA eliminado.');if(editing===item.id)reset();}catch(e){showError(errorMessage(e,'No se pudo eliminar el registro IVA.'));}finally{setBusy(false);}};
  return <div className="taxRegistrationManager">
    <div className="configList">{items.length?items.map(item=><div className={`configRow ${item.active?'':'isInactive'}`} key={item.id}>
      <div className="configRowIcon"><BadgeEuro size={17}/></div><div className="configRowMain"><strong>{item.label}</strong><span>{countryName(item.countryCode)} · {item.vatNumber}{item.isDefault?' · Predeterminado':''}</span>{item.fiscalName&&<small>{item.fiscalName}</small>}</div>
      <div className="configRowActions"><button type="button" className="iconBtn" title="Editar" onClick={()=>edit(item)}><Pencil size={15}/></button><button type="button" className="iconBtn dangerIcon" title="Eliminar" onClick={()=>remove(item)} disabled={busy}><Trash2 size={15}/></button></div>
    </div>):<div className="configEmpty">No hay registros IVA. Añade España, Francia, Alemania o cualquier otro país desde el que factures.</div>}</div>
    <div className="configEditor"><div className="configEditorHead"><strong>{editing?'Editar registro IVA':'Nuevo registro IVA'}</strong>{editing&&<button type="button" className="link" onClick={reset}>Cancelar edición</button>}</div>
      <div className="salesFormGrid"><label>Nombre / etiqueta<input value={form.label} onChange={e=>setForm(v=>({...v,label:e.target.value}))} placeholder="Francia Amazon"/></label><label>País<input maxLength={2} value={form.countryCode} onChange={e=>setForm(v=>({...v,countryCode:e.target.value.toUpperCase()}))} placeholder="FR"/></label><label className="salesSpan2">Nº IVA / VAT<input value={form.vatNumber} onChange={e=>setForm(v=>({...v,vatNumber:e.target.value.toUpperCase()}))} placeholder="FR..."/></label><label className="salesSpan2">Nombre fiscal alternativo <span className="optionalLabel">opcional</span><input value={form.fiscalName||''} onChange={e=>setForm(v=>({...v,fiscalName:e.target.value}))} placeholder="Vacío = ZENVIA COMMERCE SL"/></label><label className="salesSpan2">Dirección fiscal alternativa <span className="optionalLabel">opcional</span><input value={form.addressText||''} onChange={e=>setForm(v=>({...v,addressText:e.target.value}))} placeholder="Vacío = dirección fiscal principal"/></label></div>
      <div className="configChecks"><label><input type="checkbox" checked={form.isDefault} onChange={e=>setForm(v=>({...v,isDefault:e.target.checked}))}/><span>Usar por defecto en facturas nuevas</span></label><label><input type="checkbox" checked={form.active} onChange={e=>setForm(v=>({...v,active:e.target.checked}))}/><span>Registro activo</span></label></div>
      <button type="button" className="secondary configSave" onClick={save} disabled={busy}><Save size={15}/>{busy?'Guardando…':editing?'Guardar cambios':'Añadir registro IVA'}</button>
    </div>
  </div>;
}

const emptySeries=():SalesSeriesInput=>({code:'',name:'',kind:'standard',year:new Date().getFullYear(),prefix:'',nextNumber:1,padding:4,active:true});

export function SeriesManagerModal({open,onClose,onChanged}:{open:boolean;onClose:()=>void;onChanged?:()=>void|Promise<void>}){
  const [items,setItems]=useState<ManagedSalesSeries[]>([]);const [editing,setEditing]=useState<string|null>(null);const [form,setForm]=useState<SalesSeriesInput>(emptySeries());const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const refresh=async()=>{try{setItems(await loadManagedSalesSeries());setError('');}catch(e){setError(errorMessage(e,'No se pudieron cargar las series.'));}};
  useEffect(()=>{if(open)void refresh();},[open]);if(!open)return null;
  const edit=(item:ManagedSalesSeries)=>{setEditing(item.id);setForm({code:item.code,name:item.name,kind:item.kind,year:item.year,prefix:item.prefix,nextNumber:item.nextNumber,padding:item.padding,active:item.active});};
  const reset=()=>{setEditing(null);setForm(emptySeries());};
  const save=async()=>{if(!form.code.trim()||!form.name.trim()||!form.prefix.trim()||form.year<2000){setError('Completa código, nombre, año y prefijo.');return;}setBusy(true);setError('');try{if(editing)await updateSalesSeries(editing,form);else await addSalesSeries(form);await refresh();await onChanged?.();showSuccess(editing?'Serie actualizada.':'Serie creada.');reset();}catch(e){const m=errorMessage(e,'No se pudo guardar la serie.');setError(m);showError(m);}finally{setBusy(false);}};
  const remove=async(item:ManagedSalesSeries)=>{if(!window.confirm(`¿Eliminar la serie ${item.name}? Si ya tiene facturas asociadas no se podrá borrar.`))return;setBusy(true);try{await deleteSalesSeries(item.id);await refresh();await onChanged?.();showSuccess('Serie eliminada.');if(editing===item.id)reset();}catch(e){showError(errorMessage(e,'No se pudo eliminar la serie.'));}finally{setBusy(false);}};
  return <div className="modalBackdrop"><div className="modal salesConfigModal polishedModal"><div className="modalHead salesModalHead"><div><div className="eyebrow">CONFIGURACIÓN</div><h3>Series de facturación</h3><p>Crea series distintas por canal, país o tipo de factura y controla su numeración.</p></div><button onClick={onClose}><X/></button></div>
    <section className="salesFormSection"><div className="salesSectionTitle"><ReceiptText size={18}/><div><strong>Series disponibles</strong><span>Las series con facturas asociadas pueden desactivarse aunque no se puedan eliminar</span></div></div><div className="configList seriesConfigList">{items.map(item=><div className={`configRow ${item.active?'':'isInactive'}`} key={item.id}><div className="configRowMain"><strong>{item.name}</strong><span>{item.kind==='rectifying'?'Rectificativa':'Ordinaria'} · {item.year} · {item.prefix}{String(item.nextNumber).padStart(item.padding,'0')}</span><small>{item.active?'Activa':'Inactiva'} · código {item.code}</small></div><div className="configRowActions"><button className="iconBtn" onClick={()=>edit(item)} title="Editar serie"><Pencil size={15}/></button><button className="iconBtn dangerIcon" onClick={()=>remove(item)} title="Eliminar serie" disabled={busy}><Trash2 size={15}/></button></div></div>)}</div></section>
    <section className="salesFormSection"><div className="salesSectionTitle"><CirclePlus size={18}/><div><strong>{editing?'Editar serie':'Nueva serie'}</strong><span>El prefijo se combina con el siguiente número disponible</span></div></div><div className="salesFormGrid"><label>Código<input value={form.code} onChange={e=>setForm(v=>({...v,code:e.target.value.toUpperCase()}))} placeholder="WEB"/></label><label>Nombre<input value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder="Facturas web 2026"/></label><label>Tipo<select value={form.kind} onChange={e=>setForm(v=>({...v,kind:e.target.value as 'standard'|'rectifying'}))}><option value="standard">Ordinaria</option><option value="rectifying">Rectificativa</option></select></label><label>Año<input type="number" value={form.year} onChange={e=>setForm(v=>({...v,year:Number(e.target.value)}))}/></label><label>Prefijo<input value={form.prefix} onChange={e=>setForm(v=>({...v,prefix:e.target.value}))} placeholder="WEB-2026-"/></label><label>Siguiente número<input type="number" min="1" value={form.nextNumber} onChange={e=>setForm(v=>({...v,nextNumber:Number(e.target.value)}))}/></label><label>Longitud número<input type="number" min="1" max="8" value={form.padding} onChange={e=>setForm(v=>({...v,padding:Number(e.target.value)}))}/></label><label className="configCheckboxLabel"><input type="checkbox" checked={form.active} onChange={e=>setForm(v=>({...v,active:e.target.checked}))}/><span>Serie activa</span></label></div>{error&&<div className="errorBox">{error}</div>}<div className="configEditorActions">{editing&&<button className="secondary" onClick={reset}>Cancelar edición</button>}<button className="primary" onClick={save} disabled={busy}><Check size={15}/>{busy?'Guardando…':editing?'Guardar serie':'Crear serie'}</button></div></section>
    <div className="modalActions salesStickyActions"><button className="secondary" onClick={onClose}>Cerrar</button></div>
  </div></div>;
}
