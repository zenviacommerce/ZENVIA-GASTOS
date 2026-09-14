import { useEffect, useMemo, useState } from 'react';
import { Building2, Mail, MapPin, Pencil, Phone, Search, Trash2, X } from 'lucide-react';
import { addClient, deleteClient, loadClients, updateClient, type Client, type ClientInput } from '../services/sales';
import { emailError, nameError, normalizeEmail, normalizePhone, normalizeTaxId, phoneError, taxIdError } from '../services/validation';
import '../sales.css';

const emptyClient = (): ClientInput => ({
  name: '', taxId: '', email: '', phone: '', addressLine1: '', addressLine2: '', postalCode: '', city: '', province: '', countryCode: 'ES', paymentTermsDays: 0, notes: '',
});

function ClientModal({open,client,onClose,onSaved}:{open:boolean;client:Client|null;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [form,setForm]=useState<ClientInput>(emptyClient());
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!open)return;
    setForm(client?{
      name:client.name,taxId:client.taxId||'',email:client.email||'',phone:client.phone||'',addressLine1:client.addressLine1||'',addressLine2:client.addressLine2||'',postalCode:client.postalCode||'',city:client.city||'',province:client.province||'',countryCode:client.countryCode||'ES',paymentTermsDays:client.paymentTermsDays||0,notes:client.notes||'',
    }:emptyClient());
    setError('');
  },[open,client]);

  if(!open)return null;
  const set=(key:keyof ClientInput,value:string|number)=>setForm(current=>({...current,[key]:value}));
  const save=async()=>{
    const validation = nameError(form.name,'El nombre o razón social') || taxIdError(form.taxId||'',false) || emailError(form.email||'',false) || phoneError(form.phone||'',false);
    if(validation){setError(validation);return;}
    setBusy(true);setError('');
    try{
      const payload:ClientInput={...form,name:form.name.trim(),taxId:form.taxId?normalizeTaxId(form.taxId):'',email:form.email?normalizeEmail(form.email):'',phone:form.phone?normalizePhone(form.phone):''};
      if(client)await updateClient(client.id,payload);else await addClient(payload);
      await onSaved();onClose();
    }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar el cliente.');}
    finally{setBusy(false)}
  };

  return <div className="modalBackdrop"><div className="modal salesClientModal">
    <div className="modalHead"><div><h3>{client?'Editar cliente':'Nuevo cliente'}</h3><p>Datos fiscales y de contacto que se usarán al emitir facturas.</p></div><button onClick={onClose}><X/></button></div>
    <div className="salesFormGrid">
      <label className="salesSpan2">Nombre / razón social *<input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Empresa o cliente"/></label>
      <label>CIF/NIF<input value={form.taxId||''} onChange={e=>set('taxId',e.target.value)} placeholder="B12345678"/></label>
      <label>País<input value={form.countryCode} maxLength={2} onChange={e=>set('countryCode',e.target.value.toUpperCase())}/></label>
      <label>Email<input type="email" value={form.email||''} onChange={e=>set('email',e.target.value)} placeholder="facturacion@cliente.com"/></label>
      <label>Teléfono<input type="tel" value={form.phone||''} onChange={e=>set('phone',e.target.value)} placeholder="+34 600 000 000"/></label>
      <label className="salesSpan2">Dirección<input value={form.addressLine1||''} onChange={e=>set('addressLine1',e.target.value)} placeholder="Calle, número"/></label>
      <label>Código postal<input value={form.postalCode||''} onChange={e=>set('postalCode',e.target.value)}/></label>
      <label>Ciudad<input value={form.city||''} onChange={e=>set('city',e.target.value)}/></label>
      <label>Provincia<input value={form.province||''} onChange={e=>set('province',e.target.value)}/></label>
      <label>Pago habitual<select value={form.paymentTermsDays} onChange={e=>set('paymentTermsDays',Number(e.target.value))}><option value={0}>Al contado</option><option value={15}>15 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label>
      <label className="salesSpan2">Notas<textarea rows={3} value={form.notes||''} onChange={e=>set('notes',e.target.value)} placeholder="Información interna sobre el cliente"/></label>
    </div>
    {error&&<div className="errorBox">{error}</div>}
    <div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={save} disabled={busy||!form.name.trim()}>{busy?'Guardando…':client?'Guardar cambios':'Crear cliente'}</button></div>
  </div></div>;
}

export function Clients(){
  const [clients,setClients]=useState<Client[]>([]);
  const [loading,setLoading]=useState(true);
  const [query,setQuery]=useState('');
  const [editing,setEditing]=useState<Client|null>(null);
  const [modal,setModal]=useState(false);
  const [error,setError]=useState('');
  const [busyId,setBusyId]=useState<string|null>(null);

  const refresh=async()=>{setLoading(true);try{setClients(await loadClients());setError('')}catch(e){setError(e instanceof Error?e.message:'No se pudieron cargar los clientes.')}finally{setLoading(false)}};
  useEffect(()=>{void refresh()},[]);
  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return !q?clients:clients.filter(c=>[c.name,c.taxId||'',c.email||'',c.city||''].some(v=>v.toLowerCase().includes(q)))},[clients,query]);
  const openNew=()=>{setEditing(null);setModal(true)};
  const openEdit=(client:Client)=>{setEditing(client);setModal(true)};
  const remove=async(client:Client)=>{
    if(!window.confirm(`¿Eliminar el cliente “${client.name}”?`))return;
    setBusyId(client.id);setError('');
    try{await deleteClient(client.id);await refresh()}catch(e){setError(e instanceof Error?e.message:'No se pudo eliminar el cliente.')}finally{setBusyId(null)}
  };

  return <div className="page">
    <div className="pageHead"><div><div className="eyebrow">VENTAS</div><h1>Clientes</h1><p>Datos fiscales, contacto y condiciones de pago para la facturación.</p></div><button className="primary" onClick={openNew}>+ Cliente</button></div>
    <div className="toolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar cliente, CIF, email o ciudad…"/></div><span>{filtered.length} cliente{filtered.length===1?'':'s'}</span></div>
    {error&&<div className="errorBox">{error}</div>}
    <div className="clientGrid">
      {loading?<div className="card emptyState large">Cargando clientes…</div>:filtered.length?filtered.map(client=><article className="card clientCard" key={client.id}>
        <div className="clientCardTop"><div className="clientIcon"><Building2/></div><div className="supplierActions"><button className="iconAction" onClick={()=>openEdit(client)} title="Editar cliente"><Pencil size={16}/></button><button className="iconAction danger" disabled={busyId===client.id} onClick={()=>remove(client)} title="Eliminar cliente"><Trash2 size={16}/></button></div></div>
        <h3>{client.name}</h3>
        <strong className="clientTax">{client.taxId||'CIF/NIF pendiente'}</strong>
        {client.email&&<span><Mail size={15}/>{client.email}</span>}
        {client.phone&&<span><Phone size={15}/>{client.phone}</span>}
        {(client.city||client.addressLine1)&&<span><MapPin size={15}/>{[client.addressLine1,client.postalCode,client.city].filter(Boolean).join(' · ')}</span>}
        <small>{client.paymentTermsDays?`Pago a ${client.paymentTermsDays} días`:'Pago al contado'}</small>
      </article>):<div className="card emptyState large">Todavía no hay clientes. Crea el primero para empezar a facturar.</div>}
    </div>
    <ClientModal open={modal} client={editing} onClose={()=>{setModal(false);setEditing(null)}} onSaved={refresh}/>
  </div>;
}
