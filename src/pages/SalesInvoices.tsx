import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, CalendarDays, CheckCircle2, Download, Eye, FileCheck2, FilePenLine,
  Mail, PackageSearch, Pencil, Plus, Printer, ReceiptText, RotateCcw, Search, Settings2,
  Trash2, UserRound, WalletCards, X,
} from 'lucide-react';
import {
  addSalesPayment, createSalesInvoiceDraft, downloadSalesInvoicePdf, ensureSalesSeries,
  issueSalesInvoice, loadBusinessSettings, loadClients, loadSalesInvoices,
  saveBusinessSettings, updateSalesInvoiceDraft,
  type BusinessSettings, type Client, type SalesInvoice, type SalesInvoiceDraftInput,
  type SalesInvoiceLine, type SalesInvoiceSeries,
} from '../services/sales';
import { loadBillableProducts, type BillableProduct } from '../services/billableProducts';
import { createRectifyingInvoice } from '../services/salesRectifying';
import { deleteSalesInvoiceDraftSafe } from '../services/salesDraftDelete';
import { deleteReversibleSalesInvoice, reopenSalesInvoice } from '../services/salesReversible';
import { printSalesInvoicePdf } from '../services/salesInvoicePdf';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { ProductCatalogPicker } from '../components/ProductCatalogPicker';
import { SendInvoiceModal } from '../components/SendInvoiceModal';
import '../sales.css';

const today=()=>new Date().toISOString().slice(0,10);
const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const dateLabel=(value?:string|null)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('es-ES'):'—';
const statusLabel=(status:SalesInvoice['status'])=>({draft:'Borrador',issued:'Emitida',sent:'Enviada',partially_paid:'Cobro parcial',paid:'Cobrada',rectified:'Rectificada'}[status]);
const statusClass=(status:SalesInvoice['status'])=>`salesStatus ${status}`;
const emptyLine=(position=1):SalesInvoiceLine=>({position,description:'',quantity:1,unit:'ud',unitPrice:0,discountPercent:0,taxRate:21,productId:null});
const calcLine=(line:SalesInvoiceLine)=>{const gross=line.quantity*line.unitPrice;const net=gross*(1-(line.discountPercent||0)/100);const tax=net*(line.taxRate||0)/100;return {gross,net,tax,total:net+tax};};

