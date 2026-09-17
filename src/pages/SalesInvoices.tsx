import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileUp, LoaderCircle, X } from 'lucide-react';
import { SalesInvoices as SalesInvoicesCore } from './SalesInvoicesCore';
import { SalesInvoiceImportModal } from '../components/SalesInvoiceImportModal';
import { loadBusinessSettings, loadClients, loadSalesInvoices, type BusinessSettings, type Client, type SalesInvoice } from '../services/sales';
import { loadCompanyBranding, type CompanyBranding } from '../services/companyBranding';
import { exportSalesInvoices } from '../services/salesInvoiceExport';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { SelectField } from '../components/forms/SelectField';
import '../sales-transfer.css';

const IMPORT_LABEL='Importar facturas';
const downloadBlob=(blob:Blob,filename:string)=>{const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1500);};
const compactDate=(value:string)=>value||'sin-fecha';

export function SalesInvoices(){
  const [clients,setClients]=useState<Client[]>([]);
  const [invoices,setInvoices]=useState<SalesInvoice[]>([]);
  const [settings,setSettings]=useState<BusinessSettings>({legalName:'ZENVIA COMMERCE SL',countryCode:'ES'});
  const [branding,setBranding]=useState<CompanyBranding>({ownerId:'',logoPath:null,logoDataUrl:null});
  const [importOpen,setImportOpen]=useState(false);
  const [exportOpen,setExportOpen]=useState(false);
  const [headerActionsHost,setHeaderActionsHost]=useState<HTMLElement|null>(null);
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('all');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [loading,setLoading]=useState(true);
  const [exporting,setExporting]=useState(false);
  const [epoch,setEpoch]=useState(0);

  const refreshTools=useCallback(async()=>{
    setLoading(true);
    try{
      const [nextClients,nextInvoices,nextSettings,nextBranding]=await Promise.all([loadClients(),loadSalesInvoices(),loadBusinessSettings(),loadCompanyBranding()]);
      setClients(nextClients);setInvoices(nextInvoices);setSettings(nextSettings);setBranding(nextBranding);
      return true;
    }catch(error){showError(errorMessage(error,'No se pudieron cargar las herramientas de facturación.'));return false;}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{void refreshTools();},[refreshTools]);
  useEffect(()=>{
    const frame=window.requestAnimationFrame(()=>setHeaderActionsHost(document.querySelector<HTMLElement>('.salesInvoicesTransferHost .pageHead .actions')));
    return()=>window.cancelAnimationFrame(frame);
  },[epoch]);

  const exportRows=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return invoices.filter(invoice=>{
      if(status!=='all'&&invoice.status!==status)return false;
      if(from&&invoice.issueDate<from)return false;
      if(to&&invoice.issueDate>to)return false;
      if(q&&![invoice.invoiceNumber||'borrador',invoice.clientName,invoice.clientTaxId||'',invoice.issuerTaxId||''].some(value=>value.toLowerCase().includes(q)))return false;
      return true;
    });
  },[invoices,query,status,from,to]);

  const openImport=async()=>{if(await refreshTools())setImportOpen(true);};
  const openExport=async()=>{if(await refreshTools())setExportOpen(true);};

  const exportNow=async()=>{
    if(!exportRows.length){showError('No hay facturas para los filtros de exportación.');return;}
    setExporting(true);
    try{
      const scope=[from&&`desde-${from}`,to&&`hasta-${to}`,status!=='all'&&status,query.trim()&&'busqueda'].filter(Boolean).join('_')||'todas';
      const blob=await exportSalesInvoices(exportRows,settings,branding,scope);
      downloadBlob(blob,`facturas_venta_${compactDate(from)}_${compactDate(to)}.zip`);
      showSuccess(`Exportadas ${exportRows.length} factura${exportRows.length===1?'':'s'} con CSV y PDF.`);
      setExportOpen(false);
    }catch(error){showError(errorMessage(error,'No se pudo exportar la facturación.'));}
    finally{setExporting(false);}
  };

  const importFinished=async()=>{
    await refreshTools();
    setEpoch(value=>value+1);
    showSuccess('Facturas importadas como borrador. Revisa y emite solo las que correspondan.');
  };

  const exportLabel=`Exportar (${invoices.length})`;

  return <>
    <div className="salesInvoicesTransferHost"><SalesInvoicesCore key={epoch}/></div>
    {headerActionsHost&&createPortal(<>
      <button className="secondary salesTransferHeaderAction" type="button" onClick={()=>void openExport()} disabled={loading||!invoices.length}><Download size={17}/> {exportLabel}</button>
      <button className="secondary salesTransferHeaderAction" type="button" onClick={()=>void openImport()} disabled={loading}><FileUp size={17}/> {IMPORT_LABEL}</button>
    </>,headerActionsHost)}

    {exportOpen&&<div className="modalBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!exporting)setExportOpen(false)}}>
      <div className="modal polishedModal salesExportModal">
        <div className="modalHead salesModalHead"><div><div className="eyebrow">FACTURACIÓN</div><h3>Exportar facturas de venta</h3><p>Filtra la selección y descarga un ZIP con el resumen CSV y los PDF.</p></div><button type="button" onClick={()=>setExportOpen(false)} disabled={exporting} aria-label="Cerrar"><X/></button></div>
        <section className="salesFormSection">
          <div className="salesSectionTitle"><Download size={18}/><div><strong>Selección de facturas</strong><span>Los filtros solo afectan a esta exportación.</span></div></div>
          <div className="salesFormGrid salesExportFilterGrid">
            <label className="salesSpan2">Buscar<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Cliente, CIF, VAT o nº de factura…"/></label>
            <label className="salesSpan2">Estado<SelectField value={status} onChange={setStatus} ariaLabel="Estado para exportar" options={[{value:'all',label:'Todos los estados'},{value:'draft',label:'Borradores'},{value:'issued',label:'Emitidas'},{value:'sent',label:'Enviadas'},{value:'partially_paid',label:'Cobro parcial'},{value:'paid',label:'Cobradas'},{value:'rectified',label:'Rectificadas'}]}/></label>
            <label>Desde<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label>
            <label>Hasta<input type="date" value={to} min={from||undefined} onChange={event=>setTo(event.target.value)}/></label>
          </div>
          <div className="salesExportSelection"><strong>{exportRows.length} factura{exportRows.length===1?'':'s'}</strong><span>Se incluirán el CSV resumen y los PDF de esta selección.</span></div>
        </section>
        <div className="modalActions"><button className="secondary" type="button" onClick={()=>setExportOpen(false)} disabled={exporting}>Cancelar</button><button className="primary" type="button" onClick={()=>void exportNow()} disabled={exporting||!exportRows.length}>{exporting?<LoaderCircle className="spin" size={17}/>:<Download size={17}/>} {exporting?'Preparando…':`Exportar (${exportRows.length})`}</button></div>
      </div>
    </div>}

    <SalesInvoiceImportModal open={importOpen} onClose={()=>setImportOpen(false)} clients={clients} existingInvoices={invoices} onFinished={importFinished}/>
  </>;
}
