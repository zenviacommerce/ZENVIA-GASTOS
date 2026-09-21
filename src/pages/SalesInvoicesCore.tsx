import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeEuro, Banknote, Calculator, CalendarDays, CheckCircle2, Download, Eye, FileCheck2, FilePenLine,
  ImagePlus, ListOrdered, Mail, PackageSearch, Pencil, Plus, Printer, ReceiptText, RotateCcw, Search, Settings2,
  Trash2, UserRound, WalletCards, X,
} from 'lucide-react';
import {
  addSalesPayment, createSalesInvoiceDraft, defaultSalesDueDate, ensureSalesSeries, resolveSalesDueDays,
  issueSalesInvoice, loadBusinessSettings, loadClients, loadSalesInvoices, markSalesInvoicePaid,
  saveBusinessSettings, updateSalesInvoiceDraft,
  type BusinessSettings, type Client, type SalesInvoice, type SalesInvoiceDraftInput,
  type SalesInvoiceLine, type SalesInvoiceSeries,
} from '../services/sales';
import { updateSalesInvoiceNumber } from '../services/salesInvoiceNumber';
import { loadBillableProducts, type BillableProduct } from '../services/billableProducts';
import { createRectifyingInvoice } from '../services/salesRectifying';
import { deleteSalesInvoiceDraftSafe } from '../services/salesDraftDelete';
import { deleteReversibleSalesInvoice, reopenSalesInvoice } from '../services/salesReversible';
import { downloadSalesInvoicePdf, printSalesInvoicePdf } from '../services/salesInvoicePdf';
import { loadCompanyBranding, removeCompanyLogo, uploadCompanyLogo, validateCompanyLogo, type CompanyBranding } from '../services/companyBranding';
import { loadTaxRegistrations, type TaxRegistration } from '../services/salesConfig';
import { SeriesManagerModal, TaxRegistrationsPanel } from '../components/SalesConfigurationModals';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { confirmAction, openActionProcess } from '../services/actionDialog';
import { ProductCatalogPicker } from '../components/ProductCatalogPicker';
import { SendInvoiceModal } from '../components/SendInvoiceModal';
import { PostalAddressFields } from '../components/forms/PostalAddressFields';
import { SearchableSelect } from '../components/forms/SearchableSelect';
import { SelectField } from '../components/forms/SelectField';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { PeriodFilterPanel } from '../components/PeriodFilterPanel';
import { StatCard } from '../components/StatCard';
import { defaultDateFilter, periodLabel } from '../services/filters';
import { useSettings } from '../context/SettingsContext';
import type { SalesSettings } from '../services/settingsSchema';
import '../sales.css';

const today=()=>new Date().toISOString().slice(0,10);
const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const dateLabel=(value?:string|null)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('es-ES'):'—';
const statusLabel=(status:SalesInvoice['status'])=>({draft:'Borrador',issued:'Emitida',sent:'Enviada',partially_paid:'Cobro parcial',paid:'Cobrada',rectified:'Rectificada'}[status]);
const statusClass=(status:SalesInvoice['status'])=>`salesStatus ${status}`;
const isOverdueInvoice=(invoice:SalesInvoice)=>invoice.invoiceType==='standard'&&!['draft','paid','rectified'].includes(invoice.status)&&invoice.dueDate!=null&&invoice.dueDate<today()&&Math.max(0,invoice.totalAmount-invoice.paidAmount)>0.005;
const regionNames=typeof Intl!=='undefined'&&'DisplayNames' in Intl?new Intl.DisplayNames(['es'],{type:'region'}):null;
const countryName=(code:string)=>regionNames?.of(code)||code;
type CollectionFilter='all'|'open'|'overdue'|'paid';
const emptyLine=(position=1,taxRate=21):SalesInvoiceLine=>({position,description:'',quantity:1,unit:'ud',unitPrice:0,discountPercent:0,taxRate,productId:null});
const clientDefaultVatRate=(client:Client|undefined|null,globalVatRate:number)=>client?.defaultVatRate==null?globalVatRate:client.defaultVatRate;
const clientDefaultPaymentMethod=(client:Client|undefined|null,sales:SalesSettings)=>{
  const preferredId=client?.defaultPaymentMethod||sales.defaultPaymentMethod;
  return sales.paymentMethods.find(item=>item.id===preferredId&&item.active)?.label
    ||sales.paymentMethods.find(item=>item.active)?.label
    ||'';
};
const calcLine=(line:SalesInvoiceLine)=>{const gross=line.quantity*line.unitPrice;const net=gross*(1-(line.discountPercent||0)/100);const tax=net*(line.taxRate||0)/100;return {gross,net,tax,total:net+tax};};

