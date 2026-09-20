import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, Calculator, ChevronRight, CircleDollarSign, FileText, Mail, MapPin, Pencil, Phone, Search, Trash2, UserRound, WalletCards, X } from 'lucide-react';
import { addClient, deleteClient, loadClients, loadSalesInvoices, updateClient, type Client, type ClientInput, type SalesInvoice } from '../services/sales';
import { emailError, nameError, normalizeEmail, normalizePhone, normalizeTaxId, phoneError, taxIdError } from '../services/validation';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { confirmAction, openActionProcess } from '../services/actionDialog';
import { Pagination } from '../components/Pagination';
import { FormGrid, FormModal, FormSection } from '../components/forms/FormPrimitives';
import { PostalAddressFields } from '../components/forms/PostalAddressFields';
import { SelectField } from '../components/forms/SelectField';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { PeriodFilterPanel } from '../components/PeriodFilterPanel';
import { StatCard } from '../components/StatCard';
import { defaultDateFilter, periodLabel } from '../services/filters';
import '../sales.css';

const PAGE_SIZE=20;
const emptyClient = (): ClientInput => ({
  name: '', taxId: '', email: '', phone: '', addressLine1: '', addressLine2: '', postalCode: '', city: '', province: '', countryCode: 'ES', paymentTermsDays: 0, notes: '',
});
const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const dateLabel=(value?:string|null)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('es-ES'):'—';
const EU_COUNTRIES=new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);

type ClientFilter='all'|'pending'|'settled'|'es'|'eu';
type ClientMetric={invoiced:number;pending:number;count:number;lastDate:string|null;recent:SalesInvoice[]};

