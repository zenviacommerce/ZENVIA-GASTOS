import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Platform bridge supports complete ticket editing',async()=>{
  const source=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(source,/\['incident','request'\]\.includes\(body\?\.type\)/);
  assert.match(source,/patch\.subject=subject/);
  assert.match(source,/patch\.description=description/);
  assert.match(source,/patch\.resolved_at=patch\.status==='resolved'/);
  assert.match(source,/patch\.closed_at=patch\.status==='closed'/);
});

test('Platform bridge deletes tickets and cleans attachment storage',async()=>{
  const source=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(source,/action==='delete_ticket'/);
  assert.match(source,/from\('support_attachments'\)\.select\('storage_path'\)/);
  assert.match(source,/from\('support_tickets'\)\.delete\(\)/);
  assert.match(source,/storage\.from\('support-attachments'\)\.remove\(paths\)/);
});
