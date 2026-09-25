import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('platform owner invites land in customer app and require password setup',async()=>{
  const platform=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(platform,/CUSTOMER_APP_URL/);
  assert.match(platform,/https:\/\/gestion\.zenviacommerce\.com/);
  assert.match(platform,/inviteUserByEmail\(ownerEmail,\{/);
  assert.match(platform,/redirectTo:customerAppUrl/);
  assert.match(platform,/onboarding_pending:true/);
});

test('customer app blocks invited owners until they create a password',async()=>{
  const [app,screen]=await Promise.all([
    read('src/App.tsx'),
    read('src/components/InvitePasswordSetup.tsx'),
  ]);
  assert.match(app,/user_metadata\?\.onboarding_pending===true/);
  assert.match(app,/<InvitePasswordSetup/);
  assert.match(screen,/supabase\.auth\.updateUser\(\{password,data:metadata\}\)/);
  assert.match(screen,/onboarding_pending:false/);
  assert.match(screen,/password\.length<8/);
  assert.match(screen,/password!==confirm/);
});
