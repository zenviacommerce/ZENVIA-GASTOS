import { useEffect, useRef, useState } from 'react';
import { Camera, FileUp, X, ScanLine, CheckCircle2, AlertCircle, LoaderCircle } from 'lucide-react';
import { imageFilesToPdf } from '../services/pdf';
import { isMultiInvoiceDocumentError } from '../services/invoiceReaderEnhanced';
import { classifyInvoiceCandidate, invoiceCandidateToInput, prepareInvoiceCandidate } from '../services/invoiceImportPipeline';
import { InvoiceCandidateForm } from './InvoiceCandidateForm';
import type { ExpenseCategory, Invoice, InvoiceImportCandidate, InvoiceSource, NewInvoiceInput } from '../types';

export function UploadInvoiceModal({open,onClose,onSave,categories,existingInvoices}:{open:boolean;onClose:()=>void;onSave:(input:NewInvoiceInput)=>Promise<void>;categories:ExpenseCategory[];existingInvoices:Invoice[]}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null);
  const [source,setSource]=useState<InvoiceSource>('manual');
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [reading,setReading]=useState(false);
  const [readerBlocked,setReaderBlocked]=useState(false);
  const [readerMessage,setReaderMessage]=useState('');
  const [candidate,setCandidate]=useState<InvoiceImportCandidate|null>(null);

  useEffect(()=>{
    if(!open){
      setFile(null);setStatus('');setError('');setReaderMessage('');setCandidate(null);setReading(false);setReaderBlocked(false);
    }
  },[open]);
  if(!open) return null;

  const runReader = async (prepared: File) => {
    setReading(true);setReaderBlocked(false);setReaderMessage('Analizando factura…');setCandidate(null);
    try {
      const preparedCandidate=await prepareInvoiceCandidate(prepared,categories,setReaderMessage);
      const result=classifyInvoiceCandidate(preparedCandidate,existingInvoices);
      setCandidate(result);
      const percent=Math.round(result.confidence*100);
      if(result.status==='duplicate'){
        setReaderBlocked(true);
        setError(result.reviewReason||'Esta factura ya está importada.');
        setReaderMessage('Documento bloqueado: se ha detectado como duplicado.');
      }else if(result.status==='needs_review'){
        setReaderMessage(`Lectura completada · confianza ${percent}% · requiere revisión: ${result.reviewReason||'revisa los datos antes de guardar.'}`);
      }else{
        setReaderMessage(`Lectura completada · confianza ${percent}%${result.lines.length?` · ${result.lines.length} línea${result.lines.length>1?'s':''} detectada${result.lines.length>1?'s':''}`:''}. Revisa los datos antes de guardar.`);
      }
    } catch(e) {
      if(isMultiInvoiceDocumentError(e)) {
        setReaderBlocked(true);
        setError(e.message);
        setReaderMessage('Documento bloqueado: contiene varias facturas o abonos y no debe contabilizarse como una sola factura.');
      } else {
        setReaderMessage(`No se pudo completar la lectura automática. ${e instanceof Error?e.message:''}`.trim());
        setError('No se pudo preparar la factura. Prueba con otro archivo o vuelve a intentarlo.');
      }
    } finally { setReading(false); }
  };

  const handleFiles = async (files: File[], nextSource: InvoiceSource) => {
    if(!files.length)return;
    setError('');setReaderBlocked(false);setStatus('Preparando documento…');
    try {
      const prepared=files.every(f=>f.type.startsWith('image/'))?await imageFilesToPdf(files):files[0];
      setFile(prepared);setSource(nextSource);
      setStatus(nextSource==='camera'?`Escaneo convertido a PDF (${files.length} página${files.length>1?'s':''}).`:'Documento listo.');
      await runReader(prepared);
    } catch(e){setError(e instanceof Error?e.message:'No se pudo procesar el archivo.');}
  };

  const submit = async () => {
    if(readerBlocked){setError('Este documento no se puede guardar mientras esté bloqueado.');return;}
    if(!file||!candidate||!candidate.supplierName.trim()||!candidate.invoiceDate){setError('Selecciona un archivo e indica proveedor y fecha.');return;}
    setSaving(true);setError('');
    try{
      await onSave(invoiceCandidateToInput(candidate,source));
      onClose();
    }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar la factura.');}
    finally{setSaving(false);}
  };

  return <div className="modalBackdrop"><div className="modal invoiceModal">
    <div className="modalHead"><div><h3>Nueva factura</h3><p>Sube un PDF o escanea una o varias páginas con la cámara.</p></div><button onClick={onClose}><X/></button></div>
    <div className="uploadChoices">
      <button className="uploadChoice" onClick={()=>fileRef.current?.click()}><FileUp/><strong>Subir PDF o imagen</strong><span>Desde archivos del dispositivo</span></button>
      <button className="uploadChoice accent" onClick={()=>cameraRef.current?.click()}><Camera/><strong>Escanear con cámara</strong><span>Permite varias páginas</span></button>
    </div>
    <input hidden ref={fileRef} type="file" accept="application/pdf,image/*" onChange={e=>handleFiles(Array.from(e.target.files??[]),'manual')}/>
    <input hidden ref={cameraRef} type="file" accept="image/*" capture="environment" multiple onChange={e=>handleFiles(Array.from(e.target.files??[]),'camera')}/>
    {file&&<div className="selectedFile"><CheckCircle2 size={18}/><div><strong>{file.name}</strong><span>{(file.size/1024/1024).toFixed(2)} MB · {source==='camera'?'Cámara':'Archivo'}</span></div></div>}

    <div className={`aiNote ${reading?'reading':candidate?'done':''}`}>
      {reading?<LoaderCircle className="spin"/>:<ScanLine/>}
      <div><strong>{reading?'Lectura inteligente en curso':candidate?'Lectura inteligente completada':readerBlocked?'Documento bloqueado':'Lectura inteligente automática'}</strong><span>{readerMessage||'Al seleccionar una factura intentaremos detectar proveedor, número, fecha, importes, categoría y líneas de producto.'}</span></div>
    </div>

    {candidate&&<InvoiceCandidateForm candidate={candidate} categories={categories} onChange={setCandidate}/>} 
    {candidate?.lines.length?<div className="detectedLines"><strong>{candidate.lines.length} líneas detectadas</strong><span>Se guardarán junto con la factura y podrás revisarlas desde el detalle.</span></div>:null}
    {status&&<div className="success"><CheckCircle2 size={18}/>{status}</div>}
    {candidate?.status==='needs_review'&&candidate.reviewReason&&<div className="warningBox"><AlertCircle size={18}/>{candidate.reviewReason} Puedes revisarla y guardarla manualmente.</div>}
    {error&&<div className="errorBox"><AlertCircle size={18}/>{error}</div>}
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving||reading||!file||!candidate||readerBlocked} onClick={submit}>{saving?'Guardando…':reading?'Leyendo…':readerBlocked?'Documento bloqueado':'Guardar factura'}</button></div>
  </div></div>;
}
