import { supabase } from './supabase';
import { loadAppSettings } from './settings';
import { APP_SETTINGS_SCHEMA_VERSION, DEFAULT_APP_SETTINGS, type AppSettings, type SettingsSection } from './settingsSchema';
import { loadBusinessSettings } from './sales';
import { loadTaxRegistrations, loadManagedSalesSeries } from './salesConfig';
import { loadEntityAliases } from './entityAliases';
import { loadShippingRules } from './shippingRules';
import { loadAutomationRules } from './automationRules';

export type SettingsExport={
  format:'zenvia-gestion-settings';
  version:1;
  exportedAt:string;
  businessSettings:Awaited<ReturnType<typeof loadBusinessSettings>>;
  branding:{logoPath:string|null};
  taxRegistrations:Awaited<ReturnType<typeof loadTaxRegistrations>>;
  invoiceSeries:Awaited<ReturnType<typeof loadManagedSalesSeries>>;
  appSettings:AppSettings;
  aliases:Awaited<ReturnType<typeof loadEntityAliases>>;
  shippingRules:Awaited<ReturnType<typeof loadShippingRules>>;
  automationRules:Awaited<ReturnType<typeof loadAutomationRules>>;
};

export type SettingsResetPreview={
  changedSections:SettingsSection[];
  unchangedSections:SettingsSection[];
  changedCount:number;
};

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export async function buildSettingsExport():Promise<SettingsExport>{
  const loaded=await loadAppSettings();
  const [
    businessSettings,
    brandingRow,
    taxRegistrations,
    invoiceSeries,
    aliases,
    shippingRules,
    automationRules,
  ]=await Promise.all([
    loadBusinessSettings(),
    supabase.from('company_branding').select('logo_path').eq('owner_id',loaded.ownerId).maybeSingle(),
    loadTaxRegistrations(),
    loadManagedSalesSeries(),
    loadEntityAliases(),
    loadShippingRules({ensureDefaults:false}),
    loadAutomationRules(),
  ]);

  if(brandingRow.error)throw brandingRow.error;

  return {
    format:'zenvia-gestion-settings',
    version:1,
    exportedAt:new Date().toISOString(),
    businessSettings,
    branding:{logoPath:brandingRow.data?.logo_path||null},
    taxRegistrations,
    invoiceSeries,
    appSettings:clone(loaded.settings),
    aliases,
    shippingRules,
    automationRules,
  };
}

export async function downloadSettingsExport(){
  const payload=await buildSettingsExport();
  const date=payload.exportedAt.slice(0,10);
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download='zenvia-gestion-configuracion-'+date+'.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),30000);
  return payload;
}

export async function previewSettingsReset():Promise<SettingsResetPreview>{
  const loaded=await loadAppSettings();
  const keys=Object.keys(DEFAULT_APP_SETTINGS) as SettingsSection[];
  const changedSections=keys.filter(key=>!equal(loaded.settings[key],DEFAULT_APP_SETTINGS[key]));
  return {
    changedSections,
    unchangedSections:keys.filter(key=>!changedSections.includes(key)),
    changedCount:changedSections.length,
  };
}

export async function resetAllSettingsToDefaults(){
  const preview=await previewSettingsReset();
  const {error}=await supabase.rpc('configuration_reset_app_settings',{
    p_schema_version:APP_SETTINGS_SCHEMA_VERSION,
    p_config:clone(DEFAULT_APP_SETTINGS),
  });
  if(error)throw error;
  return {preview,settings:clone(DEFAULT_APP_SETTINGS)};
}
