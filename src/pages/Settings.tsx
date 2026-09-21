import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BellRing,
  Box,
  Building2,
  CreditCard,
  FileInput,
  Gauge,
  PlugZap,
  ReceiptText,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Plus,
  Trash2,
  Truck,
  UserRound,
  Users,
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { SelectField } from '../components/forms/SelectField';
import { showError, showSuccess } from '../services/toast';
import type { ClientsSettings, SalesSettings, UserPreferences } from '../services/settingsSchema';
import { loadBusinessSettings, saveBusinessSettings, type BusinessSettings } from '../services/sales';
import { loadCompanyBranding, removeCompanyLogo, uploadCompanyLogo, type CompanyBranding } from '../services/companyBranding';
import { loadManagedSalesSeries, loadTaxRegistrations, type ManagedSalesSeries, type TaxRegistration } from '../services/salesConfig';

type SettingsSectionId =
  | 'general'
  | 'sales'
  | 'expenses'
  | 'orders'
  | 'shipping'
  | 'amazon'
  | 'products'
  | 'clients'
  | 'suppliers'
  | 'integrations'
  | 'automations'
  | 'preferences'
  | 'maintenance';

type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: (props:{size?:number})=>ReactNode;
  adminOnly: boolean;
};

const sections:SettingsSection[]=[
  {id:'general',label:'General',description:'Identidad, moneda y comportamiento general de la empresa.',icon:Building2,adminOnly:true},
  {id:'sales',label:'Facturación',description:'Valores predeterminados, cobros y documentos de venta.',icon:ReceiptText,adminOnly:true},
  {id:'expenses',label:'Gastos e importación',description:'Importación, duplicados y reglas de facturas recibidas.',icon:FileInput,adminOnly:true},
  {id:'orders',label:'Pedidos',description:'Comportamiento general de pedidos, etiquetas y tracking.',icon:ShoppingBag,adminOnly:true},
  {id:'shipping',label:'Envíos',description:'Transportistas, servicios y preferencias logísticas.',icon:Truck,adminOnly:true},
  {id:'amazon',label:'Amazon',description:'Marketplaces, sincronización y comportamiento analítico.',icon:Gauge,adminOnly:true},
  {id:'products',label:'Productos',description:'IVA, costes, márgenes y creación automática.',icon:Box,adminOnly:true},
  {id:'clients',label:'Clientes',description:'Defaults, identidad y enriquecimiento de clientes.',icon:Users,adminOnly:true},
  {id:'suppliers',label:'Proveedores',description:'Defaults, alias, identidad y categorización.',icon:Building2,adminOnly:true},
  {id:'integrations',label:'Integraciones',description:'Estado y comportamiento de servicios conectados.',icon:PlugZap,adminOnly:true},
  {id:'automations',label:'Alertas y automatizaciones',description:'Alertas de negocio y acciones automáticas controladas.',icon:BellRing,adminOnly:true},
  {id:'preferences',label:'Mis preferencias',description:'Preferencias de interfaz exclusivas de tu usuario.',icon:UserRound,adminOnly:false},
  {id:'maintenance',label:'Mantenimiento',description:'Diagnóstico, duplicados, reconstrucciones y exportación.',icon:ShieldCheck,adminOnly:true},
];

function SectionPlaceholder({section}:{section:SettingsSection}){
  const Icon=section.icon;
  return <section className="settingsSectionCard">
    <div className="settingsSectionHero">
      <div className="settingsSectionIcon"><Icon size={22}/></div>
      <div><h2>{section.label}</h2><p>{section.description}</p></div>
    </div>
    <div className="settingsEmptySection">
      <SlidersHorizontal size={22}/>
      <div><strong>Sección preparada</strong><span>Los ajustes aparecerán aquí únicamente cuando estén conectados al comportamiento real de la aplicación.</span></div>
    </div>
  </section>;
}



const currencyOptions=[
  {value:'EUR',label:'EUR · Euro'},
  {value:'GBP',label:'GBP · Libra esterlina'},
  {value:'USD',label:'USD · Dólar estadounidense'},
];

