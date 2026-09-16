import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Trash2, X } from 'lucide-react';
import type { ExpenseCategory, Invoice, Supplier } from '../types';

const money = (value: number) => value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InvoiceDetailModal({invoice,suppliers,categories,onClose,onOpenFile,onDelete,onSupplierChange,onCategoryChange,deleting=false}:{invoice:Invoice|null;suppliers:Supplier[];categories:ExpenseCategory[];onClose:()=>void;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;onSupplierChange:(invoice:Invoice,supplierId:string)=>Promise<void>;onCategoryChange:(invoice:Invoice,categoryId:string)=>Promise<void>;deleting?:boolean}) {
  const [supplierId,setSupplierId]=useState('');
  const [categoryId,setCategoryId]=useState('');
  const [savingSupplier,setSavingSupplier]=useState(false);
  const [savingCategory,setSavingCategory]=useState(false);
  const [supplierError,setSupplierError]=useState('');
  const [categoryError,setCategoryError]=useState('');

  useEffect(()=>{
    setSupplierId(invoice?.supplierId || '');
    setSupplierError('');
  },[invoice?.id,invoice?.supplierId]);

  useEffect(()=>{
    setCategoryId(invoice?.categoryId || '');
    setCategoryError('');
  },[invoice?.id,invoice?.categoryId]);

  if(!invoice) return null;

  const saveSupplier=async()=>{
    if(!supplierId){setSupplierError('Selecciona un proveedor.');return;}
    setSavingSupplier(true);setSupplierError('');
    try{await onSupplierChange(invoice,supplierId)}
    catch(e){setSupplierError(e instanceof Error?e.message:'No se pudo cambiar el proveedor.');}
    finally{setSavingSupplier(false)}
  };

  const saveCategory=async()=>{
    if(!categoryId){setCategoryError('Selecciona una categoría.');return;}
    setSavingCategory(true);setCategoryError('');
    try{await onCategoryChange(invoice,categoryId)}
    catch(e){setCategoryError(e instanceof Error?e.message:'No se pudo cambiar la categoría.');}
    finally{setSavingCategory(false)}
  };

  const supplierChanged=supplierId!==String(invoice.supplierId||'');
  const categoryChanged=categoryId!==String(invoice.categoryId||'');

  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget) onClose()}}><div className="modal invoiceDetailModal">
    <div className="modalHead"><div><h3>{invoice.supplierName}</h3><p>{invoice.invoiceNumber === '—' ? 'Factura sin número' : `Factura ${invoice.invoiceNumber}`}</p></div><button onClick={onClose}><X/></button></div>

    <div className="detailFile">
      <FileText size={22}/><div><strong>{invoice.fileName || 'Documento de factura'}</strong><span>{invoice.filePath ? 'Archivo almacenado de forma privada' : 'No hay archivo asociado'}</span></div>
      <button className="secondary" disabled={!invoice.filePath} onClick={()=>onOpenFile(invoice)}><ExternalLink size={16}/> Abrir documento</button>
    </div>

    <div className="invoiceMetadataEditors">
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

      <div className="invoiceCategoryEditor">
        <label htmlFor="invoiceCategory">Categoría</label>
        <div className="invoiceCategoryEditorRow">
          <select id="invoiceCategory" value={categoryId} onChange={e=>setCategoryId(e.target.value)}>
            <option value="">Selecciona una categoría…</option>
            {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="secondary" disabled={!categoryChanged||!categoryId||savingCategory} onClick={saveCategory}>{savingCategory?'Guardando…':'Guardar categoría'}</button>
        </div>
        <span className={`invoiceCategoryHint ${!invoice.categoryId?'warn':''}`}>{!invoice.categoryId?'Esta factura no tiene categoría asignada. Selecciona una y guarda el cambio.':'Puedes reclasificar la factura sin volver a importarla.'}</span>
        {categoryError&&<div className="errorBox">{categoryError}</div>}
      </div>
    </div>

    <div className="detailGrid">
      <div><span>Fecha</span><strong>{new Date(`${invoice.invoiceDate}T12:00:00`).toLocaleDateString('es-ES')}</strong></div>
      <div><span>Categoría</span><strong>{invoice.category}</strong></div>
      <div><span>Base imponible</span><strong>{money(invoice.subtotal)} €</strong></div>
      <div><span>IVA</span><strong>{money(invoice.vat)} €</strong></div>
      {invoice.equivalenceSurcharge!==0&&<div><span>Recargo de equivalencia</span><strong>{money(invoice.equivalenceSurcharge)} €</strong></div>}
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