function ClientModal({open,client,onClose,onSaved}:{open:boolean;client:Client|null;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [form,setForm]=useState<ClientInput>(emptyClient());
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const set=useCallback((key:keyof ClientInput,value:string|number)=>setForm(current=>({...current,[key]:value})),[]);
  const addressHandlers=useMemo(()=>({
    onCountryCodeChange:(value:string)=>set('countryCode',value),
    onPostalCodeChange:(value:string)=>set('postalCode',value),
    onCityChange:(value:string)=>set('city',value),
    onProvinceChange:(value:string)=>set('province',value),
  }),[set]);

  useEffect(()=>{
    if(!open)return;
    setForm(client?{
      name:client.name,taxId:client.taxId||'',email:client.email||'',phone:client.phone||'',addressLine1:client.addressLine1||'',addressLine2:client.addressLine2||'',postalCode:client.postalCode||'',city:client.city||'',province:client.province||'',countryCode:client.countryCode||'ES',paymentTermsDays:client.paymentTermsDays||0,notes:client.notes||'',
    }:emptyClient());
    setError('');
  },[open,client]);

  if(!open)return null;
  const save=async()=>{
    const validation = nameError(form.name,'El nombre o razón social') || taxIdError(form.taxId||'',false) || emailError(form.email||'',false) || phoneError(form.phone||'',false);
    if(validation){setError(validation);return;}
    setBusy(true);setError('');
    try{
      const payload:ClientInput={...form,name:form.name.trim(),taxId:form.taxId?normalizeTaxId(form.taxId):'',email:form.email?normalizeEmail(form.email):'',phone:form.phone?normalizePhone(form.phone):''};
      if(client)await updateClient(client.id,payload);else await addClient(payload);
      await onSaved();
      showSuccess(client?'Cliente actualizado correctamente.':'Cliente creado correctamente.');
      onClose();
    }catch(e){setError(errorMessage(e,'No se pudo guardar el cliente.'));}
    finally{setBusy(false)}
  };

  return <FormModal
    open={open}
    eyebrow="CLIENTES"
    title={client?'Editar cliente':'Nuevo cliente'}
    subtitle="Datos fiscales, contacto y condiciones de pago que se reutilizarán al facturar."
    onClose={onClose}
    className="salesClientModal"
    actions={<><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={save} disabled={busy||!form.name.trim()}>{busy?'Guardando…':client?'Guardar cambios':'Crear cliente'}</button></>}
  >
    <FormSection icon={<Building2 size={18}/>} title="Identificación" subtitle="Razón social y datos fiscales">
      <FormGrid>
        <label className="formSpan2">Nombre / razón social *<input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Empresa o cliente"/></label>
        <label>CIF/NIF<input value={form.taxId||''} onChange={e=>set('taxId',e.target.value)} placeholder="B12345678"/></label>
      </FormGrid>
    </FormSection>
    <FormSection icon={<UserRound size={18}/>} title="Contacto y dirección" subtitle="Información para envío y documentación">
      <FormGrid>
        <label>Email<input type="email" value={form.email||''} onChange={e=>set('email',e.target.value)} placeholder="facturacion@cliente.com"/></label>
        <label>Teléfono<input type="tel" value={form.phone||''} onChange={e=>set('phone',e.target.value)} placeholder="+34 600 000 000"/></label>
        <label className="formSpan2">Dirección<input value={form.addressLine1||''} onChange={e=>set('addressLine1',e.target.value)} placeholder="Calle, número" autoComplete="street-address"/></label>
        <PostalAddressFields
          countryCode={form.countryCode||'ES'}
          postalCode={form.postalCode||''}
          city={form.city||''}
          province={form.province||''}
          {...addressHandlers}
        />
      </FormGrid>
    </FormSection>
    <FormSection icon={<WalletCards size={18}/>} title="Condiciones comerciales" subtitle="Plazo de pago y notas internas">
      <FormGrid>
        <label>Pago habitual<SelectField value={String(form.paymentTermsDays||0)} options={[{value:'0',label:'Al contado'},{value:'15',label:'15 días'},{value:'30',label:'30 días'},{value:'60',label:'60 días'},{value:'90',label:'90 días'}]} onChange={value=>set('paymentTermsDays',Number(value))} ariaLabel="Pago habitual"/></label>
        <label className="formSpan2">Notas<textarea rows={3} value={form.notes||''} onChange={e=>set('notes',e.target.value)} placeholder="Información interna sobre el cliente"/></label>
      </FormGrid>
    </FormSection>
    {error&&<div className="errorBox">{error}</div>}
  </FormModal>;
}

function ClientDrawer({client,metric,period,onClose,onEdit,onDelete,busy}:{client:Client;metric:ClientMetric;period:string;onClose:()=>void;onEdit:()=>void;onDelete:()=>void;busy:boolean}){
  const address=[client.addressLine1,client.addressLine2,[client.postalCode,client.city].filter(Boolean).join(' '),client.province,client.countryCode].filter(Boolean).join(', ');
  return <div className="masterDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <aside className="masterDrawer">
      <div className="masterDrawerHead"><div><div className="eyebrow">CLIENTE</div><h2>{client.name}</h2><p>{client.taxId||'CIF/NIF pendiente'}</p></div><button className="iconBtn" onClick={onClose}><X size={18}/></button></div>
      <div className="masterDrawerPeriod"><CalendarDays size={14}/><span>{period}</span></div>
      <div className="masterDrawerKpis"><div><span>Facturado</span><strong>{money(metric.invoiced)}</strong></div><div><span>Pendiente</span><strong>{money(metric.pending)}</strong></div><div><span>Facturas</span><strong>{metric.count}</strong></div></div>
      <section className="masterDrawerSection"><h3>Datos del cliente</h3><div className="masterInfoList">
        <div><span><Building2 size={15}/> Fiscal</span><strong>{client.taxId||'Sin CIF/NIF'}</strong></div>
        <div><span><Mail size={15}/> Email</span><strong>{client.email||'Sin email'}</strong></div>
        <div><span><Phone size={15}/> Teléfono</span><strong>{client.phone||'Sin teléfono'}</strong></div>
        <div><span><MapPin size={15}/> Dirección</span><strong>{address||'Sin dirección'}</strong></div>
        <div><span><WalletCards size={15}/> Pago</span><strong>{client.paymentTermsDays?`${client.paymentTermsDays} días`:'Al contado'}</strong></div>
      </div></section>
      {client.notes&&<section className="masterDrawerSection"><h3>Notas</h3><p className="masterNotes">{client.notes}</p></section>}
      <section className="masterDrawerSection"><div className="masterSectionHead"><h3>Facturas del periodo</h3><span>{metric.lastDate?`Última ${dateLabel(metric.lastDate)}`:'Sin facturas'}</span></div>
        {metric.recent.length?<div className="masterRecentList">{metric.recent.map(invoice=><div key={invoice.id}><div><strong>{invoice.invoiceNumber||'Borrador'}</strong><span>{dateLabel(invoice.issueDate)} · {invoice.status==='draft'?'Borrador':'Emitida'}</span></div><b>{money(invoice.totalAmount)}</b></div>)}</div>:<div className="masterEmptyMini">No tiene facturas en el periodo seleccionado.</div>}
      </section>
      <div className="masterDrawerActions"><button className="secondary" onClick={onEdit}><Pencil size={16}/> Editar</button><button className="secondary dangerText" disabled={busy} onClick={onDelete}><Trash2 size={16}/> Eliminar</button></div>
    </aside>
  </div>;
}

export function Clients(){
  const [clients,setClients]=useState<Client[]>([]);
  const [invoices,setInvoices]=useState<SalesInvoice[]>([]);
  const [loading,setLoading]=useState(true);
  const [query,setQuery]=useState('');
  const [dateFilter,setDateFilter]=useState(defaultDateFilter);
  const [filter,setFilter]=useState<ClientFilter>('all');
  const [editing,setEditing]=useState<Client|null>(null);
  const [selected,setSelected]=useState<Client|null>(null);
  const [modal,setModal]=useState(false);
  const [error,setError]=useState('');
  const [busyId,setBusyId]=useState<string|null>(null);
  const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
  const [bulkBusy,setBulkBusy]=useState(false);
  const [page,setPage]=useState(1);

  const refresh=async()=>{setLoading(true);try{const [nextClients,nextInvoices]=await Promise.all([loadClients(),loadSalesInvoices()]);setClients(nextClients);setInvoices(nextInvoices);setSelected(current=>current?nextClients.find(c=>c.id===current.id)||null:null);setError('')}catch(e){setError(errorMessage(e,'No se pudieron cargar los clientes.'))}finally{setLoading(false)}};
  useEffect(()=>{void refresh()},[]);

  const selectedPeriod=periodLabel(dateFilter);
  const periodInvoices=useMemo(()=>invoices.filter(invoice=>(!dateFilter.from||invoice.issueDate>=dateFilter.from)&&(!dateFilter.to||invoice.issueDate<=dateFilter.to)),[invoices,dateFilter]);
  const metrics=useMemo(()=>{
    const map=new Map<string,ClientMetric>();
    for(const client of clients)map.set(client.id,{invoiced:0,pending:0,count:0,lastDate:null,recent:[]});
    const ordered=[...periodInvoices].sort((a,b)=>b.issueDate.localeCompare(a.issueDate));
    for(const invoice of ordered){
      const metric=map.get(invoice.clientId);if(!metric)continue;
      const registered=invoice.status!=='draft';if(registered){metric.invoiced+=invoice.totalAmount;metric.count+=1;if(!metric.lastDate||invoice.issueDate>metric.lastDate)metric.lastDate=invoice.issueDate;}
      if(invoice.invoiceType==='standard'&&!['draft','paid','rectified'].includes(invoice.status))metric.pending+=Math.max(0,invoice.totalAmount-invoice.paidAmount);
      if(metric.recent.length<5)metric.recent.push(invoice);
    }
    return map;
  },[clients,periodInvoices]);

  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return clients.filter(c=>{
    const metric=metrics.get(c.id)!;
    const matchesQuery=!q||[c.name,c.taxId||'',c.email||'',c.phone||'',c.city||''].some(v=>v.toLowerCase().includes(q));
    const country=(c.countryCode||'').toUpperCase();
    const matchesFilter=filter==='all'||(filter==='pending'&&metric.pending>0.005)||(filter==='settled'&&metric.pending<=0.005)||(filter==='es'&&country==='ES')||(filter==='eu'&&country!=='ES'&&EU_COUNTRIES.has(country));
    return matchesQuery&&matchesFilter;
  })},[clients,metrics,query,filter]);
  const selectedClients=filtered.filter(client=>checkedIds.has(client.id));
  const allFilteredSelected=filtered.length>0&&filtered.every(client=>checkedIds.has(client.id));
  const toggleClient=(id:string,checked:boolean)=>setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
  const toggleAllClients=(checked:boolean)=>setCheckedIds(checked?new Set(filtered.map(client=>client.id)):new Set());
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const paged=useMemo(()=>filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[filtered,page]);
  useEffect(()=>{setPage(1);setCheckedIds(new Set())},[query,filter,dateFilter]);
  useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);

  const totals=useMemo(()=>{
    const active=filtered.filter(client=>(metrics.get(client.id)?.count||0)>0).length;
    const invoiced=filtered.reduce((sum,client)=>sum+(metrics.get(client.id)?.invoiced||0),0);
    const pending=filtered.reduce((sum,client)=>sum+(metrics.get(client.id)?.pending||0),0);
    const invoiceCount=filtered.reduce((sum,client)=>sum+(metrics.get(client.id)?.count||0),0);
    return {active,invoiced,pending,invoiceCount,average:invoiceCount?invoiced/invoiceCount:0};
  },[filtered,metrics]);
  const openNew=()=>{setEditing(null);setModal(true)};
  const openEdit=(client:Client)=>{setSelected(null);setEditing(client);setModal(true)};
  const remove=async(client:Client)=>{
    const confirmed=await confirmAction({title:'Eliminar cliente',message:`Se eliminará “${client.name}”.`,confirmLabel:'Eliminar',tone:'danger',details:['Si tiene facturas asociadas, la aplicación impedirá el borrado.']});
    if(!confirmed)return;
    setBusyId(client.id);setError('');
    try{await deleteClient(client.id);setSelected(null);await refresh();showSuccess('Cliente eliminado correctamente.');}
    catch(e){showError(errorMessage(e,'No se pudo eliminar el cliente.'));}
    finally{setBusyId(null)}
  };
  const removeSelected=async()=>{
    if(!selectedClients.length)return;
    const confirmed=await confirmAction({title:`Eliminar ${selectedClients.length} cliente${selectedClients.length===1?'':'s'}`,message:'Se intentarán eliminar los clientes seleccionados.',confirmLabel:'Eliminar seleccionados',tone:'danger',details:['Los clientes con facturas asociadas se conservarán y se indicará el motivo.']});
    if(!confirmed)return;
    setBulkBusy(true);setError('');
    const process=openActionProcess({title:'Eliminando clientes',description:'El resultado permanecerá visible al terminar.',items:selectedClients.map(client=>({id:client.id,label:client.name}))});
    let removed=0;let failed=0;
    try{
      for(const client of selectedClients){
        process.setItem(client.id,'running','Eliminando…');
        try{await deleteClient(client.id);removed+=1;process.setItem(client.id,'success','Eliminado correctamente.');}
        catch(e){failed+=1;process.setItem(client.id,'error',errorMessage(e,'No se pudo eliminar el cliente.'));}
      }
      setCheckedIds(new Set());await refresh();
      process.finish(`${removed} eliminado${removed===1?'':'s'}.${failed?` ${failed} con error.`:''}`,failed?(removed?'warning':'error'):'success');
    }finally{setBulkBusy(false);}
  };

  return <div className="page masterPage">
    <div className="pageHead"><div><div className="eyebrow">VENTAS · {selectedPeriod}</div><h1>Clientes</h1><p>Directorio comercial, facturación y situación de cobro por periodo.</p></div><button className="primary" onClick={openNew}>+ Cliente</button></div>
    <PeriodFilterPanel filter={dateFilter} onChange={setDateFilter} title="Periodo comercial"/>
    <div className="stats masterStats normalizedKpiStats">
      <StatCard label="Clientes con actividad" value={String(totals.active)} sub={`de ${filtered.length} visibles · ${selectedPeriod}`} icon={<UserRound/>}/>
      <StatCard label="Facturado" value={money(totals.invoiced)} sub={selectedPeriod} icon={<CircleDollarSign/>}/>
      <StatCard label="Pendiente de cobro" value={money(totals.pending)} sub={selectedPeriod} icon={<WalletCards/>}/>
      <StatCard label="Facturas emitidas" value={String(totals.invoiceCount)} sub={selectedPeriod} icon={<FileText/>}/>
      <StatCard label="Ticket medio" value={money(totals.average)} sub="Media por factura emitida" icon={<Calculator/>}/>
    </div>
    <div className="masterToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar cliente, CIF, email, teléfono o ciudad…"/></div><div className="masterFilters"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>Todos</button><button className={filter==='pending'?'active':''} onClick={()=>setFilter('pending')}>Con pendiente</button><button className={filter==='settled'?'active':''} onClick={()=>setFilter('settled')}>Sin pendiente</button><button className={filter==='es'?'active':''} onClick={()=>setFilter('es')}>España</button><button className={filter==='eu'?'active':''} onClick={()=>setFilter('eu')}>UE</button></div></div>
    {filtered.length>0&&<BulkSelectionToolbar selectedCount={selectedClients.length} totalCount={filtered.length} allSelected={allFilteredSelected} onToggleAll={toggleAllClients} label="clientes">
      <button className="secondary dangerText" type="button" disabled={!selectedClients.length||bulkBusy} onClick={()=>void removeSelected()}><Trash2 size={15}/> {bulkBusy?'Eliminando…':`Eliminar seleccionados (${selectedClients.length})`}</button>
    </BulkSelectionToolbar>}
    {error&&<div className="errorBox">{error}</div>}
    <section className="card tableCard masterTableCard">{loading?<div className="emptyState large">Cargando clientes…</div>:filtered.length?<table className="masterTable"><thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allFilteredSelected} onChange={toggleAllClients} label={allFilteredSelected?'Deseleccionar clientes visibles':'Seleccionar clientes visibles'}/></th><th>Cliente</th><th>CIF/NIF</th><th>País</th><th>Contacto</th><th className="right">Facturado</th><th className="right">Pendiente</th><th>Última factura</th><th></th></tr></thead><tbody>{paged.map(client=>{const metric=metrics.get(client.id)!;return <tr key={client.id} className={`clickableRow ${checkedIds.has(client.id)?'bulkSelectedRow':''}`} onClick={()=>setSelected(client)}><td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={checkedIds.has(client.id)} onChange={checked=>toggleClient(client.id,checked)} label={`Seleccionar ${client.name}`}/></td><td><div className="masterEntityCell"><div className="masterAvatar"><UserRound size={17}/></div><div><strong>{client.name}</strong><small>{client.city||'Sin ciudad'}</small></div></div></td><td>{client.taxId||<span className="muted">Pendiente</span>}</td><td><span className="masterCountry">{client.countryCode&&client.countryCode!=='XX'?client.countryCode:'Pendiente'}</span></td><td><div className="masterContactCell"><span>{client.email||'—'}</span><small>{client.phone||''}</small></div></td><td className="right"><strong>{money(metric.invoiced)}</strong></td><td className="right"><strong className={metric.pending>0.005?'masterPending':''}>{money(metric.pending)}</strong></td><td>{dateLabel(metric.lastDate)}</td><td className="right"><ChevronRight size={17}/></td></tr>})}</tbody></table>:<div className="emptyState large">No hay clientes para los filtros seleccionados.</div>}</section>
    {!loading&&filtered.length>0&&<div className="masterMobileList">{paged.map(client=>{const metric=metrics.get(client.id)!;return <div className={`bulkMobileSelectableRow ${checkedIds.has(client.id)?'selected':''}`} key={client.id}><BulkSelectCheckbox checked={checkedIds.has(client.id)} onChange={checked=>toggleClient(client.id,checked)} label={`Seleccionar ${client.name}`}/><button className="card masterMobileRow" onClick={()=>setSelected(client)}><div className="masterEntityCell"><div className="masterAvatar"><UserRound size={17}/></div><div><strong>{client.name}</strong><small>{client.taxId||'CIF/NIF pendiente'} · {client.countryCode&&client.countryCode!=='XX'?client.countryCode:'Pendiente'}</small></div></div><div className="masterMobileAmounts"><span>Facturado <strong>{money(metric.invoiced)}</strong></span><span>Pendiente <strong className={metric.pending>0.005?'masterPending':''}>{money(metric.pending)}</strong></span></div><ChevronRight size={18}/></button></div>})}</div>}
    {!loading&&filtered.length>0&&<Pagination page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage}/>}
    <ClientModal open={modal} client={editing} onClose={()=>{setModal(false);setEditing(null)}} onSaved={refresh}/>
    {selected&&<ClientDrawer client={selected} metric={metrics.get(selected.id)||{invoiced:0,pending:0,count:0,lastDate:null,recent:[]}} period={selectedPeriod} onClose={()=>setSelected(null)} onEdit={()=>openEdit(selected)} onDelete={()=>remove(selected)} busy={busyId===selected.id}/>} 
  </div>;
}