const dateFormatOptions=[
  {value:'DD/MM/YYYY',label:'DD/MM/YYYY'},
  {value:'DD-MM-YYYY',label:'DD-MM-YYYY'},
  {value:'YYYY-MM-DD',label:'YYYY-MM-DD'},
];

const languageOptions=[
  {value:'es',label:'Español'},
  {value:'en',label:'English'},
  {value:'fr',label:'Français'},
  {value:'it',label:'Italiano'},
  {value:'de',label:'Deutsch'},
  {value:'pt',label:'Português'},
];

function GeneralSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection}=useSettings();
  const [business,setBusiness]=useState<BusinessSettings>({legalName:'ZENVIA COMMERCE SL',countryCode:'ES'});
  const [general,setGeneral]=useState(settings.general);
  const [branding,setBranding]=useState<CompanyBranding|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    let active=true;
    setLoading(true);
    Promise.all([loadBusinessSettings(),loadCompanyBranding()])
      .then(([nextBusiness,nextBranding])=>{
        if(!active)return;
        setBusiness(nextBusiness);
        setBranding(nextBranding);
        setGeneral(settings.general);
        onDirtyChange(false);
      })
      .catch(e=>showError(e instanceof Error?e.message:'No se pudo cargar la configuración general.'))
      .finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  useEffect(()=>{setGeneral(settings.general)},[settings.general]);

  const updateBusiness=<K extends keyof BusinessSettings>(key:K,value:BusinessSettings[K])=>{
    setBusiness(current=>({...current,[key]:value}));
    onDirtyChange(true);
  };
  const updateGeneral=<K extends keyof typeof general>(key:K,value:(typeof general)[K])=>{
    setGeneral(current=>({...current,[key]:value}));
    onDirtyChange(true);
  };

  const save=async()=>{
    setSaving(true);
    try{
      await saveBusinessSettings(business);
      await updateSection('general',general);
      onDirtyChange(false);
      showSuccess('Configuración general guardada.');
    }catch(e){
      showError(e instanceof Error?e.message:'No se pudo guardar la configuración general.');
    }finally{
      setSaving(false);
    }
  };

  const changeLogo=async(file:File|null)=>{
    if(!file)return;
    setSaving(true);
    try{
      const next=await uploadCompanyLogo(file,branding?.logoPath);
      setBranding(next);
      showSuccess('Logotipo actualizado.');
    }catch(e){
      showError(e instanceof Error?e.message:'No se pudo actualizar el logotipo.');
    }finally{
      setSaving(false);
    }
  };

  const removeLogo=async()=>{
    setSaving(true);
    try{
      const next=await removeCompanyLogo(branding?.logoPath);
      setBranding(next);
      showSuccess('Logotipo eliminado.');
    }catch(e){
      showError(e instanceof Error?e.message:'No se pudo eliminar el logotipo.');
    }finally{
      setSaving(false);
    }
  };

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero">
      <div className="settingsSectionIcon"><Building2 size={22}/></div>
      <div><h2>Configuración general</h2><p>General de empresa, identidad fiscal y preferencias documentales globales.</p></div>
    </div>
    {loading?<div className="settingsInlineLoading">Cargando configuración…</div>:<>
      <div className="settingsFormGrid settingsFormGridWide">
        <label className="settingsField"><span>Razón social</span><input value={business.legalName} onChange={e=>updateBusiness('legalName',e.target.value)}/></label>
        <label className="settingsField"><span>Nombre comercial</span><input value={business.tradeName||''} onChange={e=>updateBusiness('tradeName',e.target.value)}/></label>
        <label className="settingsField"><span>CIF/VAT</span><input value={business.taxId||''} onChange={e=>updateBusiness('taxId',e.target.value)}/></label>
        <label className="settingsField"><span>Email</span><input type="email" value={business.email||''} onChange={e=>updateBusiness('email',e.target.value)}/></label>
        <label className="settingsField"><span>Teléfono</span><input value={business.phone||''} onChange={e=>updateBusiness('phone',e.target.value)}/></label>
        <label className="settingsField"><span>Web</span><input placeholder="https://…" value={business.website||''} onChange={e=>updateBusiness('website',e.target.value)}/></label>
        <label className="settingsField settingsFieldWide"><span>Dirección</span><input value={business.addressLine1||''} onChange={e=>updateBusiness('addressLine1',e.target.value)}/></label>
        <label className="settingsField"><span>Dirección 2</span><input value={business.addressLine2||''} onChange={e=>updateBusiness('addressLine2',e.target.value)}/></label>
        <label className="settingsField"><span>Código postal</span><input value={business.postalCode||''} onChange={e=>updateBusiness('postalCode',e.target.value)}/></label>
        <label className="settingsField"><span>Ciudad</span><input value={business.city||''} onChange={e=>updateBusiness('city',e.target.value)}/></label>
        <label className="settingsField"><span>Provincia</span><input value={business.province||''} onChange={e=>updateBusiness('province',e.target.value)}/></label>
        <label className="settingsField"><span>País</span><input maxLength={2} value={business.countryCode} onChange={e=>updateBusiness('countryCode',e.target.value.toUpperCase())}/></label>
        <label className="settingsField settingsFieldWide"><span>IBAN</span><input value={business.iban||''} onChange={e=>updateBusiness('iban',e.target.value)}/></label>
        <label className="settingsField settingsFieldWide"><span>Pie de factura</span><textarea rows={3} value={business.invoiceFooter||''} onChange={e=>updateBusiness('invoiceFooter',e.target.value)}/></label>
      </div>

      <div className="settingsSubsection">
        <h3>Documentos y aplicación</h3>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>Moneda</span><SelectField ariaLabel="Moneda" value={general.currencyCode} options={currencyOptions} onChange={value=>updateGeneral('currencyCode',value)}/></label>
          <label className="settingsField"><span>Zona horaria</span><input value={general.timezone} onChange={e=>updateGeneral('timezone',e.target.value)}/></label>
          <label className="settingsField"><span>Formato de fecha</span><SelectField ariaLabel="Formato de fecha" value={general.dateFormat} options={dateFormatOptions} onChange={value=>updateGeneral('dateFormat',value as typeof general.dateFormat)}/></label>
          <label className="settingsField"><span>Idioma</span><SelectField ariaLabel="Idioma" value={general.documentLanguage} options={languageOptions} onChange={value=>updateGeneral('documentLanguage',value as typeof general.documentLanguage)}/></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Logotipo</h3>
        <div className="settingsLogoRow">
          <div className="settingsLogoPreview">{branding?.logoDataUrl?<img src={branding.logoDataUrl} alt="Logotipo de empresa"/>:<span>Sin logotipo</span>}</div>
          <div className="settingsLogoActions">
            <label className="secondaryButton settingsFileButton">Cambiar logotipo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void changeLogo(e.target.files?.[0]||null)}/></label>
            {branding?.logoPath&&<button type="button" className="secondaryButton" disabled={saving} onClick={()=>void removeLogo()}>Eliminar logotipo</button>}
          </div>
        </div>
      </div>

      <div className="settingsSectionActions">
        <button type="button" className="primaryButton" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
      </div>
    </>}
  </section>;
}


function SalesSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<SalesSettings>(settings.sales);
  const [series,setSeries]=useState<ManagedSalesSeries[]>([]);
  const [taxRegistrations,setTaxRegistrations]=useState<TaxRegistration[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    setDraft(settings.sales);
    onDirtyChange(false);
  },[settings.sales,onDirtyChange]);

  useEffect(()=>{
    let active=true;
    setLoading(true);
    Promise.all([loadManagedSalesSeries(),loadTaxRegistrations()])
      .then(([nextSeries,nextTax])=>{if(active){setSeries(nextSeries);setTaxRegistrations(nextTax);}})
      .catch(e=>showError(e instanceof Error?e.message:'No se pudo cargar la configuración de facturación.'))
      .finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  const update=<K extends keyof SalesSettings>(key:K,value:SalesSettings[K])=>{
    setDraft(current=>({...current,[key]:value}));
    onDirtyChange(true);
  };

  const updateMethod=(index:number,patch:Partial<SalesSettings['paymentMethods'][number]>)=>{
    setDraft(current=>({...current,paymentMethods:current.paymentMethods.map((item,i)=>i===index?{...item,...patch}:item)}));
    onDirtyChange(true);
  };

  const addMethod=()=>{
    const id=`method_${Date.now()}`;
    setDraft(current=>({...current,paymentMethods:[...current.paymentMethods,{id,label:'Nuevo método',active:true}]}));
    onDirtyChange(true);
  };

  const removeMethod=(index:number)=>{
    setDraft(current=>{
      const next=current.paymentMethods.filter((_,i)=>i!==index);
      const active=next.find(item=>item.active);
      const defaultPaymentMethod=next.some(item=>item.id===current.defaultPaymentMethod&&item.active)
        ?current.defaultPaymentMethod
        :(active?.id||'');
      return {...current,paymentMethods:next,defaultPaymentMethod};
    });
    onDirtyChange(true);
  };

  const save=async()=>{
    const ids=new Set<string>();
    for(const method of draft.paymentMethods){
      const id=method.id.trim();
      const label=method.label.trim();
      if(!id||!label){showError('Todos los métodos de pago necesitan identificador y nombre.');return;}
      if(ids.has(id)){showError('Los identificadores de métodos de pago no pueden repetirse.');return;}
      ids.add(id);
    }
    if(draft.paymentMethods.length&&!draft.paymentMethods.some(item=>item.active)){showError('Debe existir al menos un método de pago activo.');return;}
    const activeDefault=draft.paymentMethods.find(item=>item.id===draft.defaultPaymentMethod&&item.active);
    if(draft.paymentMethods.length&&!activeDefault){showError('Selecciona un método de pago por defecto que esté activo.');return;}
    setSaving(true);
    try{
      await updateSection('sales',{...draft,paymentMethods:draft.paymentMethods.map(item=>({...item,id:item.id.trim(),label:item.label.trim()}))});
      onDirtyChange(false);
      showSuccess('Configuración de facturación guardada.');
    }catch(e){
      showError(e instanceof Error?e.message:'No se pudo guardar la configuración de facturación.');
    }finally{setSaving(false);}
  };

  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Facturación. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('sales');onDirtyChange(false);showSuccess('Valores predeterminados de Facturación restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };

  const activeMethods=draft.paymentMethods.filter(item=>item.active).map(item=>({value:item.id,label:item.label}));
  const seriesOptions=series.filter(item=>item.active&&item.kind==='standard').map(item=>({value:item.id,label:`${item.name} · ${item.prefix}`}));
  const taxOptions=taxRegistrations.filter(item=>item.active).map(item=>({value:item.id,label:`${item.label} · ${item.vatNumber}`}));

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero">
      <div className="settingsSectionIcon"><ReceiptText size={22}/></div>
      <div><h2>Configuración de facturación</h2><p>Defaults de nuevas facturas, cobros y presentación del PDF. Los cambios no reescriben facturas históricas.</p></div>
    </div>
    {loading?<div className="settingsInlineLoading">Cargando series y registros IVA…</div>:<>
      <div className="settingsSubsection">
        <h3>Nuevas facturas</h3>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>Vencimiento por defecto</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="365" value={draft.defaultDueDays} onChange={e=>update('defaultDueDays',Number(e.target.value))}/><em>días</em></div></label>
          <label className="settingsField"><span>IVA por defecto</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="100" step="0.01" value={draft.defaultVatRate} onChange={e=>update('defaultVatRate',Number(e.target.value))}/><em>%</em></div></label>
          <label className="settingsField"><span>Método de pago por defecto</span><SelectField ariaLabel="Método de pago por defecto" value={draft.defaultPaymentMethod} options={activeMethods} onChange={value=>update('defaultPaymentMethod',value)}/></label>
          <label className="settingsField"><span>Serie por defecto</span><SelectField ariaLabel="Serie por defecto" allowEmpty emptyLabel="Automática según el año" value={draft.defaultSeriesId||''} options={seriesOptions} onChange={value=>update('defaultSeriesId',value||null)}/></label>
          <label className="settingsField"><span>Registro IVA por defecto</span><SelectField ariaLabel="Registro IVA por defecto" allowEmpty emptyLabel="Usar registro marcado como predeterminado" value={draft.defaultTaxRegistrationId||''} options={taxOptions} onChange={value=>update('defaultTaxRegistrationId',value||null)}/></label>
          <label className="settingsField settingsFieldWide"><span>Notas por defecto</span><textarea rows={3} value={draft.defaultNotes} onChange={e=>update('defaultNotes',e.target.value)} placeholder="Solo se aplican a nuevas facturas"/></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <div className="settingsSubsectionHead"><div><h3>Métodos de pago disponibles</h3><p>Se reutilizan en facturas y cobros.</p></div><button type="button" className="secondaryButton" onClick={addMethod}><Plus size={15}/> Añadir método</button></div>
        <div className="settingsRepeater">
          {draft.paymentMethods.map((method,index)=><div className="settingsRepeaterRow" key={`${method.id}-${index}`}>
            <input aria-label="Identificador del método" value={method.id} onChange={e=>updateMethod(index,{id:e.target.value.replace(/\s+/g,'_').toLowerCase()})} placeholder="bank_transfer"/>
            <input aria-label="Nombre del método" value={method.label} onChange={e=>updateMethod(index,{label:e.target.value})} placeholder="Transferencia bancaria"/>
            <label className="settingsInlineCheck"><input type="checkbox" checked={method.active} onChange={e=>updateMethod(index,{active:e.target.checked})}/> Activo</label>
            <button type="button" className="iconBtn dangerIcon" aria-label="Eliminar método" onClick={()=>removeMethod(index)}><Trash2 size={15}/></button>
          </div>)}
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Contenido del PDF</h3>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" checked={draft.showIbanOnPdf} onChange={e=>update('showIbanOnPdf',e.target.checked)}/><span><strong>Mostrar IBAN</strong><small>Incluye la cuenta bancaria en el pie de factura.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.showFiscalDataOnPdf} onChange={e=>update('showFiscalDataOnPdf',e.target.checked)}/><span><strong>Mostrar datos fiscales</strong><small>Muestra NIF/CIF o VAT del emisor y cliente.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.showDueDateOnPdf} onChange={e=>update('showDueDateOnPdf',e.target.checked)}/><span><strong>Mostrar vencimiento</strong><small>Muestra la fecha límite de pago.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.showPaymentMethodOnPdf} onChange={e=>update('showPaymentMethodOnPdf',e.target.checked)}/><span><strong>Mostrar método de pago</strong><small>Muestra la forma de pago elegida.</small></span></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Cobros y edición</h3>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" checked={draft.allowPartialPayments} onChange={e=>update('allowPartialPayments',e.target.checked)}/><span><strong>Permitir cobros parciales</strong><small>Si se desactiva, solo se podrá registrar el importe pendiente completo.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.autoMarkPaid} onChange={e=>update('autoMarkPaid',e.target.checked)}/><span><strong>Marcar automáticamente como cobrada</strong><small>Al alcanzar el total cobrado, cambia el estado a Cobrada.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.allowEditIssuedInvoices} onChange={e=>update('allowEditIssuedInvoices',e.target.checked)}/><span><strong>Permitir editar facturas emitidas</strong><small>Solo se podrán reabrir emitidas sin envío ni cobros.</small></span></label>
        </div>
      </div>

      <div className="settingsSectionActions">
        <button type="button" className="secondaryButton" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button>
        <button type="button" className="primaryButton" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
      </div>
    </>}
  </section>;
}


function ClientsSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<ClientsSettings>(settings.clients);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{setDraft(settings.clients);onDirtyChange(false)},[settings.clients,onDirtyChange]);

  const update=<K extends keyof ClientsSettings>(key:K,value:ClientsSettings[K])=>{
    setDraft(current=>({...current,[key]:value}));
    onDirtyChange(true);
  };

  const toggleIdentity=(key:'tax_id'|'email'|'name',checked:boolean)=>{
    setDraft(current=>{
      const next=checked
        ? [...new Set([...current.duplicateIdentity,key])]
        : current.duplicateIdentity.filter(item=>item!==key);
      return {...current,duplicateIdentity:next};
    });
    onDirtyChange(true);
  };

  const save=async()=>{
    if(!draft.duplicateIdentity.length){showError('Selecciona al menos un criterio de identidad para detectar clientes duplicados.');return;}
    setSaving(true);
    try{await updateSection('clients',draft);onDirtyChange(false);showSuccess('Configuración de clientes guardada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo guardar la configuración de clientes.');}
    finally{setSaving(false);}
  };

  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Clientes. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('clients');onDirtyChange(false);showSuccess('Valores predeterminados de Clientes restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };

  const methodOptions=settings.sales.paymentMethods.filter(item=>item.active).map(item=>({value:item.id,label:item.label}));

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero">
      <div className="settingsSectionIcon"><Users size={22}/></div>
      <div><h2>Configuración de clientes</h2><p>Defaults comerciales, creación automática, enriquecimiento e identidad de clientes.</p></div>
    </div>

    <div className="settingsSubsection">
      <h3>Valores por defecto</h3>
      <div className="settingsFormGrid">
        <label className="settingsField"><span>País por defecto</span><input maxLength={2} value={draft.defaultCountryCode} onChange={e=>update('defaultCountryCode',e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2))}/></label>
        <label className="settingsField"><span>IVA por defecto</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="100" step="0.01" value={draft.defaultVatRate} onChange={e=>update('defaultVatRate',Number(e.target.value))}/><em>%</em></div></label>
        <label className="settingsField"><span>Días de pago por defecto</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="365" value={draft.defaultPaymentTermsDays} onChange={e=>update('defaultPaymentTermsDays',Number(e.target.value))}/><em>días</em></div></label>
        <label className="settingsField"><span>Método de pago por defecto</span><SelectField ariaLabel="Método de pago por defecto del cliente" value={draft.defaultPaymentMethod} options={methodOptions} onChange={value=>update('defaultPaymentMethod',value)}/></label>
      </div>
    </div>

    <div className="settingsSubsection">
      <h3>Creación y enriquecimiento</h3>
      <div className="settingsToggleGrid">
        <label className="settingsToggleField"><input type="checkbox" checked={draft.autoCreate} onChange={e=>update('autoCreate',e.target.checked)}/><span><strong>Crear clientes automáticamente</strong><small>Permite que el importador cree un cliente cuando no encuentre una coincidencia segura.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.fillTaxId} onChange={e=>update('fillTaxId',e.target.checked)}/><span><strong>Completar CIF/NIF</strong><small>Rellena el identificador fiscal detectado cuando corresponda.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.fillAddress} onChange={e=>update('fillAddress',e.target.checked)}/><span><strong>Completar dirección</strong><small>Rellena dirección, código postal, ciudad y provincia detectados.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.fillCountry} onChange={e=>update('fillCountry',e.target.checked)}/><span><strong>Completar país</strong><small>Actualiza el país cuando el PDF aporta un dato más fiable.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={!draft.overwriteReviewed} onChange={e=>update('overwriteReviewed',!e.target.checked)}/><span><strong>No sobrescribir datos revisados</strong><small>Solo completa huecos y conserva los datos que ya existen en el cliente.</small></span></label>
      </div>
    </div>

    <div className="settingsSubsection">
      <h3>Criterios de identidad</h3>
      <p className="settingsHelpText">El importador utilizará estos campos para decidir si un cliente detectado ya existe.</p>
      <div className="settingsToggleGrid">
        <label className="settingsToggleField"><input type="checkbox" checked={draft.duplicateIdentity.includes('tax_id')} onChange={e=>toggleIdentity('tax_id',e.target.checked)}/><span><strong>CIF/NIF/VAT</strong><small>Coincidencia fiscal exacta normalizada.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.duplicateIdentity.includes('email')} onChange={e=>toggleIdentity('email',e.target.checked)}/><span><strong>Email</strong><small>Coincidencia exacta de correo electrónico.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.duplicateIdentity.includes('name')} onChange={e=>toggleIdentity('name',e.target.checked)}/><span><strong>Nombre</strong><small>Coincidencia exacta tras normalizar razón social.</small></span></label>
      </div>
    </div>

    <div className="settingsSectionActions">
      <button type="button" className="secondaryButton" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button>
      <button type="button" className="primaryButton" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
    </div>
  </section>;
}

