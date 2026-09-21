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
import { DEFAULT_APP_SETTINGS, type AmazonSettings, type ClientsSettings, type ExpensesSettings, type IntegrationsSettings, type MaintenanceSettings, type NotificationsSettings, type NotificationSetting, type OrdersSettings, type ProductsSettings, type SalesSettings, type ShippingSettings, type SuppliersSettings, type UserPreferences } from '../services/settingsSchema';
import { loadBusinessSettings, saveBusinessSettings, type BusinessSettings } from '../services/sales';
import { loadCompanyBranding, removeCompanyLogo, uploadCompanyLogo, type CompanyBranding } from '../services/companyBranding';
import { loadManagedSalesSeries, loadTaxRegistrations, type ManagedSalesSeries, type TaxRegistration } from '../services/salesConfig';
import { loadExpenseCategories } from '../services/expenseCategories';
import type { ExpenseCategory } from '../types';
import { addEntityAlias, deleteEntityAlias, loadEntityAliases, updateEntityAlias, type EntityAliasRule } from '../services/entityAliases';
import { loadSupplierOptions, type SupplierOption } from '../services/supplierEditor';
import { addShippingRule, deleteShippingRule, loadShippingRules, updateShippingRule, type ShippingRule } from '../services/shippingRules';
import { AMAZON_KPI_KEYS, loadAmazonStatus, type AmazonMarketplaceStatus } from '../services/amazon';
import { loadIntegrationHealth, syncIntegration, testIntegrationConnection, type IntegrationHealth, type IntegrationId } from '../services/integrations';
import { DEFAULT_AUTOMATION_RULES, loadAutomationRules, saveAutomationRule, type AutomationRule } from '../services/automationRules';
import { applyExpenseInvoiceReprocess, findClientDuplicates, findInvoiceDuplicates, findProductDuplicates, findSupplierDuplicates, listClientsMissingTaxId, listProductsWithoutCost, listReprocessableInvoices, listSuppliersMissingTaxId, mergeClient, mergeSupplier, previewClientMerge, previewExpenseInvoiceReprocess, previewPriceHistoryRebuild, previewProductCostRecalculation, previewSupplierMerge, previewSupplierProductRebuild, rebuildPriceHistoryLinks, rebuildSupplierProductLinks, recalculateProductCosts, runAmazonSync, runSendcloudSync, type DuplicateCandidate, type ExpenseInvoiceReprocessPreview, type MaintenanceRepairPreview, type MergePreview, type ReprocessableInvoiceOption } from '../services/maintenance';
import { downloadSettingsExport, previewSettingsReset, resetAllSettingsToDefaults, type SettingsResetPreview } from '../services/settingsExport';
import { DASHBOARD_KPI_DEFAULTS, TABLE_COLUMN_DEFAULTS, type PreferenceTableKey } from '../services/uiPreferences';

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
            <label className="secondary settingsFileButton">Cambiar logotipo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void changeLogo(e.target.files?.[0]||null)}/></label>
            {branding?.logoPath&&<button type="button" className="secondary" disabled={saving} onClick={()=>void removeLogo()}>Eliminar logotipo</button>}
          </div>
        </div>
      </div>

      <div className="settingsSectionActions">
        <button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
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
        <div className="settingsSubsectionHead"><div><h3>Métodos de pago disponibles</h3><p>Se reutilizan en facturas y cobros.</p></div><button type="button" className="secondary" onClick={addMethod}><Plus size={15}/> Añadir método</button></div>
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
        <button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button>
        <button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
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
        <button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button>
        <button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
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
      <button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button>
      <button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
    </div>
  </section>;
}




function OrdersSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<OrdersSettings>(settings.orders);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{setDraft(settings.orders);onDirtyChange(false)},[settings.orders,onDirtyChange]);
  const update=<K extends keyof OrdersSettings>(key:K,value:OrdersSettings[K])=>{setDraft(current=>({...current,[key]:value}));onDirtyChange(true)};

  const save=async()=>{
    setSaving(true);
    try{await updateSection('orders',draft);onDirtyChange(false);showSuccess('Configuración de pedidos guardada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo guardar la configuración de pedidos.');}
    finally{setSaving(false);}
  };
  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Pedidos. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('orders');onDirtyChange(false);showSuccess('Valores predeterminados de Pedidos restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };

  const filenameOptions=[
    {value:'order_number',label:'Número de pedido'},
    {value:'sku',label:'SKU del primer producto'},
    {value:'product',label:'Nombre del primer producto'},
    {value:'customer_order',label:'Cliente + pedido'},
    {value:'custom',label:'Plantilla personalizada'},
  ];

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero"><div className="settingsSectionIcon"><ShoppingBag size={22}/></div><div><h2>Configuración de pedidos</h2><p>Defaults, refresco, etiquetas y confirmación de tracking de los pedidos.</p></div></div>
    <div className="settingsSubsection">
      <h3>Pedidos manuales y refresco</h3>
      <div className="settingsFormGrid">
        <label className="settingsField"><span>Estado inicial</span><input value={draft.defaultManualStatus} onChange={e=>update('defaultManualStatus',e.target.value)} placeholder="pending"/></label>
        <label className="settingsField"><span>Canal por defecto</span><SelectField ariaLabel="Canal por defecto" value={draft.defaultChannel} options={[{value:'manual',label:'Manual / API'},{value:'amazon',label:'Amazon'},{value:'shopify',label:'Shopify'}]} onChange={value=>update('defaultChannel',value)}/></label>
        <label className="settingsField"><span>País de origen</span><input maxLength={2} value={draft.originCountryCode} onChange={e=>update('originCountryCode',e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2))}/></label>
        <label className="settingsField"><span>Transportista por defecto</span><SelectField ariaLabel="Transportista por defecto" allowEmpty emptyLabel="Usar reglas automáticas" value={draft.defaultCarrier||''} options={[{value:'mrw',label:'MRW'},{value:'correos',label:'Correos'}]} onChange={value=>update('defaultCarrier',value||null)}/></label>
        <label className="settingsField"><span>Refresco de pedidos</span><div className="settingsNumberWithSuffix"><input type="number" min="30" max="3600" value={draft.refreshSeconds} onChange={e=>update('refreshSeconds',Number(e.target.value))}/><em>s</em></div></label>
        <label className="settingsField"><span>Pedido pendiente más de</span><div className="settingsNumberWithSuffix"><input type="number" min="1" max="720" value={draft.overdueHours} onChange={e=>update('overdueHours',Number(e.target.value))}/><em>h</em></div></label>
      </div>
    </div>
    <div className="settingsSubsection">
      <h3>Etiquetas</h3>
      <div className="settingsFormGrid">
        <label className="settingsField"><span>Nombre de etiqueta</span><SelectField ariaLabel="Nombre de etiqueta" value={draft.labelFilenameStrategy} options={filenameOptions} onChange={value=>update('labelFilenameStrategy',value as OrdersSettings['labelFilenameStrategy'])}/></label>
        {draft.labelFilenameStrategy==='custom'&&<label className="settingsField settingsFieldWide"><span>Plantilla de nombre</span><input value={draft.customLabelFilenameTemplate} onChange={e=>update('customLabelFilenameTemplate',e.target.value)} placeholder="{customer}_{order}_{date}"/><small>Variables: {'{order}'}, {'{sku}'}, {'{product}'}, {'{customer}'}, {'{date}'}</small></label>}
        <label className="settingsField"><span>Nombre del ZIP</span><input value={draft.bulkZipFilenameTemplate} onChange={e=>update('bulkZipFilenameTemplate',e.target.value)} placeholder="etiquetas_{scope}_{date}"/></label>
        <label className="settingsField"><span>Ámbito de generación masiva</span><SelectField ariaLabel="Ámbito de generación masiva" value={draft.bulkScope} options={[{value:'pending',label:'Pendientes visibles'},{value:'selected',label:'Solo seleccionados'}]} onChange={value=>update('bulkScope',value as OrdersSettings['bulkScope'])}/></label>
      </div>
      <div className="settingsToggleGrid">
        <label className="settingsToggleField"><input type="checkbox" checked={draft.generateLabelAutomatically} onChange={e=>update('generateLabelAutomatically',e.target.checked)}/><span><strong>Generar etiqueta automáticamente</strong><small>Al preparar un pedido usa la primera regla válida sin abrir el selector de servicio.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.downloadLabelAfterCreation} onChange={e=>update('downloadLabelAfterCreation',e.target.checked)}/><span><strong>Descargar etiqueta tras crearla</strong><small>Descarga el PDF automáticamente después de generar una etiqueta individual.</small></span></label>
      </div>
    </div>
    <div className="settingsSubsection">
      <h3>Tracking y estado</h3>
      <div className="settingsToggleGrid">
        <label className="settingsToggleField"><input type="checkbox" checked={draft.pushTrackingToMarketplace} onChange={e=>update('pushTrackingToMarketplace',e.target.checked)}/><span><strong>Enviar tracking al marketplace</strong><small>Confirma el seguimiento en Amazon cuando se crea la etiqueta.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.markSentAfterLabel} onChange={e=>update('markSentAfterLabel',e.target.checked)}/><span><strong>Marcar enviado tras etiqueta</strong><small>Cambia el pedido a enviado cuando se crea correctamente la etiqueta.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.retryTrackingConfirmation} onChange={e=>update('retryTrackingConfirmation',e.target.checked)}/><span><strong>Reintentar confirmación de tracking</strong><small>Reintenta confirmaciones pendientes durante la sincronización periódica.</small></span></label>
      </div>
    </div>
    <div className="settingsSectionActions"><button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button><button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button></div>
  </section>;
}

function ShippingSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<ShippingSettings>(settings.shipping);
  const [rules,setRules]=useState<ShippingRule[]>([]);
  const [newRule,setNewRule]=useState<Omit<ShippingRule,'id'>>({name:'Nueva regla',priority:300,active:true,conditions:{},action:{carrierContains:'',serviceIncludes:[]}});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [ruleBusy,setRuleBusy]=useState<string|null>(null);

  useEffect(()=>{setDraft(settings.shipping);onDirtyChange(false)},[settings.shipping,onDirtyChange]);
  const reloadRules=async()=>setRules(await loadShippingRules());
  useEffect(()=>{let active=true;setLoading(true);loadShippingRules().then(rows=>{if(active)setRules(rows)}).catch(e=>showError(e instanceof Error?e.message:'No se pudieron cargar las reglas de envío.')).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);

  const update=<K extends keyof ShippingSettings>(key:K,value:ShippingSettings[K])=>{setDraft(current=>({...current,[key]:value}));onDirtyChange(true)};
  const patchRule=(id:string,patch:Partial<ShippingRule>)=>setRules(current=>current.map(rule=>rule.id===id?{...rule,...patch}:rule));

  const save=async()=>{
    setSaving(true);
    try{await updateSection('shipping',draft);onDirtyChange(false);showSuccess('Configuración de envíos guardada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo guardar la configuración de envíos.');}
    finally{setSaving(false);}
  };
  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Envíos. Las reglas personalizadas se conservarán. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('shipping');onDirtyChange(false);showSuccess('Valores predeterminados de Envíos restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };
  const addRule=async()=>{
    if(!newRule.name.trim()||!newRule.action.carrierContains.trim()){showError('La regla necesita nombre y transportista.');return;}
    setRuleBusy('new');
    try{await addShippingRule(newRule);await reloadRules();setNewRule({name:'Nueva regla',priority:Math.max(300,...rules.map(rule=>rule.priority+100)),active:true,conditions:{},action:{carrierContains:'',serviceIncludes:[]}});showSuccess('Regla de envío añadida.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo añadir la regla.');}
    finally{setRuleBusy(null);}
  };
  const saveRule=async(rule:ShippingRule)=>{
    setRuleBusy(rule.id);
    try{await updateShippingRule(rule.id,{name:rule.name,priority:rule.priority,active:rule.active,conditions:rule.conditions,action:rule.action});await reloadRules();showSuccess('Regla de envío actualizada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo actualizar la regla.');}
    finally{setRuleBusy(null);}
  };
  const removeRule=async(rule:ShippingRule)=>{
    if(!window.confirm(`¿Eliminar la regla “${rule.name}”?`))return;
    setRuleBusy(rule.id);
    try{await deleteShippingRule(rule.id);await reloadRules();showSuccess('Regla de envío eliminada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo eliminar la regla.');}
    finally{setRuleBusy(null);}
  };

  const enabledCarriersText=draft.enabledCarriers.join(', ');
  const ruleEditor=(rule:ShippingRule,isNew=false)=><div className="settingsAliasRow" key={isNew?'new':rule.id}>
    <input value={rule.name} onChange={e=>isNew?setNewRule(current=>({...current,name:e.target.value})):patchRule(rule.id,{name:e.target.value})} placeholder="Nombre de regla" aria-label="Nombre de regla"/>
    <input value={rule.conditions.countryCode||''} maxLength={2} onChange={e=>{const value=e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2);isNew?setNewRule(current=>({...current,conditions:{...current.conditions,countryCode:value||null}})):patchRule(rule.id,{conditions:{...rule.conditions,countryCode:value||null}})}} placeholder="País" aria-label="País de la regla"/>
    <input value={rule.conditions.postalPrefix||''} onChange={e=>{const value=e.target.value.replace(/\s+/g,'');isNew?setNewRule(current=>({...current,conditions:{...current.conditions,postalPrefix:value||null}})):patchRule(rule.id,{conditions:{...rule.conditions,postalPrefix:value||null}})}} placeholder="CP prefijo" aria-label="Prefijo postal"/>
    <input value={rule.action.carrierContains} onChange={e=>{const value=e.target.value;isNew?setNewRule(current=>({...current,action:{...current.action,carrierContains:value}})):patchRule(rule.id,{action:{...rule.action,carrierContains:value}})}} placeholder="Transportista" aria-label="Transportista de la regla"/>
    <input value={rule.action.serviceIncludes.join(', ')} onChange={e=>{const values=e.target.value.split(',').map(value=>value.trim()).filter(Boolean);isNew?setNewRule(current=>({...current,action:{...current.action,serviceIncludes:values}})):patchRule(rule.id,{action:{...rule.action,serviceIncludes:values}})}} placeholder="Servicio contiene…" aria-label="Palabras del servicio"/>
    <input type="number" min="0" max="10000" value={rule.priority} onChange={e=>{const value=Number(e.target.value);isNew?setNewRule(current=>({...current,priority:value})):patchRule(rule.id,{priority:value})}} aria-label="Prioridad de regla"/>
    <label className="settingsInlineCheck"><input type="checkbox" checked={rule.active} onChange={e=>isNew?setNewRule(current=>({...current,active:e.target.checked})):patchRule(rule.id,{active:e.target.checked})}/> Activa</label>
    {isNew?<button type="button" className="secondary" disabled={ruleBusy==='new'} onClick={()=>void addRule()}><Plus size={15}/> Añadir</button>:<><button type="button" className="secondary" disabled={ruleBusy===rule.id} onClick={()=>void saveRule(rule)}>Guardar</button><button type="button" className="iconBtn dangerIcon" disabled={ruleBusy===rule.id} onClick={()=>void removeRule(rule)} aria-label="Eliminar regla"><Trash2 size={15}/></button></>}
  </div>;

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero"><div className="settingsSectionIcon"><Truck size={22}/></div><div><h2>Configuración de envíos</h2><p>Remitente, peso, PDF de etiqueta, transportistas y reglas automáticas de servicio.</p></div></div>
    {loading?<div className="settingsInlineLoading">Cargando reglas de envío…</div>:<>
      <div className="settingsSubsection"><h3>Remitente</h3><div className="settingsFormGrid">
        <label className="settingsField"><span>Nombre del remitente</span><input value={draft.senderName} onChange={e=>update('senderName',e.target.value)}/></label>
        <label className="settingsField settingsFieldWide"><span>Dirección del remitente</span><input value={draft.senderAddress} onChange={e=>update('senderAddress',e.target.value)}/></label>
        <label className="settingsField"><span>Código postal</span><input value={draft.senderPostalCode} onChange={e=>update('senderPostalCode',e.target.value)}/></label>
        <label className="settingsField"><span>Ciudad</span><input value={draft.senderCity} onChange={e=>update('senderCity',e.target.value)}/></label>
        <label className="settingsField"><span>País</span><input maxLength={2} value={draft.senderCountryCode} onChange={e=>update('senderCountryCode',e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2))}/></label>
      </div></div>
      <div className="settingsSubsection"><h3>Paquete y etiqueta</h3><div className="settingsFormGrid">
        <label className="settingsField"><span>Peso de respaldo</span><div className="settingsNumberWithSuffix"><input type="number" min="0.001" max="1000" step="0.001" value={draft.fallbackWeightKg} onChange={e=>update('fallbackWeightKg',Number(e.target.value))}/><em>kg</em></div></label>
        <label className="settingsField"><span>Unidad de peso</span><SelectField ariaLabel="Unidad de peso" value={draft.weightUnit} options={[{value:'kg',label:'kg'},{value:'g',label:'g'}]} onChange={value=>update('weightUnit',value as ShippingSettings['weightUnit'])}/></label>
        <label className="settingsField"><span>Tamaño de etiqueta</span><SelectField ariaLabel="Tamaño de etiqueta" value={draft.labelSize} options={[{value:'A6',label:'A6'},{value:'10x15',label:'10 × 15 cm'},{value:'A4',label:'A4'}]} onChange={value=>update('labelSize',value as ShippingSettings['labelSize'])}/></label>
        <label className="settingsField"><span>Orientación</span><SelectField ariaLabel="Orientación de etiqueta" value={draft.labelOrientation} options={[{value:'portrait',label:'Vertical'},{value:'landscape',label:'Horizontal'}]} onChange={value=>update('labelOrientation',value as ShippingSettings['labelOrientation'])}/></label>
        <label className="settingsField"><span>Copias</span><input type="number" min="1" max="20" value={draft.copies} onChange={e=>update('copies',Number(e.target.value))}/></label>
      </div><div className="settingsToggleGrid">
        <label className="settingsToggleField"><input type="checkbox" checked={draft.autoDownload} onChange={e=>update('autoDownload',e.target.checked)}/><span><strong>Descarga automática</strong><small>Permite descargar automáticamente los PDF de etiqueta cuando la acción lo solicita.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.confirmShipmentAfterLabel} onChange={e=>update('confirmShipmentAfterLabel',e.target.checked)}/><span><strong>Confirmar expedición tras etiqueta</strong><small>Permite al backend cerrar la expedición después de crear la etiqueta.</small></span></label>
        <label className="settingsToggleField"><input type="checkbox" checked={draft.persistShippingCost} onChange={e=>update('persistShippingCost',e.target.checked)}/><span><strong>Guardar coste de envío</strong><small>Persiste el coste cotizado para KPIs y análisis.</small></span></label>
      </div></div>
      <div className="settingsSubsection"><h3>Transportistas</h3><div className="settingsFormGrid">
        <label className="settingsField settingsFieldWide"><span>Transportistas habilitados</span><input value={enabledCarriersText} onChange={e=>update('enabledCarriers',e.target.value.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))} placeholder="mrw, correos"/><small>Vacío = todos. Se comparan por código o nombre.</small></label>
        <label className="settingsField"><span>Sin método válido</span><SelectField ariaLabel="Comportamiento sin método válido" value={draft.noValidMethodBehavior} options={[{value:'manual_selection',label:'Pedir selección manual'},{value:'error',label:'Bloquear con error'}]} onChange={value=>update('noValidMethodBehavior',value as ShippingSettings['noValidMethodBehavior'])}/></label>
      </div></div>
      <div className="settingsSubsection"><div className="settingsSubsectionHead"><div><h3>Reglas automáticas de envío</h3><p>Se evalúan por prioridad. Las primeras reglas creadas reproducen Baleares → Correos y resto → MRW Urgent 19:00.</p></div></div>
        <div className="settingsAliasList">{rules.map(rule=>ruleEditor(rule))}{ruleEditor({...newRule,id:'new'},true)}</div>
      </div>
      <div className="settingsSectionActions"><button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button><button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button></div>
    </>}
  </section>;
}

function AmazonSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<AmazonSettings>(settings.amazon);
  const [marketplaces,setMarketplaces]=useState<AmazonMarketplaceStatus[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{setDraft(settings.amazon);onDirtyChange(false)},[settings.amazon,onDirtyChange]);
  useEffect(()=>{
    let active=true;
    setLoading(true);
    loadAmazonStatus()
      .then(status=>{if(active)setMarketplaces((status.marketplaces||[]).filter(item=>item.active));})
      .catch(e=>showError(e instanceof Error?e.message:'No se pudieron cargar los marketplaces de Amazon.'))
      .finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  const update=<K extends keyof AmazonSettings>(key:K,value:AmazonSettings[K])=>{
    setDraft(current=>({...current,[key]:value}));
    onDirtyChange(true);
  };

  const effectiveMarketplaceIds=draft.activeMarketplaceIds.length
    ?draft.activeMarketplaceIds
    :marketplaces.map(item=>item.id);
  const currencyOptions=Array.from(new Set(['EUR',draft.consolidatedCurrency,...marketplaces.map(item=>item.currencyCode).filter(Boolean)]))
    .map(value=>({value,label:value}));

  const toggleMarketplace=(id:string,checked:boolean)=>{
    const current=new Set(effectiveMarketplaceIds);
    if(checked)current.add(id); else current.delete(id);
    if(current.size===0){showError('Amazon necesita al menos un marketplace activo.');return;}
    const allIds=marketplaces.map(item=>item.id);
    const next=allIds.length&&current.size===allIds.length?[]:allIds.filter(item=>current.has(item));
    const nextPrimary=draft.primaryMarketplaceId&&current.has(draft.primaryMarketplaceId)
      ?draft.primaryMarketplaceId
      :(allIds.find(item=>current.has(item))||null);
    setDraft(value=>({...value,activeMarketplaceIds:next,primaryMarketplaceId:nextPrimary}));
    onDirtyChange(true);
  };

  const save=async()=>{
    setSaving(true);
    try{await updateSection('amazon',draft);onDirtyChange(false);showSuccess('Configuración de Amazon guardada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo guardar la configuración de Amazon.');}
    finally{setSaving(false);}
  };

  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Amazon. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('amazon');onDirtyChange(false);showSuccess('Valores predeterminados de Amazon restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };

  const periodOptionsAmazon=[
    {value:'today',label:'Hoy'},
    {value:'current_month',label:'Mes actual'},
    {value:'current_quarter',label:'Trimestre actual'},
    {value:'current_year',label:'Año actual'},
    {value:'all',label:'Histórico configurado'},
  ];
  const kpiLabels:Record<string,string>={
    grossSales:'Ventas',salesVat:'IVA ventas',netSales:'Ventas sin IVA',orders:'Pedidos',
    businessOrders:'Pedidos B2B',units:'Unidades',amazonFees:'Tarifas Amazon',
    adsCost:'Publicidad',refunds:'Reembolsos',productCost:'Coste producto',
    fbmShippingCost:'Coste envíos FBM',netProfit:'Ganancia neta',marginPct:'Margen neto',
  };
  const visibleKpis=draft.visibleKpis.length?draft.visibleKpis:[...AMAZON_KPI_KEYS];
  const toggleKpi=(key:string,checked:boolean)=>{
    const next=new Set(visibleKpis);
    if(checked)next.add(key);else next.delete(key);
    update('visibleKpis',next.size===AMAZON_KPI_KEYS.length?[]:AMAZON_KPI_KEYS.filter(item=>next.has(item)));
  };

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero"><div className="settingsSectionIcon"><Gauge size={22}/></div><div><h2>Configuración de Amazon</h2><p>Marketplaces, criterios analíticos y sincronización automática de Amazon.</p></div></div>
    {loading?<div className="settingsInlineLoading">Cargando marketplaces de Amazon…</div>:<>
      <div className="settingsSubsection">
        <h3>Marketplaces</h3>
        <div className="settingsToggleGrid">
          {marketplaces.map(item=><label className="settingsToggleField" key={item.id}><input type="checkbox" checked={effectiveMarketplaceIds.includes(item.id)} onChange={e=>toggleMarketplace(item.id,e.target.checked)}/><span><strong>{item.countryCode} · {item.name}</strong><small>{item.currencyCode} · {item.id}</small></span></label>)}
          {!marketplaces.length&&<div className="settingsEmptyMini">No hay marketplaces activos disponibles.</div>}
        </div>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>Marketplace principal</span><SelectField ariaLabel="Marketplace principal" allowEmpty emptyLabel="Primero activo" value={draft.primaryMarketplaceId||''} options={marketplaces.filter(item=>effectiveMarketplaceIds.includes(item.id)).map(item=>({value:item.id,label:`${item.countryCode} · ${item.name}`}))} onChange={value=>update('primaryMarketplaceId',value||null)}/></label>
          <label className="settingsField"><span>Moneda consolidada</span><SelectField ariaLabel="Moneda consolidada" value={draft.consolidatedCurrency} options={currencyOptions} onChange={value=>update('consolidatedCurrency',value)}/></label>
          <label className="settingsField"><span>Periodo inicial</span><SelectField ariaLabel="Periodo inicial Amazon" value={draft.defaultPeriod} options={periodOptionsAmazon} onChange={value=>update('defaultPeriod',value as AmazonSettings['defaultPeriod'])}/></label>
          <label className="settingsField"><span>Histórico</span><div className="settingsNumberWithSuffix"><input type="number" min="1" max="3650" value={draft.historyDays} onChange={e=>update('historyDays',Number(e.target.value))}/><em>días</em></div></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Criterios analíticos</h3>
        <div className="settingsFormGrid">
          <label className="settingsField"><span>IVA de respaldo</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="100" step="0.1" value={draft.defaultVatRate} onChange={e=>update('defaultVatRate',Number(e.target.value))}/><em>%</em></div><small>Solo se usa si Amazon no aporta un IVA utilizable.</small></label>
          <label className="settingsField"><span>Factor de consumo por defecto</span><input type="number" min="0.0001" max="100000" step="0.01" value={draft.defaultConsumptionFactor} onChange={e=>update('defaultConsumptionFactor',Number(e.target.value))}/><small>Solo para vínculos SKU nuevos; no modifica factores existentes.</small></label>
          <label className="settingsField"><span>Política FX</span><SelectField ariaLabel="Política FX" value={draft.fxMissingRatePolicy} options={[{value:'last_known',label:'Usar último cambio conocido'},{value:'exclude',label:'Excluir si falta cambio exacto'}]} onChange={value=>update('fxMissingRatePolicy',value as AmazonSettings['fxMissingRatePolicy'])}/></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>Sincronización automática</h3>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" checked={draft.autoSyncOrders} onChange={e=>update('autoSyncOrders',e.target.checked)}/><span><strong>Sincronizar pedidos automáticamente</strong><small>El cron no encolará pedidos cuando esté desactivado; la sincronización manual seguirá disponible.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.autoSyncInventory} onChange={e=>update('autoSyncInventory',e.target.checked)}/><span><strong>Sincronizar inventario automáticamente</strong><small>Controla los snapshots periódicos de inventario.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.autoSyncFinance} onChange={e=>update('autoSyncFinance',e.target.checked)}/><span><strong>Sincronizar finanzas automáticamente</strong><small>Controla la cola periódica de eventos financieros.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" checked={draft.autoSyncImages} onChange={e=>update('autoSyncImages',e.target.checked)}/><span><strong>Sincronizar imágenes automáticamente</strong><small>Actualiza la caché de imágenes de productos durante la orquestación.</small></span></label>
        </div>
      </div>

      <div className="settingsSubsection">
        <h3>KPI visibles por defecto</h3>
        <div className="settingsToggleGrid">
          {AMAZON_KPI_KEYS.map(key=><label className="settingsToggleField" key={key}><input type="checkbox" checked={visibleKpis.includes(key)} onChange={e=>toggleKpi(key,e.target.checked)}/><span><strong>{kpiLabels[key]||key}</strong><small>Mostrar en el resumen de Amazon.</small></span></label>)}
        </div>
      </div>

      <div className="settingsSectionActions"><button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button><button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button></div>
    </>}
  </section>;
}

function IntegrationsSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<IntegrationsSettings>(settings.integrations);
  const [health,setHealth]=useState<IntegrationHealth[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [results,setResults]=useState<Partial<Record<IntegrationId,{checkedAt:string;message:string;ok:boolean}>>>({});

  useEffect(()=>{setDraft(settings.integrations);onDirtyChange(false)},[settings.integrations,onDirtyChange]);

  const refreshHealth=async()=>{
    setLoading(true);
    try{setHealth(await loadIntegrationHealth(draft));}
    catch(e){showError(e instanceof Error?e.message:'No se pudo cargar el estado de las integraciones.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void refreshHealth()},[]);

  const settingKey:Record<IntegrationId,keyof IntegrationsSettings>={
    gmail:'gmailEnabled',amazon:'amazonEnabled',sendcloud:'sendcloudEnabled',shopify:'shopifyEnabled',
  };
  const names:Record<IntegrationId,string>={gmail:'Gmail',amazon:'Amazon',sendcloud:'Sendcloud',shopify:'Shopify'};
  const descriptions:Record<IntegrationId,string>={
    gmail:'Importación de facturas desde la cuenta autorizada en esta sesión.',
    amazon:'SP-API, pedidos, inventario, finanzas e imágenes.',
    sendcloud:'Pedidos, etiquetas, transportistas y seguimiento.',
    shopify:'Canal Shopify conectado a través de una integración real de Sendcloud.',
  };
  const enabled=(id:IntegrationId)=>Boolean(draft[settingKey[id]]);
  const toggle=(id:IntegrationId,value:boolean)=>{
    setDraft(current=>({...current,[settingKey[id]]:value}));
    onDirtyChange(true);
  };
  const dateTime=(value:string|null)=>value?new Date(value).toLocaleString('es-ES'):'Sin registro';

  const run=async(id:IntegrationId,action:'test'|'sync')=>{
    const key=`${id}:${action}`;
    setBusy(key);
    try{
      const result=action==='test'?await testIntegrationConnection(id):await syncIntegration(id);
      setResults(current=>({...current,[id]:result}));
      showSuccess(result.message);
      const next=await loadIntegrationHealth(draft);
      setHealth(next);
    }catch(e){
      const message=e instanceof Error?e.message:'La operación no se pudo completar.';
      const checkedAt=new Date().toISOString();
      setResults(current=>({...current,[id]:{ok:false,checkedAt,message}}));
      showError(message);
    }finally{setBusy(null);}
  };

  const save=async()=>{
    setSaving(true);
    try{
      await updateSection('integrations',draft);
      setHealth(current=>current.map(item=>({...item,enabled:Boolean(draft[settingKey[item.id]])})));
      onDirtyChange(false);
      showSuccess('Configuración de integraciones guardada.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudo guardar la configuración de integraciones.');}
    finally{setSaving(false);}
  };
  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Integraciones. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('integrations');onDirtyChange(false);showSuccess('Valores predeterminados de Integraciones restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };

  const ordered:IntegrationId[]=['gmail','amazon','sendcloud','shopify'];
  const byId=new Map(health.map(item=>[item.id,item]));

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero"><div className="settingsSectionIcon"><PlugZap size={22}/></div><div><h2>Integraciones</h2><p>Estado, sincronización y activación de servicios externos sin exponer credenciales.</p></div></div>
    <div className="settingsSubsection">
      <h3>Servicios conectados</h3>
      {loading&&!health.length?<div className="settingsInlineLoading">Comprobando integraciones…</div>:<div className="settingsToggleGrid">
        {ordered.map(id=>{
          const item=byId.get(id);
          const result=results[id];
          const connected=Boolean(item?.connected);
          return <div className="settingsToggleField" key={id}>
            <input aria-label={`Activar ${names[id]}`} type="checkbox" checked={enabled(id)} onChange={e=>toggle(id,e.target.checked)}/>
            <span>
              <strong>{names[id]} · {connected?'Conectado':'No conectado'}</strong>
              <small>{descriptions[id]}</small>
              <small>Último éxito: {dateTime(item?.lastSuccessAt||null)}</small>
              <small>Último intento: {dateTime(item?.lastAttemptAt||null)}</small>
              {item?.lastError&&<small>{item.lastError}</small>}
              {result&&<small>{result.ok?'Correcto':'Error'} · {dateTime(result.checkedAt)} · {result.message}</small>}
              <span className="settingsInlineActions">
                <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void run(id,'test')}>{busy===`${id}:test`?'Comprobando…':'Probar conexión'}</button>
                <button type="button" className="secondary" disabled={busy!==null||!connected} onClick={()=>void run(id,'sync')}>{busy===`${id}:sync`?'Sincronizando…':'Sincronizar ahora'}</button>
              </span>
            </span>
          </div>;
        })}
      </div>}
      <p className="settingsHelpText">Desactivar una integración detiene sus automatismos configurados. Las acciones manuales y el historial siguen disponibles.</p>
    </div>
    <div className="settingsSectionActions"><button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button><button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button></div>
  </section>;
}

function AlertsSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection}=useSettings();
  const [draft,setDraft]=useState<NotificationsSettings>(settings.notifications);
  const [orderRule,setOrderRule]=useState<AutomationRule<'order_label_created'>>(DEFAULT_AUTOMATION_RULES.order_label_created);
  const [expenseRule,setExpenseRule]=useState<AutomationRule<'expense_invoice_imported'>>(DEFAULT_AUTOMATION_RULES.expense_invoice_imported);
  const [loadingRules,setLoadingRules]=useState(true);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{setDraft(settings.notifications);onDirtyChange(false)},[settings.notifications,onDirtyChange]);
  useEffect(()=>{
    let active=true;
    setLoadingRules(true);
    loadAutomationRules()
      .then(rules=>{if(active){setOrderRule(rules.order_label_created);setExpenseRule(rules.expense_invoice_imported);}})
      .catch(e=>showError(e instanceof Error?e.message:'No se pudieron cargar las reglas de automatización.'))
      .finally(()=>{if(active)setLoadingRules(false)});
    return()=>{active=false};
  },[]);

  const definitions:Array<{
    key:keyof NotificationsSettings;
    label:string;
    description:string;
    threshold?:{label:string;unit:string;min:number;max:number;step:number;fallback:number};
  }>=[
    {key:'overdueSalesInvoice',label:'Facturas de venta vencidas',description:'Avisa cuando una factura emitida mantiene importe pendiente después de su vencimiento.',threshold:{label:'Retraso mínimo',unit:'días',min:0,max:365,step:1,fallback:0}},
    {key:'pendingExpenseReview',label:'Gastos pendientes de revisión',description:'Detecta facturas recibidas que siguen en estado pendiente.',threshold:{label:'Antigüedad mínima',unit:'días',min:0,max:365,step:1,fallback:0}},
    {key:'pendingOrder',label:'Pedidos pendientes',description:'Avisa cuando un pedido lleva demasiado tiempo sin completarse.',threshold:{label:'Tiempo mínimo',unit:'horas',min:1,max:720,step:1,fallback:24}},
    {key:'missingTracking',label:'Pedidos sin seguimiento',description:'Detecta pedidos enviados o etiquetados que todavía no tienen tracking.',threshold:{label:'Espera mínima',unit:'horas',min:0,max:168,step:1,fallback:0}},
    {key:'amazonError',label:'Errores de Amazon',description:'Muestra errores recientes del estado o sincronización de Amazon.'},
    {key:'sendcloudError',label:'Errores de Sendcloud',description:'Muestra errores recientes de conexión o sincronización de Sendcloud.'},
    {key:'gmailError',label:'Errores de Gmail',description:'Avisa si Gmail no está disponible o la conexión falla.'},
    {key:'productWithoutCost',label:'Productos sin coste',description:'Detecta productos sin un coste de compra válido.'},
    {key:'negativeMargin',label:'Margen bajo o negativo',description:'Avisa cuando el margen estimado de un producto cae por debajo del umbral.',threshold:{label:'Margen mínimo',unit:'%',min:-100,max:100,step:0.5,fallback:0}},
    {key:'costIncrease',label:'Subidas de coste',description:'Avisa cuando el último coste supera al anterior por encima del porcentaje indicado.',threshold:{label:'Subida mínima',unit:'%',min:0,max:1000,step:0.5,fallback:10}},
    {key:'clientMissingTaxId',label:'Clientes sin NIF/VAT',description:'Detecta clientes que no tienen identificación fiscal informada.'},
    {key:'supplierMissingTaxId',label:'Proveedores sin NIF/VAT',description:'Detecta proveedores que no tienen identificación fiscal informada.'},
  ];

  const patch=(key:keyof NotificationsSettings,changes:Partial<NotificationSetting>)=>{
    setDraft(current=>({...current,[key]:{...current[key],...changes}}));
    onDirtyChange(true);
  };
  const patchOrderRule=(changes:Partial<AutomationRule<'order_label_created'>['config']>)=>{
    setOrderRule(current=>({...current,config:{...current.config,...changes}}));
    onDirtyChange(true);
  };
  const patchExpenseRule=(changes:Partial<AutomationRule<'expense_invoice_imported'>['config']>)=>{
    setExpenseRule(current=>({...current,config:{...current.config,...changes}}));
    onDirtyChange(true);
  };

  const save=async()=>{
    setSaving(true);
    try{
      const [savedOrder,savedExpense]=await Promise.all([
        saveAutomationRule(orderRule),
        saveAutomationRule(expenseRule),
        updateSection('notifications',draft),
      ]).then(([nextOrder,nextExpense])=>[nextOrder,nextExpense] as const);
      setOrderRule(savedOrder);
      setExpenseRule(savedExpense);
      onDirtyChange(false);
      showSuccess('Alertas y automatizaciones guardadas.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudieron guardar las alertas y automatizaciones.');}
    finally{setSaving(false);}
  };

  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Alertas y automatizaciones. ¿Continuar?'))return;
    setSaving(true);
    try{
      const [savedOrder,savedExpense]=await Promise.all([
        saveAutomationRule(DEFAULT_AUTOMATION_RULES.order_label_created),
        saveAutomationRule(DEFAULT_AUTOMATION_RULES.expense_invoice_imported),
        resetSection('notifications'),
      ]).then(([nextOrder,nextExpense])=>[nextOrder,nextExpense] as const);
      setOrderRule(savedOrder);
      setExpenseRule(savedExpense);
      onDirtyChange(false);
      showSuccess('Valores predeterminados de Alertas y automatizaciones restaurados.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar las alertas y automatizaciones.');}
    finally{setSaving(false);}
  };

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero"><div className="settingsSectionIcon"><BellRing size={22}/></div><div><h2>Alertas y automatizaciones</h2><p>Alertas operativas y acciones automáticas controladas después de eventos concretos.</p></div></div>
    <div className="settingsSubsection">
      <h3>Alertas</h3>
      <p className="settingsHelpText">Las alertas no crean registros ni envían correos: se calculan al vuelo y aparecen en la campana global.</p>
      <div className="settingsAlertGrid">
        {definitions.map(definition=>{
          const value=draft[definition.key];
          const thresholdValue=value.threshold??definition.threshold?.fallback??0;
          return <div className="settingsAlertCard" key={definition.key}>
            <div className="settingsAlertCardHead">
              <div><strong>{definition.label}</strong><small>{definition.description}</small></div>
              <label className="settingsMiniToggle"><input type="checkbox" checked={value.enabled} onChange={e=>patch(definition.key,{enabled:e.target.checked})}/><span>Activa</span></label>
            </div>
            <label className="settingsToggleField"><input type="checkbox" checked={value.inApp} disabled={!value.enabled} onChange={e=>patch(definition.key,{inApp:e.target.checked})}/><span><strong>Dentro de la aplicación</strong><small>Mostrar esta alerta en el centro global.</small></span></label>
            {definition.threshold&&<label className="settingsField settingsAlertThreshold"><span>{definition.threshold.label}</span><div className="settingsNumberWithSuffix"><input type="number" min={definition.threshold.min} max={definition.threshold.max} step={definition.threshold.step} value={thresholdValue} disabled={!value.enabled} onChange={e=>patch(definition.key,{threshold:Number(e.target.value)})}/><em>{definition.threshold.unit}</em></div></label>}
          </div>;
        })}
      </div>
    </div>

    <div className="settingsSubsection">
      <h3>Automatización tras crear etiqueta</h3>
      <p className="settingsHelpText">Estas acciones se ejecutan de forma independiente después de que Sendcloud haya creado correctamente la etiqueta. La creación de la etiqueta nunca depende de ellas.</p>
      {loadingRules?<div className="settingsInlineLoading">Cargando automatizaciones…</div>:<>
        <label className="settingsToggleField settingsAutomationMaster"><input type="checkbox" checked={orderRule.enabled} onChange={e=>{setOrderRule(current=>({...current,enabled:e.target.checked}));onDirtyChange(true)}}/><span><strong>Automatización de etiqueta activa</strong><small>Desactivarla conserva la etiqueta, pero no ejecuta acciones posteriores automáticas.</small></span></label>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" disabled={!orderRule.enabled} checked={orderRule.config.saveTracking} onChange={e=>patchOrderRule({saveTracking:e.target.checked})}/><span><strong>Guardar tracking</strong><small>Persiste número, URL y estado de seguimiento en el pedido.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" disabled={!orderRule.enabled} checked={orderRule.config.pushToMarketplace} onChange={e=>patchOrderRule({pushToMarketplace:e.target.checked})}/><span><strong>Enviar tracking al marketplace</strong><small>Confirma Amazon justo después de crear la etiqueta cuando corresponde.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" disabled={!orderRule.enabled} checked={orderRule.config.markSent} onChange={e=>patchOrderRule({markSent:e.target.checked})}/><span><strong>Marcar pedido enviado</strong><small>Permite cambiar el pedido a enviado tras una etiqueta correcta.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" disabled={!orderRule.enabled} checked={orderRule.config.downloadPdf} onChange={e=>patchOrderRule({downloadPdf:e.target.checked})}/><span><strong>Descargar PDF automáticamente</strong><small>Controla la descarga automática individual; la descarga manual y el ZIP siguen disponibles.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" disabled={!orderRule.enabled||!orderRule.config.saveTracking} checked={orderRule.config.retryConfirmation&&orderRule.config.saveTracking} onChange={e=>patchOrderRule({retryConfirmation:e.target.checked})}/><span><strong>Reintentar confirmación</strong><small>Reintenta Amazon durante sincronizaciones posteriores. Requiere guardar tracking.</small></span></label>
        </div>
      </>}
    </div>

    <div className="settingsSubsection">
      <h3>Automatización tras importar gasto</h3>
      <p className="settingsHelpText">Actúa únicamente sobre acciones posteriores ya implementadas. Los controles de Gastos y Productos siguen siendo condiciones adicionales de seguridad.</p>
      {loadingRules?<div className="settingsInlineLoading">Cargando automatizaciones…</div>:<>
        <label className="settingsToggleField settingsAutomationMaster"><input type="checkbox" checked={expenseRule.enabled} onChange={e=>{setExpenseRule(current=>({...current,enabled:e.target.checked}));onDirtyChange(true)}}/><span><strong>Automatización de gasto importado activa</strong><small>Desactivarla guarda la factura sin ejecutar estas actualizaciones posteriores.</small></span></label>
        <div className="settingsToggleGrid">
          <label className="settingsToggleField"><input type="checkbox" disabled={!expenseRule.enabled} checked={expenseRule.config.updateProductCosts} onChange={e=>patchExpenseRule({updateProductCosts:e.target.checked})}/><span><strong>Actualizar costes de producto</strong><small>Solo si Gastos y Productos también permiten actualizar costes desde importaciones.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" disabled={!expenseRule.enabled} checked={expenseRule.config.updatePriceHistory} onChange={e=>patchExpenseRule({updatePriceHistory:e.target.checked})}/><span><strong>Actualizar histórico de precios</strong><small>Guarda el precio confirmado en el histórico de compra cuando procede.</small></span></label>
          <label className="settingsToggleField"><input type="checkbox" disabled={!expenseRule.enabled} checked={expenseRule.config.createSupplierProductRelation} onChange={e=>patchExpenseRule({createSupplierProductRelation:e.target.checked})}/><span><strong>Crear relación producto-proveedor</strong><small>Vincula la descripción del proveedor con el producto interno cuando existe una coincidencia segura.</small></span></label>
        </div>
      </>}
    </div>

    <div className="settingsSectionActions"><button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button><button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button></div>
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
        <button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button>
        <button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
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
          <button type="button" className="secondary" disabled={aliasBusy==='new'} onClick={()=>void addAlias()}><Plus size={15}/> Añadir alias</button>
        </div>
        <div className="settingsAliasList">
          {aliases.length===0?<div className="settingsEmptyMini">Todavía no hay alias explícitos.</div>:aliases.map(alias=><div className="settingsAliasRow" key={alias.id}>
            <input value={alias.alias} onChange={e=>patchAlias(alias.id,{alias:e.target.value})} aria-label="Alias del proveedor"/>
            <SearchableSelect value={alias.targetEntityId} options={supplierOptions} onChange={value=>patchAlias(alias.id,{targetEntityId:value})} searchPlaceholder="Buscar proveedor…" ariaLabel="Proveedor asociado al alias"/>
            <input type="number" min="0" max="10000" value={alias.priority} onChange={e=>patchAlias(alias.id,{priority:Number(e.target.value)})} aria-label="Prioridad"/>
            <label className="settingsInlineCheck"><input type="checkbox" checked={alias.active} onChange={e=>patchAlias(alias.id,{active:e.target.checked})}/> Activo</label>
            <button type="button" className="secondary" disabled={aliasBusy===alias.id} onClick={()=>void saveAlias(alias)}>Guardar</button>
            <button type="button" className="iconBtn dangerIcon" disabled={aliasBusy===alias.id} aria-label="Eliminar alias" onClick={()=>void removeAlias(alias)}><Trash2 size={15}/></button>
          </div>)}
        </div>
      </div>

      <div className="settingsSectionActions">
        <button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button>
        <button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button>
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

  const dashboardLabels:Record<string,string>={
    sales:'Facturación',expenses:'Gastos',result:'Resultado',vatBalance:'IVA neto',receivable:'Pendiente de cobro',
    pendingExpenses:'Gastos por revisar',orders:'Pedidos',orderValue:'Valor de pedidos',pendingOrders:'Pedidos pendientes',
    shippedOrders:'Pedidos enviados',cancelledOrders:'Pedidos cancelados',
  };
  const tableLabels:Record<PreferenceTableKey,string>={expenses:'Gastos',suppliers:'Proveedores',clients:'Clientes',products:'Productos'};
  const columnLabels:Record<string,string>={
    date:'Fecha',supplier:'Proveedor',invoice:'Factura',category:'Categoría',source:'Origen',status:'Estado',vat:'IVA',total:'Total',
    taxId:'CIF/NIF',type:'Tipo',contact:'Contacto',invoiceCount:'Facturas',spend:'Gasto',lastInvoice:'Última factura',
    client:'Cliente',country:'País',invoiced:'Facturado',pending:'Pendiente',
    product:'Producto',sku:'SKU / EAN',lastPurchase:'Última compra',cost:'Coste',salePrice:'P. venta',margin:'Margen',costChange:'Var. coste',
  };
  const selectedDashboardKpis=draft.dashboardKpis.length?draft.dashboardKpis:[...DASHBOARD_KPI_DEFAULTS];
  const toggleDashboardKpi=(key:string,checked:boolean)=>{
    const next=new Set(selectedDashboardKpis);
    if(checked)next.add(key);else next.delete(key);
    if(next.size===0){showError('Debe quedar al menos un KPI visible en el Resumen.');return;}
    update('dashboardKpis',next.size===DASHBOARD_KPI_DEFAULTS.length?[]:DASHBOARD_KPI_DEFAULTS.filter(item=>next.has(item)));
  };
  const visibleColumns=(table:PreferenceTableKey)=>{
    const defaults=[...TABLE_COLUMN_DEFAULTS[table]];
    return Object.prototype.hasOwnProperty.call(draft.tableColumns,table)?(draft.tableColumns[table]||[]):defaults;
  };
  const toggleColumn=(table:PreferenceTableKey,key:string,checked:boolean)=>{
    const next=new Set(visibleColumns(table));
    if(checked)next.add(key);else next.delete(key);
    if(next.size===0){showError('Debe quedar al menos una columna de datos visible.');return;}
    update('tableColumns',{...draft.tableColumns,[table]:TABLE_COLUMN_DEFAULTS[table].filter(item=>next.has(item))});
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

    <div className="settingsSubsection">
      <h3>KPIs del Resumen</h3>
      <div className="settingsToggleGrid">
        {DASHBOARD_KPI_DEFAULTS.map(key=><label className="settingsToggleField" key={key}><input type="checkbox" checked={selectedDashboardKpis.includes(key)} onChange={e=>toggleDashboardKpi(key,e.target.checked)}/><span><strong>{dashboardLabels[key]||key}</strong><small>Mostrar en el panel principal.</small></span></label>)}
      </div>
    </div>

    <div className="settingsSubsection">
      <h3>Columnas visibles</h3>
      {Object.entries(TABLE_COLUMN_DEFAULTS).map(([rawTable,columns])=>{
        const table=rawTable as PreferenceTableKey;
        const visible=visibleColumns(table);
        return <div className="settingsPreferenceColumns" key={table}><strong>{tableLabels[table]}</strong><div className="settingsToggleGrid">{columns.map(key=><label className="settingsToggleField" key={key}><input type="checkbox" checked={visible.includes(key)} onChange={e=>toggleColumn(table,key,e.target.checked)}/><span><strong>{columnLabels[key]||key}</strong></span></label>)}</div></div>;
      })}
    </div>

    <div className="settingsSectionActions">
      <button type="button" className="secondary" disabled={saving} onClick={()=>{setDraft(preferences);onDirtyChange(false)}}>Descartar cambios</button>
      <button type="button" className="primary" disabled={saving} onClick={save}>{saving?'Guardando…':'Guardar preferencias'}</button>
    </div>
  </section>;
}

function MaintenanceSection({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const {settings,updateSection,resetSection,refresh:refreshSettings}=useSettings();
  const [draft,setDraft]=useState<MaintenanceSettings>(settings.maintenance);
  const [saving,setSaving]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [duplicates,setDuplicates]=useState<{
    suppliers:DuplicateCandidate[];
    clients:DuplicateCandidate[];
    products:DuplicateCandidate[];
    invoices:DuplicateCandidate[];
  }>({suppliers:[],clients:[],products:[],invoices:[]});
  const [analyzed,setAnalyzed]=useState(false);
  const [preview,setPreview]=useState<{kind:'supplier'|'client';data:MergePreview}|null>(null);
  const [diagnostics,setDiagnostics]=useState<Record<string,{count:number;names:string[]}>>({});
  const [resetPreview,setResetPreview]=useState<SettingsResetPreview|null>(null);
  const [repairPreview,setRepairPreview]=useState<{kind:'costs'|'supplierLinks'|'priceHistory';data:MaintenanceRepairPreview}|null>(null);
  const [reprocessOptions,setReprocessOptions]=useState<ReprocessableInvoiceOption[]>([]);
  const [reprocessInvoiceId,setReprocessInvoiceId]=useState('');
  const [reprocessPreview,setReprocessPreview]=useState<ExpenseInvoiceReprocessPreview|null>(null);

  useEffect(()=>{setDraft(settings.maintenance);onDirtyChange(false)},[settings.maintenance,onDirtyChange]);
  useEffect(()=>{
    let active=true;
    listReprocessableInvoices()
      .then(rows=>{if(active)setReprocessOptions(rows)})
      .catch(()=>{if(active)setReprocessOptions([])});
    return()=>{active=false};
  },[]);

  const save=async()=>{
    setSaving(true);
    try{await updateSection('maintenance',draft);onDirtyChange(false);showSuccess('Configuración de mantenimiento guardada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo guardar la configuración de mantenimiento.');}
    finally{setSaving(false);}
  };
  const restore=async()=>{
    if(!window.confirm('Se restaurarán los valores predeterminados de Mantenimiento. ¿Continuar?'))return;
    setSaving(true);
    try{await resetSection('maintenance');onDirtyChange(false);showSuccess('Valores predeterminados de Mantenimiento restaurados.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudieron restaurar los valores.');}
    finally{setSaving(false);}
  };

  const analyze=async()=>{
    setAnalyzing(true);setPreview(null);
    try{
      const [suppliers,clients,products,invoices]=await Promise.all([
        findSupplierDuplicates(draft.duplicateCandidateThreshold),
        findClientDuplicates(draft.duplicateCandidateThreshold),
        findProductDuplicates(draft.duplicateCandidateThreshold),
        findInvoiceDuplicates(draft.duplicateCandidateThreshold),
      ]);
      setDuplicates({suppliers,clients,products,invoices});setAnalyzed(true);
      showSuccess('Análisis de duplicados completado.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudo analizar duplicados.');}
    finally{setAnalyzing(false);}
  };

  const loadPreview=async(kind:'supplier'|'client',candidate:DuplicateCandidate,reverse=false)=>{
    const sourceId=reverse?candidate.rightId:candidate.leftId;
    const destinationId=reverse?candidate.leftId:candidate.rightId;
    setBusy('preview:'+candidate.id+(reverse?':reverse':''));
    try{
      const data=kind==='supplier'
        ?await previewSupplierMerge(sourceId,destinationId)
        :await previewClientMerge(sourceId,destinationId);
      setPreview({kind,data});
    }catch(e){showError(e instanceof Error?e.message:'No se pudo preparar la vista previa.');}
    finally{setBusy(null);}
  };

  const confirmMerge=async()=>{
    if(!preview)return;
    const {kind,data}=preview;
    const label=kind==='supplier'?'proveedor':'cliente';
    if(!window.confirm('Vas a fusionar el '+label+' “'+data.sourceLabel+'” dentro de “'+data.destinationLabel+'”. La operación es transaccional pero no tiene deshacer automático. ¿Continuar?'))return;
    setBusy('merge');
    try{
      if(kind==='supplier')await mergeSupplier(data.sourceId,data.destinationId);
      else await mergeClient(data.sourceId,data.destinationId);
      setPreview(null);
      await analyze();
      showSuccess((kind==='supplier'?'Proveedor':'Cliente')+' fusionado correctamente.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudo completar la fusión.');}
    finally{setBusy(null);}
  };

  const runDiagnostic=async(key:'suppliersTax'|'clientsTax'|'productsCost')=>{
    setBusy(key);
    try{
      const rows=key==='suppliersTax'?await listSuppliersMissingTaxId():key==='clientsTax'?await listClientsMissingTaxId():await listProductsWithoutCost();
      setDiagnostics(current=>({...current,[key]:{count:rows.length,names:rows.slice(0,20).map((row:any)=>String(row.name||row.sku||row.id))}}));
    }catch(e){showError(e instanceof Error?e.message:'No se pudo ejecutar el diagnóstico.');}
    finally{setBusy(null);}
  };

  const runSync=async(kind:'sendcloud'|'amazon')=>{
    setBusy('sync:'+kind);
    try{
      if(kind==='sendcloud')await runSendcloudSync();else await runAmazonSync();
      showSuccess((kind==='sendcloud'?'Sendcloud':'Amazon')+' sincronizado.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudo iniciar la sincronización.');}
    finally{setBusy(null);}
  };

  const prepareRepair=async(kind:'costs'|'supplierLinks'|'priceHistory')=>{
    setBusy('repair-preview:'+kind);
    try{
      const data=kind==='costs'
        ?await previewProductCostRecalculation()
        :kind==='supplierLinks'
          ?await previewSupplierProductRebuild()
          :await previewPriceHistoryRebuild();
      setRepairPreview({kind,data});
    }catch(e){showError(e instanceof Error?e.message:'No se pudo preparar la vista previa de mantenimiento.');}
    finally{setBusy(null);}
  };

  const applyRepair=async()=>{
    if(!repairPreview)return;
    const labels={costs:'recalcular los costes actuales',supplierLinks:'reconstruir relaciones producto-proveedor',priceHistory:'reconstruir enlaces del histórico de precios'} as const;
    if(!window.confirm('Se va a '+labels[repairPreview.kind]+'. La operación no elimina histórico. ¿Continuar?'))return;
    setBusy('repair-apply:'+repairPreview.kind);
    try{
      const data=repairPreview.kind==='costs'
        ?await recalculateProductCosts()
        :repairPreview.kind==='supplierLinks'
          ?await rebuildSupplierProductLinks()
          :await rebuildPriceHistoryLinks();
      setRepairPreview({kind:repairPreview.kind,data});
      showSuccess('Mantenimiento aplicado correctamente.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudo aplicar el mantenimiento.');}
    finally{setBusy(null);}
  };

  const prepareInvoiceReprocess=async()=>{
    if(!reprocessInvoiceId){showError('Selecciona una factura para reprocesar.');return;}
    setBusy('reprocess-preview');
    try{setReprocessPreview(await previewExpenseInvoiceReprocess(reprocessInvoiceId));}
    catch(e){showError(e instanceof Error?e.message:'No se pudo reprocesar la factura para vista previa.');}
    finally{setBusy(null);}
  };

  const confirmInvoiceReprocess=async()=>{
    if(!reprocessPreview)return;
    if(!window.confirm('Se actualizará la cabecera/extracción de esta factura con el parser actual. Las líneas y el histórico existente se conservarán. ¿Continuar?'))return;
    setBusy('reprocess-apply');
    try{
      await applyExpenseInvoiceReprocess(reprocessPreview);
      showSuccess('Factura reprocesada correctamente.');
      setReprocessPreview(null);
    }catch(e){showError(e instanceof Error?e.message:'No se pudo aplicar el reprocesado.');}
    finally{setBusy(null);}
  };

  const exportConfiguration=async()=>{
    setBusy('export');
    try{await downloadSettingsExport();showSuccess('Configuración exportada.');}
    catch(e){showError(e instanceof Error?e.message:'No se pudo exportar la configuración.');}
    finally{setBusy(null);}
  };

  const prepareGlobalReset=async()=>{
    setBusy('reset-preview');
    try{setResetPreview(await previewSettingsReset());}
    catch(e){showError(e instanceof Error?e.message:'No se pudo preparar la restauración.');}
    finally{setBusy(null);}
  };

  const confirmGlobalReset=async()=>{
    if(!resetPreview)return;
    if(!window.confirm('Se restaurarán a valores predeterminados '+resetPreview.changedCount+' secciones globales. Tus preferencias personales no se modificarán. ¿Continuar?'))return;
    setBusy('reset-all');
    try{
      await resetAllSettingsToDefaults();
      await refreshSettings();
      setDraft(DEFAULT_APP_SETTINGS.maintenance);
      setResetPreview(null);
      onDirtyChange(false);
      showSuccess('Configuración global restaurada a valores predeterminados.');
    }catch(e){showError(e instanceof Error?e.message:'No se pudo restaurar la configuración global.');}
    finally{setBusy(null);}
  };

  const evidenceLabel=(evidence:string)=>({
    same_tax_id:'Mismo NIF/VAT',same_normalized_name:'Mismo nombre normalizado',same_sku:'Mismo SKU',
    same_file_hash:'Mismo archivo',same_supplier_invoice_number:'Mismo proveedor + número',
    compatible_date:'Fecha compatible',compatible_amount:'Importe compatible',
  } as Record<string,string>)[evidence]||evidence;

  const candidateList=(kind:'supplier'|'client'|'product'|'invoice',rows:DuplicateCandidate[])=><div className="settingsMaintenanceList">
    {!rows.length?<div className="settingsEmptyMini">Sin candidatos por encima del umbral.</div>:rows.map(candidate=><div className="settingsMaintenanceCandidate" key={candidate.id}>
      <div><strong>{candidate.leftLabel} ↔ {candidate.rightLabel}</strong><small>{candidate.confidence}% · {candidate.evidence.map(evidenceLabel).join(' · ')}</small></div>
      {(kind==='supplier'||kind==='client')&&<div className="settingsInlineActions">
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void loadPreview(kind,candidate,false)}>Vista previa →</button>
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void loadPreview(kind,candidate,true)}>← Vista previa</button>
      </div>}
    </div>)}
  </div>;

  const affectedLabel=(key:string)=>({
    invoices:'Facturas de gasto',priceHistory:'Histórico de precios',products:'Productos',supplierProducts:'Relaciones producto-proveedor',
    salesInvoices:'Facturas de venta',aliases:'Alias',
  } as Record<string,string>)[key]||key;

  return <section className="settingsSectionCard">
    <div className="settingsSectionHero"><div className="settingsSectionIcon"><ShieldCheck size={22}/></div><div><h2>Mantenimiento</h2><p>Diagnóstico y correcciones explícitas. Ninguna acción histórica se ejecuta automáticamente al cambiar una configuración.</p></div></div>

    <div className="settingsSubsection">
      <h3>Análisis de duplicados</h3>
      <div className="settingsFormGrid">
        <label className="settingsField"><span>Umbral de candidato</span><div className="settingsNumberWithSuffix"><input type="number" min="0" max="100" value={draft.duplicateCandidateThreshold} onChange={e=>{setDraft(current=>({...current,duplicateCandidateThreshold:Number(e.target.value)}));onDirtyChange(true)}}/><em>%</em></div></label>
      </div>
      <div className="settingsInlineActions"><button type="button" className="primary" disabled={analyzing} onClick={()=>void analyze()}>{analyzing?'Analizando…':'Analizar duplicados'}</button></div>
      {analyzed&&<div className="settingsMaintenanceGroups">
        <div><h4>Proveedores · {duplicates.suppliers.length}</h4>{candidateList('supplier',duplicates.suppliers)}</div>
        <div><h4>Clientes · {duplicates.clients.length}</h4>{candidateList('client',duplicates.clients)}</div>
        <div><h4>Productos · {duplicates.products.length}</h4>{candidateList('product',duplicates.products)}<p className="settingsHelpText">Solo diagnóstico: no se permite fusión automática de productos.</p></div>
        <div><h4>Facturas · {duplicates.invoices.length}</h4>{candidateList('invoice',duplicates.invoices)}<p className="settingsHelpText">Solo diagnóstico: una factura candidata debe revisarse individualmente.</p></div>
      </div>}
    </div>

    {preview&&<div className="settingsSubsection settingsMergePreview">
      <h3>Vista previa</h3>
      <p><strong>{preview.data.sourceLabel}</strong> → <strong>{preview.data.destinationLabel}</strong></p>
      <div className="settingsPreviewCounts">{Object.entries(preview.data.affected).map(([key,value])=><span key={key}><strong>{value}</strong><small>{affectedLabel(key)}</small></span>)}</div>
      {preview.data.warnings.map(warning=><p className="settingsHelpText" key={warning}>{warning}</p>)}
      <div className="settingsInlineActions">
        <button type="button" className="secondary" onClick={()=>setPreview(null)}>Cancelar</button>
        <button type="button" className="primary" disabled={busy==='merge'} onClick={()=>void confirmMerge()}>{busy==='merge'?'Fusionando…':preview.kind==='supplier'?'Fusionar proveedor':'Fusionar cliente'}</button>
      </div>
    </div>}

    <div className="settingsSubsection">
      <h3>Diagnósticos de calidad</h3>
      <div className="settingsMaintenanceActions">
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void runDiagnostic('suppliersTax')}>Proveedores sin CIF/VAT</button>
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void runDiagnostic('clientsTax')}>Clientes sin NIF/VAT</button>
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void runDiagnostic('productsCost')}>Productos sin coste</button>
      </div>
      {Object.entries(diagnostics).map(([key,value])=><div className="settingsDiagnosticResult" key={key}><strong>{value.count}</strong><span>{value.names.length?value.names.join(' · '):'Sin incidencias'}</span></div>)}
    </div>

    <div className="settingsSubsection">
      <h3>Reparaciones explícitas</h3>
      <p className="settingsHelpText">Siempre se calcula una vista previa antes de modificar datos. Estas acciones no borran filas del histórico de precios.</p>
      <div className="settingsMaintenanceActions">
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void prepareRepair('costs')}>Vista previa · recalcular costes</button>
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void prepareRepair('supplierLinks')}>Vista previa · producto ↔ proveedor</button>
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void prepareRepair('priceHistory')}>Vista previa · histórico de precios</button>
      </div>
      {repairPreview&&<div className="settingsResetPreview">
        <strong>Vista previa · {repairPreview.kind==='costs'?'Costes actuales':repairPreview.kind==='supplierLinks'?'Relaciones producto-proveedor':'Histórico de precios'}</strong>
        <div className="settingsPreviewCounts">{Object.entries(repairPreview.data).filter(([key])=>!['ok','preview','message'].includes(key)).map(([key,value])=><span key={key}><strong>{String(value)}</strong><small>{key}</small></span>)}</div>
        {repairPreview.data.message&&<small>{String(repairPreview.data.message)}</small>}
        <div className="settingsInlineActions"><button type="button" className="secondary" onClick={()=>setRepairPreview(null)}>Cerrar</button>{repairPreview.data.preview!==false&&<button type="button" className="primary" disabled={busy!==null} onClick={()=>void applyRepair()}>Aplicar reparación</button>}</div>
      </div>}

      <div className="settingsMaintenanceReprocess">
        <label className="settingsField"><span>Reprocesar una factura con el parser actual</span><SearchableSelect ariaLabel="Factura a reprocesar" value={reprocessInvoiceId} options={reprocessOptions.map(item=>({value:item.id,label:item.label,searchText:item.fileName||''}))} onChange={value=>{setReprocessInvoiceId(value);setReprocessPreview(null)}} placeholder="Selecciona una factura…" searchPlaceholder="Buscar por número, proveedor o fecha…"/></label>
        <button type="button" className="secondary" disabled={busy!==null||!reprocessInvoiceId} onClick={()=>void prepareInvoiceReprocess()}>{busy==='reprocess-preview'?'Reprocesando…':'Vista previa de reprocesado'}</button>
      </div>
      {reprocessPreview&&<div className="settingsResetPreview">
        <strong>{reprocessPreview.label}</strong>
        <span>{reprocessPreview.changes.length?reprocessPreview.changes.join(' · ')+' cambiarán':'El parser no detecta cambios principales en la cabecera.'}</span>
        <div className="settingsPreviewCounts">
          <span><strong>{reprocessPreview.parsed.confidence.toLocaleString('es-ES',{style:'percent',maximumFractionDigits:0})}</strong><small>Confianza</small></span>
          <span><strong>{reprocessPreview.parsed.lines.length}</strong><small>Líneas detectadas</small></span>
          <span><strong>{reprocessPreview.parsed.total.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong><small>Total detectado</small></span>
        </div>
        {reprocessPreview.warnings.map(item=><small key={item}>{item}</small>)}
        <div className="settingsInlineActions"><button type="button" className="secondary" onClick={()=>setReprocessPreview(null)}>Cancelar</button><button type="button" className="primary" disabled={busy!==null} onClick={()=>void confirmInvoiceReprocess()}>{busy==='reprocess-apply'?'Aplicando…':'Aplicar reprocesado'}</button></div>
      </div>}
    </div>

    <div className="settingsSubsection">
      <h3>Sincronización manual</h3>
      <p className="settingsHelpText">Estas acciones son explícitas y no cambian los interruptores de sincronización automática.</p>
      <div className="settingsMaintenanceActions">
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void runSync('sendcloud')}>{busy==='sync:sendcloud'?'Sincronizando…':'Sincronizar Sendcloud ahora'}</button>
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void runSync('amazon')}>{busy==='sync:amazon'?'Sincronizando…':'Sincronizar Amazon ahora'}</button>
      </div>
    </div>

    <div className="settingsSubsection">
      <h3>Configuración global</h3>
      <p className="settingsHelpText">La exportación contiene únicamente configuración no secreta. La restauración global no modifica “Mis preferencias”.</p>
      <div className="settingsMaintenanceActions">
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void exportConfiguration()}>{busy==='export'?'Exportando…':'Exportar configuración'}</button>
        <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void prepareGlobalReset()}>{busy==='reset-preview'?'Calculando…':'Restaurar configuración global'}</button>
      </div>
      {resetPreview&&<div className="settingsResetPreview">
        <strong>Vista previa del reset</strong>
        <span>{resetPreview.changedCount} secciones cambiarán.</span>
        <small>{resetPreview.changedSections.length?'Cambios: '+resetPreview.changedSections.join(', '):'La configuración global ya coincide con los valores predeterminados.'}</small>
        {resetPreview.changedCount>0&&<div className="settingsInlineActions"><button type="button" className="secondary" onClick={()=>setResetPreview(null)}>Cancelar</button><button type="button" className="primary" disabled={busy==='reset-all'} onClick={()=>void confirmGlobalReset()}>{busy==='reset-all'?'Restaurando…':'Confirmar restauración global'}</button></div>}
      </div>}
    </div>

    <div className="settingsSectionActions"><button type="button" className="secondary" disabled={saving} onClick={()=>void restore()}>Restaurar valores predeterminados</button><button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Guardar cambios'}</button></div>
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
        {active&&active.id==='preferences'?<PreferencesSection onDirtyChange={setDirty}/>:active&&active.id==='general'?<GeneralSection onDirtyChange={setDirty}/>:active&&active.id==='sales'?<SalesSection onDirtyChange={setDirty}/>:active&&active.id==='orders'?<OrdersSection onDirtyChange={setDirty}/>:active&&active.id==='shipping'?<ShippingSection onDirtyChange={setDirty}/>:active&&active.id==='amazon'?<AmazonSection onDirtyChange={setDirty}/>:active&&active.id==='integrations'?<IntegrationsSection onDirtyChange={setDirty}/>:active&&active.id==='automations'?<AlertsSection onDirtyChange={setDirty}/>:active&&active.id==='expenses'?<ExpensesSection onDirtyChange={setDirty}/>:active&&active.id==='products'?<ProductsSection onDirtyChange={setDirty}/>:active&&active.id==='clients'?<ClientsSection onDirtyChange={setDirty}/>:active&&active.id==='suppliers'?<SuppliersSection onDirtyChange={setDirty}/>:active&&active.id==='maintenance'?<MaintenanceSection onDirtyChange={setDirty}/>:active&&<SectionPlaceholder section={active}/>} 
      </div>
    </div>
  </div>;
}
