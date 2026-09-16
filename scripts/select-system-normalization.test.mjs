import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT=process.cwd();

async function tsxFiles(dir){
  const absolute=path.join(ROOT,dir);
  const entries=await readdir(absolute,{withFileTypes:true});
  const files=[];
  for(const entry of entries){
    const rel=path.join(dir,entry.name);
    if(entry.isDirectory())files.push(...await tsxFiles(rel));
    else if(entry.isFile()&&entry.name.endsWith('.tsx'))files.push(rel.replaceAll('\\','/'));
  }
  return files;
}

async function source(file){return readFile(path.join(ROOT,file),'utf8');}

test('visible application controls do not use native select elements',async()=>{
  const files=[...await tsxFiles('src/pages'),...await tsxFiles('src/components')];
  const offenders=[];
  for(const file of files){
    const text=await source(file);
    const lines=text.split('\n');
    lines.forEach((line,index)=>{if(/<select\b/.test(line))offenders.push(`${file}:${index+1}: ${line.trim().slice(0,180)}`)});
  }
  assert.deepEqual(offenders,[],`Native <select> controls remain:\n${offenders.join('\n')}`);
});

test('orders use the global tooltip instead of duplicate native title tooltips',async()=>{
  const orders=await source('src/pages/Orders.tsx');
  const defaults=await source('src/components/OrderLabelDefaults.tsx');
  assert.equal(orders.includes('title={productsText(order)}'),false,'Orders product cell still has a native title tooltip');
  assert.equal(orders.includes('title={order.trackingStatusMessage||tracking.label}'),false,'Orders tracking badge still has a native title tooltip');
  assert.equal(defaults.includes('badge.title=original'),false,'OrderLabelDefaults still adds a native title to tracking badges');
});

test('unified select system exposes simple and searchable sibling controls',async()=>{
  const searchable=await source('src/components/forms/SearchableSelect.tsx');
  const simplePath=path.join(ROOT,'src/components/forms/SelectField.tsx');
  const hookPath=path.join(ROOT,'src/components/forms/useFloatingSelectMenu.ts');
  let simple='';let hook='';
  try{simple=await readFile(simplePath,'utf8')}catch{}
  try{hook=await readFile(hookPath,'utf8')}catch{}
  assert.ok(simple,'SelectField.tsx must exist');
  assert.ok(hook,'useFloatingSelectMenu.ts must exist');
  for(const token of ['createPortal','role="combobox"','role="listbox"','ArrowDown','ArrowUp','Enter','Escape','searchableSelectTrigger','searchableSelectMenu','searchableSelectList','searchableSelectOption'])assert.ok(simple.includes(token),`SelectField is missing ${token}`);
  assert.ok(searchable.includes("useFloatingSelectMenu"),'SearchableSelect must use the shared floating-menu hook');
  assert.ok(simple.includes("useFloatingSelectMenu"),'SelectField must use the shared floating-menu hook');
});
