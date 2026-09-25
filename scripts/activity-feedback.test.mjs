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


test('Amazon defaults to all marketplaces and never forces the primary marketplace',async()=>{
  const page=await read('../src/pages/Amazon.tsx');
  assert.match(page,/marketplaceIds:\[\]/);
  assert.match(page,/if\(!current\.marketplaceIds\.length\)return current/);
  assert.doesNotMatch(page,/const fallback=marketplaceSelection\.primaryMarketplaceId/);
});

test('shared drawer lock preserves page and sidebar scroll position',async()=>{
  const [component,css]=await Promise.all([
    read('../src/components/UnifiedListExperience.tsx'),
    read('../src/unified-list-experience.css'),
  ]);
  assert.match(component,/sideDrawerWindowScrollY=window\.scrollY/);
  assert.match(component,/sideDrawerSidebarScrollTop=document\.querySelector<HTMLElement>\('\.sidebar'\)\?\.scrollTop/);
  assert.match(component,/sidebar\.scrollTop=restoreSidebarScrollTop/);
  assert.match(css,/overflow:clip!important/);
});

test('activities are deduplicated and Amazon clears transient work on navigation',async()=>{
  const [service,page,amazon]=await Promise.all([
    read('../src/services/activity.ts'),
    read('../src/pages/Amazon.tsx'),
    read('../src/services/amazon.ts'),
  ]);
  assert.match(service,/activityByKey/);
  assert.match(service,/clearActivities/);
  assert.match(service,/cancelledActivities/);
  assert.match(page,/clearActivities\('amazon'\)/);
  assert.match(amazon,/key:\`amazon-rpc:\\${name}\`/);
  assert.match(amazon,/scope:'amazon'/);
  assert.match(amazon,/withAmazonTimeout/);
});

