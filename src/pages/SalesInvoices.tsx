import { useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, Download, FileCheck2, FilePenLine, MailCheck, Pencil, Plus, ReceiptText, Search, Send, Settings2, Trash2, X } from 'lucide-react';
import {
  addSalesPayment, createSalesInvoiceDraft, deleteSalesInvoiceDraft, downloadSalesInvoicePdf, ensureSalesSeries, issueSalesInvoice,
  loadBusinessSettings, loadClients, loadSalesInvoices, markSalesInvoiceSent, saveBusinessSettings, updateSalesInvoiceDraft,
  type BusinessSettings, type Client, type SalesInvoice, type SalesInvoiceDraftInput, type SalesInvoiceLine, type SalesInvoiceSeries,
} from '../services/sales';
import '../sales.css';

const today=()=>new Date().toISOString().slice(0,10);
const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const statusLabel=(status:SalesInvoice['status'])=>({draft:'Borrador',issued:'Emitida',sent:'Enviada',partially_paid:'Cobro parcial',paid:'Cobrada',rectified:'Rectificada'}[status]);
const statusClass=(status:SalesInvoice['status'])=>`salesStatus ${status}`;

function emptyLine(position=1):SalesInvoiceLine{return {position,description:'',quantity:1,unit:'ud',unitPrice:0,discountPercent:0,taxRate:21}}
function calcLine(line:SalesInvoiceLine){const gross=line.quantity*line.unitPrice;const net=gross*(1-(line.discountPercent||0)/100);const tax=net*(line.taxRate||0)/100;return {net,tax,total:net+tax}}

