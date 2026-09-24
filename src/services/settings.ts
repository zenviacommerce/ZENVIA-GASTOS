import { supabase } from './supabase';
import { safeStorageGet } from './browserStorage';
import {
  APP_SETTINGS_SCHEMA_VERSION,
  DEFAULT_APP_SETTINGS,
  DEFAULT_USER_PREFERENCES,
  USER_PREFERENCES_SCHEMA_VERSION,
  normalizeAppSettings,
  normalizeUserPreferences,
  validateSettingsSection,
  type AppSettings,
  type SettingsSection,
  type SettingsWarning,
  type UserPreferences,
} from './settingsSchema';

type RawAppSettingsRow = {
  owner_id: string;
  schema_version: number;
  config: unknown;
};

type WorkspaceContext = {
  userId: string;
  ownerId: string;
};

export type LoadedAppSettings = {
  ownerId: string;
  schemaVersion: number;
  settings: AppSettings;
  warnings: SettingsWarning[];
};

export type LoadedUserPreferences = {
  userId: string;
  ownerId: string;
  schemaVersion: number;
  preferences: UserPreferences;
  warnings: SettingsWarning[];
};

export type UserPreferencesPatch = Partial<UserPreferences>;

export function mergeUserPreferencesPatch(current:UserPreferences,patch:UserPreferencesPatch):UserPreferences{
  return {
    ...current,
    ...patch,
    filters:patch.filters?{...current.filters,...patch.filters}:current.filters,
    tableColumns:patch.tableColumns?{...current.tableColumns,...patch.tableColumns}:current.tableColumns,
    tableColumnOrder:patch.tableColumnOrder?{...current.tableColumnOrder,...patch.tableColumnOrder}:current.tableColumnOrder,
    dismissedAlerts:patch.dismissedAlerts?{...current.dismissedAlerts,...patch.dismissedAlerts}:current.dismissedAlerts,
  };
}

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);

async function loadWorkspaceContext():Promise<WorkspaceContext>{
  const {data:{user},error:userError}=await supabase.auth.getUser();
  if(userError)throw userError;
  if(!user)throw new Error('No hay una sesión activa.');

  const {data:profile,error:profileError}=await supabase
    .from('app_users')
    .select('data_owner_id')
    .eq('user_id',user.id)
    .maybeSingle();
  if(profileError)throw profileError;

  return {userId:user.id,ownerId:profile?.data_owner_id||user.id};
}

async function loadRawAppSettings(ownerId:string):Promise<RawAppSettingsRow|null>{
  const {data,error}=await supabase
    .from('app_settings')
    .select('owner_id,schema_version,config')
    .eq('owner_id',ownerId)
    .maybeSingle();
  if(error)throw error;
  return data as RawAppSettingsRow|null;
}

export async function loadAppSettings():Promise<LoadedAppSettings>{
  const {ownerId}=await loadWorkspaceContext();
  const row=await loadRawAppSettings(ownerId);
  if(!row){
    return {
      ownerId,
      schemaVersion:APP_SETTINGS_SCHEMA_VERSION,
      settings:clone(DEFAULT_APP_SETTINGS),
      warnings:[],
    };
  }
  const normalized=normalizeAppSettings(row.config);
  return {
    ownerId,
    schemaVersion:Number(row.schema_version)||APP_SETTINGS_SCHEMA_VERSION,
    settings:normalized.value,
    warnings:normalized.warnings,
  };
}

export async function saveSettingsSection<K extends SettingsSection>(
  section:K,
  value:AppSettings[K],
):Promise<LoadedAppSettings>{
  const validation=validateSettingsSection(section,value);
  if(validation.length)throw new Error(validation.join('\n'));

  const {ownerId}=await loadWorkspaceContext();
  const current=await loadRawAppSettings(ownerId);
  const rawConfig=isRecord(current?.config)?current!.config:{};
  const nextConfig={...rawConfig,[section]:clone(value)};

  const {error}=await supabase
    .from('app_settings')
    .upsert({
      owner_id:ownerId,
      schema_version:APP_SETTINGS_SCHEMA_VERSION,
      config:nextConfig,
      updated_at:new Date().toISOString(),
    },{onConflict:'owner_id'});
  if(error)throw error;
  return loadAppSettings();
}

export async function resetSettingsSection<K extends SettingsSection>(section:K):Promise<LoadedAppSettings>{
  return saveSettingsSection(section,clone(DEFAULT_APP_SETTINGS[section]));
}

export async function loadUserPreferences():Promise<LoadedUserPreferences>{
  const {userId,ownerId}=await loadWorkspaceContext();
  const {data,error}=await supabase
    .from('user_preferences')
    .select('schema_version,preferences')
    .eq('user_id',userId)
    .eq('owner_id',ownerId)
    .maybeSingle();
  if(error)throw error;
  if(!data){
    const preferences=clone(DEFAULT_USER_PREFERENCES);
    const legacyTheme=safeStorageGet('local','zenvia-gestion-theme')||safeStorageGet('local','zenvia-gastos-theme');
    const legacyPrinter=safeStorageGet('local','zenvia-label-printer');
    let migrated=false;
    if(legacyTheme==='dark'||legacyTheme==='light'){preferences.theme=legacyTheme;migrated=true;}
    if(legacyPrinter){preferences.labelPrinterId=legacyPrinter;migrated=true;}
    if(migrated){
      const {error:migrationError}=await supabase
        .from('user_preferences')
        .upsert({
          user_id:userId,
          owner_id:ownerId,
          schema_version:USER_PREFERENCES_SCHEMA_VERSION,
          preferences,
          updated_at:new Date().toISOString(),
        },{onConflict:'user_id,owner_id'});
      if(migrationError){
        return {
          userId,
          ownerId,
          schemaVersion:USER_PREFERENCES_SCHEMA_VERSION,
          preferences,
          warnings:[{path:'preferences',message:'Se han aplicado tus preferencias antiguas, pero todavía no se pudieron guardar en la cuenta.'}],
        };
      }
    }
    return {
      userId,
      ownerId,
      schemaVersion:USER_PREFERENCES_SCHEMA_VERSION,
      preferences,
      warnings:[],
    };
  }
  const normalized=normalizeUserPreferences(data.preferences);
  return {
    userId,
    ownerId,
    schemaVersion:Number(data.schema_version)||USER_PREFERENCES_SCHEMA_VERSION,
    preferences:normalized.value,
    warnings:normalized.warnings,
  };
}

export async function saveUserPreferences(value:UserPreferences):Promise<LoadedUserPreferences>{
  const normalized=normalizeUserPreferences(value);
  if(normalized.warnings.length){
    throw new Error(normalized.warnings.map(item=>`${item.path}: ${item.message}`).join('\n'));
  }
  const {userId,ownerId}=await loadWorkspaceContext();
  const {error}=await supabase
    .from('user_preferences')
    .upsert({
      user_id:userId,
      owner_id:ownerId,
      schema_version:USER_PREFERENCES_SCHEMA_VERSION,
      preferences:normalized.value,
      updated_at:new Date().toISOString(),
    },{onConflict:'user_id,owner_id'});
  if(error)throw error;
  return loadUserPreferences();
}

export async function patchUserPreferences(patch:UserPreferencesPatch):Promise<LoadedUserPreferences>{
  const current=await loadUserPreferences();
  return saveUserPreferences(mergeUserPreferencesPatch(current.preferences,patch));
}
