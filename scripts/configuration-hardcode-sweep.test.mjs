import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('migrated pages do not keep fixed current-quarter initializers or page sizes',async()=>{
  const pages=await Promise.all([
    'src/pages/Dashboard.tsx','src/pages/Orders.tsx','src/pages/Invoices.tsx',
    'src/pages/Suppliers.tsx','src/pages/Clients.tsx','src/pages/Products.tsx',
    'src/pages/SalesInvoicesCore.tsx',
  ].map(read));
  for(const source of pages){
    assert.doesNotMatch(source,/useState\(default(?:Date|Invoice)Filter\)/);
    assert.doesNotMatch(source,/const\s+PAGE_SIZE\s*=\s*20\b/);
  }
  assert.match(pages.join('\n'),/preferences\.defaultPeriod/);
  assert.match(pages.join('\n'),/preferences\.pageSize/);
});

test('sales due dates have no hidden 30-day service or import fallback',async()=>{
  const sales=await read('src/services/sales.ts');
  const salesImport=await read('src/services/salesInvoiceImport.ts');
  assert.doesNotMatch(sales,/defaultDueDays\s*=\s*30/);
  assert.doesNotMatch(salesImport,/defaultDueDays\s*=\s*30/);
  assert.match(sales,/defaultDueDays:number/);
  assert.match(salesImport,/defaultDueDays:number/);
});

test('shipping routing is owned by configured rules rather than geography helpers',async()=>{
  const shipping=await read('src/services/orderShipping.ts');
  const labels=await read('src/services/orderLabelFiles.ts');
  const orders=await read('src/pages/Orders.tsx');
  assert.doesNotMatch(shipping,/defaultCarrierCode/);
  assert.doesNotMatch(labels,/selectAutomaticShippingOption|isBalearicOrder|isMrwUrgent1900/);
  assert.match(orders,/selectShippingOptionByRules/);
  assert.match(orders,/firstMatchingShippingRule/);
  assert.match(orders,/settings\.orders\.defaultCarrier/);
});

test('order refresh interval is configuration driven everywhere',async()=>{
  const dashboard=await read('src/pages/Dashboard.tsx');
  const orders=await read('src/pages/Orders.tsx');
  assert.doesNotMatch(dashboard,/setInterval\([^\n]*60000/);
  assert.match(dashboard,/settings\.orders\.refreshSeconds/);
  assert.match(orders,/settings\.orders\.refreshSeconds/);
});

test('label filename strategy is always supplied from configuration',async()=>{
  const files=await read('src/services/orderLabelFiles.ts');
  const orders=await read('src/pages/Orders.tsx');
  assert.doesNotMatch(files,/options\.strategy\s*\|\|\s*['"]order_number['"]/);
  assert.match(files,/options:LabelFilenameOptions/);
  assert.match(orders,/settings\.orders\.labelFilenameStrategy/);
});

test('user interface preferences have runtime consumers',async()=>{
  const app=await read('src/App.tsx');
  const dashboard=await read('src/pages/Dashboard.tsx');
  const settings=await read('src/pages/Settings.tsx');
  const theme=await read('src/theme-consistency.css');
  assert.match(app,/dataset\.density=preferences\.density/);
  assert.match(dashboard,/preferences\.dashboardKpis/);
  assert.match(settings,/tableColumns/);
  assert.match(theme,/data-density='compact'/);
  assert.match(theme,/data-preference-table='expenses'/);
});

test('configuration is grouped with administration and uses shared application button styles',async()=>{
  const sidebar=await read('src/components/Sidebar.tsx');
  const settings=await read('src/pages/Settings.tsx');
  assert.doesNotMatch(sidebar,/\['settings','Configuración'/);
  assert.match(sidebar,/settingsSidebarButton/);
  assert.match(sidebar,/adminSidebarButton/);
  assert.doesNotMatch(settings,/primaryButton|secondaryButton/);
  assert.match(settings,/className="primary"/);
  assert.match(settings,/className="secondary/);
});

test('final theme consistency stylesheet is loaded after settings and alerts',async()=>{
  const main=await read('src/main.tsx');
  const settingsPos=main.indexOf("import './settings.css';");
  const alertsPos=main.indexOf("import './alerts.css';");
  const themePos=main.indexOf("import './theme-consistency.css';");
  assert.ok(settingsPos>=0&&alertsPos>=0&&themePos>settingsPos&&themePos>alertsPos);
});
