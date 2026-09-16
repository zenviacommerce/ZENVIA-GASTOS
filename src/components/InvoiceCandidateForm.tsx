import type { ExpenseCategory, InvoiceImportCandidate } from '../types';

type Props={
  candidate:InvoiceImportCandidate;
  categories:ExpenseCategory[];
  onChange:(next:InvoiceImportCandidate)=>void;
};

const numeric=(value:string)=>{
  const parsed=Number(value.replace(',','.'));
  return Number.isFinite(parsed)?parsed:0;
};

export function InvoiceCandidateForm({candidate,categories,onChange}:Props){
  const set=<K extends keyof InvoiceImportCandidate>(key:K,value:InvoiceImportCandidate[K])=>onChange({...candidate,[key]:value});
  return <div className="invoiceFormGrid">
    <label>Proveedor *<input value={candidate.supplierName} onChange={e=>set('supplierName',e.target.value)} placeholder="Ej. MRW"/></label>
    <label>Nº de factura<input value={candidate.invoiceNumber} onChange={e=>set('invoiceNumber',e.target.value)} placeholder="FV-2026-001"/></label>
    <label>Fecha *<input type="date" value={candidate.invoiceDate} onChange={e=>set('invoiceDate',e.target.value)}/></label>
    <label>Categoría<select value={candidate.categoryId||''} onChange={e=>set('categoryId',e.target.value||undefined)}><option value="">Sin categoría</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Base imponible (€)<input type="number" step="0.01" value={candidate.subtotal} onChange={e=>set('subtotal',numeric(e.target.value))}/></label>
    <label>IVA (€)<input type="number" step="0.01" value={candidate.vat} onChange={e=>set('vat',numeric(e.target.value))}/></label>
    <label>Recargo equivalencia (€)<input type="number" step="0.01" value={candidate.equivalenceSurcharge} onChange={e=>set('equivalenceSurcharge',numeric(e.target.value))}/></label>
    <label>Retención (€)<input type="number" step="0.01" value={candidate.withholding} onChange={e=>set('withholding',numeric(e.target.value))}/></label>
    <label>Total (€)<input type="number" step="0.01" value={candidate.total} onChange={e=>set('total',numeric(e.target.value))}/></label>
  </div>;
}
