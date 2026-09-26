import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Support module exposes incident/request ticket lifecycle with replies and attachments',async()=>{
  const [page,service,migration]=await Promise.all([
    read('src/pages/Support.tsx'),
    read('src/services/support.ts'),
    read('supabase/migrations/20260925121000_support_ticketing.sql'),
  ]);
  for(const label of ['Incidencia','Petición','Nuevo ticket','Tickets de la empresa','Responder'])assert.match(page,new RegExp(label));
  assert.match(service,/support_tickets/);
  assert.match(service,/support_messages/);
  assert.match(service,/support-attachments/);
  assert.match(service,/support-notify/);
  assert.match(migration,/support_ticket_number_seq/);
  assert.match(migration,/app_support_ticket_access/);
  assert.match(migration,/support_storage_insert/);
  assert.match(migration,/file_size_limit,allowed_mime_types/);
});

test('Support email notifications target the support mailbox and the ticket creator',async()=>{
  const fn=await read('supabase/functions/support-notify/index.ts');
  assert.match(fn,/soporte@zenviacommerce\.com/);
  assert.match(fn,/RESEND_API_KEY/);
  assert.match(fn,/ticket\.created_by_email/);
  assert.match(fn,/support_email_events/);
  assert.match(fn,/event==='reply'/);
  assert.match(fn,/event==='status'/);
});

test('Support is permission-aware and admin gets the management view',async()=>{
  const [app,sidebar,access]=await Promise.all([read('src/App.tsx'),read('src/components/Sidebar.tsx'),read('src/services/access.ts')]);
  assert.match(app,/regularPages:[^\n]*support|regularPages[^\n]*support/);
  assert.match(app,/page==='support'&&can\('support'\)/);
  assert.match(access,/MenuPermission[\s\S]*support/);
  assert.match(access,/id: 'support', label: 'Soporte'/);
  assert.match(sidebar,/CircleHelp/);
  assert.match(sidebar,/label:'Ayuda'/);
  assert.match(sidebar,/Soporte/);
});

test('Gestión customers cannot edit or delete tickets; management stays in Platform',async()=>{
  const [page,service,restriction,bridge,admin]=await Promise.all([
    read('src/pages/Support.tsx'),
    read('src/services/support.ts'),
    read('supabase/migrations/20260926071000_customer_support_readonly_management.sql'),
    read('supabase/functions/platform-bridge/index.ts'),
    read('src/pages/Admin.tsx'),
  ]);
  assert.doesNotMatch(page,/Editar ticket/);
  assert.doesNotMatch(page,/Eliminar ticket/);
  assert.doesNotMatch(service,/deleteSupportTicket/);
  assert.doesNotMatch(service,/updateSupportTicket/);
  assert.match(restriction,/revoke update,delete on public\.support_tickets from authenticated/);
  assert.match(restriction,/drop policy if exists support_tickets_admin_update/);
  assert.match(restriction,/drop policy if exists support_tickets_admin_delete/);
  assert.match(bridge,/action==='update_ticket'/);
  assert.match(bridge,/action==='delete_ticket'/);
  assert.match(admin,/support:'Soporte'/);
  assert.match(admin,/reply:'Respuesta'/);
});
