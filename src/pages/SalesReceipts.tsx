import { useEffect, useMemo, useState } from 'react';
import { Banknote, Download, Eye, FileCheck2, Plus, ReceiptText, Search, Trash2, X } from 'lucide-react';
import {
  addSalesPayment, createSalesReceiptDraft, deleteSalesReceiptDraft, ensureSalesSeries, issueSalesReceipt,
  loadBusinessSettings, loadClients, loadSalesInvoices, updateSalesReceiptDraft,
  type BusinessSettings, type Client, type SalesInvoice, type SalesInvoiceLine, type SalesInvoiceSeries,
} from '../services/sales';
import { loadBillableProducts, type BillableProduct } from '../services/billableProducts';
import { loadCompanyBranding, type CompanyBranding } from '../services/companyBranding';
import { ProductCatalogPicker } from '../components/ProductCatalogPicker';
import { SearchableSelect } from '../components/forms/SearchableSelect';
import { SelectField } from '../components/forms/SelectField';
import { confirmAction } from '../services/actionDialog';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { createSalesReceiptPdfBlob, salesReceiptPdfFilename } from '../services/salesReceiptPdf';
import { useSettings } from '../context/SettingsContext';
import '../sales.css';
import '../sales-receipts.css';

const today=()=>new Date().toISOString().slice(0,10);
const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const emptyLine=(position=1,taxRate=21):SalesInvoiceLine=>({position,description:'',quantity:1,unit:'ud',unitPrice:0,discountPercent:0,taxRate,productId:null});
const treatmentOptions=[
  {value:'taxable',label:'Sujeta a IVA'},
  {value:'exempt',label:'Exenta de IVA'},
  {value:'non_taxable',label:'No sujeta a IVA'},
  {value:'out_of_scope',label:'Fuera del ámbito de IVA'},
];
const treatmentLabel=(value:SalesInvoice['fiscalTreatment'])=>treatmentOptions.find(x=>x.value===value)?.label||value;
const statusLabel=(status:SalesInvoice['status'])=>({draft:'Borrador',issued:'Pendiente',sent:'Pendiente',partially_paid:'Cobro parcial',paid:'Cobrado',rectified:'Rectificado'}[status]||status);

function downloadBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}

