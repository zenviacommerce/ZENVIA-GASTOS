import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('fiscal data modal has dedicated wide layout without widening generic client dialogs',async()=>{
  const page=await read('src/pages/SalesInvoicesCore.tsx');
  const css=await read('src/sales-config.css');
  assert.match(page,/salesClientModal fiscalDataModal polishedModal/);
  assert.match(css,/\.modal\.salesClientModal\.fiscalDataModal\s*\{[^}]*width:min\(1160px,calc\(100vw - 40px\)\)/);
  assert.match(css,/\.fiscalDataModal \.taxRegistrationManager\s*\{[^}]*minmax\(480px,1\.28fr\)/);
  assert.match(css,/\.fiscalDataModal \.configEditor\s*\{[^}]*padding:18px/);
});

test('fiscal VAT editor adapts cleanly to tablet and mobile widths',async()=>{
  const css=await read('src/sales-config.css');
  assert.match(css,/@media\(max-width:980px\)[\s\S]*\.fiscalDataModal \.taxRegistrationManager\s*\{\s*grid-template-columns:1fr/);
  assert.match(css,/@media\(max-width:640px\)[\s\S]*\.fiscalDataModal \.configEditor \.salesFormGrid\s*\{\s*grid-template-columns:1fr/);
  assert.match(css,/\.fiscalDataModal \.configEditor \.salesSpan2\s*\{\s*grid-column:auto/);
});
