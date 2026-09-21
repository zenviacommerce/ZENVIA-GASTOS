import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../services/supabase';
import {
  loadAppSettings,
  loadUserPreferences,
  resetSettingsSection,
  saveSettingsSection,
  saveUserPreferences,
} from '../services/settings';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_USER_PREFERENCES,
  type AppSettings,
  type SettingsSection,
  type SettingsWarning,
  type UserPreferences,
} from '../services/settingsSchema';

type SettingsContextValue = {
  settings: AppSettings;
  preferences: UserPreferences;
  warnings: SettingsWarning[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateSection: <K extends SettingsSection>(section: K, value: AppSettings[K]) => Promise<void>;
  resetSection: <K extends SettingsSection>(section: K) => Promise<void>;
  updatePreferences: (value: UserPreferences) => Promise<void>;
};

const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

const SettingsContext=createContext<SettingsContextValue|undefined>(undefined);

export function SettingsProvider({children,userId}:{children:ReactNode;userId?:string|null}){
  const [authUserId,setAuthUserId]=useState<string|null>(null);
  const effectiveUserId=userId===undefined?authUserId:userId;
  const [settings,setSettings]=useState<AppSettings>(()=>clone(DEFAULT_APP_SETTINGS));
  const [preferences,setPreferences]=useState<UserPreferences>(()=>clone(DEFAULT_USER_PREFERENCES));
  const [warnings,setWarnings]=useState<SettingsWarning[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    if(userId!==undefined)return;
    let active=true;
    supabase.auth.getSession()
      .then(({data})=>{if(active)setAuthUserId(data.session?.user.id||null);})
      .catch(()=>{if(active)setAuthUserId(null);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(active)setAuthUserId(session?.user.id||null);});
    return()=>{active=false;subscription.unsubscribe();};
  },[userId]);

  const refresh=useCallback(async()=>{
    if(!effectiveUserId){
      setSettings(clone(DEFAULT_APP_SETTINGS));
      setPreferences(clone(DEFAULT_USER_PREFERENCES));
      setWarnings([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const nextWarnings:SettingsWarning[]=[];
    let nextSettings=clone(DEFAULT_APP_SETTINGS);
    let nextPreferences=clone(DEFAULT_USER_PREFERENCES);
    const errors:string[]=[];

    try{
      const loaded=await loadAppSettings();
      nextSettings=loaded.settings;
      nextWarnings.push(...loaded.warnings);
    }catch(e){
      nextWarnings.push({path:'$',message:'No se pudo cargar la configuración global; se usan valores predeterminados temporalmente.'});
      errors.push(e instanceof Error?e.message:'No se pudo cargar la configuración global.');
    }

    try{
      const loaded=await loadUserPreferences();
      nextPreferences=loaded.preferences;
      nextWarnings.push(...loaded.warnings.map(item=>({...item,path:`preferences.${item.path}`})));
    }catch(e){
      nextWarnings.push({path:'preferences',message:'No se pudieron cargar tus preferencias; se usan valores predeterminados temporalmente.'});
      errors.push(e instanceof Error?e.message:'No se pudieron cargar tus preferencias.');
    }

    setSettings(nextSettings);
    setPreferences(nextPreferences);
    setWarnings(nextWarnings);
    setError(errors.length?errors.join(' · '):null);
    setLoading(false);
  },[effectiveUserId]);

  useEffect(()=>{void refresh()},[refresh]);

  const updateSection=useCallback(async<K extends SettingsSection>(section:K,value:AppSettings[K])=>{
    const loaded=await saveSettingsSection(section,value);
    setSettings(loaded.settings);
    setWarnings(current=>[
      ...current.filter(item=>item.path!==section&&!item.path.startsWith(`${section}.`)),
      ...loaded.warnings,
    ]);
  },[]);

  const resetSection=useCallback(async<K extends SettingsSection>(section:K)=>{
    const loaded=await resetSettingsSection(section);
    setSettings(loaded.settings);
    setWarnings(loaded.warnings);
  },[]);

  const updatePreferences=useCallback(async(value:UserPreferences)=>{
    const loaded=await saveUserPreferences(value);
    setPreferences(loaded.preferences);
    setWarnings(current=>[
      ...current.filter(item=>!item.path.startsWith('preferences')),
      ...loaded.warnings.map(item=>({...item,path:`preferences.${item.path}`})),
    ]);
  },[]);

  const value=useMemo<SettingsContextValue>(()=>({
    settings,preferences,warnings,loading,error,refresh,updateSection,resetSection,updatePreferences,
  }),[settings,preferences,warnings,loading,error,refresh,updateSection,resetSection,updatePreferences]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(){
  const value=useContext(SettingsContext);
  if(!value)throw new Error('useSettings debe utilizarse dentro de SettingsProvider.');
  return value;
}