function InvoiceModal({open,invoice,clients,products,onClose,onSaved}:{open:boolean;invoice:SalesInvoice|null;clients:Client[];products:BillableProduct[];onClose:()=>void;onSaved:()=>Promise<void>}){
  const {settings}=useSettings();
  const [clientId,setClientId]=useState('');
  const [seriesId,setSeriesId]=useState('');
  const [invoiceNumber,setInvoiceNumber]=useState('');
  const [taxRegistrationId,setTaxRegistrationId]=useState('');
  const [taxRegistrations,setTaxRegistrations]=useState<TaxRegistration[]>([]);
  const [series,setSeries]=useState<SalesInvoiceSeries[]>([]);
  const [issueDate,setIssueDate]=useState(today());
  const [operationDate,setOperationDate]=useState('');
  const [dueDate,setDueDate]=useState('');
  const [paymentMethod,setPaymentMethod]=useState('');
  const [notes,setNotes]=useState('');
  const [lines,setLines]=useState<SalesInvoiceLine[]>([emptyLine()]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const clientOptions=useMemo(()=>clients.map(client=>({
    value:client.id,
    label:client.name,
    description:client.taxId||client.city||undefined,
    searchText:[client.name,client.taxId,client.email,client.phone,client.city].filter(Boolean).join(' '),
  })),[clients]);
  const paymentMethodOptions=useMemo(()=>settings.sales.paymentMethods.filter(item=>item.active).map(item=>({value:item.label,label:item.label})),[settings.sales.paymentMethods]);
  const defaultPaymentMethod=useMemo(()=>clientDefaultPaymentMethod(clients.find(client=>client.id===clientId),settings.sales),[clients,clientId,settings.sales]);

  useEffect(()=>{
    if(!open)return;
    if(invoice){
      setClientId(invoice.clientId);setSeriesId(invoice.seriesId);setInvoiceNumber(invoice.invoiceNumber||'');setTaxRegistrationId(invoice.taxRegistrationId||'');setIssueDate(invoice.issueDate);
      setOperationDate(invoice.operationDate||'');setDueDate(invoice.dueDate||'');setPaymentMethod(invoice.paymentMethod||'');
      setNotes(invoice.notes||'');setLines(invoice.lines.length?invoice.lines.map((line,index)=>({...line,position:index+1})):[emptyLine(1,settings.sales.defaultVatRate)]);
    }else{
      const firstClient=clients[0];
      const initialIssueDate=today();
      setClientId(firstClient?.id||'');setSeriesId(settings.sales.defaultSeriesId||'');setInvoiceNumber('');setTaxRegistrationId(settings.sales.defaultTaxRegistrationId||'');setIssueDate(initialIssueDate);setOperationDate('');setPaymentMethod(clientDefaultPaymentMethod(firstClient,settings.sales));setNotes(settings.sales.defaultNotes);setLines([emptyLine(1,clientDefaultVatRate(firstClient,settings.sales.defaultVatRate))]);
      setDueDate(defaultSalesDueDate(initialIssueDate,resolveSalesDueDays(firstClient?.paymentTermsDays,settings.sales.defaultDueDays)));
    }
    setError('');
    loadTaxRegistrations().then(rows=>{const active=rows.filter(item=>item.active);setTaxRegistrations(active);setTaxRegistrationId(current=>active.some(item=>item.id===current)?current:(active.find(item=>item.id===settings.sales.defaultTaxRegistrationId)?.id||active.find(item=>item.isDefault)?.id||active[0]?.id||''));}).catch(e=>setError(errorMessage(e,'No se pudieron cargar los registros IVA.')));
  },[open,invoice,clients,settings.sales.defaultDueDays,settings.sales.defaultVatRate,settings.sales.defaultSeriesId,settings.sales.defaultTaxRegistrationId,settings.sales.defaultNotes,defaultPaymentMethod]);

  useEffect(()=>{
    if(!open||!issueDate)return;
    let cancelled=false;
    const year=Number(issueDate.slice(0,4));
    ensureSalesSeries(year).then(rows=>{
      if(cancelled)return;
      setSeries(rows);
      const kind=invoice?.invoiceType||'standard';
      setSeriesId(current=>rows.some(item=>item.id===current)?current:(rows.find(item=>item.id===settings.sales.defaultSeriesId&&item.kind===kind)?.id||rows.find(item=>item.kind===kind)?.id||''));
    }).catch(e=>!cancelled&&setError(errorMessage(e,'No se pudieron preparar las series.')));
    return()=>{cancelled=true};
  },[open,issueDate,invoice?.invoiceType,settings.sales.defaultSeriesId]);

  useEffect(()=>{
    if(!open||!seriesId)return;
    const selected=series.find(item=>item.id===seriesId);
    if(!selected)return;
    if(invoice?.invoiceNumber&&invoice.seriesId===seriesId){setInvoiceNumber(invoice.invoiceNumber);return;}
    setInvoiceNumber(`${selected.prefix}${String(selected.nextNumber).padStart(selected.padding,'0')}`);
  },[open,seriesId,series,invoice?.id,invoice?.invoiceNumber,invoice?.seriesId]);

  if(!open)return null;
  const editing=Boolean(invoice);
  const invoiceKind=invoice?.invoiceType||'standard';
  const selectableSeries=series.filter(item=>item.kind===invoiceKind);
  const selectedSeries=selectableSeries.find(item=>item.id===seriesId);
  const seriesOptions=selectableSeries.map(s=>({value:s.id,label:`${s.name} · próximo ${s.prefix}${String(s.nextNumber).padStart(s.padding,'0')}`,searchText:`${s.name} ${s.code||''} ${s.prefix}`}));
  const taxRegistrationOptions=taxRegistrations.map(item=>({value:item.id,label:`${item.label} · ${item.vatNumber}${item.isDefault?' · predeterminado':''}`,searchText:`${item.label} ${item.vatNumber} ${item.countryCode}`}));
  const updateLine=(index:number,patch:Partial<SalesInvoiceLine>)=>setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
  const selectedClient=clients.find(client=>client.id===clientId);
  const selectedDefaultVat=clientDefaultVatRate(selectedClient,settings.sales.defaultVatRate);
  const removeLine=(index:number)=>setLines(current=>current.length===1?[emptyLine(1,selectedDefaultVat)]:current.filter((_,i)=>i!==index).map((line,i)=>({...line,position:i+1})));
  const addFreeLine=()=>setLines(current=>[...current,emptyLine(current.length+1,selectedDefaultVat)]);
  const addProduct=(product:BillableProduct)=>setLines(current=>{
    const productLine:SalesInvoiceLine={position:current.length+1,productId:product.id,description:product.description,quantity:1,unit:product.unit,unitPrice:product.salePrice??0,discountPercent:0,taxRate:product.taxRate};
    if(current.length===1&&!current[0].description.trim()&&!current[0].productId)return [productLine];
    return [...current,productLine];
  });
  const chooseClient=(value:string)=>{
    setClientId(value);
    const client=clients.find(c=>c.id===value);
    setDueDate(defaultSalesDueDate(issueDate,resolveSalesDueDays(client?.paymentTermsDays,settings.sales.defaultDueDays)));
    setPaymentMethod(clientDefaultPaymentMethod(client,settings.sales));
    const vat=clientDefaultVatRate(client,settings.sales.defaultVatRate);
    setLines(current=>current.map(line=>!line.productId&&!line.description.trim()?{...line,taxRate:vat}:line));
  };
  const changeIssueDate=(value:string)=>{
    setIssueDate(value);
    const client=clients.find(c=>c.id===clientId);
    setDueDate(defaultSalesDueDate(value,resolveSalesDueDays(client?.paymentTermsDays,settings.sales.defaultDueDays)));
  };
  const totals=lines.reduce((acc,line)=>{const x=calcLine(line);acc.gross+=x.gross;acc.net+=x.net;acc.tax+=x.tax;acc.total+=x.total;return acc},{gross:0,net:0,tax:0,total:0});
  const save=async()=>{
    if(!clientId){setError('Selecciona un cliente.');return;}
    if(!seriesId){setError('Selecciona una serie.');return;}
    if(!invoiceNumber.trim()){setError('Indica el número de factura.');return;}
    if(selectedSeries&&!invoiceNumber.trim().startsWith(selectedSeries.prefix)){setError(`El número debe comenzar por ${selectedSeries.prefix}.`);return;}
    if(taxRegistrations.length&&!taxRegistrationId){setError('Selecciona el registro IVA del emisor.');return;}
    const cleanLines=lines.filter(line=>line.description.trim());
    if(!cleanLines.length){setError('Añade al menos una línea a la factura.');return;}
    if(cleanLines.some(line=>line.quantity<=0)){setError('Las cantidades deben ser superiores a 0.');return;}
    if(invoiceKind==='standard'&&cleanLines.some(line=>line.unitPrice<0)){setError('Una factura ordinaria no puede tener precios negativos.');return;}
    setBusy(true);setError('');
    const payload:SalesInvoiceDraftInput={clientId,seriesId,taxRegistrationId:taxRegistrationId||null,issueDate,operationDate:operationDate||undefined,dueDate:dueDate||undefined,paymentMethod:paymentMethod||undefined,notes:notes||undefined,lines:cleanLines};
    let createdId='';
    try{
      const targetId=invoice?.id||(createdId=await createSalesInvoiceDraft(payload,settings.sales.defaultDueDays));
      if(invoice)await updateSalesInvoiceDraft(invoice.id,payload,settings.sales.defaultDueDays);
      try{await updateSalesInvoiceNumber(targetId,invoiceNumber.trim());}
      catch(numberError){if(createdId)await deleteSalesInvoiceDraftSafe(createdId).catch(()=>{});throw numberError;}
      await onSaved();showSuccess(invoice?'Borrador actualizado correctamente.':`Borrador ${invoiceNumber.trim()} creado correctamente.`);onClose();
    }catch(e){setError(errorMessage(e,'No se pudo guardar la factura.'));}finally{setBusy(false);}
  };

  return <div className="modalBackdrop"><div className="modal salesInvoiceModal polishedModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">{invoiceKind==='rectifying'?'RECTIFICATIVA':'FACTURA DE VENTA'}</div><h3>{invoiceKind==='rectifying'?'Rectificativa en borrador':editing?'Editar borrador':'Nueva factura'}</h3><p>{invoiceKind==='rectifying'?'Revisa la corrección antes de emitirla. La serie R es independiente.':'Te proponemos el siguiente número de la serie; puedes modificarlo antes de guardar.'}</p></div><button onClick={onClose}><X/></button></div>
    <section className="salesFormSection">
      <div className="salesSectionTitle"><UserRound size={18}/><div><strong>Cliente, serie, número e IVA emisor</strong><span>Quién recibe la factura, cómo se numera y desde qué registro IVA se emite</span></div></div>
      <div className="salesInvoiceMeta salesInvoiceMetaDates">
        <label>Cliente *<SearchableSelect value={clientId} options={clientOptions} onChange={chooseClient} placeholder="Selecciona cliente" searchPlaceholder="Buscar cliente, CIF, email…" ariaLabel="Cliente de la factura"/></label>
        <label>Serie<SearchableSelect value={seriesId} options={seriesOptions} onChange={setSeriesId} placeholder="Selecciona serie" searchPlaceholder="Buscar serie…" ariaLabel="Serie de facturación"/></label>
        <label>Número de factura *<input value={invoiceNumber} onChange={e=>setInvoiceNumber(e.target.value)} placeholder={selectedSeries?`${selectedSeries.prefix}${String(selectedSeries.nextNumber).padStart(selectedSeries.padding,'0')}`:'Número de factura'}/><small>{selectedSeries?`Propuesto según la serie ${selectedSeries.name}. Puedes modificarlo.`:'Selecciona una serie para obtener el siguiente número.'}</small></label>
        <label>Registro IVA<SearchableSelect value={taxRegistrationId} options={taxRegistrationOptions} onChange={setTaxRegistrationId} allowEmpty emptyLabel={taxRegistrations.length?'Selecciona registro IVA':'Sin registros IVA'} searchPlaceholder="Buscar registro IVA…" ariaLabel="Registro IVA del emisor"/></label>
      </div>
    </section>
    <section className="salesFormSection"><div className="salesSectionTitle"><CalendarDays size={18}/><div><strong>Fechas y cobro</strong><span>Operación, vencimiento y forma de pago</span></div></div><div className="salesInvoiceMeta salesInvoiceMetaDates"><label>Fecha factura<input type="date" value={issueDate} onChange={e=>changeIssueDate(e.target.value)}/></label><label>Fecha operación<input type="date" value={operationDate} onChange={e=>setOperationDate(e.target.value)}/></label><label>Vencimiento<input type="date" min={issueDate||undefined} value={dueDate} onChange={e=>setDueDate(e.target.value)}/><small>{clients.find(client=>client.id===clientId)?.paymentTermsDays?`Según condiciones del cliente: ${clients.find(client=>client.id===clientId)?.paymentTermsDays} días`:`${settings.sales.defaultDueDays} días por defecto`}</small></label><label>Forma de pago<SelectField value={paymentMethod} onChange={setPaymentMethod} ariaLabel="Forma de pago" options={paymentMethodOptions}/></label></div></section>
    <section className="salesFormSection salesProductsSection"><div className="salesSectionTitle"><PackageSearch size={18}/><div><strong>Productos y conceptos</strong><span>Busca en tu catálogo o añade una línea libre</span></div></div><ProductCatalogPicker products={products} onAdd={addProduct}/><div className="salesLinesEditor"><div className="salesLinesHead"><div><strong>Líneas de factura</strong><span>{lines.length} línea{lines.length===1?'':'s'}</span></div><button className="secondary" type="button" onClick={addFreeLine}><Plus size={15}/> Concepto libre</button></div>{lines.map((line,index)=>{const total=calcLine(line).total;const product=products.find(item=>item.id===line.productId);return <div className="salesLine salesLineCard" key={`${line.id||'new'}-${index}`}><div className="salesLineIdentity"><div className="salesLineIndex">{index+1}</div><div><strong>{product?.name||'Concepto libre'}</strong><small>{product?.sku?`SKU ${product.sku}`:product?'Producto vinculado':'Sin producto vinculado'}</small></div></div><label className="salesLineDescription">Descripción<input value={line.description} onChange={e=>updateLine(index,{description:e.target.value})} placeholder="Producto o servicio facturado"/></label><label>Cantidad<input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updateLine(index,{quantity:Number(e.target.value)})}/></label><label>Unidad<input value={line.unit} onChange={e=>updateLine(index,{unit:e.target.value})}/></label><label>Precio unit.<input type="number" step="0.01" value={line.unitPrice} onChange={e=>updateLine(index,{unitPrice:Number(e.target.value)})}/></label><label>Dto. %<input type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={e=>updateLine(index,{discountPercent:Number(e.target.value)})}/></label><label>IVA %<SelectField value={String(line.taxRate)} onChange={value=>updateLine(index,{taxRate:Number(value)})} ariaLabel="IVA de la línea" options={[{value:'21',label:'21 %'},{value:'10',label:'10 %'},{value:'4',label:'4 %'},{value:'0',label:'0 %'}]}/></label><div className="salesLineTotal"><small>Total</small><strong>{money(total)}</strong></div><button className="iconAction danger" title="Eliminar línea" type="button" onClick={()=>removeLine(index)}><Trash2 size={16}/></button></div>})}</div></section>
    <section className="salesInvoiceBottom salesFormSection salesInvoiceSummary"><label>Notas<textarea rows={4} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observaciones visibles en la factura"/></label><div className="salesTotals"><span>Importe bruto <strong>{money(totals.gross)}</strong></span>{Math.abs(totals.gross-totals.net)>0.005&&<span>Descuento <strong>{money(totals.net-totals.gross)}</strong></span>}<span>Base imponible <strong>{money(totals.net)}</strong></span><span>IVA <strong>{money(totals.tax)}</strong></span><span className="salesGrandTotal">Total <strong>{money(totals.total)}</strong></span></div></section>
    {error&&<div className="errorBox">{error}</div>}<div className="modalActions salesStickyActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={save} disabled={busy}>{busy?'Guardando…':'Guardar borrador'}</button></div>
  </div></div>;
}