function ReceiptEditor({receipt,clients,products,onClose,onSaved}:{receipt:SalesInvoice|null;clients:Client[];products:BillableProduct[];onClose:()=>void;onSaved:()=>Promise<void>}){
  const {settings}=useSettings();
  const [series,setSeries]=useState<SalesInvoiceSeries[]>([]);
  const [clientId,setClientId]=useState(receipt?.clientId||'');
  const [seriesId,setSeriesId]=useState(receipt?.seriesId||'');
  const [issueDate,setIssueDate]=useState(receipt?.issueDate||today());
  const [treatment,setTreatment]=useState<SalesInvoice['fiscalTreatment']>(receipt?.fiscalTreatment||'taxable');
  const [reason,setReason]=useState(receipt?.fiscalReason||'');
  const [paymentMethod,setPaymentMethod]=useState(receipt?.paymentMethod||settings.sales.paymentMethods.find(x=>x.id===settings.sales.defaultPaymentMethod)?.label||'');
  const [notes,setNotes]=useState(receipt?.notes||'');
  const [lines,setLines]=useState<SalesInvoiceLine[]>(receipt?.lines.length?receipt.lines:[emptyLine(1,settings.sales.defaultVatRate)]);
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    void ensureSalesSeries(Number(issueDate.slice(0,4))).then(rows=>{
      const receipts=rows.filter(row=>row.kind==='receipt');setSeries(receipts);
      setSeriesId(current=>receipts.some(row=>row.id===current)?current:(receipts[0]?.id||''));
    }).catch(e=>showError(errorMessage(e,'No se pudo preparar la serie de recibos.')));
  },[issueDate]);

  useEffect(()=>{
    if(treatment==='taxable')return;
    setLines(current=>current.map(line=>({...line,taxRate:0})));
  },[treatment]);

  const clientOptions=clients.map(client=>({value:client.id,label:client.name,description:client.taxId||client.city||undefined,searchText:[client.taxId,client.email,client.city].filter(Boolean).join(' ')}));
  const seriesOptions=series.map(row=>({value:row.id,label:`${row.name} · próximo ${row.prefix}${String(row.nextNumber).padStart(row.padding,'0')}`}));
  const paymentOptions=settings.sales.paymentMethods.filter(x=>x.active).map(x=>({value:x.label,label:x.label}));
  const updateLine=(index:number,patch:Partial<SalesInvoiceLine>)=>setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
  const removeLine=(index:number)=>setLines(current=>current.length===1?current:current.filter((_,i)=>i!==index).map((line,i)=>({...line,position:i+1})));
  const addProduct=(product:BillableProduct)=>setLines(current=>[...current,{
    position:current.length+1,productId:product.id,description:product.description||product.name,quantity:1,unit:product.unit||'ud',
    unitPrice:product.salePrice||0,discountPercent:0,taxRate:treatment==='taxable'?product.taxRate:0,
  }]);
  const addFree=()=>setLines(current=>[...current,emptyLine(current.length+1,treatment==='taxable'?settings.sales.defaultVatRate:0)]);
  const total=lines.reduce((sum,line)=>{const net=line.quantity*line.unitPrice*(1-(line.discountPercent||0)/100);return sum+net+net*(line.taxRate||0)/100},0);

  const save=async(issue=false)=>{
    if(!clientId){showError('Selecciona un cliente.');return;}
    if(!seriesId){showError('Selecciona una serie de recibos.');return;}
    const clean=lines.filter(line=>line.description.trim()&&line.quantity>0);
    if(!clean.length){showError('Añade al menos un concepto.');return;}
    if(treatment!=='taxable'&&!reason.trim()){showError('Indica el motivo fiscal de la exención o no sujeción.');return;}
    setBusy(true);
    try{
      const input={clientId,seriesId,issueDate,paymentMethod,notes,fiscalTreatment:treatment,fiscalReason:reason,lines:clean};
      let id=receipt?.id;
      if(id)await updateSalesReceiptDraft(id,input);else id=await createSalesReceiptDraft(input);
      if(issue&&id)await issueSalesReceipt(id);
      showSuccess(issue?'Recibo emitido correctamente.':'Borrador de recibo guardado.');
      await onSaved();onClose();
    }catch(e){showError(errorMessage(e,issue?'No se pudo emitir el recibo.':'No se pudo guardar el recibo.'))}
    finally{setBusy(false)}
  };

  return <div className="modalBackdrop"><div className="modal polishedModal receiptEditorModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">RECIBOS</div><h3>{receipt?'Editar recibo':'Nuevo recibo'}</h3><p>Documento de venta con control de cobro y tratamiento fiscal.</p></div><button type="button" onClick={onClose}><X/></button></div>
    <div className="receiptEditorBody">
      <section className="salesFormSection"><div className="salesSectionTitle"><ReceiptText size={18}/><div><strong>Datos del recibo</strong><span>Cliente, numeración y clasificación fiscal</span></div></div>
        <div className="salesFormGrid receiptMetaGrid">
          <label>Cliente *<SearchableSelect value={clientId} options={clientOptions} onChange={setClientId} placeholder="Selecciona cliente" searchPlaceholder="Buscar cliente…" ariaLabel="Cliente del recibo"/></label>
          <label>Serie *<SelectField value={seriesId} onChange={setSeriesId} options={seriesOptions} ariaLabel="Serie del recibo"/></label>
          <label>Fecha *<input type="date" value={issueDate} onChange={e=>setIssueDate(e.target.value)}/></label>
          <label>Forma de cobro<SelectField value={paymentMethod} onChange={setPaymentMethod} options={paymentOptions} ariaLabel="Forma de cobro"/></label>
          <label>Tratamiento fiscal<SelectField value={treatment} onChange={value=>setTreatment(value as SalesInvoice['fiscalTreatment'])} options={treatmentOptions} ariaLabel="Tratamiento fiscal"/></label>
          {treatment!=='taxable'&&<label className="salesSpan2">Motivo fiscal *<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ej.: operación exenta conforme al supuesto aplicable…"/></label>}
        </div>
      </section>
      <section className="salesFormSection"><div className="salesSectionTitle"><ReceiptText size={18}/><div><strong>Productos y conceptos</strong><span>Usa el mismo catálogo que Facturación</span></div></div>
        <ProductCatalogPicker products={products} onAdd={addProduct}/>
        <div className="receiptLines">
          {lines.map((line,index)=><div className="receiptLine" key={line.id||index}>
            <input className="receiptDescription" value={line.description} onChange={e=>updateLine(index,{description:e.target.value})} placeholder="Descripción"/>
            <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updateLine(index,{quantity:Number(e.target.value)})} aria-label="Cantidad"/>
            <input type="number" min="0" step="0.01" value={line.unitPrice} onChange={e=>updateLine(index,{unitPrice:Number(e.target.value)})} aria-label="Precio"/>
            <input type="number" min="0" max="100" step="0.01" value={line.taxRate} disabled={treatment!=='taxable'} onChange={e=>updateLine(index,{taxRate:Number(e.target.value)})} aria-label="IVA"/>
            <button type="button" className="iconButton" onClick={()=>removeLine(index)} aria-label="Eliminar línea"><Trash2 size={15}/></button>
          </div>)}
          <button type="button" className="secondary receiptAddLine" onClick={addFree}><Plus size={15}/> Concepto libre</button>
        </div>
      </section>
      <label className="receiptNotes">Notas<textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notas internas o del recibo…"/></label>
      <div className="receiptTotal"><span>Total</span><strong>{money(total)}</strong></div>
    </div>
    <div className="modalActions receiptModalActions"><button className="secondary" type="button" onClick={onClose}>Cancelar</button><button className="secondary" type="button" disabled={busy} onClick={()=>void save(false)}>{busy?'Guardando…':'Guardar borrador'}</button><button className="primary" type="button" disabled={busy} onClick={()=>void save(true)}><FileCheck2 size={16}/> Emitir recibo</button></div>
  </div></div>;
}

