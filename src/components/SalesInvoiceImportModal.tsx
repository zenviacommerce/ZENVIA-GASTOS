import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, LoaderCircle, Plus, Trash2, Upload, X } from 'lucide-react';
import { ensureSalesSeries, type Client, type SalesInvoice, type SalesInvoiceSeries } from '../services/sales';
import { createSalesInvoiceDraftFromCandidate, friendlySalesImportError, prepareSalesInvoiceImportCandidate, recalculateSalesImportCandidate, type SalesInvoiceImportCandidate } from '../services/salesInvoiceImport';
import { SearchableSelect } from './forms/SearchableSelect';
import { SelectField } from './forms/SelectField';
import { BulkSelectCheckbox, BulkSelectionToolbar } from './BulkSelectionToolbar';
import { showError, showOperationResult, showSuccess } from '../services/toast';
import { normalizeTaxId, taxIdError } from '../services/validation';
import { useSettings } from '../context/SettingsContext';
import { defaultSalesDueDate } from '../services/salesDefaults';

const ANALYSIS_CONCURRENCY=2;
type Item={id:string;file:File;candidate?:SalesInvoiceImportCandidate;series:SalesInvoiceSeries[];status:'analyzing'|'needs_review'|'ready'|'duplicate'|'importing'|'imported'|'error';error?:string;excluded?:boolean};
type Props={open:boolean;onClose:()=>void;clients:Client[];existingInvoices:SalesInvoice[];onFinished:()=>Promise<void>|void};
const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';

function bestSeries(series:SalesInvoiceSeries[],invoiceNumber:string){
  const standards=series.filter(item=>item.kind==='standard'&&item.active);
  return [...standards].sort((a,b)=>b.prefix.length-a.prefix.length).find(item=>invoiceNumber.startsWith(item.prefix))||standards[0]||null;
}
function proposedNumber(series:SalesInvoiceSeries){return `${series.prefix}${String(series.nextNumber).padStart(series.padding,'0')}`;}