function BusinessModal({open,settings,branding,onClose,onSaved}:{open:boolean;settings:BusinessSettings;branding:CompanyBranding;onClose:()=>void;onSaved:(settings:BusinessSettings,branding:CompanyBranding)=>Promise<void>}){
  const [form,setForm]=useState(settings);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [logoFile,setLogoFile]=useState<File|null>(null);const [logoPreview,setLogoPreview]=useState<string|null>(branding.logoDataUrl||null);const [removeLogo,setRemoveLogo]=useState(false);
  const set=useCallback((key:keyof BusinessSettings,value:string)=>setForm(current=>({...current,[key]:value})),[]);
  const addressHandlers=useMemo(()=>({
    onCountryCodeChange:(value:string)=>set('countryCode',value),
    onPostalCodeChange:(value:string)=>set('postalCode',value),
    onCityChange:(value:string)=>set('city',value),
    onProvinceChange:(value:string)=>set('province',value),
  }),[set]);
  useEffect(()=>{if(open){setForm(settings);setError('');setLogoFile(null);setLogoPreview(branding.logoDataUrl||null);setRemoveLogo(false);}},[open,settings,branding]); if(!open)return null;
  const chooseLogo=(file?:File)=>{if(!file)return;try{validateCompanyLogo(file);setLogoFile(file);setRemoveLogo(false);setError('');const reader=new FileReader();reader.onload=()=>setLogoPreview(typeof reader.result==='string'?reader.result:null);reader.readAsDataURL(file);}catch(e){setError(errorMessage(e,'No se pudo seleccionar el logotipo.'));}};
  const clearLogo=()=>{setLogoFile(null);setLogoPreview(null);setRemoveLogo(true);};
  const save=async()=>{if(!form.legalName.trim()||!form.taxId?.trim()||!form.addressLine1?.trim()||!form.postalCode?.trim()||!form.city?.trim()){setError('Completa razón social, CIF/NIF, dirección, código postal y ciudad.');return;}setBusy(true);setError('');try{await saveBusinessSettings(form);let nextBranding=branding;if(removeLogo)nextBranding=await removeCompanyLogo(branding.logoPath);else if(logoFile)nextBranding=await uploadCompanyLogo(logoFile,branding.logoPath);await onSaved(form,nextBranding);showSuccess('Datos fiscales y branding guardados correctamente.');onClose();}catch(e){setError(errorMessage(e,'No se pudieron guardar los datos fiscales.'));}finally{setBusy(false);}};
  return <div className="modalBackdrop"><div className="modal salesClientModal polishedModal"><div className="modalHead salesModalHead"><div><div className="eyebrow">CONFIGURACIÓN</div><h3>Datos fiscales de ZENVIA</h3><p>Datos generales del emisor, registros IVA y logotipo utilizados en las facturas.</p></div><button onClick={onClose}><X/></button></div>
    <section className="salesFormSection"><div className="salesSectionTitle"><ReceiptText size={18}/><div><strong>Identificación fiscal principal</strong><span>Identidad legal de la empresa. Los VAT de otros países se gestionan debajo.</span></div></div><div className="salesFormGrid"><label className="salesSpan2">Razón social *<input value={form.legalName} onChange={e=>set('legalName',e.target.value)}/></label><label>CIF/NIF principal *<input value={form.taxId||''} onChange={e=>set('taxId',e.target.value)}/></label><label>Nombre comercial<input value={form.tradeName||''} onChange={e=>set('tradeName',e.target.value)}/></label></div></section>
    <section className="salesFormSection"><div className="salesSectionTitle"><WalletCards size={18}/><div><strong>Registros IVA del emisor</strong><span>España, Francia, Alemania, Italia… Elige uno distinto en cada factura cuando lo necesites.</span></div></div><TaxRegistrationsPanel/></section>
    <section className="salesFormSection"><div className="salesSectionTitle"><ImagePlus size={18}/><div><strong>Logotipo de empresa</strong><span>Se mostrará en borradores, facturas, rectificativas, descargas, impresión y envíos</span></div></div><div className="companyLogoEditor"><div className={`companyLogoPreview ${logoPreview?'hasLogo':''}`}>{logoPreview?<img src={logoPreview} alt="Logotipo de empresa"/>:<div><ImagePlus size={25}/><span>Sin logotipo</span></div>}</div><div className="companyLogoControls"><label className="secondary companyLogoUpload"><ImagePlus size={16}/>{logoPreview?'Cambiar logotipo':'Subir logotipo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>chooseLogo(e.target.files?.[0])}/></label>{logoPreview&&<button className="secondary dangerText" type="button" onClick={clearLogo}><Trash2 size={16}/> Quitar logotipo</button>}<small>PNG, JPG o WebP · máximo 5 MB. Para mejor resultado utiliza fondo transparente y formato horizontal.</small></div></div></section>
    <section className="salesFormSection"><div className="salesSectionTitle"><UserRound size={18}/><div><strong>Dirección y contacto</strong><span>Información de contacto visible en factura</span></div></div><div className="salesFormGrid"><label className="salesSpan2">Dirección *<input value={form.addressLine1||''} onChange={e=>set('addressLine1',e.target.value)} autoComplete="street-address"/></label><PostalAddressFields countryCode={form.countryCode||'ES'} postalCode={form.postalCode||''} city={form.city||''} province={form.province||''} requiredPostalCode requiredCity {...addressHandlers}/><label>Email<input type="email" value={form.email||''} onChange={e=>set('email',e.target.value)}/></label><label>Teléfono<input value={form.phone||''} onChange={e=>set('phone',e.target.value)}/></label></div></section>
    <section className="salesFormSection"><div className="salesSectionTitle"><WalletCards size={18}/><div><strong>Cobro y pie de factura</strong><span>Datos bancarios y texto final</span></div></div><div className="salesFormGrid"><label className="salesSpan2">IBAN<input value={form.iban||''} onChange={e=>set('iban',e.target.value)} placeholder="ES00…"/></label><label className="salesSpan2">Pie de factura<textarea rows={3} value={form.invoiceFooter||''} onChange={e=>set('invoiceFooter',e.target.value)} placeholder="Condiciones de pago, registro mercantil…"/></label></div></section>
    {error&&<div className="errorBox">{error}</div>}<div className="modalActions salesStickyActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar datos fiscales'}</button></div>
  </div></div>;
}

function PaymentModal({invoice,salesSettings,onClose,onSaved}:{invoice:SalesInvoice|null;salesSettings:SalesSettings;onClose:()=>void;onSaved:()=>Promise<void>}){
  const pending=invoice?Math.max(0,invoice.totalAmount-invoice.paidAmount):0;const defaultMethod=salesSettings.paymentMethods.find(item=>item.id===salesSettings.defaultPaymentMethod&&item.active)?.label||salesSettings.paymentMethods.find(item=>item.active)?.label||'';const paymentOptions=salesSettings.paymentMethods.filter(item=>item.active).map(item=>({value:item.label,label:item.label}));const [amount,setAmount]=useState(pending);const [date,setDate]=useState(today());const [method,setMethod]=useState(defaultMethod);const [reference,setReference]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(invoice){setAmount(Math.max(0,invoice.totalAmount-invoice.paidAmount));setDate(today());setMethod(invoice.paymentMethod||defaultMethod);setReference('');setError('');}},[invoice,defaultMethod]); if(!invoice)return null;
  const save=async()=>{if(amount<=0){setError('Indica un importe superior a 0.');return;}if(amount>pending+0.005){setError('El cobro no puede superar el importe pendiente.');return;}if(!salesSettings.allowPartialPayments&&amount<pending-0.005){setError('Los cobros parciales están desactivados. Registra el importe pendiente completo.');return;}setBusy(true);setError('');try{await addSalesPayment(invoice.id,{amount,paymentDate:date,method,reference});await onSaved();showSuccess(amount>=pending-0.005?(salesSettings.autoMarkPaid?'Factura marcada como cobrada.':'Cobro completo registrado. Puedes marcarla como cobrada manualmente.'):'Cobro parcial registrado correctamente.');onClose();}catch(e){setError(errorMessage(e,'No se pudo registrar el cobro.'));}finally{setBusy(false);}};
  return <div className="modalBackdrop"><div className="modal smallModal polishedModal salesPaymentModal"><div className="modalHead salesModalHead"><div><div className="eyebrow">COBROS</div><h3>Registrar cobro</h3><p>{invoice.invoiceNumber} · Pendiente {money(pending)}</p></div><button onClick={onClose}><X/></button></div><div className="salesPaymentQuick"><button type="button" className="primary" onClick={()=>setAmount(pending)}>Cobrar todo · {money(pending)}</button><span>{salesSettings.allowPartialPayments?'Puedes modificar el importe si el cliente ha hecho un pago parcial.':'Los cobros parciales están desactivados.'}</span></div><div className="salesFormSection"><div className="salesFormGrid"><label>Importe<input type="number" min="0.01" max={pending} step="0.01" value={amount} disabled={!salesSettings.allowPartialPayments} onChange={e=>setAmount(Number(e.target.value))}/></label><label>Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Método<SelectField value={method} onChange={setMethod} ariaLabel="Método de cobro" options={paymentOptions}/></label><label>Referencia<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Nº operación, transferencia…"/></label></div></div>{error&&<div className="errorBox">{error}</div>}<div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':amount>=pending-0.005?'Marcar como cobrada':'Registrar cobro parcial'}</button></div></div></div>;
}