function ReceiptDetail({receipt,business,branding,onClose,onEdit,onChanged}:{receipt:SalesInvoice;business:BusinessSettings;branding:CompanyBranding;onClose:()=>void;onEdit:()=>void;onChanged:()=>Promise<void>}){
  const {settings}=useSettings();
  const pending=Math.max(0,receipt.totalAmount-receipt.paidAmount);
  const [busy,setBusy]=useState(false);
  const collect=async()=>{
    if(pending<=0.005)return;
    setBusy(true);
    try{
      await addSalesPayment(receipt.id,{amount:pending,paymentDate:today(),method:receipt.paymentMethod||settings.sales.paymentMethods.find(x=>x.id===settings.sales.defaultPaymentMethod)?.label});
      showSuccess('Cobro registrado.');await onChanged();onClose();
    }catch(e){showError(errorMessage(e,'No se pudo registrar el cobro.'))}finally{setBusy(false)}
  };
  const remove=async()=>{
    const ok=await confirmAction({title:'Eliminar borrador',message:'El recibo en borrador se eliminará definitivamente.',confirmLabel:'Eliminar',tone:'danger'});
    if(!ok)return;
    setBusy(true);try{await deleteSalesReceiptDraft(receipt.id);showSuccess('Borrador eliminado.');await onChanged();onClose()}catch(e){showError(errorMessage(e,'No se pudo eliminar el recibo.'))}finally{setBusy(false)}
  };
  const download=()=>downloadBlob(createSalesReceiptPdfBlob(receipt,business,branding),salesReceiptPdfFilename(receipt));
  return <div className="modalBackdrop"><div className="modal polishedModal receiptDetailModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">RECIBO</div><h3>{receipt.invoiceNumber||'Borrador'}</h3><p>{receipt.clientName} · {receipt.issueDate}</p></div><button type="button" onClick={onClose}><X/></button></div>
    <div className="receiptDetailBody">
      <div className="receiptDetailStats"><div><span>Estado</span><strong>{statusLabel(receipt.status)}</strong></div><div><span>Tratamiento fiscal</span><strong>{treatmentLabel(receipt.fiscalTreatment)}</strong></div><div><span>Total</span><strong>{money(receipt.totalAmount)}</strong></div><div><span>Pendiente</span><strong>{receipt.status==='draft'?'—':money(pending)}</strong></div></div>
      {receipt.fiscalReason&&<div className="receiptFiscalReason"><strong>Motivo fiscal</strong><p>{receipt.fiscalReason}</p></div>}
      <div className="receiptDetailLines">{receipt.lines.map(line=><div key={line.id||line.position}><span>{line.description}<small>{line.quantity} × {money(line.unitPrice)} · IVA {line.taxRate}%</small></span><strong>{money(line.lineTotal||0)}</strong></div>)}</div>
      {receipt.notes&&<div className="receiptFiscalReason"><strong>Notas</strong><p>{receipt.notes}</p></div>}
    </div>
    <div className="modalActions receiptModalActions">
      {receipt.status==='draft'&&<><button className="secondary dangerAction" type="button" disabled={busy} onClick={()=>void remove()}><Trash2 size={15}/> Eliminar</button><button className="secondary" type="button" onClick={onEdit}>Editar</button></>}
      {receipt.status!=='draft'&&<button className="secondary" type="button" onClick={download}><Download size={15}/> PDF</button>}
      {receipt.status!=='draft'&&receipt.status!=='paid'&&pending>0.005&&<button className="primary" type="button" disabled={busy} onClick={()=>void collect()}><Banknote size={15}/> Marcar cobrado</button>}
    </div>
  </div></div>;
}

