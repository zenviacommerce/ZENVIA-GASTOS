import type { ThemePreference, UserPreferences } from './settingsSchema';

export type ResolvedTheme='light'|'dark';

export function resolveThemePreference(theme:ThemePreference,prefersDark:boolean):ResolvedTheme{
  if(theme==='dark')return 'dark';
  if(theme==='light')return 'light';
  return prefersDark?'dark':'light';
}

export function effectiveStartPage<T extends string>(
  personal:string|null,
  company:string,
  allowed:readonly T[],
):T|null{
  const candidates=[personal,company,...allowed];
  for(const candidate of candidates){
    if(candidate&&allowed.includes(candidate as T))return candidate as T;
  }
  return null;
}


const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

export function rememberedFilter<T>(
  preferences:UserPreferences,
  key:string,
  fallback:T,
):T{
  if(!preferences.rememberFilters)return clone(fallback);
  const stored=preferences.filters[key];
  if(stored===undefined||stored===null)return clone(fallback);
  return clone(stored as T);
}

export async function persistRememberedFilter(
  preferences:UserPreferences,
  updatePreferences:(value:UserPreferences)=>Promise<void>,
  key:string,
  value:unknown,
){
  if(!preferences.rememberFilters)return false;
  const current=preferences.filters[key];
  if(JSON.stringify(current??null)===JSON.stringify(value??null))return false;
  await updatePreferences({...preferences,filters:{...preferences.filters,[key]:clone(value)}});
  return true;
}

export function selectedPreferenceKeys(configured:string[],defaults:readonly string[]){
  const allowed=new Set(defaults);
  const selected=configured.filter(key=>allowed.has(key));
  return selected.length?Array.from(new Set(selected)):[...defaults];
}
