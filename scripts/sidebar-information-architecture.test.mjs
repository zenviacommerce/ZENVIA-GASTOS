import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('sidebar groups navigation by business area in the agreed order',async()=>{
  const sidebar=await read('../src/components/Sidebar.tsx');
  const inicio=sidebar.indexOf("label:'Inicio'");
  const operaciones=sidebar.indexOf("label:'Operaciones'");
  const gestion=sidebar.indexOf("label:'Gestión'");
  const canales=sidebar.indexOf("label:'Canales'");
  const ayuda=sidebar.indexOf("label:'Ayuda'");
  assert.ok(inicio>=0&&operaciones>inicio&&gestion>operaciones&&canales>gestion&&ayuda>canales);

  const operationsBlock=sidebar.slice(operaciones,gestion);
  assert.ok(operationsBlock.indexOf("'orders'")<operationsBlock.indexOf("'sales'"));
  assert.ok(operationsBlock.indexOf("'sales'")<operationsBlock.indexOf("'invoices'"));

  const managementBlock=sidebar.slice(gestion,canales);
  assert.ok(managementBlock.indexOf("'products'")<managementBlock.indexOf("'clients'"));
  assert.ok(managementBlock.indexOf("'clients'")<managementBlock.indexOf("'suppliers'"));
});

test('support is a first-class Help destination and system actions keep an intuitive order',async()=>{
  const sidebar=await read('../src/components/Sidebar.tsx');
  const ayuda=sidebar.indexOf("label:'Ayuda'");
  const soporte=sidebar.indexOf("['support','Soporte','Soporte',CircleHelp]",ayuda);
  const system=sidebar.indexOf('sidebarSystemLabel">Sistema');
  const settings=sidebar.indexOf('>Configuración</span>',system);
  const admin=sidebar.indexOf('>Administración</span>',system);
  const theme=sidebar.indexOf("theme==='dark'?'Modo claro':'Modo oscuro'",system);
  const logout=sidebar.indexOf('>Cerrar sesión</span>',system);
  assert.ok(ayuda>=0&&soporte>ayuda);
  assert.ok(system>=0&&settings>system&&admin>settings&&theme>admin&&logout>theme);
  assert.match(sidebar,/CircleHelp/);
  assert.doesNotMatch(sidebar,/LifeBuoy/);
});

test('sidebar grouping remains readable on desktop and mobile',async()=>{
  const [desktop,mobile]=await Promise.all([
    read('../src/sidebar-brand.css'),
    read('../src/mobile-nav.css'),
  ]);
  assert.match(desktop,/\.sidebarNavGroup/);
  assert.match(desktop,/\.sidebarSectionLabel/);
  assert.match(desktop,/text-transform:uppercase/);
  assert.match(mobile,/\.sidebar \.sidebarNavGroup/);
  assert.match(mobile,/\.sidebarBottom \.adminSidebarButton\{display:flex!important\}/);
});
