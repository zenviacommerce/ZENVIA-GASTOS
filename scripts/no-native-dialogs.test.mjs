import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src');
const sourceExtensions=new Set(['.ts','.tsx','.js','.jsx']);
const nativeDialogPattern=/(?:window\.|globalThis\.)?(?:alert|confirm|prompt)\s*\(/g;

async function sourceFiles(dir){
  const entries=await readdir(dir,{withFileTypes:true});
  const nested=await Promise.all(entries.map(async entry=>{
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())return sourceFiles(full);
    return sourceExtensions.has(path.extname(entry.name))?[full]:[];
  }));
  return nested.flat();
}

test('application UI never uses native browser alert confirm or prompt dialogs',async()=>{
  const offenders=[];
  for(const file of await sourceFiles(root)){
    const source=await readFile(file,'utf8');
    const matches=[...source.matchAll(nativeDialogPattern)];
    if(matches.length){
      offenders.push({
        file:path.relative(root,file).replaceAll('\\','/'),
        matches:matches.map(match=>match[0]),
      });
    }
  }
  assert.deepEqual(offenders,[],`Native browser dialogs found: ${JSON.stringify(offenders)}`);
});