function BulkPaymentModal({invoices,salesSettings,onClose,onSaved}:{invoices:SalesInvoice[];salesSettings:SalesSettings;onClose:()=>void;onSaved:()=>Promise<void>}){
  const defaultMethod=salesSettings.paymentMethods.find(item=>item.id===salesSettings.defaultPaymentMethod&&item.active)?.label||salesSettings.paymentMethods.find(item=>item.active)?.label||'';const paymentOptions=salesSettings.paymentMethods.filter(item=>item.active).map(item=>({value:item.label,label:item.label}));const [date,setDate]=useState(today());const [method,setMethod]=useState(defaultMethod);const [reference,setReference]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const total=invoices.reduce((sum,invoice)=>sum+Math.max(0,invoice.totalAmount-invoice.paidAmount),0);
  if(!invoices.length)return null;
  const save=async()=>{
    setBusy(true);setError('');
    const process=openActionProcess({title:'Registrando cobros',description:'Se registrará el importe pendiente de cada factura seleccionada.',items:invoices.map(invoice=>({id:invoice.id,label:`${invoice.invoiceNumber||'Factura'} · ${invoice.clientName}`}))});
    let paid=0;let failed=0;
    try{
      for(const invoice of invoices){
        const pending=Math.max(0,invoice.totalAmount-invoice.paidAmount);
        process.setItem(invoice.id,'running',`Registrando ${money(pending)}…`);
        try{
          if(pending>0.005)await addSalesPayment(invoice.id,{amount:pending,paymentDate:date,method,reference});
          paid+=1;process.setItem(invoice.id,'success','Cobrada completamente.');
        }catch(e){failed+=1;process.setItem(invoice.id,'error',errorMessage(e,'No se pudo registrar el cobro.'));}
      }
      await onSaved();
      process.finish(`${paid} factura${paid===1?'':'s'} cobrada${paid===1?'':'s'}.${failed?` ${failed} con error.`:''}`,failed?(paid?'warning':'error'):'success');
      if(paid)onClose();
    }catch(e){setError(errorMessage(e,'No se pudo actualizar la facturación tras registrar los cobros.'));process.finish('No se pudo completar la actualización final.','error');}
    finally{setBusy(false);}
  };
  return <div className="modalBackdrop"><div className="modal smallModal polishedModal salesPaymentModal"><div className="modalHead salesModalHead"><div><div className="eyebrow">COBROS EN LOTE</div><h3>Marcar facturas como cobradas</h3><p>{invoices.length} factura{invoices.length===1?'':'s'} · Total pendiente {money(total)}</p></div><button onClick={onClose}><X/></button></div><div className="salesFormSection"><div className="salesFormGrid"><label>Fecha de cobro<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Método<SelectField value={method} onChange={setMethod} ariaLabel="Método de cobro en lote" options={paymentOptions}/></label><label className="salesSpan2">Referencia común<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Opcional"/></label></div></div><div className="salesBulkPaymentList">{invoices.map(invoice=><div key={invoice.id}><span>{invoice.invoiceNumber||'Factura'} · {invoice.clientName}</span><strong>{money(Math.max(0,invoice.totalAmount-invoice.paidAmount))}</strong></div>)}</div>{error&&<div className="errorBox">{error}</div>}<div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Registrando…':`Cobrar ${money(total)}`}</button></div></div></div>;
}

