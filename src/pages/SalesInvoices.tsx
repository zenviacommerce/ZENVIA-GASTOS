import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileUp, LoaderCircle } from 'lucide-react';
import { SalesInvoices as SalesInvoicesCore } from './SalesInvoicesCore';
import { SalesInvoiceImportModal } from '../components/SalesInvoiceImportModal';
import { loadBusinessSettings, loadClients, loadSalesInvoices, type BusinessSettings, type Client, type SalesInvoice } from '../services/sales';
import { loadCompanyBranding, type CompanyBranding } from '../services/companyBranding';
import { exportSalesInvoices } from '../services/salesInvoiceExport';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { SelectField } from '../components/forms/SelectField';
import '../sales-transfer.css';

const downloadBlob=(blob:Blob,filename:string)=>{const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1500);};
const compactDate=(value:string)=>value||'sin-fecha';

export function SalesInvoices(){
  const [clients,setClients]=useState<Client[]>([]);
  const [invoices,setInvoices]=useState<SalesInvoice[]>([]);
  const [settings,setSettings]=useState<BusinessSettings>({legalName:'ZENVIA COMMERCE SL',countryCode:'ES'});
  const [branding,setBranding]=useState<CompanyBranding>({ownerId:'',logoPath:null,logoDataUrl:null});
  const [importOpen,setImportOpen]=useState(false);
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
    }catch(error){showError(errorMessage(error,'No se pudieron cargar las herramientas de facturación.'));}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{void refreshTools();},[refreshTools]);

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

  const exportNow=async()=>{
    if(!exportRows.length){showError('No hay facturas para los filtros de exportación.');return;}
    setExporting(true);
    try{
      const scope=[from&&`desde-${from}`,to&&`hasta-${to}`,status!=='all'&&status,query.trim()&&'busqueda'].filter(Boolean).join('_')||'todas';
      const blob=await exportSalesInvoices(exportRows,settings,branding,scope);
      downloadBlob(blob,`facturas_venta_${compactDate(from)}_${compactDate(to)}.zip`);
      showSuccess(`Exportadas ${exportRows.length} factura${exportRows.length===1?'':'s'} con CSV y PDF.`);
    }catch(error){showError(errorMessage(error,'No se pudo exportar la facturación.'));}
    finally{setExporting(false);}
  };

  const importFinished=async()=>{
    await refreshTools();
    setEpoch(value=>value+1);
    showSuccess('Facturas importadas como borrador. Revisa y emite solo las que correspondan.');
  };

  return <>
    <div className="card salesTransferPanel">
      <div className="salesTransferHead"><div><strong>Importar y exportar facturas</strong><span>Los PDF importados siempre pasan por revisión y se guardan como borrador.</span></div><div className="actions"><button className="secondary" type="button" onClick={()=>setImportOpen(true)} disabled={loading}><FileUp size={17}/> Importar facturas</button><button className="secondary" type="button" onClick={()=>void exportNow()} disabled={loading||exporting||!exportRows.length}>{exporting?<LoaderCircle className="spin" size={17}/>:<Download size={17}/>} Exportar ({exportRows.length})</button></div></div>
      <div className="toolbar salesToolbar salesExportToolbar"><div className="search"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Filtrar exportación por cliente, CIF, VAT o nº…"/></div><SelectField value={status} onChange={setStatus} ariaLabel="Estado para exportar" options={[{value:'all',label:'Todos los estados'},{value:'draft',label:'Borradores'},{value:'issued',label:'Emitidas'},{value:'sent',label:'Enviadas'},{value:'partially_paid',label:'Cobro parcial'},{value:'paid',label:'Cobradas'},{value:'rectified',label:'Rectificadas'}]}/><label className="salesExportDate">Desde<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label className="salesExportDate">Hasta<input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label></div>
    </div>
    <SalesInvoicesCore key={epoch}/>
    <SalesInvoiceImportModal open={importOpen} onClose={()=>setImportOpen(false)} clients={clients} existingInvoices={invoices} onFinished={importFinished}/>
  </>;
}
