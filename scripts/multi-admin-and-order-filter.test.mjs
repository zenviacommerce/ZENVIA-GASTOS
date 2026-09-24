import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('orders start with all channels unless the user explicitly remembers another filter',async()=>{
  const orders=await read('src/pages/Orders.tsx');
  assert.match(orders,/rememberedFilter[\s\S]*channel:'all'/);
  assert.doesNotMatch(orders,/const\s+initialChannel\s*=/);
  assert.match(orders,/value:'all',label:'Todos los canales'/);
});

test('managed users support multiple administrators through the existing role model',async()=>{
  const access=await read('src/services/access.ts');
  const admin=await read('src/pages/Admin.tsx');
  const edge=await read('supabase/functions/admin-users/index.ts');

  assert.match(access,/role:\s*AppRole/);
  assert.match(admin,/Tipo de usuario/);
  assert.match(admin,/value:'admin',label:'Administrador'/);
  assert.match(admin,/currentUserId/);
  assert.match(admin,/disabled=\{isSelf\}/);

  assert.match(edge,/const role = body\?\.role === 'admin' \? 'admin' : 'user'/);
  assert.match(edge,/requestedRole/);
  assert.match(edge,/No puedes quitarte tu propio rol de administrador/);
  assert.match(edge,/No puedes eliminar tu propio acceso de administrador/);
  assert.doesNotMatch(edge,/target\.role === 'admin' \|\| targetId === callerId/);
});

test('administrator role remains the single authority for Administration access',async()=>{
  const app=await read('src/App.tsx');
  const migration=await read('supabase/migrations/20260910133408_app_user_access_control.sql');
  assert.match(app,/access\.role==='admin'/);
  assert.match(migration,/au\.role='admin'/);
  assert.doesNotMatch(migration,/requested='admin'/);
});