export function SalesInvoiceImportModal({open,onClose,clients,existingInvoices,onFinished}:Props){
  const {settings}=useSettings();
  const inputRef=useRef<HTMLInputElement>(null);
  const [items,setItems]=useState<Item[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
  const [busy,setBusy]=useState(false);

  useEffect(()=>{if(!open){setItems([]);setSelectedId(null);setCheckedIds(new Set());setBusy(false);}},[open]);
  const patch=(id:string,change:Partial<Item>)=>setItems(current=>current.map(item=>item.id===id?{...item,...change}:item));
  const patchCandidate=(id:string,change:Partial<SalesInvoiceImportCandidate>)=>setItems(current=>current.map(item=>item.id===id&&item.candidate?{...item,status:item.status==='duplicate'?'duplicate':'needs_review',candidate:recalculateSalesImportCandidate({...item.candidate,...change,status:'needs_review'})}:item));
  const patchProposedClient=(id:string,change:Partial<NonNullable<SalesInvoiceImportCandidate['proposedClient']>>)=>setItems(current=>current.map(item=>item.id===id&&item.candidate?.proposedClient?{...item,status:item.status==='duplicate'?'duplicate':'needs_review',candidate:{...item.candidate,status:'needs_review',proposedClient:{...item.candidate.proposedClient,...change}}}:item));

  const prepareFile=async(item:Item)=>{
    try{
      let candidate=await prepareSalesInvoiceImportCandidate(item.file,clients,settings.sales.defaultDueDays,settings.clients);
      const year=/^\d{4}-/.test(candidate.issueDate)?Number(candidate.issueDate.slice(0,4)):new Date().getFullYear();
      const allSeries=await ensureSalesSeries(year);
      const series=allSeries.filter(row=>row.kind==='standard'&&row.active);
      const selectedSeries=bestSeries(series,candidate.invoiceNumber);
      candidate={...candidate,seriesId:selectedSeries?.id||'',invoiceNumber:candidate.invoiceNumber||(selectedSeries?proposedNumber(selectedSeries):'')};
      const duplicateInvoice=candidate.invoiceNumber?existingInvoices.find(invoice=>invoice.invoiceNumber===candidate.invoiceNumber):undefined;
      const repairable=Boolean(duplicateInvoice&&duplicateInvoice.status==='draft');
      if(duplicateInvoice){
        candidate=repairable
          ? {...candidate,status:'needs_review',existingInvoiceId:duplicateInvoice!.id,existingInvoiceNumber:duplicateInvoice!.invoiceNumber,existingClientId:duplicateInvoice!.clientId,reviewReason:'Ya existe este borrador. Al guardar se actualizarán sus datos y su cliente, sin crear una factura duplicada.'}
          : {...candidate,status:'duplicate',reviewReason:'Ya existe una factura emitida o no reparable con este número.'};
      }
      patch(item.id,{candidate,series,status:duplicateInvoice&&!repairable?'duplicate':'needs_review',error:undefined});
    }catch(error){patch(item.id,{status:'error',error:error instanceof Error?error.message:'No se pudo analizar la factura.'});}
  };

  const analyzeFiles=async(files:File[])=>{
    const pdfs=files.filter(file=>file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf'));
    const initial:Item[]=pdfs.map(file=>({id:crypto.randomUUID(),file,series:[],status:'analyzing'}));
    setItems(initial);setSelectedId(null);setCheckedIds(new Set());
    let cursor=0;
    const worker=async()=>{while(true){const index=cursor++;if(index>=initial.length)return;await prepareFile(initial[index]);}};
    await Promise.all(Array.from({length:Math.min(ANALYSIS_CONCURRENCY,initial.length)},()=>worker()));
  };

  const selected=items.find(item=>item.id===selectedId);
  const candidate=selected?.candidate;
  const clientOptions=useMemo(()=>clients.map(client=>({value:client.id,label:client.name,description:client.taxId||client.city||undefined,searchText:[client.name,client.taxId,client.email,client.city].filter(Boolean).join(' ')})),[clients]);
  const seriesOptions=(selected?.series||[]).map(series=>({value:series.id,label:`${series.name} · ${series.prefix}`,description:`Siguiente ${proposedNumber(series)}`,searchText:`${series.name} ${series.code} ${series.prefix}`}));

  const changeDate=async(value:string)=>{
    if(!selected||!candidate)return;
    patchCandidate(selected.id,{issueDate:value,dueDate:defaultSalesDueDate(value,settings.sales.defaultDueDays)});
    if(!/^\d{4}-/.test(value))return;
    try{
      const rows=(await ensureSalesSeries(Number(value.slice(0,4)))).filter(row=>row.kind==='standard'&&row.active);
      const chosen=bestSeries(rows,candidate.invoiceNumber);
      setItems(current=>current.map(item=>item.id===selected.id&&item.candidate?{...item,series:rows,status:'needs_review',candidate:{...item.candidate,issueDate:value,seriesId:chosen?.id||''}}:item));
    }catch(error){patch(selected.id,{error:error instanceof Error?error.message:'No se pudieron cargar las series.'});}
  };

  const updateLine=(index:number,change:Partial<SalesInvoiceImportCandidate['lines'][number]>)=>{if(!selected||!candidate)return;patchCandidate(selected.id,{lines:candidate.lines.map((line,i)=>i===index?{...line,...change}:line)});};
  const addLine=()=>{if(!selected||!candidate)return;const selectedClient=clients.find(client=>client.id===candidate.clientId);const taxRate=selectedClient?.defaultVatRate??candidate.proposedClient?.defaultVatRate??settings.sales.defaultVatRate;patchCandidate(selected.id,{lines:[...candidate.lines,{position:candidate.lines.length+1,description:'',quantity:1,unit:'ud',unitPrice:0,discountPercent:0,taxRate,productId:null}]});};
  const removeLine=(index:number)=>{if(!selected||!candidate)return;patchCandidate(selected.id,{lines:candidate.lines.filter((_,i)=>i!==index).map((line,i)=>({...line,position:i+1}))});};

  const validationError=(item:Item)=>{
    const current=item.candidate;
    if(!current)return 'No se ha podido analizar la factura.';
    const selectedSeries=item.series.find(series=>series.id===current.seriesId);
    if(!current.clientId&&!current.proposedClient?.name)return 'Selecciona el cliente o revisa el cliente detectado.';
    if(!current.clientId&&current.proposedClient?.name&&!settings.clients.autoCreate)return 'La creación automática de clientes está desactivada. Selecciona un cliente existente o crea el cliente manualmente.';
    if(!current.issueDate)return 'Indica la fecha de factura.';
    if(!current.dueDate)return 'Indica la fecha de vencimiento.';
    if(current.dueDate<current.issueDate)return 'El vencimiento no puede ser anterior a la fecha de factura.';
    if(current.proposedClient?.taxId&&taxIdError(current.proposedClient.taxId,false))return 'Revisa el DNI/CIF/VAT detectado del cliente.';
    if(!current.seriesId||!selectedSeries)return 'Selecciona la serie.';
    if(!current.invoiceNumber.trim())return 'Indica el número de factura.';
    if(!current.invoiceNumber.startsWith(selectedSeries.prefix))return `El número debe comenzar por ${selectedSeries.prefix}.`;
    const collision=existingInvoices.find(invoice=>invoice.invoiceNumber===current.invoiceNumber);
    if(current.existingInvoiceId&&current.existingInvoiceNumber&&current.invoiceNumber!==current.existingInvoiceNumber)return 'Para reparar este borrador conserva su número de factura.';
    if(collision&&collision.id!==current.existingInvoiceId)return 'Ya existe una factura con este número.';
    if(!current.lines.some(line=>line.description.trim()&&Number.isFinite(line.quantity)&&line.quantity>0))return 'Añade al menos una línea válida.';
    if(current.lines.some(line=>!Number.isFinite(line.quantity)||!Number.isFinite(line.unitPrice)||!Number.isFinite(line.taxRate)))return 'Hay una línea con valores numéricos no válidos.';
    return '';
  };

  const confirmReview=()=>{
    if(!selected||!candidate)return;
    const error=validationError(selected);
    if(error){patch(selected.id,{status:'needs_review',error});return;}
    patch(selected.id,{status:'ready',error:undefined,candidate:{...recalculateSalesImportCandidate(candidate),status:'ready',reviewReason:undefined}});
  };

  const selectableItems=items.filter(item=>!item.excluded&&item.candidate&&['needs_review','ready'].includes(item.status));
  const selectedBulkItems=selectableItems.filter(item=>checkedIds.has(item.id));
  const allSelectableSelected=selectableItems.length>0&&selectableItems.every(item=>checkedIds.has(item.id));
  const toggleChecked=(id:string,checked:boolean)=>setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
  const toggleAll=(checked:boolean)=>setCheckedIds(checked?new Set(selectableItems.map(item=>item.id)):new Set());

  const validateMany=(targets:Item[])=>{
    if(!targets.length)return;
    const results=new Map(targets.map(item=>[item.id,validationError(item)]));
    const valid=[...results.values()].filter(error=>!error).length;
    const invalid=results.size-valid;
    setItems(current=>current.map(item=>{
      if(!results.has(item.id)||!item.candidate)return item;
      const error=results.get(item.id)||'';
      if(error)return {...item,status:'needs_review',error};
      return {...item,status:'ready',error:undefined,candidate:{...recalculateSalesImportCandidate(item.candidate),status:'ready',reviewReason:undefined}};
    }));
    setCheckedIds(new Set());
    const successMessage=valid?`${valid} factura${valid===1?' validada':'s validadas'}.`:'';
    const failureMessage=invalid?`${invalid} factura${invalid===1?' necesita':'s necesitan'} revisión manual.`:'';
    showOperationResult(successMessage,failureMessage);
  };
  const validateSelected=()=>validateMany(selectedBulkItems);
  const validateAll=()=>validateMany(selectableItems);

  const excludeSelected=()=>{
    const ids=new Set(selectedBulkItems.map(item=>item.id));
    if(!ids.size)return;
    setItems(current=>current.map(item=>ids.has(item.id)?{...item,excluded:true}:item));
    setCheckedIds(new Set());
  };

  const importReady=async()=>{
    const ready=items.filter(item=>!item.excluded&&item.status==='ready'&&item.candidate);
    if(!ready.length)return;
    setBusy(true);
    try{
      for(const item of ready){
        patch(item.id,{status:'importing'});
        try{await createSalesInvoiceDraftFromCandidate(item.candidate!,settings.sales.defaultDueDays,settings.general.currencyCode,settings.clients);patch(item.id,{status:'imported',candidate:{...item.candidate!,status:'imported'}});}
        catch(error){patch(item.id,{status:'error',error:friendlySalesImportError(error)});}
      }
      await onFinished();
    }finally{setBusy(false);}
  };

  if(!open)return null;
  const readyCount=items.filter(item=>!item.excluded&&item.status==='ready').length;
  const pendingCount=items.filter(item=>item.status==='analyzing').length;
  const reviewCount=items.filter(item=>!item.excluded&&item.status==='needs_review').length;

  return <div className="modalBackdrop"><div className="modal bulkInvoiceModal salesImportModal">
    <div className="modalHead"><div><h3>Importar facturas de venta</h3><p>Selecciona uno o varios PDF. Cada factura debe revisarse antes de guardarse y siempre se crea como borrador.</p></div><button onClick={onClose}><X/></button></div>
    <input hidden ref={inputRef} type="file" multiple accept="application/pdf" onChange={event=>void analyzeFiles(Array.from(event.target.files||[]))}/>
    {!items.length?<button className="bulkInvoiceDrop" type="button" onClick={()=>inputRef.current?.click()}><Upload/><strong>Seleccionar PDFs</strong><span>Puedes elegir varios archivos a la vez</span></button>:<>
      <div className="bulkInvoiceSummary"><strong>{items.length-pendingCount} de {items.length} analizadas</strong><span>{readyCount} revisadas · {reviewCount} por revisar · {pendingCount} analizando</span><button className="secondary" type="button" disabled={busy} onClick={()=>inputRef.current?.click()}>Cambiar selección</button></div>
      <BulkSelectionToolbar selectedCount={selectedBulkItems.length} totalCount={selectableItems.length} allSelected={allSelectableSelected} onToggleAll={toggleAll} label="facturas">
        <button className="secondary" type="button" disabled={!selectedBulkItems.length||busy} onClick={excludeSelected}>Excluir seleccionadas</button>
        <button className="secondary" type="button" disabled={!selectableItems.length||busy} onClick={validateAll}><CheckCircle2 size={15}/> Validar todas</button>
        <button className="primary" type="button" disabled={!selectedBulkItems.length||busy} onClick={validateSelected}><CheckCircle2 size={15}/> Validar seleccionadas ({selectedBulkItems.length})</button>
      </BulkSelectionToolbar>
      <div className="bulkInvoiceList">{items.map(item=><div key={item.id} className={`bulkInvoiceRow ${item.status} ${item.excluded?'excluded':''} ${checkedIds.has(item.id)?'selected':''}`}>
        <div className="bulkInvoiceFile"><BulkSelectCheckbox checked={checkedIds.has(item.id)&&!item.excluded} disabled={item.excluded||!item.candidate||!['needs_review','ready'].includes(item.status)} onChange={checked=>toggleChecked(item.id,checked)} label={`Seleccionar ${item.file.name}`}/><FileText size={18}/><div><strong>{item.file.name}</strong><span>{item.status==='analyzing'?'Analizando':item.status==='needs_review'?(item.candidate?.existingInvoiceId?'Reparar borrador':'Requiere revisión'):item.status==='ready'?(item.candidate?.existingInvoiceId?'Listo para reparar':'Revisada'):item.status==='duplicate'?'Duplicada':item.status==='importing'?'Guardando':item.status==='imported'?(item.candidate?.existingInvoiceId?'Borrador actualizado':'Borrador creado'):'Error'}</span></div></div>
        {item.status==='analyzing'?<LoaderCircle className="spin" size={18}/>:item.candidate?<div className="bulkInvoiceMeta"><span>{clients.find(client=>client.id===item.candidate?.clientId)?.name||(item.candidate.proposedClient?.name?`${item.candidate.existingInvoiceId?'Cliente corregido':'Nuevo cliente'} · ${item.candidate.proposedClient.name}`:'Cliente sin asignar')}</span><span>{item.candidate.invoiceNumber||'Sin número'} · {item.candidate.issueDate||'Sin fecha'}</span><span>Base {money(item.candidate.subtotal)} · IVA {money(item.candidate.taxAmount)} · Total {money(item.candidate.totalAmount)}</span>{item.error&&<span className="warnText">{item.error}</span>}</div>:<div className="bulkInvoiceMeta"><span className="warnText">{item.error||'No se pudo analizar.'}</span></div>}
        <div className="bulkInvoiceActions">{item.candidate&&['needs_review','ready','duplicate'].includes(item.status)&&<button className="secondary" type="button" onClick={()=>setSelectedId(item.id)}>Revisar</button>}<button className="secondary" type="button" disabled={busy||['imported','importing'].includes(item.status)} onClick={()=>{patch(item.id,{excluded:!item.excluded});setCheckedIds(current=>{const next=new Set(current);next.delete(item.id);return next;});}}>{item.excluded?'Incluir':'Excluir'}</button></div>
      </div>)}</div>
    </>}

    {selected&&candidate&&<div className="bulkInvoiceReview salesImportReview"><div className="bulkInvoiceReviewHead"><div><strong>Revisar factura</strong><span>{selected.file.name}</span></div><button className="iconBtn" onClick={()=>setSelectedId(null)}><X size={16}/></button></div>
      <div className="salesFormGrid">
        <label>Cliente *<SearchableSelect value={candidate.clientId} options={clientOptions} onChange={value=>patchCandidate(selected.id,{clientId:value,proposedClient:value&&value!==candidate.clientId?null:candidate.proposedClient})} placeholder={candidate.proposedClient?.name?`Nuevo: ${candidate.proposedClient.name}`:'Selecciona cliente'} searchPlaceholder="Buscar cliente, CIF, email…" ariaLabel="Cliente importado"/>{candidate.proposedClient?.name&&<small className="salesImportedClientHint">{candidate.clientId?'Datos detectados para completar el cliente':'Se creará automáticamente'}: <strong>{candidate.proposedClient.name}</strong>{candidate.proposedClient.taxId?` · ${candidate.proposedClient.taxId}`:' · sin DNI/CIF/VAT en el PDF'}</small>}</label>
        <label>Serie *<SearchableSelect value={candidate.seriesId} options={seriesOptions} onChange={value=>patchCandidate(selected.id,{seriesId:value})} placeholder="Selecciona serie" searchPlaceholder="Buscar serie…" ariaLabel="Serie importada"/></label>
        <label>Número de factura *<input value={candidate.invoiceNumber} disabled={Boolean(candidate.existingInvoiceId)} onChange={event=>patchCandidate(selected.id,{invoiceNumber:event.target.value})}/>{candidate.existingInvoiceId&&<small className="salesImportedClientHint">Se actualizará el borrador existente, conservando este número.</small>}</label>
        <label>Fecha factura *<input type="date" value={candidate.issueDate} onChange={event=>void changeDate(event.target.value)}/></label>
        <label>Vencimiento *<input type="date" min={candidate.issueDate||undefined} value={candidate.dueDate} onChange={event=>patchCandidate(selected.id,{dueDate:event.target.value})}/><small className="salesImportedClientHint">Por defecto, {settings.sales.defaultDueDays} días después de la fecha de factura.</small></label>
      </div>
      {candidate.proposedClient&&<section className="salesImportedClientEditor">
        <div className="salesImportedClientEditorHead"><div><strong>Datos fiscales detectados del cliente</strong><span>Se guardarán al crear el cliente o completarán los datos que falten.</span></div></div>
        <div className="salesFormGrid">
          <label className="salesSpan2">Nombre / razón social<input value={candidate.proposedClient.name} onChange={event=>patchProposedClient(selected.id,{name:event.target.value})}/></label>
          <label>DNI / CIF / VAT<input value={candidate.proposedClient.taxId||''} onChange={event=>patchProposedClient(selected.id,{taxId:normalizeTaxId(event.target.value)})} placeholder="B12345678 / 12345678Z / FR…"/><small className="salesImportedClientHint">{candidate.proposedClient.taxId?'Detectado o revisado':'No aparece en el PDF; puedes completarlo si lo conoces.'}</small></label>
          <label>País<input maxLength={2} value={candidate.proposedClient.countryCode||'XX'} onChange={event=>patchProposedClient(selected.id,{countryCode:event.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2)})}/></label>
        </div>
      </section>}
      <div className="salesLinesEditor"><div className="salesLinesHead"><div><strong>Líneas detectadas</strong><span>Comprueba descripción, cantidad, precio e IVA</span></div><button className="secondary" type="button" onClick={addLine}><Plus size={15}/> Añadir línea</button></div>
        {candidate.lines.map((line,index)=><div className="salesLine salesLineCard" key={`${candidate.id}-${index}`}><label className="salesLineDescription">Descripción<input value={line.description} onChange={event=>updateLine(index,{description:event.target.value})}/></label><label>Cantidad<input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event=>updateLine(index,{quantity:Number(event.target.value)})}/></label><label>Unidad<input value={line.unit} onChange={event=>updateLine(index,{unit:event.target.value})}/></label><label>Precio unit.<input type="number" step="0.01" value={line.unitPrice} onChange={event=>updateLine(index,{unitPrice:Number(event.target.value)})}/></label><label>IVA %<SelectField value={String(line.taxRate)} onChange={value=>updateLine(index,{taxRate:Number(value)})} ariaLabel={`IVA línea ${index+1}`} options={[{value:'21',label:'21 %'},{value:'10',label:'10 %'},{value:'4',label:'4 %'},{value:'0',label:'0 %'}]}/></label><button className="iconAction danger" type="button" onClick={()=>removeLine(index)}><Trash2 size={16}/></button></div>)}
      </div>
      <div className="salesTotals"><span>Base imponible <strong>{money(recalculateSalesImportCandidate(candidate).subtotal)}</strong></span><span>IVA <strong>{money(recalculateSalesImportCandidate(candidate).taxAmount)}</strong></span><span className="salesGrandTotal">Total <strong>{money(recalculateSalesImportCandidate(candidate).totalAmount)}</strong></span></div>
      {(selected.error||candidate.reviewReason)&&<div className="warningBox"><AlertCircle size={17}/>{selected.error||candidate.reviewReason}</div>}
      <div className="modalActions"><button className="secondary" type="button" onClick={()=>setSelectedId(null)}>Cerrar revisión</button><button className="primary" type="button" onClick={confirmReview}><CheckCircle2 size={16}/> Confirmar revisión</button></div>
    </div>}

    <div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cerrar</button><button className="primary" onClick={importReady} disabled={busy||readyCount===0}>{busy?'Guardando…':`Guardar / reparar borradores (${readyCount})`}</button></div>
  </div></div>;
}