function InvoiceModal({open,invoice,clients,products,onClose,onSaved}:{open:boolean;invoice:SalesInvoice|null;clients:Client[];products:BillableProduct[];onClose:()=>void;onSaved:()=>Promise<void>}){
  const [clientId,setClientId]=useState('');
  const [seriesId,setSeriesId]=useState('');
  const [series,setSeries]=useState<SalesInvoiceSeries[]>([]);
  const [issueDate,setIssueDate]=useState(today());
  const [operationDate,setOperationDate]=useState('');
  const [dueDate,setDueDate]=useState('');
  const [paymentMethod,setPaymentMethod]=useState('Transferencia bancaria');
  const [notes,setNotes]=useState('');
  const [lines,setLines]=useState<SalesInvoiceLine[]>([emptyLine()]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!open)return;
    if(invoice){
      setClientId(invoice.clientId);setSeriesId(invoice.seriesId);setIssueDate(invoice.issueDate);
      setOperationDate(invoice.operationDate||'');setDueDate(invoice.dueDate||'');setPaymentMethod(invoice.paymentMethod||'');
      setNotes(invoice.notes||'');setLines(invoice.lines.length?invoice.lines.map((line,index)=>({...line,position:index+1})):[emptyLine()]);
    }else{
      const firstClient=clients[0];
      setClientId(firstClient?.id||'');setSeriesId('');setIssueDate(today());setOperationDate('');setPaymentMethod('Transferencia bancaria');setNotes('');setLines([emptyLine()]);
      if(firstClient?.paymentTermsDays){const d=new Date();d.setDate(d.getDate()+firstClient.paymentTermsDays);setDueDate(d.toISOString().slice(0,10));}else setDueDate('');
    }
    setError('');
  },[open,invoice,clients]);

  useEffect(()=>{
    if(!open||!issueDate)return;
    let cancelled=false;
    const year=Number(issueDate.slice(0,4));
    ensureSalesSeries(year).then(rows=>{
      if(cancelled)return;
      setSeries(rows);
      const kind=invoice?.invoiceType||'standard';
      setSeriesId(current=>rows.some(item=>item.id===current)?current:(rows.find(item=>item.kind===kind)?.id||''));
    }).catch(e=>!cancelled&&setError(errorMessage(e,'No se pudieron preparar las series.')));
    return()=>{cancelled=true};
  },[open,issueDate,invoice?.invoiceType]);

  if(!open)return null;
  const editing=Boolean(invoice);
  const invoiceKind=invoice?.invoiceType||'standard';
  const selectableSeries=series.filter(item=>item.kind===invoiceKind);
  const updateLine=(index:number,patch:Partial<SalesInvoiceLine>)=>setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
  const removeLine=(index:number)=>setLines(current=>current.length===1?[emptyLine()]:current.filter((_,i)=>i!==index).map((line,i)=>({...line,position:i+1})));
  const addFreeLine=()=>setLines(current=>[...current,emptyLine(current.length+1)]);
  const addProduct=(product:BillableProduct)=>setLines(current=>{
    const productLine:SalesInvoiceLine={position:current.length+1,productId:product.id,description:product.description,quantity:1,unit:product.unit,unitPrice:product.salePrice??0,discountPercent:0,taxRate:product.taxRate};
    if(current.length===1&&!current[0].description.trim()&&!current[0].productId)return [productLine];
    return [...current,productLine];
  });
  const chooseClient=(value:string)=>{
    setClientId(value);
    const client=clients.find(c=>c.id===value);
    if(client?.paymentTermsDays){const d=new Date(`${issueDate}T12:00:00`);d.setDate(d.getDate()+client.paymentTermsDays);setDueDate(d.toISOString().slice(0,10));}
  };
  const totals=lines.reduce((acc,line)=>{const x=calcLine(line);acc.gross+=x.gross;acc.net+=x.net;acc.tax+=x.tax;acc.total+=x.total;return acc},{gross:0,net:0,tax:0,total:0});
  const save=async()=>{
    if(!clientId){setError('Selecciona un cliente.');return;}
    if(!seriesId){setError('Selecciona una serie.');return;}
    const cleanLines=lines.filter(line=>line.description.trim());
    if(!cleanLines.length){setError('Añade al menos una línea a la factura.');return;}
    if(cleanLines.some(line=>line.quantity<=0)){setError('Las cantidades deben ser superiores a 0.');return;}
    if(invoiceKind==='standard'&&cleanLines.some(line=>line.unitPrice<0)){setError('Una factura ordinaria no puede tener precios negativos.');return;}
    setBusy(true);setError('');
    const payload:SalesInvoiceDraftInput={clientId,seriesId,issueDate,operationDate:operationDate||undefined,dueDate:dueDate||undefined,paymentMethod:paymentMethod||undefined,notes:notes||undefined,lines:cleanLines};
    try{
      if(invoice)await updateSalesInvoiceDraft(invoice.id,payload);else await createSalesInvoiceDraft(payload);
      await onSaved();
      showSuccess(invoice?'Borrador actualizado correctamente.':'Borrador creado correctamente.');
      onClose();
    }catch(e){const message=errorMessage(e,'No se pudo guardar la factura.');setError(message);showError(message);}
    finally{setBusy(false);}
  };

  return <div className="modalBackdrop"><div className="modal salesInvoiceModal polishedModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">{invoiceKind==='rectifying'?'RECTIFICATIVA':'FACTURA DE VENTA'}</div><h3>{invoiceKind==='rectifying'?'Rectificativa en borrador':editing?'Editar borrador':'Nueva factura'}</h3><p>{invoiceKind==='rectifying'?'Revisa la corrección antes de emitirla. La serie R es independiente.':'Prepara la factura con cliente, productos y condiciones. El número se asigna al emitir.'}</p></div><button onClick={onClose}><X/></button></div>

    <section className="salesFormSection">
      <div className="salesSectionTitle"><UserRound size={18}/><div><strong>Cliente y numeración</strong><span>Quién recibe la factura y qué serie utilizará</span></div></div>
      <div className="salesInvoiceMeta salesInvoiceMetaPrimary">
        <label>Cliente *<select value={clientId} onChange={e=>chooseClient(e.target.value)}><option value="">Selecciona cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}{c.taxId?` · ${c.taxId}`:''}</option>)}</select></label>
        <label>Serie<select value={seriesId} onChange={e=>setSeriesId(e.target.value)}>{selectableSeries.map(s=><option key={s.id} value={s.id}>{s.name} · próximo {s.prefix}{String(s.nextNumber).padStart(s.padding,'0')}</option>)}</select></label>
      </div>
    </section>

    <section className="salesFormSection">
      <div className="salesSectionTitle"><CalendarDays size={18}/><div><strong>Fechas y cobro</strong><span>Operación, vencimiento y forma de pago</span></div></div>
      <div className="salesInvoiceMeta salesInvoiceMetaDates">
        <label>Fecha factura<input type="date" value={issueDate} onChange={e=>setIssueDate(e.target.value)}/></label>
        <label>Fecha operación<input type="date" value={operationDate} onChange={e=>setOperationDate(e.target.value)}/></label>
        <label>Vencimiento<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
        <label>Forma de pago<input value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} placeholder="Transferencia, tarjeta…"/></label>
      </div>
    </section>

    <section className="salesFormSection salesProductsSection">
      <div className="salesSectionTitle"><PackageSearch size={18}/><div><strong>Productos y conceptos</strong><span>Busca en tu catálogo o añade una línea libre</span></div></div>
      <ProductCatalogPicker products={products} onAdd={addProduct}/>
      <div className="salesLinesEditor">
        <div className="salesLinesHead"><div><strong>Líneas de factura</strong><span>{lines.length} línea{lines.length===1?'':'s'}</span></div><button className="secondary" type="button" onClick={addFreeLine}><Plus size={15}/> Concepto libre</button></div>
        {lines.map((line,index)=>{const total=calcLine(line).total;const product=products.find(item=>item.id===line.productId);return <div className="salesLine salesLineCard" key={`${line.id||'new'}-${index}`}>
          <div className="salesLineIdentity">
            <div className="salesLineIndex">{index+1}</div>
            <div><strong>{product?.name||'Concepto libre'}</strong><small>{product?.sku?`SKU ${product.sku}`:product?'Producto vinculado':'Sin producto vinculado'}</small></div>
          </div>
          <label className="salesLineDescription">Descripción<input value={line.description} onChange={e=>updateLine(index,{description:e.target.value})} placeholder="Producto o servicio facturado"/></label>
          <label>Cantidad<input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updateLine(index,{quantity:Number(e.target.value)})}/></label>
          <label>Unidad<input value={line.unit} onChange={e=>updateLine(index,{unit:e.target.value})}/></label>
          <label>Precio unit.<input type="number" step="0.01" value={line.unitPrice} onChange={e=>updateLine(index,{unitPrice:Number(e.target.value)})}/></label>
          <label>Dto. %<input type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={e=>updateLine(index,{discountPercent:Number(e.target.value)})}/></label>
          <label>IVA %<select value={line.taxRate} onChange={e=>updateLine(index,{taxRate:Number(e.target.value)})}><option value={21}>21 %</option><option value={10}>10 %</option><option value={4}>4 %</option><option value={0}>0 %</option></select></label>
          <div className="salesLineTotal"><small>Total</small><strong>{money(total)}</strong></div>
          <button className="iconAction danger" title="Eliminar línea" type="button" onClick={()=>removeLine(index)}><Trash2 size={16}/></button>
        </div>})}
      </div>
    </section>

    <section className="salesInvoiceBottom salesFormSection salesInvoiceSummary">
      <label>Notas<textarea rows={4} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observaciones visibles en la factura"/></label>
      <div className="salesTotals"><span>Importe bruto <strong>{money(totals.gross)}</strong></span>{Math.abs(totals.gross-totals.net)>0.005&&<span>Descuento <strong>{money(totals.net-totals.gross)}</strong></span>}<span>Base imponible <strong>{money(totals.net)}</strong></span><span>IVA <strong>{money(totals.tax)}</strong></span><span className="salesGrandTotal">Total <strong>{money(totals.total)}</strong></span></div>
    </section>
    {error&&<div className="errorBox">{error}</div>}
    <div className="modalActions salesStickyActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={save} disabled={busy}>{busy?'Guardando…':'Guardar borrador'}</button></div>
  </div></div>;
}

