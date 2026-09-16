import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('single invoice upload keeps a manual-review fallback when automatic reading fails',async()=>{
  const [pipeline,upload]=await Promise.all([
    read('../src/services/invoiceImportPipeline.ts'),
    read('../src/components/UploadInvoiceModal.tsx'),
  ]);
  assert.match(pipeline,/export\s+async\s+function\s+createManualInvoiceCandidate\s*\(/);
  assert.match(pipeline,/status:\s*['"]needs_review['"]/);
  assert.match(upload,/createManualInvoiceCandidate/);
  assert.match(upload,/setCandidate\(manualCandidate\)/);
});

test('bulk import always clears busy state even when final refresh fails',async()=>{
  const source=await read('../src/components/BulkInvoiceImportModal.tsx');
  assert.match(source,/try\s*\{[\s\S]*await\s+onFinished\(\)[\s\S]*\}\s*finally\s*\{\s*setBusy\(false\)/);
});
