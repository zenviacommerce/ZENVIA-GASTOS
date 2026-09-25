import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('global activity host is mounted and supports determinate and indeterminate progress',async()=>{
  const [main,service,component,css]=await Promise.all([
    read('../src/main.tsx'),
    read('../src/services/activity.ts'),
    read('../src/components/ActivityCenter.tsx'),
    read('../src/activity.css'),
  ]);
  assert.match(main,/ActivityCenter/);
  assert.match(service,/startActivity/);
  assert.match(service,/withActivity/);
  assert.match(component,/quedan/);
  assert.match(component,/restantes/);
  assert.match(component,/isIndeterminate/);
  assert.match(css,/activityIndeterminate/);
});

test('expense and sales exports report file and zip progress',async()=>{
  const [expenses,sales]=await Promise.all([
    read('../src/services/exportQuarter.ts'),
    read('../src/services/salesInvoiceExport.ts'),
  ]);
  for(const source of [expenses,sales]){
    assert.match(source,/startActivity/);
    assert.match(source,/generateAsync\([^\n]*metadata=>/);
    assert.match(source,/progress:/);
    assert.match(source,/current:/);
    assert.match(source,/total:/);
    assert.match(source,/activity\.finish\(\)/);
  }
});

test('Amazon requests expose background work and tables do not show false empty states',async()=>{
  const [service,products,marketplaces,orders,inventory,unmapped]=await Promise.all([
    read('../src/services/amazon.ts'),
    read('../src/components/amazon/AmazonProducts.tsx'),
    read('../src/components/amazon/AmazonMarketplaces.tsx'),
    read('../src/components/amazon/AmazonOrders.tsx'),
    read('../src/components/amazon/AmazonInventory.tsx'),
    read('../src/components/amazon/AmazonUnmapped.tsx'),
  ]);
  assert.match(service,/Cargando resumen de Amazon/);
  assert.match(service,/Cargando detalle de Amazon/);
  assert.match(service,/Cargando evolución de Amazon/);
  assert.match(service,/Cargando productos de Amazon/);
  assert.match(service,/activity\.finish\(\)/);
  assert.match(products,/loading\?'Cargando productos de Amazon/);
  assert.match(marketplaces,/loading\?'Cargando marketplaces de Amazon/);
  assert.match(orders,/loading\?'Cargando pedidos de Amazon/);
  assert.match(inventory,/loading\?'Cargando inventario de Amazon/);
  assert.match(unmapped,/loading\?'Cargando SKU sin vincular/);
});
