import type { ThemePreference } from './settingsSchema';

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
