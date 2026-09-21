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


export const DASHBOARD_KPI_DEFAULTS=[
  'sales','expenses','result','vatBalance','receivable','pendingExpenses',
  'orders','orderValue','pendingOrders','shippedOrders','cancelledOrders',
] as const;

export const TABLE_COLUMN_DEFAULTS={
  expenses:['date','supplier','invoice','category','source','status','vat','total'],
  suppliers:['supplier','taxId','type','category','contact','invoiceCount','spend','lastInvoice'],
  clients:['client','taxId','country','contact','invoiced','pending','lastInvoice'],
  products:['product','sku','supplier','lastPurchase','cost','salePrice','margin','costChange'],
} as const;

export type PreferenceTableKey=keyof typeof TABLE_COLUMN_DEFAULTS;

export function visibleTableColumns(preferences:UserPreferences,table:PreferenceTableKey):string[]{
  const defaults=[...TABLE_COLUMN_DEFAULTS[table]];
  if(!Object.prototype.hasOwnProperty.call(preferences.tableColumns,table))return defaults;
  const allowed=new Set<string>(defaults);
  return (preferences.tableColumns[table]||[]).filter(key=>allowed.has(key));
}

export function hiddenTableColumns(preferences:UserPreferences,table:PreferenceTableKey):string{
  const visible=new Set(visibleTableColumns(preferences,table));
  return TABLE_COLUMN_DEFAULTS[table].filter(key=>!visible.has(key)).join(' ');
}
