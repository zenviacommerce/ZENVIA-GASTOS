import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Platform bridge keeps support attachments private and signed',async()=>{
  const source=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(source,/action==='prepare_ticket_attachment'/);
  assert.match(source,/createSignedUploadUrl\(storagePath\)/);
  assert.match(source,/action==='finalize_ticket_attachment'/);
  assert.match(source,/support_attachments'\)\.insert/);
  assert.match(source,/createSignedUrl\(String\(attachment\.storage_path\),3600\)/);
  assert.match(source,/fileSize>10\*1024\*1024/);
  assert.match(source,/storagePath\.startsWith\(\`\$\{ticketId\}\//);
});

test('service-role bridge preserves explicit Platform operator identity',async()=>{
  const migration=await read('supabase/migrations/20260926073500_platform_support_operator_writes.sql');
  assert.match(migration,/auth\.role\(\).*service_role/);
  assert.match(migration,/new\.author_role<>'admin'/);
  assert.match(migration,/new\.uploaded_by is null/);
  assert.match(migration,/new\.owner_id:=ticket_owner/);
});