function InvoiceModal({open,invoice,clients,series,onClose,onSaved}:{open:boolean;invoice:SalesInvoice|null;clients:Client[];series:SalesInvoiceSeries[];onClose:()=>void;onSaved:()=>Promise<void>}){
 const standardSeries=series.find(item=>item.kind==='standard');
 const [clientId,setClientId]=useState(''); const [seriesId,setSeriesId]=useState(''); const [issueDate,setIssueDate]=useState(today()); const [operationDate,setOperationDate]=useState(''); const [dueDate,setDueDate]=useState(''); const [paymentMethod,setPaymentMethod]=useState('Transferencia bancaria'); const [notes,setNotes]=useState(''); const [lines,setLines]=useState<SalesInvoiceLine[]>([emptyLine()]); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 useEffect(()=>{
   if(!open)return;
   if(invoice){setClientId(invoice.clientId);setSeriesId(invoice.seriesId);setIssueDate(invoice.issueDate);setOperationDate(invoice.operationDate||'');setDueDate(invoice.dueDate||'');setPaymentMethod(invoice.paymentMethod||'');setNotes(invoice.notes||'');setLines(invoice.lines.length?invoice.lines.map((line,index)=>({...line,position:index+1})):[emptyLine()]);}
   else{setClientId(clients[0]?.id||'');setSeriesId(standardSeries?.id||series[0]?.id||'');setIssueDate(today());setOperationDate('');setPaymentMethod('Transferencia bancaria');setNotes('');setLines([emptyLine()]);const client=clients[0];if(client?.paymentTermsDays){const d=new Date();d.setDate(d.getDate()+client.paymentTermsDays);setDueDate(d.toISOString().slice(0,10));}else setDueDate('');}
   setError('');
 },[open,invoice,clients,series,standardSeries?.id]);
 if(!open)return null;
 const editing=Boolean(invoice);
 const updateLine=(index:number,patch:Partial<SalesInvoiceLine>)=>setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
 const removeLine=(index:number)=>setLines(current=>current.length===1?[emptyLine()]:current.filter((_,i)=>i!==index).map((line,i)=>({...line,position:i+1})));
 const chooseClient=(value:string)=>{setClientId(value);const client=clients.find(c=>c.id===value);if(client?.paymentTermsDays){const d=new Date(`${issueDate}T12:00:00`);d.setDate(d.getDate()+client.paymentTermsDays);setDueDate(d.toISOString().slice(0,10));}};
 const totals=lines.reduce((acc,line)=>{const x=calcLine(line);acc.gross+=line.quantity*line.unitPrice;acc.net+=x.net;acc.tax+=x.tax;acc.total+=x.total;return acc},{gross:0,net:0,tax:0,total:0});
 const save=async()=>{
   if(!clientId){setError('Selecciona un cliente.');return} if(!seriesId){setError('Selecciona una serie.');return}
   const cleanLines=lines.filter(line=>line.description.trim()); if(!cleanLines.length){setError('Añade al menos una línea a la factura.');return}
   if(cleanLines.some(line=>line.quantity<=0||line.unitPrice<0)){setError('Revisa cantidades y precios.');return}
   setBusy(true);setError('');
   const payload:SalesInvoiceDraftInput={clientId,seriesId,issueDate,operationDate:operationDate||undefined,dueDate:dueDate||undefined,paymentMethod:paymentMethod||undefined,notes:notes||undefined,lines:cleanLines};
   try{if(invoice)await updateSalesInvoiceDraft(invoice.id,payload);else await createSalesInvoiceDraft(payload);await onSaved();onClose();}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar la factura.')}finally{setBusy(false)}
 };
 return <div className="modalBackdrop"><div className="modal salesInvoiceModal">
   <div className="modalHead"><div><h3>{editing?'Editar borrador':'Nueva factura'}</h3><p>El número definitivo se asignará únicamente cuando emitas la factura.</p></div><button onClick={onClose}><X/></button></div>
   <div className="salesInvoiceMeta">
    <label>Cliente *<select value={clientId} onChange={e=>chooseClient(e.target.value)}><option value="">Selecciona cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}{c.taxId?` · ${c.taxId}`:''}</option>)}</select></label>
    <label>Serie<select value={seriesId} onChange={e=>setSeriesId(e.target.value)}>{series.filter(s=>s.kind==='standard').map(s=><option key={s.id} value={s.id}>{s.name} · próximo {s.prefix}{String(s.nextNumber).padStart(s.padding,'0')}</option>)}</select></label>
    <label>Fecha factura<input type="date" value={issueDate} onChange={e=>setIssueDate(e.target.value)}/></label>
    <label>Fecha operación<input type="date" value={operationDate} onChange={e=>setOperationDate(e.target.value)}/></label>
    <label>Vencimiento<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
    <label>Forma de pago<input value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} placeholder="Transferencia, tarjeta…"/></label>
   </div>
   <div className="salesLinesEditor">
    <div className="salesLinesHead"><strong>Conceptos</strong><button className="secondary" onClick={()=>setLines(current=>[...current,emptyLine(current.length+1)])}><Plus size={15}/> Línea</button></div>
    {lines.map((line,index)=>{const total=calcLine(line).total;return <div className="salesLine" key={index}>
      <label className="salesLineDescription">Descripción<input value={line.description} onChange={e=>updateLine(index,{description:e.target.value})} placeholder="Producto o servicio facturado"/></label>
      <label>Cantidad<input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updateLine(index,{quantity:Number(e.target.value)})}/></label>
      <label>Unidad<input value={line.unit} onChange={e=>updateLine(index,{unit:e.target.value})}/></label>
      <label>Precio unit.<input type="number" min="0" step="0.01" value={line.unitPrice} onChange={e=>updateLine(index,{unitPrice:Number(e.target.value)})}/></label>
      <label>Dto. %<input type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={e=>updateLine(index,{discountPercent:Number(e.target.value)})}/></label>
      <label>IVA %<select value={line.taxRate} onChange={e=>updateLine(index,{taxRate:Number(e.target.value)})}><option value={21}>21 %</option><option value={10}>10 %</option><option value={4}>4 %</option><option value={0}>0 %</option></select></label>
      <div className="salesLineTotal"><small>Total</small><strong>{money(total)}</strong></div>
      <button className="iconAction danger" title="Eliminar línea" onClick={()=>removeLine(index)}><Trash2 size={16}/></button>
    </div>})}
   </div>
   <div className="salesInvoiceBottom"><label>Notas<textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observaciones visibles en la factura"/></label><div className="salesTotals"><span>Importe bruto <strong>{money(totals.gross)}</strong></span>{totals.gross-totals.net>0&&<span>Descuento <strong>-{money(totals.gross-totals.net)}</strong></span>}<span>Base imponible <strong>{money(totals.net)}</strong></span><span>IVA <strong>{money(totals.tax)}</strong></span><span className="salesGrandTotal">Total <strong>{money(totals.total)}</strong></span></div></div>
   {error&&<div className="errorBox">{error}</div>}
   <div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={save} disabled={busy}>{busy?'Guardando…':editing?'Guardar borrador':'Guardar borrador'}</button></div>
 </div></div>
}