const themeOptions=[
  {value:'system',label:'Sistema'},
  {value:'light',label:'Claro'},
  {value:'dark',label:'Oscuro'},
];

const densityOptions=[
  {value:'comfortable',label:'Cómoda'},
  {value:'compact',label:'Compacta'},
];

const pageSizeOptions=[10,20,25,50,100].map(value=>({value:String(value),label:String(value)}));

const startPageOptions=[
  {value:'',label:'Usar valor de empresa'},
  {value:'dashboard',label:'Resumen'},
  {value:'sales',label:'Facturación'},
  {value:'orders',label:'Pedidos'},
  {value:'invoices',label:'Gastos'},
  {value:'clients',label:'Clientes'},
  {value:'products',label:'Productos'},
  {value:'suppliers',label:'Proveedores'},
  {value:'amazon',label:'Amazon'},
  {value:'settings',label:'Configuración'},
];

const periodOptions=[
  {value:'today',label:'Hoy'},
  {value:'current_month',label:'Mes actual'},
  {value:'current_quarter',label:'Trimestre actual'},
  {value:'current_year',label:'Año actual'},
  {value:'all',label:'Todo'},
];

function PreferencesSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {preferences,updatePreferences}=useSettings();
  const [draft,setDraft]=useState<UserPreferences>(preferences);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{setDraft(preferences);onDirtyChange(false)},[preferences,onDirtyChange]);

  const update=<K extends keyof UserPreferences>(key:K,value:UserPreferences[K])=>{
    setDraft(current=>({...current,[key]:value}));
    onDirtyChange(true);
  };

  const save=async()=>{
    setSaving(true);
    try{
      await updatePreferences(draft);
      onDirtyChange(false);
      showSuccess('Preferencias guardadas.');
    }catch(e){
      showError(e instanceof Error?e.message:'No se pudieron guardar las preferencias.');
    }finally{
      setSaving(false);
    }
  };

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero">
      <div className="settingsSectionIcon"><UserRound size={22}/></div>
      <div><h2>Preferencias de interfaz</h2><p>Estos ajustes son exclusivos de tu usuario y no afectan al resto del equipo.</p></div>
    </div>

    <div className="settingsFormGrid">
      <label className="settingsField"><span>Tema</span><SelectField ariaLabel="Tema" value={draft.theme} options={themeOptions} onChange={value=>update('theme',value as UserPreferences['theme'])}/></label>
      <label className="settingsField"><span>Densidad</span><SelectField ariaLabel="Densidad" value={draft.density} options={densityOptions} onChange={value=>update('density',value as UserPreferences['density'])}/></label>
      <label className="settingsField"><span>Registros por página</span><SelectField ariaLabel="Registros por página" value={String(draft.pageSize)} options={pageSizeOptions} onChange={value=>update('pageSize',Number(value) as UserPreferences['pageSize'])}/></label>
      <label className="settingsField"><span>Página inicial</span><SelectField ariaLabel="Página inicial" value={draft.startPage||''} options={startPageOptions} onChange={value=>update('startPage',value||null)}/></label>
      <label className="settingsField"><span>Periodo inicial</span><SelectField ariaLabel="Periodo inicial" value={draft.defaultPeriod} options={periodOptions} onChange={value=>update('defaultPeriod',value as UserPreferences['defaultPeriod'])}/></label>
      <label className="settingsToggleField"><input type="checkbox" checked={draft.rememberFilters} onChange={event=>update('rememberFilters',event.target.checked)}/><span><strong>Recordar filtros</strong><small>Conserva los últimos filtros de cada pantalla cuando vuelvas a entrar.</small></span></label>
    </div>

    <div className="settingsSectionActions">
      <button type="button" className="secondaryButton" disabled={saving} onClick={()=>{setDraft(preferences);onDirtyChange(false)}}>Descartar cambios</button>
      <button type="button" className="primaryButton" disabled={saving} onClick={save}>{saving?'Guardando…':'Guardar preferencias'}</button>
    </div>
  </section>;
}