function BusinessModal({open,settings,onClose,onSaved}:{open:boolean;settings:BusinessSettings;onClose:()=>void;onSaved:(settings:BusinessSettings)=>Promise<void>}){
  const [form,setForm]=useState(settings);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(open){setForm(settings);setError('');}},[open,settings]); if(!open)return null;
  const set=(key:keyof BusinessSettings,value:string)=>setForm(current=>({...current,[key]:value}));
  const save=async()=>{
    if(!form.legalName.trim()||!form.taxId?.trim()||!form.addressLine1?.trim()||!form.postalCode?.trim()||!form.city?.trim()){setError('Completa razón social, CIF/NIF, dirección, código postal y ciudad.');return;}
    setBusy(true);setError('');
    try{await saveBusinessSettings(form);await onSaved(form);showSuccess('Datos fiscales guardados correctamente.');onClose();}
    catch(e){const message=errorMessage(e,'No se pudieron guardar los datos fiscales.');setError(message);showError(message);}
    finally{setBusy(false);}
  };
  return <div className="modalBackdrop"><div className="modal salesClientModal polishedModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">CONFIGURACIÓN</div><h3>Datos fiscales de ZENVIA</h3><p>Se congelan dentro de cada factura cuando la emites.</p></div><button onClick={onClose}><X/></button></div>
    <section className="salesFormSection"><div className="salesSectionTitle"><ReceiptText size={18}/><div><strong>Identificación fiscal</strong><span>Datos que aparecerán como emisor</span></div></div><div className="salesFormGrid">
      <label className="salesSpan2">Razón social *<input value={form.legalName} onChange={e=>set('legalName',e.target.value)}/></label><label>CIF/NIF *<input value={form.taxId||''} onChange={e=>set('taxId',e.target.value)}/></label><label>Nombre comercial<input value={form.tradeName||''} onChange={e=>set('tradeName',e.target.value)}/></label>
    </div></section>
    <section className="salesFormSection"><div className="salesSectionTitle"><UserRound size={18}/><div><strong>Dirección y contacto</strong><span>Información de contacto visible en factura</span></div></div><div className="salesFormGrid">
      <label className="salesSpan2">Dirección *<input value={form.addressLine1||''} onChange={e=>set('addressLine1',e.target.value)}/></label><label>Código postal *<input value={form.postalCode||''} onChange={e=>set('postalCode',e.target.value)}/></label><label>Ciudad *<input value={form.city||''} onChange={e=>set('city',e.target.value)}/></label><label>Provincia<input value={form.province||''} onChange={e=>set('province',e.target.value)}/></label><label>País<input maxLength={2} value={form.countryCode} onChange={e=>set('countryCode',e.target.value.toUpperCase())}/></label><label>Email<input type="email" value={form.email||''} onChange={e=>set('email',e.target.value)}/></label><label>Teléfono<input value={form.phone||''} onChange={e=>set('phone',e.target.value)}/></label>
    </div></section>
    <section className="salesFormSection"><div className="salesSectionTitle"><WalletCards size={18}/><div><strong>Cobro y pie de factura</strong><span>Datos bancarios y texto final</span></div></div><div className="salesFormGrid"><label className="salesSpan2">IBAN<input value={form.iban||''} onChange={e=>set('iban',e.target.value)} placeholder="ES00…"/></label><label className="salesSpan2">Pie de factura<textarea rows={3} value={form.invoiceFooter||''} onChange={e=>set('invoiceFooter',e.target.value)} placeholder="Condiciones de pago, registro mercantil…"/></label></div></section>
    {error&&<div className="errorBox">{error}</div>}<div className="modalActions salesStickyActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar datos fiscales'}</button></div>
  </div></div>;
}