function BusinessModal({open,settings,onClose,onSaved}:{open:boolean;settings:BusinessSettings;onClose:()=>void;onSaved:(settings:BusinessSettings)=>Promise<void>}){
 const [form,setForm]=useState(settings);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{if(open){setForm(settings);setError('')}},[open,settings]); if(!open)return null;
 const set=(key:keyof BusinessSettings,value:string)=>setForm(current=>({...current,[key]:value}));
 const save=async()=>{if(!form.legalName.trim()){setError('Indica la razón social.');return}setBusy(true);try{await saveBusinessSettings(form);await onSaved(form);onClose()}catch(e){setError(e instanceof Error?e.message:'No se pudieron guardar los datos fiscales.')}finally{setBusy(false)}};
 return <div className="modalBackdrop"><div className="modal salesClientModal"><div className="modalHead"><div><h3>Datos fiscales de ZENVIA</h3><p>Estos datos quedan copiados en cada factura cuando se emite.</p></div><button onClick={onClose}><X/></button></div><div className="salesFormGrid">
  <label className="salesSpan2">Razón social *<input value={form.legalName} onChange={e=>set('legalName',e.target.value)}/></label><label>CIF/NIF *<input value={form.taxId||''} onChange={e=>set('taxId',e.target.value)}/></label><label>Nombre comercial<input value={form.tradeName||''} onChange={e=>set('tradeName',e.target.value)}/></label><label className="salesSpan2">Dirección *<input value={form.addressLine1||''} onChange={e=>set('addressLine1',e.target.value)}/></label><label>Código postal *<input value={form.postalCode||''} onChange={e=>set('postalCode',e.target.value)}/></label><label>Ciudad *<input value={form.city||''} onChange={e=>set('city',e.target.value)}/></label><label>Provincia<input value={form.province||''} onChange={e=>set('province',e.target.value)}/></label><label>País<input maxLength={2} value={form.countryCode} onChange={e=>set('countryCode',e.target.value.toUpperCase())}/></label><label>Email<input type="email" value={form.email||''} onChange={e=>set('email',e.target.value)}/></label><label>Teléfono<input value={form.phone||''} onChange={e=>set('phone',e.target.value)}/></label><label className="salesSpan2">IBAN<input value={form.iban||''} onChange={e=>set('iban',e.target.value)} placeholder="ES00…"/></label><label className="salesSpan2">Pie de factura<textarea rows={3} value={form.invoiceFooter||''} onChange={e=>set('invoiceFooter',e.target.value)} placeholder="Condiciones de pago, registro mercantil…"/></label>
 </div>{error&&<div className="errorBox">{error}</div>}<div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar datos fiscales'}</button></div></div></div>
}

function PaymentModal({invoice,onClose,onSaved}:{invoice:SalesInvoice|null;onClose:()=>void;onSaved:()=>Promise<void>}){
 const pending=invoice?Math.max(0,invoice.totalAmount-invoice.paidAmount):0;const [amount,setAmount]=useState(pending);const [date,setDate]=useState(today());const [method,setMethod]=useState('Transferencia bancaria');const [reference,setReference]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{if(invoice){setAmount(Math.max(0,invoice.totalAmount-invoice.paidAmount));setDate(today());setMethod('Transferencia bancaria');setReference('');setError('')}},[invoice]); if(!invoice)return null;
 const save=async()=>{if(amount<=0){setError('Indica un importe superior a 0.');return}setBusy(true);try{await addSalesPayment(invoice.id,{amount,paymentDate:date,method,reference});await onSaved();onClose()}catch(e){setError(e instanceof Error?e.message:'No se pudo registrar el cobro.')}finally{setBusy(false)}};
 return <div className="modalBackdrop"><div className="modal smallModal"><div className="modalHead"><div><h3>Registrar cobro</h3><p>{invoice.invoiceNumber} · Pendiente {money(pending)}</p></div><button onClick={onClose}><X/></button></div><div className="stackForm"><label>Importe<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(Number(e.target.value))}/></label><label>Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Método<input value={method} onChange={e=>setMethod(e.target.value)}/></label><label>Referencia<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Transferencia, operación…"/></label></div>{error&&<div className="errorBox">{error}</div>}<div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':'Registrar cobro'}</button></div></div></div>
}

