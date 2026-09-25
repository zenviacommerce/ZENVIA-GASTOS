import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Gestion exposes Platform access only through the server-to-server bridge',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  const notify=await read('supabase/functions/support-notify/index.ts');
  assert.match(bridge,/platform_bridge_secrets/);
  assert.match(bridge,/x-platform-token/);
  assert.match(bridge,/sha256\(supplied\)/);
  assert.match(notify,/x-platform-token/);
  assert.match(notify,/platform_bridge_secrets/);
});
