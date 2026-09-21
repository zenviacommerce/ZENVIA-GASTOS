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
import { SearchableSelect } from '../components/forms/SearchableSelect';
import { showError, showSuccess } from '../services/toast';
import type { ClientsSettings, ExpensesSettings, ProductsSettings, SalesSettings, SuppliersSettings, UserPreferences } from '../services/settingsSchema';
import { loadBusinessSettings, saveBusinessSettings, type BusinessSettings } from '../services/sales';
import { loadCompanyBranding, removeCompanyLogo, uploadCompanyLogo, type CompanyBranding } from '../services/companyBranding';
import { loadManagedSalesSeries, loadTaxRegistrations, type ManagedSalesSeries, type TaxRegistration } from '../services/salesConfig';
import { loadExpenseCategories } from '../services/expenseCategories';
import type { ExpenseCategory } from '../types';
import { addEntityAlias, deleteEntityAlias, loadEntityAliases, updateEntityAlias, type EntityAliasRule } from '../services/entityAliases';
import { loadSupplierOptions, type SupplierOption } from '../services/supplierEditor';

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



function ExpensesSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<ExpensesSettings>(settings.expenses);
  const [categories,setCategories]=useState<ExpenseCategory[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{setDraft(settings.expenses);onDirtyChange(false)},[settings.expenses,onDirtyChange]);
  useEffect(()=>{
    let active=true;
    setLoading(true);
    loadExpenseCategories()
      .then(rows=>{if(active)setCategories(rows)})
      .catch(e=>showError(e instanceof Error?e.message:'No se pudieron cargar las categorías de gasto.'))
      .finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  const update=<K extends keyof ExpensesSettings>(key:K,value:ExpensesSettings[K])=>{
    setDraft(current=>({...current,[key]:value}));
    onDirtyChange(true);
  };
  const toggleRequired=(field:string,checked:boolean)=>{
    setDraft(current=>({...current,requiredReviewFields:checked
      ?[...new Set([...current.requiredReviewFields,field])]
      :current.requiredReviewFields.filter(item=>item!==field)}));
    onDirtyChange(true);
  };

  const save=async()=>{
    setSaving(true);
    try{await updateSection('expenses',draft);onDirtyChange(false);showSuccess('Configuración de gastos e importación guardada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo guardar la configuración de gastos.');}
    finally{setSaving(false);}
  };

  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Gastos e importación. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('expenses');onDirtyChange(false);showSuccess('Valores predeterminados de Gastos restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };

  const statusOptions=[
    {value:'pending',label:'Pendiente'},
    {value:'reviewed',label:'Revisada'},
    {value:'accounted',label:'Contabilizada'},
  ];
  const supplierTypeOptions=[
    {value:'goods',label:'Mercancía'},
    {value:'service',label:'Servicios'},
    {value:'both',label:'Mercancía y servicios'},
  ];

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero">
      <div className="settingsSectionIcon"><FileInput size={22}/></div>
      <div><h2>Gastos e importación</h2><p>Controla cómo se interpretan, validan y guardan las facturas recibidas.</p></div>
    </div>
    {loading?<div className="settingsInlineLoading">Cargando categorías…</div>:<>
      <div className="settingsSubsection">
        <h3>Alta y clasificación</h3>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>Estado inicial</span><SelectField ariaLabel="Estado inicial del gasto" value={draft.initialStatus} options={statusOptions} onChange={value=>update('initialStatus',value as ExpensesSettings['initialStatus'])}/></label>
          <label className="settingsField"><span>Categoría por defecto</span><SelectField ariaLabel="Categoría por defecto" allowEmpty emptyLabel="Sin categoría automática" value={draft.defaultCategoryId||''} options={categories.map(item=>({value:item.id,label:item.name}))} onChange={value=>update('defaultCategoryId',value||null)}/></label>
          <label className="settingsField"><span>Tipo de proveedor por defecto</span><SelectField ariaLabel="Tipo de proveedor por defecto" allowEmpty emptyLabel="Sin clasificar" value={draft.defaultSupplierType||''} options={supplierTypeOptions} onChange={value=>update('defaultSupplierType',(value||null) as ExpensesSettings['defaultSupplierType'])}/></label>
          <label className="settingsField"><span>Umbral de confianza</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="100" step="1" value={Math.round(draft.confidenceThreshold*100)} onChange={e=>update('confidenceThreshold',Math.min(1,Math.max(0,Number(e.target.value)/100)))}/><em>%</em></div></label>
        </div>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" checked={draft.autoCreateSuppliers} onChange={e=>update('autoCreateSuppliers',e.target.checked)}/><span><strong>Crear proveedores automáticamente</strong><small>Solo cuando no exista coincidencia fiscal, alias o identidad segura.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.autoCreateProducts} onChange={e=>update('autoCreateProducts',e.target.checked)}/><span><strong>Crear productos automáticamente</strong><small>Crea productos desde líneas válidas cuando el flujo lo permita.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.fillMissingSupplierData} onChange={e=>update('fillMissingSupplierData',e.target.checked)}/><span><strong>Completar datos vacíos del proveedor</strong><small>Añade datos fiscales y de contacto sin pisar información existente.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.updateProductCosts} onChange={e=>update('updateProductCosts',e.target.checked)}/><span><strong>Actualizar costes automáticamente</strong><small>Actualiza el coste efectivo con compras confirmadas.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.createSupplierProductRelation} onChange={e=>update('createSupplierProductRelation',e.target.checked)}/><span><strong>Crear relación producto-proveedor</strong><small>Vincula las descripciones del proveedor con el producto interno.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.updatePriceHistory} onChange={e=>update('updatePriceHistory',e.target.checked)}/><span><strong>Actualizar histórico de precios</strong><small>Guarda el precio confirmado en el historial de compra.</small></span></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Duplicados y revisión</h3>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" checked={draft.detectDuplicates} onChange={e=>update('detectDuplicates',e.target.checked)}/><span><strong>Detectar duplicados</strong><small>Comprueba hash, proveedor y número de factura.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.blockHighConfidenceDuplicates} onChange={e=>update('blockHighConfidenceDuplicates',e.target.checked)}/><span><strong>Bloquear duplicados seguros</strong><small>Impide guardar cuando la coincidencia es inequívoca.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.warnAmbiguousMatches} onChange={e=>update('warnAmbiguousMatches',e.target.checked)}/><span><strong>Avisar coincidencias dudosas</strong><small>Obliga a revisión cuando la identidad no es concluyente.</small></span></label>
        </div>
        <div className="settingsFieldGroup">
          <strong>Campos que obligan a revisión</strong>
          <div className="settingsInlineChecks">
            {[['invoiceNumber','Número'],['issueDate','Fecha'],['supplier','Proveedor'],['total','Total']].map(([key,label])=>
              <label key={key}><input type="checkbox" checked={draft.requiredReviewFields.includes(key)} onChange={e=>toggleRequired(key,e.target.checked)}/>{label}</label>
            )}
          </div>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Gmail y reprocesado</h3>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>Tamaño máximo de adjunto</span><div className="settingsNumberWithSuffix"><input type="number" min="1" max="100" value={draft.maxAttachmentMb} onChange={e=>update('maxAttachmentMb',Number(e.target.value))}/><em>MB</em></div></label>
        </div>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" checked={draft.gmailPdfOnly} onChange={e=>update('gmailPdfOnly',e.target.checked)}/><span><strong>Importar solo PDF desde Gmail</strong><small>Ignora otros adjuntos en la bandeja automática.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.allowReimportDeleted} onChange={e=>update('allowReimportDeleted',e.target.checked)}/><span><strong>Reprocesar facturas eliminadas</strong><small>Permite volver a importar un adjunto cuyo gasto fue eliminado.</small></span></label>
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



function ProductsSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<ProductsSettings>(settings.products);
  const [suppliers,setSuppliers]=useState<SupplierOption[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{setDraft(settings.products);onDirtyChange(false)},[settings.products,onDirtyChange]);
  useEffect(()=>{
    let active=true;
    setLoading(true);
    loadSupplierOptions()
      .then(rows=>{if(active)setSuppliers(rows)})
      .catch(e=>showError(e instanceof Error?e.message:'No se pudieron cargar los proveedores para Productos.'))
      .finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  const update=<K extends keyof ProductsSettings>(key:K,value:ProductsSettings[K])=>{
    setDraft(current=>({...current,[key]:value}));
    onDirtyChange(true);
  };

  const save=async()=>{
    setSaving(true);
    try{await updateSection('products',draft);onDirtyChange(false);showSuccess('Configuración de productos guardada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo guardar la configuración de productos.');}
    finally{setSaving(false);}
  };

  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Productos. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('products');onDirtyChange(false);showSuccess('Valores predeterminados de Productos restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };

  const supplierOptions=suppliers.map(item=>({value:item.id,label:item.name,description:item.taxId||undefined,searchText:[item.name,item.taxId].filter(Boolean).join(' ')}));
  const costMethodOptions=[
    {value:'last_purchase',label:'Última compra'},
    {value:'average',label:'Promedio de compras'},
    {value:'manual',label:'Manual · no actualizar desde facturas'},
  ];
  const roundingOptions=[0.01,0.05,0.1,0.5,1].map(value=>({value:String(value),label:value.toLocaleString('es-ES',{maximumFractionDigits:2})+' €'}));

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero">
      <div className="settingsSectionIcon"><Box size={22}/></div>
      <div><h2>Configuración de productos</h2><p>Defaults comerciales, creación desde compras, estrategia de coste, márgenes y alertas.</p></div>
    </div>
    {loading?<div className="settingsInlineLoading">Cargando proveedores…</div>:<>
      <div className="settingsSubsection">
        <h3>Nuevos productos</h3>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>IVA por defecto</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="100" step="0.01" value={draft.defaultVatRate} onChange={e=>update('defaultVatRate',Number(e.target.value))}/><em>%</em></div></label>
          <label className="settingsField"><span>Unidad por defecto</span><input value={draft.defaultUnit} onChange={e=>update('defaultUnit',e.target.value)} placeholder="ud"/></label>
          <label className="settingsField"><span>Proveedor por defecto</span><SearchableSelect value={draft.defaultSupplierId||''} options={supplierOptions} onChange={value=>update('defaultSupplierId',value||null)} allowEmpty emptyLabel="Sin proveedor" placeholder="Sin proveedor" searchPlaceholder="Buscar proveedor…" ariaLabel="Proveedor por defecto del producto"/></label>
          <label className="settingsField"><span>Categoría por defecto</span><input value={draft.defaultCategoryId||''} onChange={e=>update('defaultCategoryId',e.target.value.trim()?e.target.value:null)} placeholder="Ej. Film, bolsas, vasos…"/></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Costes e importaciones</h3>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>Método de coste</span><SelectField ariaLabel="Método de coste" value={draft.costMethod} options={costMethodOptions} onChange={value=>update('costMethod',value as ProductsSettings['costMethod'])}/></label>
          <label className="settingsField"><span>Decimales de coste</span><input type="number" min="0" max="6" value={draft.costDecimals} onChange={e=>update('costDecimals',Number(e.target.value))}/></label>
        </div>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" checked={draft.updateCostFromImports} onChange={e=>update('updateCostFromImports',e.target.checked)}/><span><strong>Actualizar coste desde importaciones</strong><small>Permite que las compras modifiquen el coste según el método elegido.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.autoCreateFromInvoice} onChange={e=>update('autoCreateFromInvoice',e.target.checked)}/><span><strong>Crear productos desde facturas</strong><small>Permite crear productos nuevos a partir de líneas de compras de mercancía.</small></span></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Precio y margen</h3>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>Margen objetivo</span><div className="settingsNumberWithSuffix"><input type="number" min="-100" max="1000" step="0.1" value={draft.targetMarginPct} onChange={e=>update('targetMarginPct',Number(e.target.value))}/><em>%</em></div></label>
          <label className="settingsField"><span>Margen mínimo</span><div className="settingsNumberWithSuffix"><input type="number" min="-100" max="1000" step="0.1" value={draft.minimumMarginPct} onChange={e=>update('minimumMarginPct',Number(e.target.value))}/><em>%</em></div></label>
          <label className="settingsField"><span>Alerta de margen</span><div className="settingsNumberWithSuffix"><input type="number" min="-100" max="1000" step="0.1" value={draft.marginAlertPct} onChange={e=>update('marginAlertPct',Number(e.target.value))}/><em>%</em></div></label>
          <label className="settingsField"><span>Alerta de subida de coste</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="1000" step="0.1" value={draft.costIncreaseAlertPct} onChange={e=>update('costIncreaseAlertPct',Number(e.target.value))}/><em>%</em></div></label>
          <label className="settingsField"><span>Redondeo de precio</span><SelectField ariaLabel="Redondeo de precio" value={String(draft.priceRounding)} options={roundingOptions} onChange={value=>update('priceRounding',Number(value))}/></label>
        </div>
      </div>

      <div className="settingsSectionActions">
        <button type="button" className="secondaryButton" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button>
        <button type="button" className="primaryButton" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
      </div>
    </>}
  </section>;
}

function SuppliersSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<SuppliersSettings>(settings.suppliers);
  const [categories,setCategories]=useState<ExpenseCategory[]>([]);
  const [suppliers,setSuppliers]=useState<SupplierOption[]>([]);
  const [aliases,setAliases]=useState<EntityAliasRule[]>([]);
  const [newAlias,setNewAlias]=useState({alias:'',targetEntityId:'',priority:100,active:true});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [aliasBusy,setAliasBusy]=useState<string|null>(null);

  useEffect(()=>{setDraft(settings.suppliers);onDirtyChange(false)},[settings.suppliers,onDirtyChange]);

  const reloadAliases=async()=>setAliases(await loadEntityAliases('supplier'));

  useEffect(()=>{
    let active=true;
    setLoading(true);
    Promise.all([loadExpenseCategories(),loadSupplierOptions(),loadEntityAliases('supplier')])
      .then(([nextCategories,nextSuppliers,nextAliases])=>{
        if(!active)return;
        setCategories(nextCategories);
        setSuppliers(nextSuppliers);
        setAliases(nextAliases);
      })
      .catch(e=>showError(e instanceof Error?e.message:'No se pudo cargar la configuración de proveedores.'))
      .finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  const update=<K extends keyof SuppliersSettings>(key:K,value:SuppliersSettings[K])=>{
    setDraft(current=>({...current,[key]:value}));
    onDirtyChange(true);
  };

  const save=async()=>{
    setSaving(true);
    try{await updateSection('suppliers',draft);onDirtyChange(false);showSuccess('Configuración de proveedores guardada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo guardar la configuración de proveedores.');}
    finally{setSaving(false);}
  };

  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Proveedores. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('suppliers');onDirtyChange(false);showSuccess('Valores predeterminados de Proveedores restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };

  const addAlias=async()=>{
    if(!newAlias.alias.trim()||!newAlias.targetEntityId){showError('Indica el alias y el proveedor de destino.');return;}
    setAliasBusy('new');
    try{
      await addEntityAlias({entityType:'supplier',alias:newAlias.alias,targetEntityId:newAlias.targetEntityId,priority:newAlias.priority,active:newAlias.active});
      await reloadAliases();
      setNewAlias({alias:'',targetEntityId:'',priority:100,active:true});
      showSuccess('Alias añadido.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudo añadir el alias.');}
    finally{setAliasBusy(null);}
  };

  const patchAlias=(id:string,patch:Partial<EntityAliasRule>)=>{
    setAliases(current=>current.map(item=>item.id===id?{...item,...patch}:item));
  };

  const saveAlias=async(alias:EntityAliasRule)=>{
    if(!alias.alias.trim()||!alias.targetEntityId){showError('El alias necesita texto y proveedor de destino.');return;}
    setAliasBusy(alias.id);
    try{
      await updateEntityAlias(alias.id,{entityType:'supplier',alias:alias.alias,targetEntityId:alias.targetEntityId,priority:alias.priority,active:alias.active});
      await reloadAliases();
      showSuccess('Alias actualizado.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudo actualizar el alias.');}
    finally{setAliasBusy(null);}
  };

  const removeAlias=async(alias:EntityAliasRule)=>{
    if(!window.confirm(`¿Eliminar el alias “${alias.alias}”?`))return;
    setAliasBusy(alias.id);
    try{await deleteEntityAlias(alias.id);await reloadAliases();showSuccess('Alias eliminado.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo eliminar el alias.');}
    finally{setAliasBusy(null);}
  };

  const supplierOptions=suppliers.map(item=>({value:item.id,label:item.name,description:item.taxId||undefined,searchText:[item.name,item.taxId].filter(Boolean).join(' ')}));
  const typeOptions=[
    {value:'goods',label:'Mercancía'},
    {value:'service',label:'Servicios'},
    {value:'both',label:'Mercancía y servicios'},
  ];

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero">
      <div className="settingsSectionIcon"><Building2 size={22}/></div>
      <div><h2>Configuración de proveedores</h2><p>Defaults, enriquecimiento, detección de identidad y alias explícitos del proveedor.</p></div>
    </div>
    {loading?<div className="settingsInlineLoading">Cargando proveedores y alias…</div>:<>
      <div className="settingsSubsection">
        <h3>Valores por defecto</h3>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>Tipo por defecto</span><SelectField ariaLabel="Tipo por defecto del proveedor" allowEmpty emptyLabel="Sin clasificar" value={draft.defaultType||''} options={typeOptions} onChange={value=>update('defaultType',(value||null) as SuppliersSettings['defaultType'])}/></label>
          <label className="settingsField"><span>Categoría por defecto</span><SelectField ariaLabel="Categoría por defecto del proveedor" allowEmpty emptyLabel="Sin categoría" value={draft.defaultCategoryId||''} options={categories.map(item=>({value:item.id,label:item.name}))} onChange={value=>update('defaultCategoryId',value||null)}/></label>
          <label className="settingsField"><span>Umbral de identidad</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="200" value={draft.identityThreshold} onChange={e=>update('identityThreshold',Number(e.target.value))}/><em>pts</em></div></label>
        </div>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" checked={draft.autoCreate} onChange={e=>update('autoCreate',e.target.checked)}/><span><strong>Crear proveedores automáticamente</strong><small>Permite crear el proveedor si alias e identidad no encuentran coincidencia.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.detectDuplicates} onChange={e=>update('detectDuplicates',e.target.checked)}/><span><strong>Detectar proveedores duplicados</strong><small>Activa coincidencias fiscales, exactas y heurísticas además de los alias explícitos.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.onlyFillEmpty} onChange={e=>update('onlyFillEmpty',e.target.checked)}/><span><strong>Solo completar campos vacíos</strong><small>Evita sustituir información ya revisada del proveedor.</small></span></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Enriquecimiento automático</h3>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" checked={draft.enrichTaxId} onChange={e=>update('enrichTaxId',e.target.checked)}/><span><strong>Enriquecer CIF/NIF</strong><small>Completa el identificador fiscal cuando la identidad es segura.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.enrichEmail} onChange={e=>update('enrichEmail',e.target.checked)}/><span><strong>Enriquecer email</strong><small>Completa el correo detectado en la factura.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.enrichPhone} onChange={e=>update('enrichPhone',e.target.checked)}/><span><strong>Enriquecer teléfono</strong><small>Completa el teléfono detectado en la factura.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.enrichWebsite} onChange={e=>update('enrichWebsite',e.target.checked)}/><span><strong>Enriquecer web</strong><small>Completa la web detectada en la factura.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.enrichAddress} onChange={e=>update('enrichAddress',e.target.checked)}/><span><strong>Enriquecer dirección</strong><small>Completa la dirección postal detectada.</small></span></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <div className="settingsSubsectionHead"><div><h3>Alias explícitos</h3><p>Tienen prioridad sobre cualquier heurística. Úsalos cuando una factura imprime un nombre comercial o abreviado distinto al proveedor real.</p></div></div>
        <div className="settingsAliasCreate">
          <input value={newAlias.alias} onChange={e=>setNewAlias(current=>({...current,alias:e.target.value}))} placeholder="Ej. Compost & Paper"/>
          <SearchableSelect value={newAlias.targetEntityId} options={supplierOptions} onChange={value=>setNewAlias(current=>({...current,targetEntityId:value}))} placeholder="Proveedor de destino" searchPlaceholder="Buscar proveedor…" ariaLabel="Proveedor de destino del alias"/>
          <input type="number" min="0" max="10000" value={newAlias.priority} onChange={e=>setNewAlias(current=>({...current,priority:Number(e.target.value)}))} aria-label="Prioridad del alias"/>
          <label className="settingsInlineCheck"><input type="checkbox" checked={newAlias.active} onChange={e=>setNewAlias(current=>({...current,active:e.target.checked}))}/> Activo</label>
          <button type="button" className="secondaryButton" disabled={aliasBusy==='new'} onClick={()=>void addAlias()}><Plus size={15}/> Añadir alias</button>
        </div>
        <div className="settingsAliasList">
          {aliases.length===0?<div className="settingsEmptyMini">Todavía no hay alias explícitos.</div>:aliases.map(alias=><div className="settingsAliasRow" key={alias.id}>
            <input value={alias.alias} onChange={e=>patchAlias(alias.id,{alias:e.target.value})} aria-label="Alias del proveedor"/>
            <SearchableSelect value={alias.targetEntityId} options={supplierOptions} onChange={value=>patchAlias(alias.id,{targetEntityId:value})} searchPlaceholder="Buscar proveedor…" ariaLabel="Proveedor asociado al alias"/>
            <input type="number" min="0" max="10000" value={alias.priority} onChange={e=>patchAlias(alias.id,{priority:Number(e.target.value)})} aria-label="Prioridad"/>
            <label className="settingsInlineCheck"><input type="checkbox" checked={alias.active} onChange={e=>patchAlias(alias.id,{active:e.target.checked})}/> Activo</label>
            <button type="button" className="secondaryButton" disabled={aliasBusy===alias.id} onClick={()=>void saveAlias(alias)}>Guardar</button>
            <button type="button" className="iconBtn dangerIcon" disabled={aliasBusy===alias.id} aria-label="Eliminar alias" onClick={()=>void removeAlias(alias)}><Trash2 size={15}/></button>
          </div>)}
        </div>
      </div>

      <div className="settingsSectionActions">
        <button type="button" className="secondaryButton" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button>
        <button type="button" className="primaryButton" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
      </div>
    </>}
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
        {active&&active.id==='preferences'?<PreferencesSection onDirtyChange={setDirty}/>:active&&active.id==='general'?<GeneralSection onDirtyChange={setDirty}/>:active&&active.id==='sales'?<SalesSection onDirtyChange={setDirty}/>:active&&active.id==='expenses'?<ExpensesSection onDirtyChange={setDirty}/>:active&&active.id==='products'?<ProductsSection onDirtyChange={setDirty}/>:active&&active.id==='clients'?<ClientsSection onDirtyChange={setDirty}/>:active&&active.id==='suppliers'?<SuppliersSection onDirtyChange={setDirty}/>:active&&<SectionPlaceholder section={active}/>} 
      </div>
    </div>
  </div>;
}
