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
  Truck,
  UserRound,
  Users,
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';

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
    return()=>window.dispatchEvent(new CustomEvent('zenvia:settings-dirty',{detail:{dirty:false}}));
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
        {active&&<SectionPlaceholder section={active}/>}
      </div>
    </div>
  </div>;
}
