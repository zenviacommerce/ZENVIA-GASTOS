import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('post-login bootstrap cannot remain indefinitely in the initial auth spinner after getSession rejection',async()=>{
  const app=await read('src/App.tsx');
  assert.match(app,/getSession\(\)[^\n]*catch\(\(\)=>\{setSession\(null\);setAuthReady\(true\)\}\)/);
  assert.match(app,/withTimeout\(loadAccessProfile\(userId\),12000/);
  assert.match(app,/No se pudo cargar el acceso/);
  assert.match(app,/Reintentar/);
});

test('settings and preferences refresh when the effective authenticated user changes',async()=>{
  const context=await read('src/context/SettingsContext.tsx');
  assert.match(context,/const refresh=useCallback\(async\(\)=>\{/);
  assert.match(context,/\},\[effectiveUserId\]\);/);
  assert.match(context,/useEffect\(\(\)=>\{void refresh\(\)\},\[refresh\]\)/);
});

test('tablet account drawer keeps Settings and Administration available',async()=>{
  const sidebar=await read('src/components/Sidebar.tsx');
  const theme=await read('src/theme-consistency.css');
  assert.match(sidebar,/settingsSidebarButton/);
  assert.match(sidebar,/adminSidebarButton/);
  assert.match(theme,/sidebarBottom \.settingsSidebarButton/);
  assert.match(theme,/sidebarBottom \.adminSidebarButton/);
  assert.match(theme,/display:flex!important/);
});
