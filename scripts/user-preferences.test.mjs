import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function transpiled(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('theme resolution supports system and safe fallback behavior',async()=>{
  const {resolveThemePreference}=await transpiled('../src/services/uiPreferences.ts');
  assert.equal(resolveThemePreference('dark',false),'dark');
  assert.equal(resolveThemePreference('light',true),'light');
  assert.equal(resolveThemePreference('system',true),'dark');
  assert.equal(resolveThemePreference('system',false),'light');
});

test('default date filter accepts the configured initial period',async()=>{
  const {defaultDateFilter}=await transpiled('../src/services/filters.ts');
  const now=new Date(2026,8,21,12,0,0);
  assert.deepEqual(defaultDateFilter('current_month',now),{preset:'current_month',from:'2026-09-01',to:'2026-09-30'});
});

test('auto pagination reads page size from user preferences instead of a fixed constant',async()=>{
  const source=await readFile(new URL('../src/components/AutoPagination.tsx',import.meta.url),'utf8');
  assert.match(source,/useSettings/);
  assert.match(source,/preferences\.pageSize/);
  assert.doesNotMatch(source,/const PAGE_SIZE\s*=\s*20/);
});

test('Mis preferencias exposes only controls that persist through updatePreferences',async()=>{
  const source=await readFile(new URL('../src/pages/Settings.tsx',import.meta.url),'utf8');
  assert.match(source,/Preferencias de interfaz/);
  assert.match(source,/updatePreferences/);
  assert.match(source,/Tema/);
  assert.match(source,/Densidad/);
  assert.match(source,/Registros por página/);
  assert.match(source,/Página inicial/);
  assert.match(source,/Periodo inicial/);
  assert.match(source,/Guardar preferencias/);
});

test('application resolves theme and start page from effective preferences',async()=>{
  const source=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(source,/useSettings/);
  assert.match(source,/resolveThemePreference/);
  assert.match(source,/preferences\.startPage/);
  assert.match(source,/settings\.general\.startPage/);
});


test('visible table columns honor saved order and ignore unknown keys',async()=>{
  const {orderedTableColumns}=await transpiled('../src/services/uiPreferences.ts');
  const preferences={
    theme:'system',density:'comfortable',pageSize:20,startPage:null,defaultPeriod:'current_quarter',
    rememberFilters:true,
    tableColumns:{clients:['client','country','pending']},
    tableColumnOrder:{clients:['pending','unknown','client']},
    dashboardKpis:[],filters:{},labelPrinterId:null,
  };
  assert.deepEqual(orderedTableColumns(preferences,'clients'),['pending','client','country']);
});

test('Mis preferencias exposes column ordering controls',async()=>{
  const source=await readFile(new URL('../src/pages/Settings.tsx',import.meta.url),'utf8');
  assert.match(source,/tableColumnOrder/);
  assert.match(source,/moveColumn/);
  assert.match(source,/Mover columna a la izquierda/);
  assert.match(source,/Mover columna a la derecha/);
});
