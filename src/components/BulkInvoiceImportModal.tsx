import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, LoaderCircle, Upload, X } from 'lucide-react';
import { classifyInvoiceCandidate, invoiceCandidateToInput, prepareInvoiceCandidate } from '../services/invoiceImportPipeline';
import type { ExpenseCategory, Invoice, InvoiceImportCandidate, NewInvoiceInput } from '../types';
import { InvoiceCandidateForm } from './InvoiceCandidateForm';

export const ANALYSIS_CONCURRENCY=2;

type BulkItem={
  id:string;
  file:File;
  status:InvoiceImportCandidate['status'];
  candidate?:InvoiceImportCandidate;
  error?:string;
  excluded?:boolean;
};

type Props={
  open:boolean;
  onClose:()=>void;
  categories:ExpenseCategory[];
  existingInvoices:Invoice[];
  onSave:(input:NewInvoiceInput)=>Promise<void>;
  onFinished:()=>Promise<void>|void;
};

const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const statusLabel:Record<InvoiceImportCandidate['status'],string>={analyzing:'Analizando',ready:'Lista',needs_review:'Requiere revisión',duplicate:'Duplicada',error:'Error',importing:'Importando',imported:'Importada'};

export function BulkInvoiceImportModal({open,onClose,categories,existingInvoices,onSave,onFinished}:Props){
  const inputRef=useRef<HTMLInputElement>(null);
  const [items,setItems]=useState<BulkItem[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);

  useEffect(()=>{if(!open){setItems([]);setSelectedId(null);setBusy(false)}},[open]);
  if(!open)return null;

  const patch=(id:string,update:Partial<BulkItem>)=>setItems(current=>current.map(item=>item.id===id?{...item,...update}:item));

  const analyzeFiles=async(files:File[])=>{
    const pdfs=files.filter(file=>file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf'));
    const initial=pdfs.map(file=>({id:crypto.randomUUID(),file,status:'analyzing' as const}));
    setItems(initial);setSelectedId(null);
    let cursor=0;
    const worker=async()=>{
      while(true){
        const index=cursor++;
        if(index>=initial.length)return;
        const item=initial[index];
        try{
          const prepared=await prepareInvoiceCandidate(item.file,categories);
          const candidate=classifyInvoiceCandidate(prepared,existingInvoices);
          patch(item.id,{candidate,status:candidate.status,error:undefined});
        }catch(error){
          patch(item.id,{status:'error',error:error instanceof Error?error.message:'No se pudo analizar la factura.'});
        }
      }
    };
    await Promise.all(Array.from({length:Math.min(ANALYSIS_CONCURRENCY,initial.length)},()=>worker()));
  };

  const chooseFiles=(files:File[])=>{if(files.length)void analyzeFiles(files)};
  const selected=items.find(item=>item.id===selectedId);
  const updateSelectedCandidate=(candidate:InvoiceImportCandidate)=>{
    if(!selected)return;
    const nextStatus=candidate.status==='duplicate'?'duplicate':candidate.status==='error'?'error':candidate.status;
    patch(selected.id,{candidate,status:nextStatus});
  };
  const confirmReview=()=>{
    if(!selected?.candidate)return;
    const candidate=selected.candidate;
    if(!candidate.supplierName.trim()||!candidate.invoiceDate)return;
    const next={...candidate,status:'ready' as const,reviewReason:undefined};
    patch(selected.id,{candidate:next,status:'ready',error:undefined});
  };

  const importReady=async()=>{
    const ready=items.filter(item=>!item.excluded&&item.candidate?.status==='ready').map(item=>item.candidate!);
    if(!ready.length)return;
    setBusy(true);
    for(const candidate of ready){
      patch(candidate.id,{status:'importing'});
      setItems(current=>current.map(item=>item.candidate?.id===candidate.id?{...item,status:'importing',candidate:{...candidate,status:'importing'}}:item));
      try{
        await onSave(invoiceCandidateToInput(candidate,'manual'));
        setItems(current=>current.map(item=>item.candidate?.id===candidate.id?{...item,status:'imported',candidate:{...candidate,status:'imported'}}:item));
      }catch(error){
        setItems(current=>current.map(item=>item.candidate?.id===candidate.id?{...item,status:'error',error:error instanceof Error?error.message:'No se pudo importar.',candidate:{...candidate,status:'error'}}:item));
      }
    }
    await onFinished();
    setBusy(false);
  };

  const analyzed=items.filter(item=>item.status!=='analyzing').length;
  const readyCount=items.filter(item=>!item.excluded&&item.status==='ready').length;
  const reviewCount=items.filter(item=>!item.excluded&&item.status==='needs_review').length;
  const pendingCount=items.filter(item=>item.status==='analyzing').length;

  return <div className="modalBackdrop"><div className="modal bulkInvoiceModal">
    <div className="modalHead"><div><h3>Importar facturas</h3><p>Selecciona varios PDF. Se analizan de dos en dos y podrás revisar cada factura antes de importarla.</p></div><button onClick={onClose}><X/></button></div>
    <input hidden ref={inputRef} type="file" multiple accept="application/pdf" onChange={e=>chooseFiles(Array.from(e.target.files??[]))}/>
    {!items.length?<button className="bulkInvoiceDrop" type="button" onClick={()=>inputRef.current?.click()}><Upload/><strong>Seleccionar PDFs</strong><span>Puedes elegir varios archivos a la vez</span></button>:<>
      <div className="bulkInvoiceSummary"><strong>{analyzed} de {items.length} analizadas</strong><span>{readyCount} listas · {reviewCount} requieren revisión · {pendingCount} pendientes</span><button className="secondary" type="button" disabled={busy} onClick={()=>inputRef.current?.click()}>Cambiar selección</button></div>
      <div className="bulkInvoiceList">{items.map(item=>{
        const candidate=item.candidate;
        return <div key={item.id} className={`bulkInvoiceRow ${item.status} ${item.excluded?'excluded':''}`}>
          <div className="bulkInvoiceFile"><FileText size={18}/><div><strong>{item.file.name}</strong><span>{statusLabel[item.status]}{item.excluded?' · Excluida':''}</span></div></div>
          {item.status==='analyzing'?<LoaderCircle className="spin" size={18}/>:candidate?<div className="bulkInvoiceMeta"><span>{candidate.supplierName||'Proveedor sin detectar'}</span><span>{candidate.invoiceNumber||'Sin número'} · {candidate.invoiceDate||'Sin fecha'}</span><span>Base {money(candidate.subtotal)} · IVA {money(candidate.vat)}{candidate.equivalenceSurcharge?` · R.E. ${money(candidate.equivalenceSurcharge)}`:''} · Total {money(candidate.total)}</span><span>{candidate.lines.length} línea{candidate.lines.length===1?'':'s'}</span>{candidate.reviewReason&&<span className="warnText">{candidate.reviewReason}</span>}</div>:<div className="bulkInvoiceMeta"><span className="warnText">{item.error||'No se pudo analizar.'}</span></div>}
          <div className="bulkInvoiceActions">{candidate&&['ready','needs_review'].includes(item.status)&&<button className="secondary" type="button" onClick={()=>setSelectedId(item.id)}>Revisar</button>}<button className="secondary" type="button" disabled={busy||item.status==='importing'||item.status==='imported'} onClick={()=>patch(item.id,{excluded:!item.excluded})}>{item.excluded?'Incluir':'Excluir'}</button></div>
        </div>;
      })}</div>
    </>}

    {selected?.candidate&&<div className="bulkInvoiceReview"><div className="bulkInvoiceReviewHead"><div><strong>Revisar factura</strong><span>{selected.file.name}</span></div><button className="iconBtn" onClick={()=>setSelectedId(null)}><X size={16}/></button></div><InvoiceCandidateForm candidate={selected.candidate} categories={categories} onChange={updateSelectedCandidate}/>{selected.status==='needs_review'&&<button className="secondary" type="button" onClick={confirmReview}><CheckCircle2 size={16}/> Confirmar revisión y marcar lista</button>}</div>}

    {items.some(item=>item.status==='error')&&<div className="warningBox"><AlertCircle size={18}/>Las facturas con error no bloquean la importación de las demás.</div>}
    <div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cerrar</button><button className="primary" onClick={importReady} disabled={busy||readyCount===0}>{busy?'Importando…':`Importar ${readyCount} factura${readyCount===1?'':'s'}`}</button></div>
  </div></div>;
}
