import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, FileSpreadsheet, LoaderCircle, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { activateTransportTariff, createTransportTariffDraft, deleteTransportTariffDraft, listTransportTariffs, markTransportTariffReviewed, parseTransportTariffDocument, saveActiveTransportTariff, saveTransportTariffReview, type TransportTariffBandDraft, type TransportTariffDocument, type TransportTariffServiceDraft } from '../services/transportTariffs';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { confirmAction } from '../services/actionDialog';
import './transport-tariffs.css';

interface Props{open:boolean;onClose:()=>void}
const clone=<T,>(value:T):T=>structuredClone(value);
const money=(value:number|null)=>value==null?'—':new Intl.NumberFormat('es-ES',{minimumFractionDigits:2,maximumFractionDigits:4}).format(value);
const statusLabel=(status:string)=>({draft:'Borrador',reviewed:'Revisada',active:'Activa',superseded:'Histórica'}[status]||status);
const sourceLabel=(doc:TransportTariffDocument)=>doc.parserProvider==='openai'?'IA':doc.parserProvider==='automatic-rules'?'Lectura automática':doc.parserProvider==='manual-version'?'Actualización manual':doc.parserProvider;
const numberValue=(value:string)=>value.trim()===''?null:Number(value.replace(',','.'));

function emptyBand():TransportTariffBandDraft{return {countryCode:'ES',zoneCode:'peninsular',zoneName:'España Peninsular',minWeightKg:0,maxWeightKg:null,basePrice:null,extraKgPrice:null}}
function emptyService(index:number):TransportTariffServiceDraft{return {serviceName:`Servicio ${index+1}`,canonicalServiceKey:`service-${index+1}`,externalProvider:'mrw',externalServiceCode:`service-${index+1}`,mappingStatus:'suggested',bands:[emptyBand()]}}

