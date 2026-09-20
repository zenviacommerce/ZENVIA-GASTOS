import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('Configuración is available to every active user and Administration stays admin-only',async()=>{
  const sidebar=await read('../src/components/Sidebar.tsx');
  const app=await read('../src/App.tsx');
  assert.match(sidebar,/['"]settings['"]/);
  assert.match(sidebar,/Configuraci[oó]n/);
  assert.match(app,/page==='settings'/);
  assert.match(app,/SettingsPage/);
  assert.match(app,/allowedPages[\s\S]*settings/);
  assert.match(app,/page==='admin'[\s\S]*access\.role==='admin'/);
});

test('settings page exposes personal preferences to everyone and global sections only to admins',async()=>{
  const page=await read('../src/pages/Settings.tsx');
  assert.match(page,/Mis preferencias/);
  assert.match(page,/General/);
  assert.match(page,/Facturaci[oó]n/);
  assert.match(page,/Gastos e importaci[oó]n/);
  assert.match(page,/Pedidos/);
  assert.match(page,/Env[ií]os/);
  assert.match(page,/Amazon/);
  assert.match(page,/Productos/);
  assert.match(page,/Clientes/);
  assert.match(page,/Proveedores/);
  assert.match(page,/Integraciones/);
  assert.match(page,/Alertas y automatizaciones/);
  assert.match(page,/Mantenimiento/);
  assert.match(page,/isAdmin/);
  assert.match(page,/filter|adminOnly/);
});

test('settings navigation protects unsaved changes before switching sections',async()=>{
  const page=await read('../src/pages/Settings.tsx');
  assert.match(page,/dirty/i);
  assert.match(page,/confirm/i);
  assert.match(page,/cambios sin guardar/i);
});

test('settings layout has responsive desktop and narrow-screen navigation',async()=>{
  const css=await read('../src/settings.css');
  assert.match(css,/settingsLayout/);
  assert.match(css,/settingsNav/);
  assert.match(css,/@media\s*\(max-width:/);
  assert.match(css,/overflow-x\s*:\s*auto/);
});
