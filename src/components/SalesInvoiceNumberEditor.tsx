import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Hash, Pencil, Search, X } from 'lucide-react';
import { ensureSalesSeries, loadSalesInvoices, type SalesInvoice } from '../services/sales';
import { updateSalesInvoiceNumber } from '../services/salesInvoiceNumber';
import { errorMessage, showSuccess } from '../services/toast';

const statusLabel=(status:SalesInvoice['status'])=>({draft:'Borrador',issued:'Emitida',sent:'Enviada',partially_paid:'Cobro parcial',paid:'Cobrada',rectified:'Rectificada'}[status]);

export function SalesInvoiceNumberEditor(){
  const [host,setHost]=useState<HTMLElement|null>(null);
  const [open,setOpen]=useState(false);
  const [invoices,setInvoices]=useState<SalesInvoice[]>([]);
  const [query,setQuery]=useState('');
  const [editing,setEditing]=useState<SalesInvoice|null>(null);
  const [number,setNumber]=useState('');
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    const locate=()=>{
      const pages=Array.from(document.querySelectorAll<HTMLElement>('.page'));
      const page=pages.find(item=>item.querySelector('h1')?.textContent?.trim()==='Facturación');
      setHost(page?.querySelector<HTMLElement>('.pageHead .actions')||null);
    };
    locate();
    const observer=new MutationObserver(locate);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);

  const refresh=async()=>{
    setLoading(true);setError('');
    try{setInvoices(await loadSalesInvoices());}
    catch(e){setError(errorMessage(e,'No se pudo cargar la numeración.'));}
    finally{setLoading(false);}
  };

  const show=()=>{setOpen(true);setQuery('');setEditing(null);setNumber('');void refresh();};
  const close=()=>{setOpen(false);setEditing(null);setNumber('');setError('');};

  const beginEdit=async(invoice:SalesInvoice)=>{
    setEditing(invoice);setError('');
    if(invoice.invoiceNumber){setNumber(invoice.invoiceNumber);return;}
    try{
      const year=Number(invoice.issueDate.slice(0,4));
      const series=await ensureSalesSeries(year);
      const current=series.find(item=>item.id===invoice.seriesId);
      setNumber(current?`${current.prefix}${String(current.nextNumber).padStart(current.padding,'0')}`:'');
    }catch{setNumber('');}
  };

  const save=async()=>{
    if(!editing)return;
    const clean=number.trim();
    if(!clean){setError('Indica un número de factura.');return;}
    setSaving(true);setError('');
    try{
      const previous=editing.invoiceNumber||'Sin número';
      await updateSalesInvoiceNumber(editing.id,clean);
      showSuccess(`Número actualizado: ${previous} → ${clean}`);
      window.location.reload();
    }catch(e){setError(errorMessage(e,'No se pudo actualizar el número de factura.'));setSaving(false);}
  };

  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();if(!q)return invoices;return invoices.filter(invoice=>[invoice.invoiceNumber||'borrador',invoice.clientName,invoice.clientTaxId||'',invoice.seriesName,statusLabel(invoice.status)].some(value=>value.toLowerCase().includes(q)));},[invoices,query]);

  if(!host)return null;
  return <>
    {createPortal(<button className="secondary" type="button" onClick={show} title="Modificar la numeración de facturas"><Hash size={17}/> Numeración</button>,host)}
    {open&&createPortal(<div className="modalBackdrop"><div className="modal polishedModal salesNumberModal"><div className="modalHead salesModalHead"><div><div className="eyebrow">FACTURACIÓN</div><h3>Numeración de facturas</h3><p>Puedes modificar el número también en facturas ya emitidas. La serie seguirá avanzando desde el número más alto confirmado.</p></div><button onClick={close}><X/></button></div>
      <div className="salesFormSection"><div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar número, cliente, CIF o estado…"/></div></div>
      {error&&<div className="errorBox">{error}</div>}
      <div className="salesNumberList">{loading?<div className="emptyState">Cargando facturas…</div>:filtered.length?filtered.map(invoice=><div className="salesNumberRow" key={invoice.id}><div><strong>{invoice.invoiceNumber||'Sin número'}</strong><span>{invoice.clientName} · {statusLabel(invoice.status)} · {invoice.seriesName}</span></div><button className="secondary" type="button" onClick={()=>void beginEdit(invoice)}><Pencil size={15}/> Editar</button></div>):<div className="emptyState">No hay facturas para esta búsqueda.</div>}</div>
      {editing&&<div className="salesNumberEditor"><div><strong>Número de factura</strong><span>{editing.clientName} · {statusLabel(editing.status)}</span></div><label>Número de factura<input autoFocus value={number} onChange={e=>setNumber(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void save();}} placeholder="F-2026-0187"/></label><small>Debe respetar el prefijo de la serie. Si introduces un número superior, el siguiente automático continuará a partir de él.</small><div className="modalActions"><button className="secondary" type="button" onClick={()=>{setEditing(null);setNumber('');}} disabled={saving}>Cancelar</button><button className="primary" type="button" onClick={()=>void save()} disabled={saving}>{saving?'Guardando…':'Guardar número'}</button></div></div>}
      <div className="modalActions salesStickyActions"><button className="secondary" onClick={close}>Cerrar</button></div>
    </div></div>,document.body)}
  </>;
}