function PaymentModal({invoice,onClose,onSaved}:{invoice:SalesInvoice|null;onClose:()=>void;onSaved:()=>Promise<void>}){
  const pending=invoice?Math.max(0,invoice.totalAmount-invoice.paidAmount):0;const [amount,setAmount]=useState(pending);const [date,setDate]=useState(today());const [method,setMethod]=useState('Transferencia bancaria');const [reference,setReference]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(invoice){setAmount(Math.max(0,invoice.totalAmount-invoice.paidAmount));setDate(today());setMethod('Transferencia bancaria');setReference('');setError('');}},[invoice]); if(!invoice)return null;
  const save=async()=>{if(amount<=0){setError('Indica un importe superior a 0.');return;}if(amount>pending+0.005){setError('El cobro no puede superar el importe pendiente.');return;}setBusy(true);setError('');try{await addSalesPayment(invoice.id,{amount,paymentDate:date,method,reference});await onSaved();showSuccess('Cobro registrado correctamente.');onClose();}catch(e){const message=errorMessage(e,'No se pudo registrar el cobro.');setError(message);showError(message);}finally{setBusy(false);}};
  return <div className="modalBackdrop"><div className="modal smallModal polishedModal salesPaymentModal"><div className="modalHead salesModalHead"><div><div className="eyebrow">COBROS</div><h3>Registrar cobro</h3><p>{invoice.invoiceNumber} · Pendiente {money(pending)}</p></div><button onClick={onClose}><X/></button></div><div className="salesFormSection"><div className="salesFormGrid"><label>Importe<input type="number" min="0.01" max={pending} step="0.01" value={amount} onChange={e=>setAmount(Number(e.target.value))}/></label><label>Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Método<input value={method} onChange={e=>setMethod(e.target.value)}/></label><label>Referencia<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Transferencia, operación…"/></label></div></div>{error&&<div className="errorBox">{error}</div>}<div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':'Registrar cobro'}</button></div></div></div>;
}