export function SalesReceipts(){
  const [receipts,setReceipts]=useState<SalesInvoice[]>([]);
  const [clients,setClients]=useState<Client[]>([]);
  const [products,setProducts]=useState<BillableProduct[]>([]);
  const [business,setBusiness]=useState<BusinessSettings>({legalName:'ZENVIA COMMERCE SL',countryCode:'ES'});
  const [branding,setBranding]=useState<CompanyBranding>({ownerId:'',logoPath:null,logoDataUrl:null});
  const [query,setQuery]=useState('');
  const [collection,setCollection]=useState('all');
  const [editor,setEditor]=useState(false);
  const [editing,setEditing]=useState<SalesInvoice|null>(null);
  const [detail,setDetail]=useState<SalesInvoice|null>(null);
  const [loading,setLoading]=useState(true);

  const refresh=async()=>{
    setLoading(true);
    try{
      await ensureSalesSeries(new Date().getFullYear());
      const [documents,nextClients,nextProducts,nextBusiness,nextBranding]=await Promise.all([loadSalesInvoices(),loadClients(),loadBillableProducts(),loadBusinessSettings(),loadCompanyBranding()]);
      const next=documents.filter(item=>item.documentKind==='receipt');
      setReceipts(next);setClients(nextClients);setProducts(nextProducts);setBusiness(nextBusiness);setBranding(nextBranding);
      setDetail(current=>current?next.find(item=>item.id===current.id)||null:null);
    }catch(e){showError(errorMessage(e,'No se pudieron cargar los recibos.'))}finally{setLoading(false)}
  };
  useEffect(()=>{void refresh()},[]);

  const shown=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return receipts.filter(receipt=>{
      if(collection==='open'&&(receipt.status==='draft'||receipt.status==='paid'))return false;
      if(collection==='paid'&&receipt.status!=='paid')return false;
      return !q||[receipt.invoiceNumber||'borrador',receipt.clientName,receipt.clientTaxId||''].some(value=>value.toLowerCase().includes(q));
    });
  },[receipts,query,collection]);
  const issued=shown.filter(x=>x.status!=='draft');
  const income=issued.reduce((sum,x)=>sum+x.totalAmount,0);
  const collected=issued.reduce((sum,x)=>sum+x.paidAmount,0);
  const pending=issued.reduce((sum,x)=>sum+Math.max(0,x.totalAmount-x.paidAmount),0);

  const openNew=()=>{if(!clients.length){showError('Crea al menos un cliente antes de preparar un recibo.');return;}setEditing(null);setEditor(true)};
  return <div className="page salesPage receiptsPage">
    <div className="pageHead"><div><div className="eyebrow">FACTURACIÓN</div><h1>Recibos</h1><p>Ventas registradas con control de cobro y clasificación fiscal explícita.</p></div><div className="actions"><button className="primary" onClick={openNew}><Plus size={17}/> Nuevo recibo</button></div></div>
    <div className="statsGrid receiptStats"><div className="statCard"><div><span>Ingresos</span><strong>{money(income)}</strong></div></div><div className="statCard"><div><span>Cobrado</span><strong>{money(collected)}</strong></div></div><div className="statCard"><div><span>Pendiente</span><strong>{money(pending)}</strong></div></div><div className="statCard"><div><span>Documentos</span><strong>{issued.length}</strong></div></div></div>
    <div className="toolbar"><div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nº, cliente o NIF…"/></div><SelectField value={collection} onChange={setCollection} ariaLabel="Cobro" options={[{value:'all',label:'Todos'},{value:'open',label:'Pendientes de cobro'},{value:'paid',label:'Cobrados'}]}/><span>{shown.length} recibos</span></div>
    <section className="card receiptTable">
      <div className="receiptRow receiptHead"><div>Número</div><div>Cliente</div><div>Fecha</div><div>Fiscal</div><div>Estado</div><div>Total</div><div>Pendiente</div><div></div></div>
      {shown.map(receipt=>{const due=Math.max(0,receipt.totalAmount-receipt.paidAmount);return <button type="button" className="receiptRow receiptDataRow" key={receipt.id} onClick={()=>setDetail(receipt)}>
        <div><strong>{receipt.invoiceNumber||'Borrador'}</strong></div><div className="entityCell"><strong>{receipt.clientName}</strong><span>{receipt.clientTaxId||'Sin NIF/CIF'}</span></div><div>{receipt.issueDate}</div><div>{treatmentLabel(receipt.fiscalTreatment)}</div><div><span className={`salesStatus ${receipt.status}`}>{statusLabel(receipt.status)}</span></div><div><strong>{money(receipt.totalAmount)}</strong></div><div>{receipt.status==='draft'?'—':money(due)}</div><div><Eye size={16}/></div>
      </button>})}
      {!loading&&!shown.length&&<div className="emptyState">No hay recibos para mostrar.</div>}
      {loading&&!receipts.length&&<div className="emptyState">Cargando recibos…</div>}
    </section>
    {editor&&<ReceiptEditor receipt={editing} clients={clients} products={products} onClose={()=>{setEditor(false);setEditing(null)}} onSaved={refresh}/>}
    {detail&&<ReceiptDetail receipt={detail} business={business} branding={branding} onClose={()=>setDetail(null)} onEdit={()=>{setEditing(detail);setDetail(null);setEditor(true)}} onChanged={refresh}/>}
  </div>;
}