export function TransportTariffsPanel({open,onClose}:Props){
  const [documents,setDocuments]=useState<TransportTariffDocument[]>([]),[selectedId,setSelectedId]=useState<string|null>(null),[draft,setDraft]=useState<TransportTariffDocument|null>(null);
  const [loading,setLoading]=useState(false),[reading,setReading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [activeApplyFrom,setActiveApplyFrom]=useState('');
  const fileRef=useRef<HTMLInputElement|null>(null);

  const refresh=async(preferred?:string|null)=>{setLoading(true);try{const rows=await listTransportTariffs();setDocuments(rows);const next=preferred&&rows.some(row=>row.id===preferred)?preferred:selectedId&&rows.some(row=>row.id===selectedId)?selectedId:rows[0]?.id||null;setSelectedId(next);setDraft(next?clone(rows.find(row=>row.id===next)!):null)}catch(e){setError(errorMessage(e,'No se pudieron cargar las tarifas de transporte.'))}finally{setLoading(false)}};
  useEffect(()=>{if(open)void refresh()},[open]);
  useEffect(()=>{if(!selectedId){setDraft(null);return}const doc=documents.find(item=>item.id===selectedId);if(doc)setDraft(clone(doc))},[selectedId,documents]);
  useEffect(()=>{const doc=documents.find(item=>item.id===selectedId);if(!doc||doc.status!=='active'){setActiveApplyFrom('');return}const today=new Date().toISOString().slice(0,10);let next=today;if(doc.effectiveFrom&&next<doc.effectiveFrom)next=doc.effectiveFrom;if(doc.effectiveTo&&next>doc.effectiveTo)next=doc.effectiveTo;setActiveApplyFrom(next)},[selectedId,documents]);
  const selected=useMemo(()=>documents.find(item=>item.id===selectedId)||null,[documents,selectedId]);

  if(!open)return null;
  const editable=draft?.status==='draft'||draft?.status==='active';

  const importFile=async(file:File)=>{
    setReading(true);setError('');
    try{
      const proposal=await parseTransportTariffDocument(file);
      const id=await createTransportTariffDraft(file,proposal);
      await refresh(id);
      showSuccess('Tarifa leída y guardada como borrador. Revisa los datos antes de activarla.');
    }catch(e){setError(errorMessage(e,'No se pudo leer la tarifa.'))}finally{setReading(false);if(fileRef.current)fileRef.current.value=''}
  };
  const updateDoc=(patch:Partial<TransportTariffDocument>)=>setDraft(current=>current?{...current,...patch}:current);
  const updateService=(index:number,patch:Partial<TransportTariffServiceDraft>)=>setDraft(current=>{if(!current)return current;const services=clone(current.services);services[index]={...services[index],...patch};return {...current,services}});
  const updateBand=(serviceIndex:number,bandIndex:number,patch:Partial<TransportTariffBandDraft>)=>setDraft(current=>{if(!current)return current;const services=clone(current.services);services[serviceIndex].bands[bandIndex]={...services[serviceIndex].bands[bandIndex],...patch};return {...current,services}});
  const addService=()=>setDraft(current=>current?{...current,services:[...current.services,emptyService(current.services.length)]}:current);
  const removeService=(index:number)=>setDraft(current=>current?{...current,services:current.services.filter((_,i)=>i!==index)}:current);
  const addBand=(serviceIndex:number)=>setDraft(current=>{if(!current)return current;const services=clone(current.services);const previous=services[serviceIndex].bands.at(-1);services[serviceIndex].bands.push({...emptyBand(),countryCode:previous?.countryCode||'ES',zoneCode:previous?.zoneCode||'peninsular',zoneName:previous?.zoneName||'España Peninsular',minWeightKg:previous?.maxWeightKg??previous?.minWeightKg??0});return {...current,services}});
  const removeBand=(serviceIndex:number,bandIndex:number)=>setDraft(current=>{if(!current)return current;const services=clone(current.services);services[serviceIndex].bands=services[serviceIndex].bands.filter((_,i)=>i!==bandIndex);return {...current,services}});

  const save=async(showToast=true)=>{if(!draft)return;setSaving(true);setError('');try{if(draft.status==='active'){if(!activeApplyFrom){showError('Indica desde qué fecha se aplican los cambios.');return}await saveActiveTransportTariff(draft,activeApplyFrom);await refresh(draft.id);if(showToast)showSuccess(`Cambios aplicados desde ${new Date(`${activeApplyFrom}T12:00:00`).toLocaleDateString('es-ES')} y estimaciones recalculadas.`)}else{await saveTransportTariffReview(draft);await refresh(draft.id);if(showToast)showSuccess('Revisión guardada.')}}catch(e){setError(errorMessage(e,draft.status==='active'?'No se pudo actualizar la tarifa activa.':'No se pudo guardar la revisión.'));throw e}finally{setSaving(false)}};
  const review=async()=>{if(!draft)return;if(!draft.effectiveFrom){showError('Indica la fecha de inicio de vigencia.');return}if(draft.services.some(service=>service.mappingStatus!=='confirmed')){showError('Confirma la asociación de todos los servicios antes de terminar la revisión.');return}setSaving(true);try{await saveTransportTariffReview(draft);await markTransportTariffReviewed(draft.id);await refresh(draft.id);showSuccess('Tarifa revisada. Ya puedes activarla.')}catch(e){showError(errorMessage(e,'No se pudo confirmar la revisión.'))}finally{setSaving(false)}};
  const activate=async()=>{if(!draft)return;setSaving(true);try{await activateTransportTariff(draft.id);await refresh(draft.id);showSuccess('Tarifa activada. Los nuevos envíos podrán utilizar esta versión.')}catch(e){showError(errorMessage(e,'No se pudo activar la tarifa.'))}finally{setSaving(false)}};
  const remove=async()=>{if(!selected)return;const confirmed=await confirmAction({title:'Eliminar tarifa',message:`Se eliminará la tarifa ${selected.carrierName} (${statusLabel(selected.status)}).`,confirmLabel:'Eliminar',tone:'danger'});if(!confirmed)return;setSaving(true);try{await deleteTransportTariffDraft(selected);await refresh(null);showSuccess('Tarifa eliminada.')}catch(e){showError(errorMessage(e,'No se pudo eliminar la tarifa.'))}finally{setSaving(false)}};

  return <div className="modalBackdrop transportTariffOverlay" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <div className="modal transportTariffModal">
      <header className="modalHead transportTariffHead"><div><div className="eyebrow">CONFIGURACIÓN · TRANSPORTE</div><h2>Tarifas de transporte</h2><p>Sube una tarifa, revisa la lectura y actívala solo cuando esté correcta.</p></div><button className="iconButton" onClick={onClose} aria-label="Cerrar"><X size={20}/></button></header>
      <div className="transportTariffActions"><input ref={fileRef} hidden type="file" accept=".pdf,.xlsx,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={event=>{const file=event.target.files?.[0];if(file)void importFile(file)}}/><button className="primary" onClick={()=>fileRef.current?.click()} disabled={reading||saving}>{reading?<LoaderCircle className="spin" size={16}/>:<Upload size={16}/>} Subir tarifa</button><button className="secondary" onClick={()=>void refresh(selectedId)} disabled={loading||saving}><RefreshCw className={loading?'spin':''} size={16}/> Actualizar</button><span className="transportImportRule">Siempre: leer → Revisar importación → Confirmar revisión → Activar tarifa</span></div>
      {error&&<div className="errorBox"><AlertCircle size={17}/>{error}</div>}
      <div className="transportTariffBody">
        <aside className="transportTariffVersions"><h3>Versiones</h3>{loading&&!documents.length&&<div className="transportEmpty"><LoaderCircle className="spin"/> Cargando…</div>}{!loading&&!documents.length&&<div className="transportEmpty"><FileSpreadsheet/>Todavía no hay tarifas cargadas.</div>}{documents.map(doc=><button key={doc.id} className={`transportVersion ${selectedId===doc.id?'active':''}`} onClick={()=>setSelectedId(doc.id)}><div><strong>{doc.carrierName}</strong><span className={`transportStatus ${doc.status}`}>{statusLabel(doc.status)}</span></div><small>{doc.effectiveFrom||'Inicio pendiente'} → {doc.effectiveTo||'sin fin'}</small><small>{doc.sourceFileName||'Documento sin nombre'}</small></button>)}</aside>
        <main className="transportTariffReview">
          {!draft&&<div className="transportEmpty transportEmptyLarge"><Upload/><h3>Sube una tarifa</h3><p>PDF o Excel XLSX. La aplicación extraerá los datos y nunca la activará sin tu confirmación.</p></div>}
          {draft&&<>
            <div className="transportReviewTitle"><div><h3>{draft.status==='active'?'Editar tarifa activa':editable?'Revisar importación':'Detalle de tarifa'}</h3><p>{draft.sourceFileName} · {sourceLabel(draft)} · confianza {Math.round(draft.parserConfidence*100)}%</p></div><span className={`transportStatus ${draft.status}`}>{statusLabel(draft.status)}</span></div>
            {draft.parserNotes.length>0&&<div className="transportParserNotes">{draft.parserNotes.map((note,index)=><span key={index}><Check size={14}/>{note}</span>)}</div>}
            <section className="transportMetaGrid">
              <label>Transportista<input disabled={!editable} value={draft.carrierName} onChange={e=>updateDoc({carrierName:e.target.value})}/></label>
              <label>Código<input disabled={!editable} value={draft.carrierCode} onChange={e=>updateDoc({carrierCode:e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g,'')})}/></label>
              <label>Vigente desde<input disabled={!editable} type="date" value={draft.effectiveFrom||''} onChange={e=>updateDoc({effectiveFrom:e.target.value||null})}/></label>
              <label>Vigente hasta<input disabled={!editable} type="date" min={draft.effectiveFrom||undefined} value={draft.effectiveTo||''} onChange={e=>updateDoc({effectiveTo:e.target.value||null})}/></label>
              <label>Combustible (%)<input disabled={!editable} inputMode="decimal" value={draft.fuelSurchargePct??''} placeholder="Configurable" onChange={e=>updateDoc({fuelSurchargePct:numberValue(e.target.value)})}/></label>
              <label className="transportCheckbox"><input disabled={!editable} type="checkbox" checked={draft.pricesIncludeVat} onChange={e=>updateDoc({pricesIncludeVat:e.target.checked})}/><span>Precios incluyen IVA</span></label>
            </section>
            <div className="transportServicesHead"><div><h3>Servicios y tramos</h3><p>Confirma la asociación una vez; la próxima tarifa del mismo transportista la reutilizará.</p></div>{editable&&<button className="secondary" onClick={addService}><Plus size={15}/> Servicio</button>}</div>
            <div className="transportServiceList">{draft.services.map((service,serviceIndex)=><section className="transportServiceCard" key={`${service.id||'new'}-${serviceIndex}`}>
              <div className="transportServiceHeader"><div className="transportServiceFields"><label>Servicio<input disabled={!editable} value={service.serviceName} onChange={e=>updateService(serviceIndex,{serviceName:e.target.value})}/></label><label>Proveedor / API<input disabled={!editable} value={service.externalProvider} onChange={e=>updateService(serviceIndex,{externalProvider:e.target.value})}/></label><label>Código de servicio<input disabled={!editable} value={service.externalServiceCode} onChange={e=>updateService(serviceIndex,{externalServiceCode:e.target.value})}/></label></div><div className="transportMappingActions"><span className={`transportMapping ${service.mappingStatus}`}>{service.mappingStatus==='confirmed'?'Asociación confirmada':service.mappingStatus==='unmapped'?'Sin asociar':'Sugerida'}</span>{editable&&service.mappingStatus!=='confirmed'&&<button className="secondary" onClick={()=>updateService(serviceIndex,{mappingStatus:'confirmed'})}><Check size={14}/> Confirmar asociación</button>}{editable&&<button className="dangerIcon" onClick={()=>removeService(serviceIndex)} aria-label="Eliminar servicio"><Trash2 size={16}/></button>}</div></div>
              <div className="transportBands"><div className="transportBandHeader"><span>País</span><span>Zona</span><span>Desde kg</span><span>Hasta kg</span><span>Precio base</span><span>€/kg extra</span><span></span></div>{service.bands.map((band,bandIndex)=><div className="transportBandRow" key={`${band.id||'band'}-${bandIndex}`}><input disabled={!editable} value={band.countryCode} maxLength={2} onChange={e=>updateBand(serviceIndex,bandIndex,{countryCode:e.target.value.toUpperCase()})}/><input disabled={!editable} value={band.zoneName} onChange={e=>updateBand(serviceIndex,bandIndex,{zoneName:e.target.value,zoneCode:e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-')})}/><input disabled={!editable} inputMode="decimal" value={band.minWeightKg} onChange={e=>updateBand(serviceIndex,bandIndex,{minWeightKg:Number(e.target.value.replace(',','.'))||0})}/><input disabled={!editable} inputMode="decimal" value={band.maxWeightKg??''} placeholder="∞" onChange={e=>updateBand(serviceIndex,bandIndex,{maxWeightKg:numberValue(e.target.value)})}/><input disabled={!editable} inputMode="decimal" value={band.basePrice??''} placeholder="—" onChange={e=>updateBand(serviceIndex,bandIndex,{basePrice:numberValue(e.target.value)})}/><input disabled={!editable} inputMode="decimal" value={band.extraKgPrice??''} placeholder="—" onChange={e=>updateBand(serviceIndex,bandIndex,{extraKgPrice:numberValue(e.target.value)})}/>{editable?<button className="dangerIcon" onClick={()=>removeBand(serviceIndex,bandIndex)} aria-label="Eliminar tramo"><Trash2 size={15}/></button>:<small>{money(band.basePrice)}</small>}</div>)}{editable&&<button className="transportAddBand" onClick={()=>addBand(serviceIndex)}><Plus size={14}/> Añadir tramo</button>}</div>
            </section>)}</div>
            <footer className="transportTariffFooter">{['draft','reviewed'].includes(draft.status)&&<button className="danger" onClick={remove} disabled={saving}><Trash2 size={16}/> Eliminar</button>}<div className="transportFooterMain">{draft.status==='draft'&&<button className="secondary" onClick={()=>void save()} disabled={saving}>{saving?<LoaderCircle className="spin" size={16}/>:null} Guardar cambios</button>}{draft.status==='draft'&&<button className="primary" onClick={review} disabled={saving}>Confirmar revisión</button>}{draft.status==='reviewed'&&<button className="primary" onClick={activate} disabled={saving}>Activar tarifa</button>}{draft.status==='active'&&<div className="transportActiveScope"><div><span className="transportActiveNote"><Check size={16}/> Tarifa activa · editable</span><small>Todos los campos que cambies se aplicarán desde la fecha indicada, sin crear otra tarifa visible.</small></div><label><span>Aplicar cambios desde</span><input type="date" min={draft.effectiveFrom||undefined} max={draft.effectiveTo||undefined} value={activeApplyFrom} onChange={e=>setActiveApplyFrom(e.target.value)}/></label>{draft.effectiveFrom&&<button className="secondary" type="button" onClick={()=>setActiveApplyFrom(draft.effectiveFrom!)}>Desde inicio</button>}<button className="primary" onClick={()=>void save()} disabled={saving||!activeApplyFrom}>{saving?<LoaderCircle className="spin" size={16}/>:null} Guardar cambios</button></div>}</div></footer>
          </>}
        </main>
      </div>
    </div>
  </div>;
}