function InvoiceDetail({invoice,settings,onClose,onPdf,onPrint,onPayment,onSend,onRectify,onEdit,onReopen,onDelete}:{invoice:SalesInvoice|null;settings:BusinessSettings;onClose:()=>void;onPdf:(invoice:SalesInvoice)=>void;onPrint:(invoice:SalesInvoice)=>void;onPayment:(invoice:SalesInvoice)=>void;onSend:(invoice:SalesInvoice)=>void;onRectify:(invoice:SalesInvoice)=>void;onEdit:(invoice:SalesInvoice)=>void;onReopen:(invoice:SalesInvoice)=>void;onDelete:(invoice:SalesInvoice)=>void}){
  if(!invoice)return null;
  const pending=Math.max(0,invoice.totalAmount-invoice.paidAmount);
  const canRectify=invoice.invoiceType==='standard'&&!['draft','rectified'].includes(invoice.status);
  return <div className="modalBackdrop"><div className="modal salesDetailModal polishedModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">{invoice.invoiceType==='rectifying'?'FACTURA RECTIFICATIVA':'FACTURA DE VENTA'}</div><h3>{invoice.invoiceNumber||'Borrador'}</h3><p>{invoice.clientName} · {dateLabel(invoice.issueDate)}</p></div><button onClick={onClose}><X/></button></div>
    <div className="salesDetailMeta"><div><span>Estado</span><strong className={statusClass(invoice.status)}>{statusLabel(invoice.status)}</strong></div><div><span>Cliente</span><strong>{invoice.clientName}</strong><small>{invoice.clientTaxId||'CIF/NIF pendiente'}</small></div><div><span>Vencimiento</span><strong>{dateLabel(invoice.dueDate)}</strong></div><div><span>Pendiente</span><strong>{invoice.status==='draft'?'—':money(pending)}</strong></div></div>
    {invoice.invoiceType==='rectifying'&&<div className="salesRectifyingNotice"><RotateCcw size={17}/><span>Esta factura rectifica una factura anterior. Los importes negativos reducen la facturación y el IVA repercutido.</span></div>}
    <section className="salesDetailSection"><h4>Conceptos</h4><div className="salesDetailLines"><div className="salesDetailLine salesDetailLineHead"><span>Descripción</span><span>Cant.</span><span>Precio</span><span>IVA</span><span>Total</span></div>{invoice.lines.map(line=><div className="salesDetailLine" key={line.id||`${line.position}-${line.description}`}><strong>{line.description}</strong><span>{line.quantity.toLocaleString('es-ES')} {line.unit}</span><span>{money(line.unitPrice)}</span><span>{line.taxRate.toLocaleString('es-ES')} %</span><span>{money(line.lineTotal??calcLine(line).total)}</span></div>)}</div></section>
    <div className="salesDetailBottom"><div><h4>Datos de facturación</h4><p><strong>{invoice.issuerName||settings.legalName}</strong><br/>{invoice.issuerTaxId||settings.taxId}<br/>{invoice.issuerAddress||settings.addressLine1}</p><p><strong>{invoice.clientName}</strong><br/>{invoice.clientTaxId}<br/>{invoice.clientAddress}</p></div><div className="salesTotals"><span>Base imponible <strong>{money(invoice.subtotal)}</strong></span>{invoice.discountAmount!==0&&<span>Descuentos <strong>{money(-invoice.discountAmount)}</strong></span>}<span>IVA <strong>{money(invoice.taxAmount)}</strong></span><span className="salesGrandTotal">Total <strong>{money(invoice.totalAmount)}</strong></span></div></div>
    {invoice.payments.length>0&&<section className="salesDetailSection"><h4>Cobros</h4><div className="salesPaymentList">{invoice.payments.map(payment=><div key={payment.id}><span>{dateLabel(payment.paymentDate)} · {payment.method||'Cobro'}{payment.reference?` · ${payment.reference}`:''}</span><strong>{money(payment.amount)}</strong></div>)}</div></section>}
    <div className="modalActions salesDetailActions">
      {invoice.status==='draft'?<><button className="secondary" onClick={()=>onEdit(invoice)}><Pencil size={16}/> Editar borrador</button><button className="secondary" onClick={()=>onPdf(invoice)}><Download size={16}/> Descargar PDF</button><button className="secondary" onClick={()=>onPrint(invoice)}><Printer size={16}/> Imprimir PDF</button><button className="secondary dangerText" onClick={()=>onDelete(invoice)}><Trash2 size={16}/> Eliminar borrador</button></>:invoice.status==='issued'?<><button className="secondary" onClick={()=>onReopen(invoice)}><Pencil size={16}/> Editar factura</button><button className="secondary dangerText" onClick={()=>onDelete(invoice)}><Trash2 size={16}/> Eliminar factura</button><button className="secondary" onClick={()=>onPdf(invoice)}><Download size={16}/> Descargar PDF</button><button className="secondary" onClick={()=>onPrint(invoice)}><Printer size={16}/> Imprimir PDF</button><button className="primary" onClick={()=>onSend(invoice)}><Mail size={16}/> Enviar por Gmail</button></>:<><button className="secondary" onClick={()=>onPdf(invoice)}><Download size={16}/> Descargar PDF</button><button className="secondary" onClick={()=>onPrint(invoice)}><Printer size={16}/> Imprimir PDF</button>{invoice.status!=='rectified'&&<button className="primary" onClick={()=>onSend(invoice)}><Mail size={16}/> Enviar por Gmail</button>}</>}
      {invoice.invoiceType==='standard'&&!['draft','paid','rectified'].includes(invoice.status)&&<button className="secondary" onClick={()=>onPayment(invoice)}><CheckCircle2 size={16}/> Registrar cobro</button>}
      {invoice.invoiceType==='standard'&&invoice.status==='paid'&&<button className="secondary" disabled><CheckCircle2 size={16}/> Cobrada</button>}
      {canRectify&&<button className="secondary dangerText" onClick={()=>onRectify(invoice)}><RotateCcw size={16}/> Crear rectificativa</button>}
    </div>
  </div></div>;
}

