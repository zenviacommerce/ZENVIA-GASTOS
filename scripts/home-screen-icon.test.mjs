import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath=path.join(root,'public','manifest.webmanifest');
const generatorPath=path.join(root,'scripts','generate-brand-icon.mjs');

test('home-screen metadata uses the ZENVIA brand icon without install UI',()=>{
  assert.ok(existsSync(manifestPath),'public/manifest.webmanifest must exist');
  assert.ok(existsSync(generatorPath),'brand icon generator must exist');

  const index=readFileSync(path.join(root,'index.html'),'utf8');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
  const app=readFileSync(path.join(root,'src','App.tsx'),'utf8');

  assert.match(index,/rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(index,/rel="apple-touch-icon" href="\/zenvia-app-icon\.webp"/);
  assert.equal(manifest.name,'ZENVIA Gestión');
  assert.equal(manifest.short_name,'ZENVIA');
  assert.ok(manifest.icons?.some(icon=>icon.src==='/zenvia-app-icon.webp'));
  assert.match(pkg.scripts.build,/generate-brand-icon\.mjs/);
  assert.match(pkg.scripts.dev,/generate-brand-icon\.mjs/);
  assert.doesNotMatch(app,/InstallAppPrompt|beforeinstallprompt|Añadir a pantalla de inicio|Instalar aplicación/);
});
