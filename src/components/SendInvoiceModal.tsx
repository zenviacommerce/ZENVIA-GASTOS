import { useEffect, useState } from 'react';
import { Mail, Send, X } from 'lucide-react';
import type { BusinessSettings, SalesInvoice } from '../services/sales';
import { markSalesInvoiceSent } from '../services/sales';
import { createSalesInvoicePdfBlob, salesInvoicePdfFilename, type InvoicePdfBranding } from '../services/salesInvoicePdf';
import { sendInvoiceViaGmail } from '../services/gmailSender';
import { errorMessage, showError } from '../services/toast';

export function SendInvoiceModal({invoice,settings,branding,onClose,onSent}:{invoice:SalesInvoice|null;settings:BusinessSettings;branding?:InvoicePdfBranding|null;onClose:()=>void;onSent:()=>Promise<void>}){
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
      const pdf=createSalesInvoicePdfBlob(invoice,settings,branding);
      await sendInvoiceViaGmail({to:to.trim(),subject:subject.trim(),body:body.trim(),pdf,filename:salesInvoicePdfFilename(invoice)});
      await markSalesInvoiceSent(invoice.id);
      await onSent();
      onClose();
    }catch(e){const message=errorMessage(e,'No se pudo enviar la factura.');setError(message);showError(message);}
    finally{setBusy(false);}
  };

  return <div className="modalBackdrop"><div className="modal salesClientModal polishedModal salesSendModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">ENVÍO</div><h3>Enviar factura por Gmail</h3><p>Se adjuntará automáticamente el PDF de {invoice.invoiceNumber}.</p></div><button onClick={onClose}><X/></button></div>
    <section className="salesFormSection">
      <div className="salesSectionTitle"><Mail size={18}/><div><strong>Destinatario y mensaje</strong><span>Revisa los datos antes de enviar</span></div></div>
      <div className="salesFormGrid">
        <label className="salesSpan2">Para<input type="email" inputMode="email" value={to} onChange={e=>setTo(e.target.value)} placeholder="cliente@empresa.com"/></label>
        <label className="salesSpan2">Asunto<input value={subject} onChange={e=>setSubject(e.target.value)}/></label>
        <label className="salesSpan2">Mensaje<textarea rows={7} value={body} onChange={e=>setBody(e.target.value)}/></label>
      </div>
      <div className="aiNote"><Mail size={17}/><div><strong>Autorización de Google</strong><span>La primera vez Google te pedirá permiso para enviar desde tu cuenta. La conexión de lectura de facturas de gastos sigue siendo independiente.</span></div></div>
    </section>
    {error&&<div className="errorBox">{error}</div>}
    <div className="modalActions salesStickyActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={send} disabled={busy}><Send size={16}/>{busy?'Enviando…':'Enviar factura'}</button></div>
  </div></div>;
}