export function SalesInvoices(){
  const [invoices,setInvoices]=useState<SalesInvoice[]>([]);
  const [clients,setClients]=useState<Client[]>([]);
  const [products,setProducts]=useState<BillableProduct[]>([]);
  const [settings,setSettings]=useState<BusinessSettings>({legalName:'ZENVIA COMMERCE SL',countryCode:'ES'});
  const [query,setQuery]=useState('');const [status,setStatus]=useState('all');const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const [modal,setModal]=useState(false);const [editing,setEditing]=useState<SalesInvoice|null>(null);const [detail,setDetail]=useState<SalesInvoice|null>(null);const [businessModal,setBusinessModal]=useState(false);const [paymentInvoice,setPaymentInvoice]=useState<SalesInvoice|null>(null);const [sendInvoice,setSendInvoice]=useState<SalesInvoice|null>(null);const [busyId,setBusyId]=useState<string|null>(null);
  const refresh=async()=>{
    setLoading(true);
    try{
      await ensureSalesSeries(new Date().getFullYear());
      const [nextInvoices,nextClients,nextSettings,nextProducts]=await Promise.all([loadSalesInvoices(),loadClients(),loadBusinessSettings(),loadBillableProducts()]);
      setInvoices(nextInvoices);setClients(nextClients);setSettings(nextSettings);setProducts(nextProducts);
      setDetail(current=>current?nextInvoices.find(item=>item.id===current.id)||null:null);setError('');
    }catch(e){setError(errorMessage(e,'No se pudo cargar la facturación.'));}
    finally{setLoading(false);}
  };
  useEffect(()=>{void refresh();},[]);
  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return invoices.filter(i=>(status==='all'||i.status===status)&&(!q||[i.invoiceNumber||'borrador',i.clientName,i.clientTaxId||''].some(v=>v.toLowerCase().includes(q))));},[invoices,query,status]);
  const totals=useMemo(()=>({issued:invoices.filter(i=>i.status!=='draft').reduce((s,i)=>s+i.totalAmount,0),pending:invoices.filter(i=>i.invoiceType==='standard'&&!['draft','paid','rectified'].includes(i.status)).reduce((s,i)=>s+Math.max(0,i.totalAmount-i.paidAmount),0),drafts:invoices.filter(i=>i.status==='draft').length}),[invoices]);
  const openNew=()=>{if(!clients.length){const message='Crea al menos un cliente antes de preparar una factura.';setError(message);showError(message);return;}setEditing(null);setModal(true);};
  const edit=(invoice:SalesInvoice)=>{setDetail(null);setEditing(invoice);setModal(true);};
  const reopenForEdit=async(invoice:SalesInvoice)=>{
    if(invoice.status!=='issued')return;
    if(!window.confirm(`¿Editar ${invoice.invoiceNumber}? Volverá a borrador y su número quedará reservado para esta misma factura cuando la vuelvas a emitir.`))return;
    setBusyId(invoice.id);setError('');
    try{
      await reopenSalesInvoice(invoice.id);
      const next=await loadSalesInvoices();
      setInvoices(next);
      const draft=next.find(item=>item.id===invoice.id)||null;
      setDetail(null);
      if(draft){setEditing(draft);setModal(true);}
      showSuccess('Factura reabierta. Puedes corregirla y volver a emitirla con el mismo número.');
    }catch(e){const message=errorMessage(e,'No se pudo reabrir la factura.');setError(message);showError(message);}
    finally{setBusyId(null);}
  };
  const emit=async(invoice:SalesInvoice)=>{if(!window.confirm(`¿Emitir ${invoice.invoiceType==='rectifying'?'esta rectificativa':'esta factura'}? Se asignará el número. Mientras siga solo como emitida podrás reabrirla o eliminarla.`))return;setBusyId(invoice.id);setError('');try{await issueSalesInvoice(invoice.id);await refresh();showSuccess(invoice.invoiceType==='rectifying'?'Rectificativa emitida correctamente.':'Factura emitida correctamente.');}catch(e){const message=errorMessage(e,'No se pudo emitir la factura.');setError(message);showError(message);}finally{setBusyId(null);}};
  const remove=async(invoice:SalesInvoice)=>{
    const issued=invoice.status==='issued';
    const message=issued?`¿Eliminar completamente ${invoice.invoiceNumber}? Su número quedará libre para reutilizarse.`:'¿Eliminar este borrador? Esta acción no se puede deshacer.';
    if(!window.confirm(message))return;
    setBusyId(invoice.id);setError('');
    try{
      if(issued)await deleteReversibleSalesInvoice(invoice.id);else await deleteSalesInvoiceDraftSafe(invoice.id);
      if(detail?.id===invoice.id)setDetail(null);
      await refresh();
      showSuccess(issued?'Factura eliminada. Su número queda disponible para reutilizarse.':'Borrador eliminado correctamente.');
    }catch(e){const text=errorMessage(e,issued?'No se pudo eliminar la factura.':'No se pudo eliminar el borrador.');setError(text);showError(text);}
    finally{setBusyId(null);}
  };
  const pdf=(invoice:SalesInvoice)=>{try{downloadSalesInvoicePdf(invoice,settings);showSuccess('PDF generado correctamente.');}catch(e){const message=errorMessage(e,'No se pudo generar el PDF.');setError(message);showError(message);}};
  const printPdf=(invoice:SalesInvoice)=>{try{printSalesInvoicePdf(invoice,settings);showSuccess('PDF preparado para imprimir.');}catch(e){const message=errorMessage(e,'No se pudo abrir la impresión del PDF.');setError(message);showError(message);}};
  const rectify=async(invoice:SalesInvoice)=>{if(!window.confirm(`Se creará una rectificativa en borrador que anula ${invoice.invoiceNumber}. ¿Continuar?`))return;setBusyId(invoice.id);setError('');try{const id=await createRectifyingInvoice(invoice.id);const next=await loadSalesInvoices();setInvoices(next);const draft=next.find(item=>item.id===id)||null;setDetail(null);showSuccess('Rectificativa creada en borrador.');if(draft){setEditing(draft);setModal(true);}}catch(e){const message=errorMessage(e,'No se pudo crear la rectificativa.');setError(message);showError(message);}finally{setBusyId(null);}};

  return <div className="page">
    <div className="pageHead"><div><div className="eyebrow">VENTAS</div><h1>Facturación</h1><p>Borradores, emisión, envío real por Gmail, cobros y rectificativas desde un único sitio.</p></div><div className="actions"><button className="secondary" onClick={()=>setBusinessModal(true)}><Settings2 size={17}/> Datos fiscales</button><button className="primary" onClick={openNew}>+ Nueva factura</button></div></div>
    <div className="stats salesStats"><div className="stat"><div className="statIcon"><ReceiptText/></div><div><span>Facturado</span><strong>{money(totals.issued)}</strong><small>Incluye rectificativas</small></div></div><div className="stat"><div className="statIcon"><Banknote/></div><div><span>Pendiente de cobro</span><strong>{money(totals.pending)}</strong><small>Facturas ordinarias vivas</small></div></div><div className="stat"><div className="statIcon"><FilePenLine/></div><div><span>Borradores</span><strong>{totals.drafts}</strong><small>Sin numerar</small></div></div></div>
    <div className="toolbar salesToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar cliente, CIF o nº factura…"/></div><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Todos los estados</option><option value="draft">Borradores</option><option value="issued">Emitidas</option><option value="sent">Enviadas</option><option value="partially_paid">Cobro parcial</option><option value="paid">Cobradas</option><option value="rectified">Rectificadas</option></select></div>
    {error&&<div className="errorBox">{error}</div>}
    <section className="card tableCard">{loading?<div className="emptyState large">Cargando facturación…</div>:filtered.length?<table><thead><tr><th>Fecha</th><th>Número</th><th>Cliente</th><th>Tipo</th><th>Estado</th><th className="right">Base</th><th className="right">IVA</th><th className="right">Total</th><th className="right">Pendiente</th><th className="right">Acciones</th></tr></thead><tbody>{filtered.map(invoice=>{const pending=Math.max(0,invoice.totalAmount-invoice.paidAmount);return <tr key={invoice.id} className="clickableRow" onClick={()=>setDetail(invoice)}><td>{dateLabel(invoice.issueDate)}</td><td><strong>{invoice.invoiceNumber||'Borrador'}</strong></td><td>{invoice.clientName}</td><td>{invoice.invoiceType==='rectifying'?<span className="tag">Rectificativa</span>:'Ordinaria'}</td><td><span className={statusClass(invoice.status)}>{statusLabel(invoice.status)}</span></td><td className="right">{money(invoice.subtotal)}</td><td className="right">{money(invoice.taxAmount)}</td><td className="right"><strong>{money(invoice.totalAmount)}</strong></td><td className="right">{invoice.status==='draft'||invoice.invoiceType==='rectifying'?'—':money(pending)}</td><td className="right"><div className="invoiceActions" onClick={e=>e.stopPropagation()}>
      <button className="iconBtn" title="Ver detalle" onClick={()=>setDetail(invoice)}><Eye size={16}/></button>
      {invoice.status==='draft'?<><button className="iconBtn" title="Editar borrador" onClick={()=>edit(invoice)}><Pencil size={16}/></button><button className="iconBtn" title="Descargar PDF borrador" onClick={()=>pdf(invoice)}><Download size={16}/></button><button className="iconBtn" title="Imprimir PDF borrador" onClick={()=>printPdf(invoice)}><Printer size={16}/></button><button className="iconBtn accountBtn" title="Emitir" disabled={busyId===invoice.id} onClick={()=>emit(invoice)}><FileCheck2 size={16}/></button><button className="iconBtn dangerIcon" title="Eliminar borrador" disabled={busyId===invoice.id} onClick={()=>remove(invoice)}><Trash2 size={16}/></button></>:<><button className="iconBtn" title="Descargar PDF" onClick={()=>pdf(invoice)}><Download size={16}/></button><button className="iconBtn" title="Imprimir PDF" onClick={()=>printPdf(invoice)}><Printer size={16}/></button>{invoice.status==='issued'&&<><button className="iconBtn" title="Editar factura emitida" disabled={busyId===invoice.id} onClick={()=>reopenForEdit(invoice)}><Pencil size={16}/></button><button className="iconBtn dangerIcon" title="Eliminar factura emitida" disabled={busyId===invoice.id} onClick={()=>remove(invoice)}><Trash2 size={16}/></button></>}{invoice.status!=='rectified'&&<button className="iconBtn" title="Enviar por Gmail" onClick={()=>setSendInvoice(invoice)}><Mail size={16}/></button>}{invoice.invoiceType==='standard'&&!['paid','rectified'].includes(invoice.status)&&<button className="iconBtn accountBtn" title="Registrar cobro" onClick={()=>setPaymentInvoice(invoice)}><CheckCircle2 size={16}/></button>}{invoice.invoiceType==='standard'&&invoice.status!=='rectified'&&<button className="iconBtn" title="Crear rectificativa" disabled={busyId===invoice.id} onClick={()=>rectify(invoice)}><RotateCcw size={16}/></button>}</>}
    </div></td></tr>;})}</tbody></table>:<div className="emptyState large">No hay facturas de venta para los filtros seleccionados.</div>}</section>
    {!products.length&&clients.length>0&&<div className="card alertCard"><div className="trendIcon"><PackageSearch/></div><div><h3>Catálogo comercial</h3><p>Puedes crear facturas con conceptos libres. Cuando tengas productos activos aparecerán en el buscador del editor de factura.</p></div></div>}
    <InvoiceModal open={modal} invoice={editing} clients={clients} products={products} onClose={()=>{setModal(false);setEditing(null);}} onSaved={refresh}/>
    <InvoiceDetail invoice={detail} settings={settings} onClose={()=>setDetail(null)} onPdf={pdf} onPrint={printPdf} onPayment={setPaymentInvoice} onSend={setSendInvoice} onRectify={rectify} onEdit={edit} onReopen={reopenForEdit} onDelete={remove}/>
    <BusinessModal open={businessModal} settings={settings} onClose={()=>setBusinessModal(false)} onSaved={async next=>{setSettings(next);await refresh();}}/>
    <PaymentModal invoice={paymentInvoice} onClose={()=>setPaymentInvoice(null)} onSaved={refresh}/>
    <SendInvoiceModal invoice={sendInvoice} settings={settings} onClose={()=>setSendInvoice(null)} onSent={async()=>{await refresh();showSuccess('Factura enviada por Gmail correctamente.');}}/>
  </div>;
}
