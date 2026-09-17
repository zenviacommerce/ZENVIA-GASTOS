import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('Dashboard refreshes Sendcloud before reading order KPIs',async()=>{
  const dashboard=await source('src/pages/Dashboard.tsx');
  assert.match(dashboard,/syncSendcloudOrders/);
  assert.match(dashboard,/await\s+syncSendcloudOrders\(false\)/);
  assert.match(dashboard,/await\s+listFulfillmentOrders\(\)/);
});

test('Dashboard keeps order KPIs fresh every 60 seconds',async()=>{
  const dashboard=await source('src/pages/Dashboard.tsx');
  assert.match(dashboard,/setInterval\([^]*60000\)/);
  assert.match(dashboard,/clearInterval/);
});
