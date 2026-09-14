import { useEffect, useState } from 'react';
import { Mail, X } from 'lucide-react';
import type { BusinessSettings, SalesInvoice } from '../services/sales';
import { markSalesInvoiceSent } from '../services/sales';
import { createSalesInvoicePdfBlob, salesInvoicePdfFilename } from '../services/salesInvoicePdf';
import { sendInvoiceViaGmail } from '../services/gmailSender';

export function SendInvoiceModal({invoice,settings,onClose,onSent}:{invoice:SalesInvoice|null;settings:BusinessSettings;onClose:()=>void;onSent:()=>Promise<void>}){
  const [to,setTo]=useState('');
  const [subject,setSubject]=useState('');
  const [body,setBody]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!invoice)return;
    const number=invoice.invoiceNumber||'factura';
    setTo(invoice.clientEmail||'');
    setSubject(`Factura ${number} - ZENVIA COMMERCE`);
    setBody(`Hola,\n\nAdjuntamos la factura ${number} por importe de ${invoice.totalAmount.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} €.\n\nGracias.\nZENVIA COMMERCE`);
    setError('');
  },[invoice]);

  if(!invoice)return null;
  const send=async()=>{
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(to.trim())){setError('Indica un email de destino válido.');return;}
    if(!subject.trim()){setError('Indica un asunto.');return;}
    setBusy(true);setError('');
    try{
      const pdf=createSalesInvoicePdfBlob(invoice,settings);
      await sendInvoiceViaGmail({to:to.trim(),subject:subject.trim(),body:body.trim(),pdf,filename:salesInvoicePdfFilename(invoice)});
      await markSalesInvoiceSent(invoice.id);
      await onSent();
      onClose();
    }catch(e){setError(e instanceof Error?e.message:'No se pudo enviar la factura.');}
    finally{setBusy(false);}
  };

  return <div className="modalBackdrop"><div className="modal salesClientModal">
    <div className="modalHead"><div><h3>Enviar factura por Gmail</h3><p>Se adjuntará automáticamente el PDF de {invoice.invoiceNumber}.</p></div><button onClick={onClose}><X/></button></div>
    <div className="stackForm">
      <label>Para<input type="email" inputMode="email" value={to} onChange={e=>setTo(e.target.value)} placeholder="cliente@empresa.com"/></label>
      <label>Asunto<input value={subject} onChange={e=>setSubject(e.target.value)}/></label>
      <label>Mensaje<textarea rows={7} value={body} onChange={e=>setBody(e.target.value)}/></label>
      <div className="aiNote"><Mail size={17}/><div><strong>Primera vez</strong><span>Google te pedirá autorización para que ZENVIA Gestión pueda enviar este correo desde tu cuenta. La conexión usada para leer facturas de gastos sigue siendo independiente.</span></div></div>
    </div>
    {error&&<div className="errorBox">{error}</div>}
    <div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={send} disabled={busy}>{busy?'Enviando…':'Enviar factura'}</button></div>
  </div></div>;
}