function InvoiceDetail({invoice,settings,allowEditIssuedInvoices,autoMarkPaid,onClose,onPdf,onPrint,onPayment,onMarkPaid,onSend,onRectify,onEdit,onReopen,onDelete,onIssue}:{invoice:SalesInvoice|null;settings:BusinessSettings;allowEditIssuedInvoices:boolean;autoMarkPaid:boolean;onClose:()=>void;onPdf:(invoice:SalesInvoice)=>void;onPrint:(invoice:SalesInvoice)=>void;onPayment:(invoice:SalesInvoice)=>void;onMarkPaid:(invoice:SalesInvoice)=>void;onSend:(invoice:SalesInvoice)=>void;onRectify:(invoice:SalesInvoice)=>void;onEdit:(invoice:SalesInvoice)=>void;onReopen:(invoice:SalesInvoice)=>void;onDelete:(invoice:SalesInvoice)=>void;onIssue:(invoice:SalesInvoice)=>void}){
  if(!invoice)return null;const pending=Math.max(0,invoice.totalAmount-invoice.paidAmount);const canRectify=invoice.invoiceType==='standard'&&!['draft','rectified'].includes(invoice.status);
  return <div className="modalBackdrop"><div className="modal salesDetailModal polishedModal"><div className="modalHead salesModalHead"><div><div className="eyebrow">{invoice.invoiceType==='rectifying'?'FACTURA RECTIFICATIVA':'FACTURA DE VENTA'}</div><h3>{invoice.invoiceNumber||'Borrador'}</h3><p>{invoice.clientName} · {dateLabel(invoice.issueDate)}</p></div><button onClick={onClose}><X/></button></div>
    <div className="salesDetailMeta"><div><span>Estado</span><strong className={statusClass(invoice.status)}>{statusLabel(invoice.status)}</strong></div><div><span>Vencimiento</span><strong className={isOverdueInvoice(invoice)?'salesDueDate overdue':'salesDueDate'}>{invoice.dueDate?dateLabel(invoice.dueDate):'—'}</strong><small>{isOverdueInvoice(invoice)?'Vencida y pendiente de cobro':invoice.dueDate?'Fecha límite de cobro':'Sin vencimiento'}</small></div><div><span>Cliente</span><strong>{invoice.clientName}</strong><small>{invoice.clientTaxId||'CIF/NIF pendiente'}</small></div><div><span>IVA emisor</span><strong>{invoice.issuerTaxId||settings.taxId||'—'}</strong><small>{invoice.issuerTaxRegistrationLabel||invoice.taxRegistrationLabel||invoice.issuerTaxCountryCode||''}</small></div><div><span>Pendiente</span><strong>{invoice.status==='draft'?'—':money(pending)}</strong></div></div>
    {invoice.invoiceType==='rectifying'&&<div className="salesRectifyingNotice"><RotateCcw size={17}/><span>Esta factura rectifica una factura anterior. Los importes negativos reducen la facturación y el IVA repercutido.</span></div>}
    <section className="salesDetailSection"><h4>Conceptos</h4><div className="salesDetailLines"><div className="salesDetailLine salesDetailLineHead"><span>Descripción</span><span>Cant.</span><span>Precio</span><span>IVA</span><span>Total</span></div>{invoice.lines.map(line=><div className="salesDetailLine" key={line.id||`${line.position}-${line.description}`}><strong>{line.description}</strong><span>{line.quantity.toLocaleString('es-ES')} {line.unit}</span><span>{money(line.unitPrice)}</span><span>{line.taxRate.toLocaleString('es-ES')} %</span><span>{money(line.lineTotal??calcLine(line).total)}</span></div>)}</div></section>
    <div className="salesDetailBottom"><div className="salesParties"><div><h4>Emisor</h4><p><strong>{invoice.issuerName||settings.legalName}</strong><br/>{invoice.issuerTaxId||settings.taxId}{invoice.issuerTaxRegistrationLabel?` · ${invoice.issuerTaxRegistrationLabel}`:''}<br/>{invoice.issuerAddress||settings.addressLine1}{(invoice.issuerEmail||settings.email)&&<><br/>{invoice.issuerEmail||settings.email}</>}{(invoice.issuerPhone||settings.phone)&&<><br/>{invoice.issuerPhone||settings.phone}</>}</p></div><div><h4>Cliente</h4><p><strong>{invoice.clientName}</strong>{invoice.clientTaxId&&<><br/>{invoice.clientTaxId}</>}{invoice.clientAddress&&<><br/>{invoice.clientAddress}</>}{invoice.clientEmail&&<><br/>{invoice.clientEmail}</>}{invoice.clientPhone&&<><br/>{invoice.clientPhone}</>}</p></div></div><div className="salesTotals"><span>Base imponible <strong>{money(invoice.subtotal)}</strong></span>{invoice.discountAmount!==0&&<span>Descuentos <strong>{money(-invoice.discountAmount)}</strong></span>}<span>IVA <strong>{money(invoice.taxAmount)}</strong></span><span className="salesGrandTotal">Total <strong>{money(invoice.totalAmount)}</strong></span></div></div>
    {invoice.payments.length>0&&<section className="salesDetailSection"><h4>Cobros</h4><div className="salesPaymentList">{invoice.payments.map(payment=><div key={payment.id}><span>{dateLabel(payment.paymentDate)} · {payment.method||'Cobro'}{payment.reference?` · ${payment.reference}`:''}</span><strong>{money(payment.amount)}</strong></div>)}</div></section>}
    <div className="modalActions salesDetailActions">{invoice.status==='draft'?<><button className="secondary" onClick={()=>onEdit(invoice)}><Pencil size={16}/> Editar borrador</button><button className="secondary" onClick={()=>onPdf(invoice)}><Download size={16}/> Descargar PDF</button><button className="secondary" onClick={()=>onPrint(invoice)}><Printer size={16}/> Imprimir PDF</button><button className="secondary dangerText" onClick={()=>onDelete(invoice)}><Trash2 size={16}/> Eliminar borrador</button><button className="primary" onClick={()=>onIssue(invoice)}><FileCheck2 size={16}/> {invoice.invoiceType==='rectifying'?'Emitir rectificativa':'Emitir factura'}</button></>:invoice.status==='issued'?<>{allowEditIssuedInvoices&&<button className="secondary" onClick={()=>onReopen(invoice)}><Pencil size={16}/> Editar factura</button>}<button className="secondary dangerText" onClick={()=>onDelete(invoice)}><Trash2 size={16}/> Eliminar factura</button><button className="secondary" onClick={()=>onPdf(invoice)}><Download size={16}/> Descargar PDF</button><button className="secondary" onClick={()=>onPrint(invoice)}><Printer size={16}/> Imprimir PDF</button><button className="primary" onClick={()=>onSend(invoice)}><Mail size={16}/> Enviar por Gmail</button></>:<><button className="secondary" onClick={()=>onPdf(invoice)}><Download size={16}/> Descargar PDF</button><button className="secondary" onClick={()=>onPrint(invoice)}><Printer size={16}/> Imprimir PDF</button>{invoice.status!=='rectified'&&<button className="primary" onClick={()=>onSend(invoice)}><Mail size={16}/> Enviar por Gmail</button>}</>}{invoice.invoiceType==='standard'&&!['draft','paid','rectified'].includes(invoice.status)&&<button className="secondary" onClick={()=>onPayment(invoice)}><CheckCircle2 size={16}/> Registrar cobro</button>}{invoice.invoiceType==='standard'&&invoice.status==='paid'&&<button className="secondary" disabled><CheckCircle2 size={16}/> Cobrada</button>}{invoice.invoiceType==='standard'&&!autoMarkPaid&&invoice.status!=='paid'&&invoice.status!=='draft'&&invoice.status!=='rectified'&&pending<=0.005&&<button className="secondary" onClick={()=>onMarkPaid(invoice)}><CheckCircle2 size={16}/> Marcar como cobrada</button>}{canRectify&&<button className="secondary dangerText" onClick={()=>onRectify(invoice)}><RotateCcw size={16}/> Crear rectificativa</button>}</div>
  </div></div>;
}

