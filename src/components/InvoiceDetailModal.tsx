import { ExternalLink, FileText, Trash2, X } from 'lucide-react';
import type { Invoice } from '../types';

const money = (value: number) => value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InvoiceDetailModal({invoice,onClose,onOpenFile,onDelete,deleting=false}:{invoice:Invoice|null;onClose:()=>void;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;deleting?:boolean}) {
  if(!invoice) return null;
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget) onClose()}}><div className="modal invoiceDetailModal">
    <div className="modalHead"><div><h3>{invoice.supplierName}</h3><p>{invoice.invoiceNumber === '—' ? 'Factura sin número' : `Factura ${invoice.invoiceNumber}`}</p></div><button onClick={onClose}><X/></button></div>

    <div className="detailFile">
      <FileText size={22}/><div><strong>{invoice.fileName || 'Documento de factura'}</strong><span>{invoice.filePath ? 'Archivo almacenado de forma privada' : 'No hay archivo asociado'}</span></div>
      <button className="secondary" disabled={!invoice.filePath} onClick={()=>onOpenFile(invoice)}><ExternalLink size={16}/> Abrir documento</button>
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
