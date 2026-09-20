import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadSchema(){
  const source=await readFile(new URL('../src/services/settingsSchema.ts',import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('configuration defaults preserve current production behavior',async()=>{
  const {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES}=await loadSchema();
  assert.equal(DEFAULT_APP_SETTINGS.sales.defaultDueDays,30);
  assert.equal(DEFAULT_APP_SETTINGS.general.currencyCode,'EUR');
  assert.equal(DEFAULT_APP_SETTINGS.general.countryCode,'ES');
  assert.equal(DEFAULT_APP_SETTINGS.orders.labelFilenameStrategy,'order_number');
  assert.equal(DEFAULT_APP_SETTINGS.orders.refreshSeconds,60);
  assert.equal(DEFAULT_USER_PREFERENCES.theme,'system');
  assert.equal(DEFAULT_USER_PREFERENCES.pageSize,20);
  assert.equal(DEFAULT_USER_PREFERENCES.defaultPeriod,'current_quarter');
  assert.equal(DEFAULT_USER_PREFERENCES.startPage,null);
});

test('invalid nested setting falls back without discarding valid siblings',async()=>{
  const {normalizeAppSettings}=await loadSchema();
  const result=normalizeAppSettings({
    sales:{defaultDueDays:999,defaultPaymentMethod:'bank_transfer'},
    general:{currencyCode:'EUR',countryCode:'ES'},
  });
  assert.equal(result.value.sales.defaultDueDays,30);
  assert.equal(result.value.sales.defaultPaymentMethod,'bank_transfer');
  assert.equal(result.value.general.currencyCode,'EUR');
  assert.ok(result.warnings.some(item=>item.path==='sales.defaultDueDays'));
});

test('unknown keys and malformed root do not break settings normalization',async()=>{
  const {normalizeAppSettings,DEFAULT_APP_SETTINGS}=await loadSchema();
  const malformed=normalizeAppSettings(null);
  assert.deepEqual(malformed.value,DEFAULT_APP_SETTINGS);
  assert.ok(malformed.warnings.length>0);

  const result=normalizeAppSettings({general:{currencyCode:'USD',unknownFlag:true},totallyUnknown:{x:1}});
  assert.equal(result.value.general.currencyCode,'USD');
  assert.equal(result.value.general.countryCode,'ES');
  assert.ok(result.warnings.some(item=>item.path==='general.unknownFlag'));
  assert.ok(result.warnings.some(item=>item.path==='totallyUnknown'));
});

test('user preference normalization accepts approved values and rejects unsupported page sizes',async()=>{
  const {normalizeUserPreferences}=await loadSchema();
  const valid=normalizeUserPreferences({theme:'system',pageSize:50,startPage:null,defaultPeriod:'current_month'});
  assert.equal(valid.value.theme,'system');
  assert.equal(valid.value.pageSize,50);
  assert.equal(valid.value.startPage,null);
  assert.equal(valid.value.defaultPeriod,'current_month');

  const invalid=normalizeUserPreferences({pageSize:37,theme:'neon'});
  assert.equal(invalid.value.pageSize,20);
  assert.equal(invalid.value.theme,'system');
  assert.ok(invalid.warnings.some(item=>item.path==='pageSize'));
  assert.ok(invalid.warnings.some(item=>item.path==='theme'));
});

test('section validation rejects out-of-contract values',async()=>{
  const {validateSettingsSection,DEFAULT_APP_SETTINGS}=await loadSchema();
  assert.deepEqual(validateSettingsSection('sales',DEFAULT_APP_SETTINGS.sales),[]);
  assert.ok(validateSettingsSection('sales',{...DEFAULT_APP_SETTINGS.sales,defaultDueDays:-1}).length>0);
  assert.ok(validateSettingsSection('orders',{...DEFAULT_APP_SETTINGS.orders,refreshSeconds:5}).length>0);
});