export function SalesInvoices({
  selectedIds=[],
  onSelectedIdsChange,
  onExportSelected,
  onFiltersChange,
}:{
  selectedIds?:string[];
  onSelectedIdsChange?:(ids:string[])=>void;
  onExportSelected?:(ids:string[])=>void;
  onFiltersChange?:(filters:{query:string;status:string;from:string;to:string;clientId:string;country:string;collection:string})=>void;
}={}){
  const {settings:appSettings,preferences}=useSettings();
  const [invoices,setInvoices]=useState<SalesInvoice[]>([]);const [clients,setClients]=useState<Client[]>([]);const [products,setProducts]=useState<BillableProduct[]>([]);const [settings,setSettings]=useState<BusinessSettings>({legalName:'ZENVIA COMMERCE SL',countryCode:'ES'});const [branding,setBranding]=useState<CompanyBranding>({ownerId:'',logoPath:null,logoDataUrl:null});
  const [query,setQuery]=useState('');const [status,setStatus]=useState('all');const [clientId,setClientId]=useState('all');const [countryFilter,setCountryFilter]=useState('all');const [collectionFilter,setCollectionFilter]=useState<CollectionFilter>('all');const [dateFilter,setDateFilter]=useState(()=>defaultDateFilter(preferences.defaultPeriod));const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const [modal,setModal]=useState(false);const [editing,setEditing]=useState<SalesInvoice|null>(null);const [detail,setDetail]=useState<SalesInvoice|null>(null);const [businessModal,setBusinessModal]=useState(false);const [seriesModal,setSeriesModal]=useState(false);const [paymentInvoice,setPaymentInvoice]=useState<SalesInvoice|null>(null);const [bulkPaymentInvoices,setBulkPaymentInvoices]=useState<SalesInvoice[]>([]);const [sendInvoice,setSendInvoice]=useState<SalesInvoice|null>(null);const [busyId,setBusyId]=useState<string|null>(null);const [bulkDeleting,setBulkDeleting]=useState(false);const [bulkIssuing,setBulkIssuing]=useState(false);
  const refresh=async()=>{setLoading(true);try{await ensureSalesSeries(new Date().getFullYear());const [nextInvoices,nextClients,nextSettings,nextProducts,nextBranding]=await Promise.all([loadSalesInvoices(),loadClients(),loadBusinessSettings(),loadBillableProducts(),loadCompanyBranding()]);setInvoices(nextInvoices);setClients(nextClients);setSettings(nextSettings);setProducts(nextProducts);setBranding(nextBranding);setDetail(current=>current?nextInvoices.find(item=>item.id===current.id)||null:null);setError('');}catch(e){setError(errorMessage(e,'No se pudo cargar la facturación.'));}finally{setLoading(false);}};
  useEffect(()=>{void refresh();},[]);
  const clientById=useMemo(()=>new Map(clients.map(client=>[client.id,client])),[clients]);
  const countryOptions=useMemo(()=>[...new Set(clients.map(client=>(client.countryCode||'XX').toUpperCase()))].sort((a,b)=>countryName(a).localeCompare(countryName(b),'es')).map(code=>({value:code,label:code==='XX'?'País pendiente':`${countryName(code)} · ${code}`})),[clients]);
  const clientOptions=useMemo(()=>clients.map(client=>({value:client.id,label:client.name,searchText:[client.taxId,client.email,client.city].filter(Boolean).join(' ')})),[clients]);
  const hasDueDates=useMemo(()=>invoices.some(invoice=>Boolean(invoice.dueDate)),[invoices]);
  const collectionOptions=useMemo(()=>[
    {value:'all',label:'Todas'},
    {value:'open',label:'Pendientes de cobro'},
    ...(hasDueDates?[{value:'overdue',label:'Vencidas y pendientes'}]:[]),
    {value:'paid',label:'Cobradas'},
  ],[hasDueDates]);
  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();const now=today();return invoices.filter(invoice=>{
    if(status!=='all'&&invoice.status!==status)return false;
    if(clientId!=='all'&&invoice.clientId!==clientId)return false;
    const country=(clientById.get(invoice.clientId)?.countryCode||'XX').toUpperCase();
    if(countryFilter!=='all'&&country!==countryFilter)return false;
    if(dateFilter.from&&invoice.issueDate<dateFilter.from)return false;
    if(dateFilter.to&&invoice.issueDate>dateFilter.to)return false;
    const pending=Math.max(0,invoice.totalAmount-invoice.paidAmount);
    if(collectionFilter==='open'&&(invoice.invoiceType!=='standard'||invoice.status==='draft'||invoice.status==='rectified'||pending<=0.005))return false;
    if(collectionFilter==='paid'&&invoice.status!=='paid')return false;
    if(collectionFilter==='overdue'&&(invoice.invoiceType!=='standard'||invoice.status==='draft'||invoice.status==='rectified'||pending<=0.005||!invoice.dueDate||invoice.dueDate>=now))return false;
    if(q&&![invoice.invoiceNumber||'borrador',invoice.clientName,invoice.clientTaxId||'',invoice.issuerTaxId||''].some(value=>value.toLowerCase().includes(q)))return false;
    return true;
  });},[invoices,query,status,clientId,countryFilter,collectionFilter,dateFilter,clientById]);
  useEffect(()=>{onSelectedIdsChange?.([]);},[query,status,clientId,countryFilter,collectionFilter,dateFilter]);
  useEffect(()=>{onFiltersChange?.({query,status,clientId,country:countryFilter,collection:collectionFilter,from:dateFilter.from,to:dateFilter.to});},[query,status,clientId,countryFilter,collectionFilter,dateFilter,onFiltersChange]);
  const selectedSet=useMemo(()=>new Set(selectedIds),[selectedIds]);
  const selectedVisible=filtered.filter(invoice=>selectedSet.has(invoice.id));
  const deletableSelected=selectedVisible.filter(invoice=>invoice.status==='draft'||invoice.status==='issued');
  const issuableSelected=selectedVisible.filter(invoice=>invoice.status==='draft');
  const collectableSelected=selectedVisible.filter(invoice=>invoice.invoiceType==='standard'&&!['draft','paid','rectified'].includes(invoice.status)&&Math.max(0,invoice.totalAmount-invoice.paidAmount)>0.005);
  const allVisibleSelected=filtered.length>0&&filtered.every(invoice=>selectedSet.has(invoice.id));
  const changeSelection=(next:Set<string>)=>onSelectedIdsChange?.([...next]);
  const toggleInvoice=(id:string,checked:boolean)=>{const next=new Set(selectedSet);if(checked)next.add(id);else next.delete(id);changeSelection(next);};
  const toggleAllVisible=(checked:boolean)=>{const next=new Set(selectedSet);for(const invoice of filtered){if(checked)next.add(invoice.id);else next.delete(invoice.id);}changeSelection(next);};

  const selectedPeriod=periodLabel(dateFilter);
  const totals=useMemo(()=>{
    const issuedRows=filtered.filter(invoice=>invoice.status!=='draft');
    const issued=issuedRows.reduce((sum,invoice)=>sum+invoice.totalAmount,0);
    const tax=issuedRows.reduce((sum,invoice)=>sum+invoice.taxAmount,0);
    const pending=filtered.filter(invoice=>invoice.invoiceType==='standard'&&!['draft','paid','rectified'].includes(invoice.status)).reduce((sum,invoice)=>sum+Math.max(0,invoice.totalAmount-invoice.paidAmount),0);
    const collected=filtered.filter(invoice=>invoice.invoiceType==='standard'&&invoice.status!=='draft').reduce((sum,invoice)=>sum+Math.max(0,invoice.paidAmount),0);
    const drafts=filtered.filter(invoice=>invoice.status==='draft').length;
    return {issued,tax,pending,collected,drafts,count:issuedRows.length,average:issuedRows.length?issued/issuedRows.length:0};
  },[filtered]);
  const openNew=()=>{if(!clients.length){showError('Crea al menos un cliente antes de preparar una factura.');return;}setEditing(null);setModal(true);};
  const edit=(invoice:SalesInvoice)=>{setDetail(null);setEditing(invoice);setModal(true);};
  const reopenForEdit=async(invoice:SalesInvoice)=>{
    if(invoice.status!=='issued'||!appSettings.sales.allowEditIssuedInvoices)return;
    const confirmed=await confirmAction({
      title:'Editar factura emitida',
      message:`${invoice.invoiceNumber} volverá a borrador y conservará su número mientras la corriges.`,
      confirmLabel:'Volver a borrador',
      tone:'warning',
      details:['Podrás modificar sus datos y volver a emitirla después.'],
    });
    if(!confirmed)return;
    setBusyId(invoice.id);setError('');
    try{
      await reopenSalesInvoice(invoice.id);
      const next=await loadSalesInvoices();setInvoices(next);
      const draft=next.find(item=>item.id===invoice.id)||null;
      setDetail(null);
      if(draft){setEditing(draft);setModal(true);}
      showSuccess('Factura reabierta. Puedes corregirla y volver a emitirla.');
    }catch(e){showError(errorMessage(e,'No se pudo reabrir la factura.'));}
    finally{setBusyId(null);}
  };
  const markPaid=async(invoice:SalesInvoice)=>{
    setBusyId(invoice.id);setError('');
    try{await markSalesInvoicePaid(invoice.id);await refresh();showSuccess('Factura marcada como cobrada.');}
    catch(e){showError(errorMessage(e,'No se pudo marcar la factura como cobrada.'));}
    finally{setBusyId(null);}
  };
  const emit=async(invoice:SalesInvoice)=>{
    const missingTax=!invoice.clientTaxId?.trim();
    const confirmed=await confirmAction({
      title:invoice.invoiceType==='rectifying'?'Emitir rectificativa':'Emitir factura',
      message:missingTax
        ?`El cliente ${invoice.clientName} no tiene NIF/CIF informado. Puedes emitirla igualmente, pero conviene revisar si ese dato es obligatorio para esta factura.`
        :`Se emitirá ${invoice.invoiceNumber||'la factura'} y quedará registrada como emitida.`,
      confirmLabel:missingTax?'Emitir igualmente':'Emitir',
      tone:missingTax?'warning':'default',
      details:[
        invoice.invoiceNumber?`Número: ${invoice.invoiceNumber}`:'',
        missingTax?'NIF/CIF del cliente: pendiente':'Datos fiscales del cliente: completos',
      ].filter(Boolean),
    });
    if(!confirmed)return;
    setBusyId(invoice.id);setError('');
    try{
      await issueSalesInvoice(invoice.id);
      await refresh();
      showSuccess(invoice.invoiceType==='rectifying'?'Rectificativa emitida correctamente.':'Factura emitida correctamente.');
    }catch(e){showError(errorMessage(e,'No se pudo emitir la factura.'),9000);}
    finally{setBusyId(null);}
  };
  const remove=async(invoice:SalesInvoice)=>{
    const issued=invoice.status==='issued';
    const confirmed=await confirmAction({
      title:issued?'Eliminar factura emitida':'Eliminar borrador',
      message:issued
        ?`Se eliminará completamente ${invoice.invoiceNumber}. Su número quedará libre para reutilizarse.`
        :'Este borrador se eliminará definitivamente.',
      confirmLabel:'Eliminar',
      tone:'danger',
      details:['Esta acción no se puede deshacer.'],
    });
    if(!confirmed)return;
    setBusyId(invoice.id);setError('');
    try{
      if(issued)await deleteReversibleSalesInvoice(invoice.id);else await deleteSalesInvoiceDraftSafe(invoice.id);
      if(detail?.id===invoice.id)setDetail(null);
      await refresh();
      showSuccess(issued?'Factura eliminada. Su número queda disponible para reutilizarse.':'Borrador eliminado correctamente.');
    }catch(e){showError(errorMessage(e,issued?'No se pudo eliminar la factura.':'No se pudo eliminar el borrador.'));}
    finally{setBusyId(null);}
  };
  const issueSelected=async()=>{
    if(!selectedVisible.length)return;
    const blocked=selectedVisible.length-issuableSelected.length;
    if(!issuableSelected.length){showError('Las facturas seleccionadas no están en borrador y no se pueden emitir.',9000);return;}
    const missingTax=issuableSelected.filter(invoice=>!invoice.clientTaxId?.trim());
    const confirmed=await confirmAction({
      title:`Emitir ${issuableSelected.length} factura${issuableSelected.length===1?'':'s'}`,
      message:missingTax.length
        ?`${missingTax.length} factura${missingTax.length===1?' tiene':'s tienen'} el NIF/CIF del cliente pendiente. Puedes continuar y revisar después los datos fiscales que correspondan.`
        :'Todas las facturas seleccionadas están listas para emitir.',
      confirmLabel:missingTax.length?'Emitir igualmente':'Emitir seleccionadas',
      tone:missingTax.length?'warning':'default',
      details:[
        `${issuableSelected.length} borrador${issuableSelected.length===1?'':'es'} se procesará${issuableSelected.length===1?'':'n'}.`,
        missingTax.length?`${missingTax.length} sin NIF/CIF de cliente.`:'',
        blocked?`${blocked} selección${blocked===1?'':'es'} no está${blocked===1?'':'n'} en borrador y se omitirá${blocked===1?'':'n'}.`:'',
      ].filter(Boolean),
    });
    if(!confirmed)return;

    setBulkIssuing(true);setError('');
    const process=openActionProcess({
      title:'Emitiendo facturas',
      description:'Puedes seguir el resultado de cada factura. Este panel permanecerá abierto al terminar.',
      items:selectedVisible.map(invoice=>({id:invoice.id,label:`${invoice.invoiceNumber||'Borrador'} · ${invoice.clientName}`})),
    });
    for(const invoice of selectedVisible.filter(item=>item.status!=='draft')){
      process.setItem(invoice.id,'skipped','No está en borrador; se mantiene sin cambios.');
    }

    let issued=0;let failed=0;
    try{
      for(const invoice of issuableSelected){
        process.setItem(invoice.id,'running',!invoice.clientTaxId?.trim()?'NIF/CIF pendiente; emitiendo con advertencia fiscal.':'Emitiendo…');
        try{
          await issueSalesInvoice(invoice.id);
          issued+=1;
          process.setItem(invoice.id,'success','Emitida correctamente.');
        }catch(e){
          failed+=1;
          process.setItem(invoice.id,'error',errorMessage(e,'No se pudo emitir.'));
        }
      }
      onSelectedIdsChange?.([]);
      await refresh();
      const summary=[
        `${issued} factura${issued===1?' emitida':'s emitidas'}.`,
        failed?`${failed} con error.`:'',
        blocked?`${blocked} omitida${blocked===1?'':'s'}.`:'',
      ].filter(Boolean).join(' ');
      process.finish(summary,failed?(issued?'warning':'error'):'success');
    }finally{setBulkIssuing(false);}
  };
  const removeSelected=async()=>{
    if(!selectedVisible.length)return;
    const blocked=selectedVisible.length-deletableSelected.length;
    if(!deletableSelected.length){showError('Las facturas seleccionadas no están en un estado eliminable.',9000);return;}
    const confirmed=await confirmAction({
      title:`Eliminar ${deletableSelected.length} factura${deletableSelected.length===1?'':'s'}`,
      message:'Las facturas seleccionadas se eliminarán de forma definitiva.',
      confirmLabel:'Eliminar seleccionadas',
      tone:'danger',
      details:[
        'Esta acción no se puede deshacer.',
        blocked?`${blocked} factura${blocked===1?' no es':'s no son'} eliminable${blocked===1?'':'s'} y se omitirá${blocked===1?'':'n'}.`:'',
      ].filter(Boolean),
    });
    if(!confirmed)return;

    setBulkDeleting(true);setError('');
    const process=openActionProcess({
      title:'Eliminando facturas',
      description:'El resultado permanecerá visible al terminar.',
      items:selectedVisible.map(invoice=>({id:invoice.id,label:`${invoice.invoiceNumber||'Borrador'} · ${invoice.clientName}`})),
    });
    for(const invoice of selectedVisible.filter(item=>!['draft','issued'].includes(item.status))){
      process.setItem(invoice.id,'skipped','Este estado no permite eliminación directa.');
    }

    let removed=0;let failed=0;
    try{
      for(const invoice of deletableSelected){
        process.setItem(invoice.id,'running','Eliminando…');
        try{
          if(invoice.status==='issued')await deleteReversibleSalesInvoice(invoice.id);
          else await deleteSalesInvoiceDraftSafe(invoice.id);
          removed+=1;
          process.setItem(invoice.id,'success','Eliminada correctamente.');
        }catch(e){
          failed+=1;
          process.setItem(invoice.id,'error',errorMessage(e,'No se pudo eliminar.'));
        }
      }
      if(detail&&deletableSelected.some(invoice=>invoice.id===detail.id))setDetail(null);
      onSelectedIdsChange?.([]);
      await refresh();
      const summary=[
        `${removed} factura${removed===1?' eliminada':'s eliminadas'}.`,
        failed?`${failed} con error.`:'',
        blocked?`${blocked} omitida${blocked===1?'':'s'}.`:'',
      ].filter(Boolean).join(' ');
      process.finish(summary,failed?(removed?'warning':'error'):'success');
    }finally{setBulkDeleting(false);}
  };
  const pdf=(invoice:SalesInvoice)=>{try{downloadSalesInvoicePdf(invoice,settings,branding,appSettings.sales);showSuccess('PDF generado correctamente.');}catch(e){showError(errorMessage(e,'No se pudo generar el PDF.'));}};
  const printPdf=(invoice:SalesInvoice)=>{try{printSalesInvoicePdf(invoice,settings,branding,appSettings.sales);showSuccess('PDF preparado para imprimir.');}catch(e){showError(errorMessage(e,'No se pudo abrir la impresión del PDF.'));}};
  const rectify=async(invoice:SalesInvoice)=>{
    const confirmed=await confirmAction({
      title:'Crear rectificativa',
      message:`Se creará una rectificativa en borrador que anula ${invoice.invoiceNumber}.`,
      confirmLabel:'Crear rectificativa',
      tone:'warning',
      details:['Podrás revisarla antes de emitirla.'],
    });
    if(!confirmed)return;
    setBusyId(invoice.id);setError('');
    try{const id=await createRectifyingInvoice(invoice.id);const next=await loadSalesInvoices();setInvoices(next);const draft=next.find(item=>item.id===id)||null;setDetail(null);showSuccess('Rectificativa creada en borrador.');if(draft){setEditing(draft);setModal(true);}}
    catch(e){showError(errorMessage(e,'No se pudo crear la rectificativa.'));}
    finally{setBusyId(null);}
  };
  return <div className="page"><div className="pageHead"><div><div className="eyebrow">VENTAS</div><h1>Facturación</h1><p>Borradores, series, registros IVA, emisión, envío por Gmail, cobros y rectificativas desde un único sitio.</p></div><div className="actions"><button className="secondary" onClick={()=>setSeriesModal(true)}><ListOrdered size={17}/> Series</button><button className="secondary" onClick={()=>setBusinessModal(true)}><Settings2 size={17}/> Datos fiscales</button><button className="primary" onClick={openNew}>+ Nueva factura</button></div></div>
    <PeriodFilterPanel filter={dateFilter} onChange={setDateFilter} title="Periodo de facturación"/>
    <div className="stats salesStats normalizedKpiStats">
      <StatCard label="Facturado" value={money(totals.issued)} sub={selectedPeriod} icon={<ReceiptText/>}/>
      <StatCard label="IVA repercutido" value={money(totals.tax)} sub={selectedPeriod} icon={<BadgeEuro/>}/>
      <StatCard label="Cobrado" value={money(totals.collected)} sub={selectedPeriod} icon={<CheckCircle2/>}/>
      <StatCard label="Pendiente de cobro" value={money(totals.pending)} sub="Facturas ordinarias vivas" icon={<Banknote/>}/>
      <StatCard label="Facturas emitidas" value={String(totals.count)} sub={selectedPeriod} icon={<CalendarDays/>}/>
      <StatCard label="Borradores" value={String(totals.drafts)} sub="Pendientes de emitir" icon={<FilePenLine/>}/>
      <StatCard label="Ticket medio" value={money(totals.average)} sub="Sobre facturas emitidas" icon={<Calculator/>}/>
    </div>
    <div className="businessFilterBar salesBusinessFilters">
      <div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar cliente, CIF, VAT o nº factura…"/></div>
      <div className="businessFilterFields">
        <label className="filterField"><span>Cliente</span><SearchableSelect value={clientId==='all'?'':clientId} options={clientOptions} onChange={value=>setClientId(value||'all')} allowEmpty emptyLabel="Todos los clientes" searchPlaceholder="Buscar cliente…" ariaLabel="Filtrar por cliente"/></label>
        <label className="filterField"><span>País</span><SelectField value={countryFilter} onChange={setCountryFilter} ariaLabel="Filtrar facturas por país" options={[{value:'all',label:'Todos los países'},...countryOptions]}/></label>
        <label className="filterField"><span>Estado</span><SelectField value={status} onChange={setStatus} ariaLabel="Estado de factura" options={[{value:'all',label:'Todos los estados'},{value:'draft',label:'Borradores'},{value:'issued',label:'Emitidas'},{value:'sent',label:'Enviadas'},{value:'partially_paid',label:'Cobro parcial'},{value:'paid',label:'Cobradas'},{value:'rectified',label:'Rectificadas'}]}/></label>
        <label className="filterField"><span>Cobro</span><SelectField value={collectionFilter} onChange={value=>setCollectionFilter(value as CollectionFilter)} ariaLabel="Filtrar por situación de cobro" options={collectionOptions}/></label>
      </div>
      <button className="filterResetCompact" type="button" onClick={()=>{setQuery('');setStatus('all');setClientId('all');setCountryFilter('all');setCollectionFilter('all');setDateFilter(defaultDateFilter(preferences.defaultPeriod))}}><RotateCcw size={15}/> Limpiar filtros</button>
      <span className="filterResultCount">{filtered.length} factura{filtered.length===1?'':'s'} · {selectedPeriod}</span>
    </div>
    {filtered.length>0&&<BulkSelectionToolbar selectedCount={selectedVisible.length} totalCount={filtered.length} allSelected={allVisibleSelected} onToggleAll={toggleAllVisible} label="facturas visibles">
      <button className="secondary" type="button" disabled={!issuableSelected.length||bulkIssuing||bulkDeleting} onClick={()=>void issueSelected()}><FileCheck2 size={15}/> {bulkIssuing?'Emitiendo…':`Emitir seleccionadas (${issuableSelected.length})`}</button>
      <button className="secondary collectBulkButton" type="button" disabled={!collectableSelected.length||bulkDeleting||bulkIssuing} onClick={()=>setBulkPaymentInvoices(collectableSelected)}><Banknote size={15}/> Cobrar seleccionadas ({collectableSelected.length})</button>
      <button className="secondary dangerText" type="button" disabled={!deletableSelected.length||bulkDeleting||bulkIssuing} onClick={()=>void removeSelected()}><Trash2 size={15}/> {bulkDeleting?'Eliminando…':`Eliminar seleccionadas (${deletableSelected.length})`}</button>
      <button className="primary" type="button" disabled={!selectedVisible.length||bulkDeleting||bulkIssuing} onClick={()=>onExportSelected?.(selectedVisible.map(invoice=>invoice.id))}><Download size={15}/> Exportar seleccionadas ({selectedVisible.length})</button>
    </BulkSelectionToolbar>}
    {error&&<div className="errorBox">{error}</div>}
    <section className="card tableCard salesInvoiceTableCard">{loading?<div className="emptyState large">Cargando facturación…</div>:filtered.length?<table><thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allVisibleSelected} onChange={toggleAllVisible} label={allVisibleSelected?'Deseleccionar facturas visibles':'Seleccionar facturas visibles'}/></th><th>Fecha</th><th>Vencimiento</th><th>Número</th><th>Cliente</th><th>Tipo</th><th>Estado</th><th className="right">Base</th><th className="right">IVA</th><th className="right">Total</th><th className="right">Pendiente</th><th className="right">Acciones</th></tr></thead><tbody>{filtered.map(invoice=>{const pending=Math.max(0,invoice.totalAmount-invoice.paidAmount);return <tr key={invoice.id} className={`clickableRow ${selectedSet.has(invoice.id)?'bulkSelectedRow':''}`} onClick={()=>setDetail(invoice)}><td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={selectedSet.has(invoice.id)} onChange={checked=>toggleInvoice(invoice.id,checked)} label={`Seleccionar ${invoice.invoiceNumber||invoice.clientName}`}/></td><td>{dateLabel(invoice.issueDate)}</td><td><span className={isOverdueInvoice(invoice)?'salesDueDate overdue':'salesDueDate'}>{invoice.dueDate?dateLabel(invoice.dueDate):'—'}{isOverdueInvoice(invoice)&&<small>Vencida</small>}</span></td><td><strong>{invoice.invoiceNumber||'Borrador'}</strong></td><td>{invoice.clientName}</td><td>{invoice.invoiceType==='rectifying'?<span className="tag">Rectificativa</span>:'Ordinaria'}</td><td><span className={statusClass(invoice.status)}>{statusLabel(invoice.status)}</span></td><td className="right">{money(invoice.subtotal)}</td><td className="right">{money(invoice.taxAmount)}</td><td className="right"><strong>{money(invoice.totalAmount)}</strong></td><td className="right">{invoice.status==='draft'||invoice.invoiceType==='rectifying'?'—':money(pending)}</td><td className="right"><div className="invoiceActions" onClick={e=>e.stopPropagation()}><button className="iconBtn" title="Ver detalle" onClick={()=>setDetail(invoice)}><Eye size={16}/></button>{invoice.status==='draft'?<><button className="iconBtn" title="Editar borrador" onClick={()=>edit(invoice)}><Pencil size={16}/></button><button className="iconBtn" title="Descargar PDF borrador" onClick={()=>pdf(invoice)}><Download size={16}/></button><button className="iconBtn" title="Imprimir PDF borrador" onClick={()=>printPdf(invoice)}><Printer size={16}/></button><button className="iconBtn accountBtn" title="Emitir" disabled={busyId===invoice.id} onClick={()=>emit(invoice)}><FileCheck2 size={16}/></button><button className="iconBtn dangerIcon" title="Eliminar borrador" disabled={busyId===invoice.id} onClick={()=>remove(invoice)}><Trash2 size={16}/></button></>:<><button className="iconBtn" title="Descargar PDF" onClick={()=>pdf(invoice)}><Download size={16}/></button><button className="iconBtn" title="Imprimir PDF" onClick={()=>printPdf(invoice)}><Printer size={16}/></button>{invoice.status==='issued'&&<>{appSettings.sales.allowEditIssuedInvoices&&<button className="iconBtn" title="Editar factura emitida" disabled={busyId===invoice.id} onClick={()=>reopenForEdit(invoice)}><Pencil size={16}/></button>}<button className="iconBtn dangerIcon" title="Eliminar factura emitida" disabled={busyId===invoice.id} onClick={()=>remove(invoice)}><Trash2 size={16}/></button></>}{invoice.status!=='rectified'&&<button className="iconBtn" title="Enviar por Gmail" onClick={()=>setSendInvoice(invoice)}><Mail size={16}/></button>}{invoice.invoiceType==='standard'&&!['draft','paid','rectified'].includes(invoice.status)&&pending>0.005&&<button className="invoiceCollectButton" title="Registrar cobro" onClick={()=>setPaymentInvoice(invoice)}><Banknote size={15}/><span>Cobrar</span></button>}{invoice.invoiceType==='standard'&&invoice.status==='paid'&&<span className="invoicePaidMark"><CheckCircle2 size={14}/> Cobrada</span>}{invoice.invoiceType==='standard'&&!appSettings.sales.autoMarkPaid&&invoice.status!=='paid'&&invoice.status!=='rectified'&&pending<=0.005&&<button className="invoiceCollectButton" title="Marcar como cobrada" disabled={busyId===invoice.id} onClick={()=>void markPaid(invoice)}><CheckCircle2 size={15}/><span>Marcar cobrada</span></button>}{invoice.invoiceType==='standard'&&invoice.status!=='rectified'&&<button className="iconBtn" title="Crear rectificativa" disabled={busyId===invoice.id} onClick={()=>rectify(invoice)}><RotateCcw size={16}/></button>}</>}</div></td></tr>;})}</tbody></table>:<div className="emptyState large">No hay facturas de venta para los filtros seleccionados.</div>}</section>
    {!loading&&filtered.length>0&&<div className="salesInvoicesMobileList">
      {filtered.map(invoice=>{const pending=Math.max(0,invoice.totalAmount-invoice.paidAmount);const collectable=invoice.invoiceType==='standard'&&!['draft','paid','rectified'].includes(invoice.status)&&pending>0.005;return <article className={`salesInvoiceMobileCard ${selectedSet.has(invoice.id)?'selected':''}`} key={invoice.id}>
        <div className="salesInvoiceMobileSelect"><BulkSelectCheckbox checked={selectedSet.has(invoice.id)} onChange={checked=>toggleInvoice(invoice.id,checked)} label={`Seleccionar ${invoice.invoiceNumber||invoice.clientName}`}/></div>
        <button className="salesInvoiceMobileMain" type="button" onClick={()=>setDetail(invoice)}>
          <div className="salesInvoiceMobileHead"><div><strong>{invoice.invoiceNumber||'Borrador'}</strong><span>{invoice.clientName}</span></div><span className={statusClass(invoice.status)}>{statusLabel(invoice.status)}</span></div>
          <div className="salesInvoiceMobileMeta"><span>{dateLabel(invoice.issueDate)}</span>{invoice.dueDate&&<span className={isOverdueInvoice(invoice)?'salesDueDate overdue':'salesDueDate'}>{isOverdueInvoice(invoice)?'Vencida':'Vence'} {dateLabel(invoice.dueDate)}</span>}<span>{invoice.invoiceType==='rectifying'?'Rectificativa':'Ordinaria'}</span></div>
          <div className="salesInvoiceMobileAmounts"><div><span>Total</span><strong>{money(invoice.totalAmount)}</strong></div><div><span>Pendiente</span><strong className={pending>0.005?'isPending':''}>{invoice.status==='draft'||invoice.invoiceType==='rectifying'?'—':money(pending)}</strong></div></div>
        </button>
        <div className="salesInvoiceMobileActions">
          <button className="secondary" type="button" onClick={()=>setDetail(invoice)}><Eye size={15}/> Ver</button>
          {invoice.status==='draft'&&<button className="primary" type="button" disabled={busyId===invoice.id} onClick={()=>emit(invoice)}><FileCheck2 size={15}/> Emitir</button>}
          {collectable&&<button className="primary invoiceMobileCollect" type="button" onClick={()=>setPaymentInvoice(invoice)}><Banknote size={15}/> Cobrar {money(pending)}</button>}
          {invoice.status==='paid'&&<span className="invoicePaidMark"><CheckCircle2 size={15}/> Cobrada</span>}
        </div>
      </article>;})}
    </div>}
    {!products.length&&clients.length>0&&<div className="card alertCard"><div className="trendIcon"><PackageSearch/></div><div><h3>Catálogo comercial</h3><p>Puedes crear facturas con conceptos libres. Cuando tengas productos activos aparecerán en el buscador del editor de factura.</p></div></div>}
    <InvoiceModal open={modal} invoice={editing} clients={clients} products={products} onClose={()=>{setModal(false);setEditing(null);}} onSaved={refresh}/><InvoiceDetail invoice={detail} settings={settings} allowEditIssuedInvoices={appSettings.sales.allowEditIssuedInvoices} autoMarkPaid={appSettings.sales.autoMarkPaid} onClose={()=>setDetail(null)} onPdf={pdf} onPrint={printPdf} onPayment={setPaymentInvoice} onMarkPaid={markPaid} onSend={setSendInvoice} onRectify={rectify} onEdit={edit} onReopen={reopenForEdit} onDelete={remove} onIssue={emit}/><BusinessModal open={businessModal} settings={settings} branding={branding} onClose={()=>setBusinessModal(false)} onSaved={async(next,nextBranding)=>{setSettings(next);setBranding(nextBranding);await refresh();}}/><SeriesManagerModal open={seriesModal} onClose={()=>setSeriesModal(false)} onChanged={refresh}/><PaymentModal invoice={paymentInvoice} salesSettings={appSettings.sales} onClose={()=>setPaymentInvoice(null)} onSaved={refresh}/><BulkPaymentModal invoices={bulkPaymentInvoices} salesSettings={appSettings.sales} onClose={()=>setBulkPaymentInvoices([])} onSaved={refresh}/><SendInvoiceModal invoice={sendInvoice} settings={settings} branding={branding} onClose={()=>setSendInvoice(null)} onSent={async()=>{await refresh();showSuccess('Factura enviada por Gmail correctamente.');}}/>
  </div>;
}