export function SettingsPage({isAdmin}:{isAdmin:boolean}){
  const {warnings,error,loading}=useSettings();
  const visibleSections=useMemo(()=>sections.filter(section=>!section.adminOnly||isAdmin),[isAdmin]);
  const [activeSection,setActiveSection]=useState<SettingsSectionId>(isAdmin?'general':'preferences');
  const [dirty,setDirty]=useState(false);

  useEffect(()=>{
    if(!visibleSections.some(section=>section.id===activeSection)){
      setActiveSection('preferences');
      setDirty(false);
    }
  },[activeSection,visibleSections]);

  useEffect(()=>{
    window.dispatchEvent(new CustomEvent('zenvia:settings-dirty',{detail:{dirty}}));
    return()=>{window.dispatchEvent(new CustomEvent('zenvia:settings-dirty',{detail:{dirty:false}}));};
  },[dirty]);

  useEffect(()=>{
    if(!dirty)return;
    const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',beforeUnload);
    return()=>window.removeEventListener('beforeunload',beforeUnload);
  },[dirty]);

  const requestSection=(next:SettingsSectionId)=>{
    if(next===activeSection)return;
    if(dirty&&!window.confirm('Tienes cambios sin guardar. ¿Quieres salir de esta sección y descartarlos?'))return;
    setDirty(false);
    setActiveSection(next);
  };

  const active=visibleSections.find(section=>section.id===activeSection)||visibleSections[0];

  return <div className="page settingsPage">
    <header className="pageHead settingsPageHead">
      <div><div className="eyebrow">SISTEMA</div><h1>Configuración</h1><p>{isAdmin?'Gestiona el comportamiento global de ZENVIA Gestión y tus preferencias personales.':'Personaliza cómo quieres utilizar ZENVIA Gestión.'}</p></div>
      {loading&&<div className="settingsLoading"><Settings2 size={15}/> Actualizando configuración…</div>}
    </header>

    {(error||warnings.length>0)&&<div className="settingsWarning" role="status">
      <BellRing size={18}/>
      <div><strong>{error?'Configuración temporal':'Revisión de configuración'}</strong><span>{error||`${warnings.length} ajuste${warnings.length===1?'':'s'} ha${warnings.length===1?'':'n'} usado un valor seguro por defecto.`}</span></div>
    </div>}

    <div className="settingsLayout">
      <nav className="settingsNav" aria-label="Secciones de configuración">
        {visibleSections.map(section=>{
          const Icon=section.icon;
          return <button key={section.id} type="button" className={activeSection===section.id?'active':''} onClick={()=>requestSection(section.id)}>
            <Icon size={18}/><span><strong>{section.label}</strong><small>{section.description}</small></span>
          </button>;
        })}
      </nav>
      <div className="settingsContent" onChangeCapture={()=>setDirty(true)}>
        {active&&active.id==='preferences'?<PreferencesSection onDirtyChange={setDirty}/>:active&&active.id==='general'?<GeneralSection onDirtyChange={setDirty}/>:active&&active.id==='sales'?<SalesSection onDirtyChange={setDirty}/>:active&&active.id==='clients'?<ClientsSection onDirtyChange={setDirty}/>:active&&<SectionPlaceholder section={active}/>} 
      </div>
    </div>
  </div>;
}