export function SalesInvoices(){
 const [invoices,setInvoices]=useState<SalesInvoice[]>([]);const [clients,setClients]=useState<Client[]>([]);const [series,setSeries]=useState<SalesInvoiceSeries[]>([]);const [settings,setSettings]=useState<BusinessSettings>({legalName:'ZENVIA COMMERCE SL',countryCode:'ES'});const [query,setQuery]=useState('');const [status,setStatus]=useState('all');const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [modal,setModal]=useState(false);const [editing,setEditing]=useState<SalesInvoice|null>(null);const [businessModal,setBusinessModal]=useState(false);const [paymentInvoice,setPaymentInvoice]=useState<SalesInvoice|null>(null);const [busyId,setBusyId]=useState<string|null>(null);
 const refresh=async()=>{setLoading(true);try{const year=new Date().getFullYear();const [nextInvoices,nextClients,nextSeries,nextSettings]=await Promise.all([loadSalesInvoices(),loadClients(),ensureSalesSeries(year),loadBusinessSettings()]);setInvoices(nextInvoices);setClients(nextClients);setSeries(nextSeries);setSettings(nextSettings);setError('')}catch(e){setError(e instanceof Error?e.message:'No se pudo cargar la facturación.')}finally{setLoading(false)}};
 useEffect(()=>{void refresh()},[]);
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return invoices.filter(i=>(status==='all'||i.status===status)&&(!q||[i.invoiceNumber||'borrador',i.clientName,i.clientTaxId||''].some(v=>v.toLowerCase().includes(q))))},[invoices,query,status]);
 const totals=useMemo(()=>({issued:invoices.filter(i=>i.status!=='draft').reduce((s,i)=>s+i.totalAmount,0),pending:invoices.filter(i=>!['draft','paid','rectified'].includes(i.status)).reduce((s,i)=>s+Math.max(0,i.totalAmount-i.paidAmount),0),drafts:invoices.filter(i=>i.status==='draft').length}),[invoices]);
 const openNew=()=>{if(!clients.length){setError('Crea al menos un cliente antes de preparar una factura.');return}setEditing(null);setModal(true)};
 const emit=async(invoice:SalesInvoice)=>{if(!window.confirm('¿Emitir esta factura? Se asignará el número definitivo y los datos fiscales quedarán bloqueados.'))return;setBusyId(invoice.id);setError('');try{await issueSalesInvoice(invoice.id);await refresh()}catch(e){setError(e instanceof Error?e.message:'No se pudo emitir la factura.')}finally{setBusyId(null)}};
 const remove=async(invoice:SalesInvoice)=>{if(!window.confirm('¿Eliminar este borrador?'))return;setBusyId(invoice.id);try{await deleteSalesInvoiceDraft(invoice.id);await refresh()}catch(e){setError(e instanceof Error?e.message:'No se pudo eliminar el borrador.')}finally{setBusyId(null)}};
 const markSent=async(invoice:SalesInvoice)=>{setBusyId(invoice.id);try{await markSalesInvoiceSent(invoice.id);await refresh()}catch(e){setError(e instanceof Error?e.message:'No se pudo marcar como enviada.')}finally{setBusyId(null)}};
 const pdf=async(invoice:SalesInvoice)=>{try{downloadSalesInvoicePdf(invoice,settings)}catch(e){setError(e instanceof Error?e.message:'No se pudo generar el PDF.')}};
 return <div className="page">
  <div className="pageHead"><div><div className="eyebrow">VENTAS</div><h1>Facturación</h1><p>Borradores, emisión, envío, cobros y facturas rectificativas desde un único sitio.</p></div><div className="actions"><button className="secondary" onClick={()=>setBusinessModal(true)}><Settings2 size={17}/> Datos fiscales</button><button className="primary" onClick={openNew}>+ Nueva factura</button></div></div>
  <div className="stats salesStats"><div className="stat"><div className="statIcon"><ReceiptText/></div><div><span>Facturado</span><strong>{money(totals.issued)}</strong><small>Facturas emitidas</small></div></div><div className="stat"><div className="statIcon"><Banknote/></div><div><span>Pendiente de cobro</span><strong>{money(totals.pending)}</strong><small>Importe vivo</small></div></div><div className="stat"><div className="statIcon"><FilePenLine/></div><div><span>Borradores</span><strong>{totals.drafts}</strong><small>Sin numerar</small></div></div></div>
  <div className="toolbar salesToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar cliente, CIF o nº factura…"/></div><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Todos los estados</option><option value="draft">Borradores</option><option value="issued">Emitidas</option><option value="sent">Enviadas</option><option value="partially_paid">Cobro parcial</option><option value="paid">Cobradas</option><option value="rectified">Rectificadas</option></select></div>
  {error&&<div className="errorBox">{error}</div>}
  <section className="card tableCard">{loading?<div className="emptyState large">Cargando facturación…</div>:filtered.length?<table><thead><tr><th>Fecha</th><th>Número</th><th>Cliente</th><th>Estado</th><th className="right">Base</th><th className="right">IVA</th><th className="right">Total</th><th className="right">Pendiente</th><th className="right">Acciones</th></tr></thead><tbody>{filtered.map(invoice=>{const pending=Math.max(0,invoice.totalAmount-invoice.paidAmount);return <tr key={invoice.id}><td>{new Date(`${invoice.issueDate}T12:00:00`).toLocaleDateString('es-ES')}</td><td><strong>{invoice.invoiceNumber||'Borrador'}</strong></td><td>{invoice.clientName}</td><td><span className={statusClass(invoice.status)}>{statusLabel(invoice.status)}</span></td><td className="right">{money(invoice.subtotal)}</td><td className="right">{money(invoice.taxAmount)}</td><td className="right"><strong>{money(invoice.totalAmount)}</strong></td><td className="right">{invoice.status==='draft'?'—':money(pending)}</td><td className="right"><div className="invoiceActions">
    {invoice.status==='draft'?<><button className="iconBtn" title="Editar borrador" onClick={()=>{setEditing(invoice);setModal(true)}}><Pencil size={16}/></button><button className="iconBtn accountBtn" title="Emitir factura" disabled={busyId===invoice.id} onClick={()=>emit(invoice)}><FileCheck2 size={16}/></button><button className="iconBtn dangerIcon" title="Eliminar borrador" disabled={busyId===invoice.id} onClick={()=>remove(invoice)}><Trash2 size={16}/></button></>:<><button className="iconBtn" title="Descargar PDF" onClick={()=>pdf(invoice)}><Download size={16}/></button>{invoice.status==='issued'&&<button className="iconBtn" title="Marcar como enviada" disabled={busyId===invoice.id} onClick={()=>markSent(invoice)}><Send size={16}/></button>}{!['paid','rectified'].includes(invoice.status)&&<button className="iconBtn accountBtn" title="Registrar cobro" onClick={()=>setPaymentInvoice(invoice)}><CheckCircle2 size={16}/></button>}</>}
   </div></td></tr>})}</tbody></table>:<div className="emptyState large">No hay facturas de venta para los filtros seleccionados.</div>}</section>
  <InvoiceModal open={modal} invoice={editing} clients={clients} series={series} onClose={()=>{setModal(false);setEditing(null)}} onSaved={refresh}/>
  <BusinessModal open={businessModal} settings={settings} onClose={()=>setBusinessModal(false)} onSaved={async next=>{setSettings(next);await refresh()}}/>
  <PaymentModal invoice={paymentInvoice} onClose={()=>setPaymentInvoice(null)} onSaved={refresh}/>
 </div>
}
