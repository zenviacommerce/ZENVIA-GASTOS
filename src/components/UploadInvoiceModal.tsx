import { useEffect, useRef, useState } from 'react';
import { Camera, FileUp, X, ScanLine, CheckCircle2, AlertCircle } from 'lucide-react';
import { imageFilesToPdf } from '../services/pdf';
import type { ExpenseCategory, InvoiceSource, NewInvoiceInput } from '../types';

export function UploadInvoiceModal({open,onClose,onSave,categories}:{open:boolean;onClose:()=>void;onSave:(input:NewInvoiceInput)=>Promise<void>;categories:ExpenseCategory[]}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null);
  const [source,setSource]=useState<InvoiceSource>('manual');
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [supplierName,setSupplierName]=useState('');
  const [invoiceNumber,setInvoiceNumber]=useState('');
  const [invoiceDate,setInvoiceDate]=useState(new Date().toISOString().slice(0,10));
  const [categoryId,setCategoryId]=useState('');
  const [subtotal,setSubtotal]=useState('');
  const [vat,setVat]=useState('');
  const [withholding,setWithholding]=useState('0');
  const [total,setTotal]=useState('');

  useEffect(()=>{ if(!open){setFile(null);setStatus('');setError('');setSupplierName('');setInvoiceNumber('');setCategoryId('');setSubtotal('');setVat('');setWithholding('0');setTotal('');}},[open]);
  if(!open) return null;

  const handleFiles = async (files: File[], nextSource: InvoiceSource) => {
    if(!files.length) return;
    setError(''); setStatus('Preparando documento…');
    try {
      const prepared = files.every(f=>f.type.startsWith('image/')) ? await imageFilesToPdf(files) : files[0];
      setFile(prepared); setSource(nextSource);
      setStatus(nextSource === 'camera' ? `Escaneo convertido a PDF (${files.length} página${files.length>1?'s':''}).` : 'Documento listo para guardar.');
    } catch(e){ setError(e instanceof Error?e.message:'No se pudo procesar el archivo.'); }
  };

  const submit = async () => {
    if(!file || !supplierName.trim() || !invoiceDate) { setError('Selecciona un archivo e indica proveedor y fecha.'); return; }
    setSaving(true); setError('');
    try {
      await onSave({file,source,supplierName,invoiceNumber,invoiceDate,categoryId:categoryId||undefined,subtotal:Number(subtotal||0),vat:Number(vat||0),withholding:Number(withholding||0),total:Number(total||0)});
      onClose();
    } catch(e){ setError(e instanceof Error?e.message:'No se pudo guardar la factura.'); }
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
    {file && <div className="selectedFile"><CheckCircle2 size={18}/><div><strong>{file.name}</strong><span>{(file.size/1024/1024).toFixed(2)} MB · {source==='camera'?'Cámara':'Archivo'}</span></div></div>}
    <div className="invoiceFormGrid">
      <label>Proveedor *<input value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="Ej. MRW"/></label>
      <label>Nº de factura<input value={invoiceNumber} onChange={e=>setInvoiceNumber(e.target.value)} placeholder="FV-2026-001"/></label>
      <label>Fecha *<input type="date" value={invoiceDate} onChange={e=>setInvoiceDate(e.target.value)}/></label>
      <label>Categoría<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Sin categoría</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Base imponible (€)<input type="number" step="0.01" value={subtotal} onChange={e=>setSubtotal(e.target.value)}/></label>
      <label>IVA (€)<input type="number" step="0.01" value={vat} onChange={e=>setVat(e.target.value)}/></label>
      <label>Retención (€)<input type="number" step="0.01" value={withholding} onChange={e=>setWithholding(e.target.value)}/></label>
      <label>Total (€)<input type="number" step="0.01" value={total} onChange={e=>setTotal(e.target.value)}/></label>
    </div>
    <div className="aiNote"><ScanLine/><div><strong>Lectura inteligente preparada</strong><span>En la siguiente fase conectaremos el motor IA para rellenar estos campos y las líneas de producto automáticamente.</span></div></div>
    {status && <div className="success"><CheckCircle2 size={18}/>{status}</div>}
    {error && <div className="errorBox"><AlertCircle size={18}/>{error}</div>}
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving||!file} onClick={submit}>{saving?'Guardando…':'Guardar factura'}</button></div>
  </div></div>;
}
