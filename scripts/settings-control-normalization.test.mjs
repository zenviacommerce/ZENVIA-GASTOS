import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('configuration raw text controls use the shared visual system',async()=>{
  const css=await read('src/settings.css');
  assert.match(css,/\.settingsContent input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='file'\]\)/);
  assert.match(css,/min-height:42px/);
  assert.match(css,/border-radius:10px/);
  assert.match(css,/border-color:#14b8a6/);
  assert.match(css,/accent-color:#0f766e/);
});

test('all static settings-specific layout classes used by SettingsPage have a CSS definition',async()=>{
  const page=await read('src/pages/Settings.tsx');
  const css=await read('src/settings.css');
  const classes=new Set();
  for(const match of page.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)){
    const raw=(match[1]||match[2]||'').replace(/\$\{[^}]+\}/g,' ');
    for(const name of raw.split(/\s+/).filter(Boolean)){
      if(name.startsWith('settings'))classes.add(name);
    }
  }
  const missing=[...classes].filter(name=>!css.includes(`.${name}`));
  assert.deepEqual(missing,[]);
});

test('repeaters aliases and compact checks have responsive layouts',async()=>{
  const css=await read('src/settings.css');
  for(const selector of ['settingsRepeaterRow','settingsAliasCreate','settingsAliasRow','settingsInlineCheck','settingsFieldGroup','settingsInlineChecks','settingsPreferenceColumns','settingsSubsectionHead']){
    assert.match(css,new RegExp(`\\.${selector}`),selector);
  }
  assert.match(css,/@media\(max-width:620px\)[\s\S]*\.settingsRepeaterRow[\s\S]*grid-template-columns:1fr/);
});
