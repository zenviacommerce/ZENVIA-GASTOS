import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('Dashboard refreshes Sendcloud before reading order KPIs when the integration is enabled',async()=>{
  const dashboard=await source('src/pages/Dashboard.tsx');
  assert.match(dashboard,/settings\.integrations\.sendcloudEnabled/);
  assert.match(dashboard,/await\s+syncSendcloudOrders\(false,true,true\)/);
  assert.match(dashboard,/await\s+listFulfillmentOrders\(\)/);
});

test('Dashboard uses the configured order refresh interval',async()=>{
  const dashboard=await source('src/pages/Dashboard.tsx');
  assert.match(dashboard,/settings\.orders\.refreshSeconds/);
  assert.match(dashboard,/Math\.max\(30,settings\.orders\.refreshSeconds\)\*1000/);
  assert.match(dashboard,/clearInterval/);
  assert.doesNotMatch(dashboard,/setInterval\([^\n]*60000/);
});
