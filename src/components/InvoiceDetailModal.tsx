import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Trash2, X } from 'lucide-react';
import type { Invoice, Supplier } from '../types';

const money = (value: number) => value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InvoiceDetailModal({invoice,suppliers,onClose,onOpenFile,onDelete,onSupplierChange,deleting=false}:{invoice:Invoice|null;suppliers:Supplier[];onClose:()=>void;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;onSupplierChange:(invoice:Invoice,supplierId:string)=>Promise<void>;deleting?:boolean}) {
  const [supplierId,setSupplierId]=useState('');
  const [savingSupplier,setSavingSupplier]=useState(false);
  const [supplierError,setSupplierError]=useState('');

  useEffect(()=>{
    setSupplierId(invoice?.supplierId || '');
    setSupplierError('');
  },[invoice?.id,invoice?.supplierId]);

  if(!invoice) return null;

  const saveSupplier=async()=>{
    if(!supplierId){setSupplierError('Selecciona un proveedor.');return;}
    setSavingSupplier(true);setSupplierError('');
    try{await onSupplierChange(invoice,supplierId)}
    catch(e){setSupplierError(e instanceof Error?e.message:'No se pudo cambiar el proveedor.');}
    finally{setSavingSupplier(false)}
  };

  const supplierChanged=supplierId!==String(invoice.supplierId||'');

  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget) onClose()}}><div className="modal invoiceDetailModal">
    <div className="modalHead"><div><h3>{invoice.supplierName}</h3><p>{invoice.invoiceNumber === '—' ? 'Factura sin número' : `Factura ${invoice.invoiceNumber}`}</p></div><button onClick={onClose}><X/></button></div>

    <div className="detailFile">
      <FileText size={22}/><div><strong>{invoice.fileName || 'Documento de factura'}</strong><span>{invoice.filePath ? 'Archivo almacenado de forma privada' : 'No hay archivo asociado'}</span></div>
      <button className="secondary" disabled={!invoice.filePath} onClick={()=>onOpenFile(invoice)}><ExternalLink size={16}/> Abrir documento</button>
    </div>

    <div className="invoiceSupplierEditor">
      <label htmlFor="invoiceSupplier">Proveedor asignado</label>
      <div className="invoiceSupplierEditorRow">
        <select id="invoiceSupplier" value={supplierId} onChange={e=>setSupplierId(e.target.value)}>
          <option value="">Selecciona un proveedor…</option>
          {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="secondary" disabled={!supplierChanged||!supplierId||savingSupplier} onClick={saveSupplier}>{savingSupplier?'Guardando…':'Guardar proveedor'}</button>
      </div>
      <span className={`invoiceSupplierHint ${!invoice.supplierId?'warn':''}`}>{!invoice.supplierId?'Esta factura no tiene proveedor asignado. Selecciona uno y guarda el cambio.':'Puedes reasignar esta factura a cualquier proveedor existente.'}</span>
      {supplierError&&<div className="errorBox">{supplierError}</div>}
    </div>

    <div className="detailGrid">
      <div><span>Fecha</span><strong>{new Date(`${invoice.invoiceDate}T12:00:00`).toLocaleDateString('es-ES')}</strong></div>
      <div><span>Categoría</span><strong>{invoice.category}</strong></div>
      <div><span>Base imponible</span><strong>{money(invoice.subtotal)} €</strong></div>
      <div><span>IVA</span><strong>{money(invoice.vat)} €</strong></div>
      <div><span>Retención</span><strong>{money(invoice.withholding)} €</strong></div>
      <div className="detailTotal"><span>Total</span><strong>{money(invoice.total)} €</strong></div>
    </div>

    <div className="detailSection">
      <div className="detailSectionHead"><div><strong>Líneas de producto</strong><span>{invoice.lines.length ? `${invoice.lines.length} línea${invoice.lines.length>1?'s':''} registrada${invoice.lines.length>1?'s':''}` : 'No se detectaron líneas'}</span></div></div>
      {invoice.lines.length ? <div className="detailLinesWrap"><table className="detailLines"><thead><tr><th>Descripción</th><th className="right">Cantidad</th><th className="right">Precio ud.</th><th className="right">Total</th></tr></thead><tbody>{invoice.lines.map(line=><tr key={line.id}><td>{line.description}</td><td className="right">{line.quantity.toLocaleString('es-ES')}</td><td className="right">{line.unitPrice==null?'—':`${money(line.unitPrice)} €`}</td><td className="right">{line.lineTotal==null?'—':`${money(line.lineTotal)} €`}</td></tr>)}</tbody></table></div> : <div className="detailEmpty">Esta factura no tiene líneas de producto registradas.</div>}
    </div>

    <div className="modalActions detailActions"><button className="danger" disabled={deleting} onClick={()=>onDelete(invoice)}><Trash2 size={16}/>{deleting?'Eliminando…':'Eliminar factura'}</button><button className="secondary" onClick={onClose}>Cerrar</button></div>
  </div></div>;
}
