import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('theme is applied in HTML before React bootstraps',async()=>{
  const html=await read('../index.html');
  const bootstrap=html.indexOf('zenvia-gestion-theme-preference');
  const app=html.indexOf('/src/main.tsx');
  assert.ok(bootstrap>0);
  assert.ok(app>bootstrap);
  assert.match(html,/document\.documentElement\.dataset\.theme=theme/);
  assert.match(html,/prefers-color-scheme: dark/);
});

test('SettingsProvider starts from cached preference instead of system default',async()=>{
  const source=await read('../src/context/SettingsContext.tsx');
  assert.match(source,/function initialUserPreferences/);
  assert.match(source,/zenvia-gestion-theme-preference/);
  assert.match(source,/useState<UserPreferences>\(initialUserPreferences\)/);
});

test('App caches both the actual preference and resolved visual theme',async()=>{
  const source=await read('../src/App.tsx');
  assert.match(source,/THEME_PREFERENCE_KEY = 'zenvia-gestion-theme-preference'/);
  assert.match(source,/safeStorageSet\('local',THEME_PREFERENCE_KEY,preferences\.theme\)/);
  assert.match(source,/safeStorageSet\('local',THEME_KEY,theme\)/);
});
