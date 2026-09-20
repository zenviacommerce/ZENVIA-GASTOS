import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function transpiled(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('sales due-day precedence is client override then global fallback',async()=>{
  const {resolveSalesDueDays,defaultSalesDueDate}=await transpiled('../src/services/salesDefaults.ts');
  assert.equal(resolveSalesDueDays(60,30),60);
  assert.equal(resolveSalesDueDays(0,45),45);
  assert.equal(resolveSalesDueDays(undefined,45),45);
  assert.equal(resolveSalesDueDays(undefined,999),30);
  assert.equal(defaultSalesDueDate('2026-09-21',45),'2026-11-05');
});

test('manual sales editor consumes configured due days instead of hidden 30',async()=>{
  const source=await readFile(new URL('../src/pages/SalesInvoicesCore.tsx',import.meta.url),'utf8');
  assert.match(source,/useSettings/);
  assert.match(source,/settings\.sales\.defaultDueDays/);
  assert.match(source,/resolveSalesDueDays/);
  assert.doesNotMatch(source,/paymentTermsDays\s*\|\|\s*30/);
});

test('sales importer receives configurable due days instead of hardcoding 30',async()=>{
  const source=await readFile(new URL('../src/services/salesInvoiceImport.ts',import.meta.url),'utf8');
  assert.match(source,/defaultDueDays/);
  assert.match(source,/resolveSalesDueDays/);
  assert.doesNotMatch(source,/addDays\([^\n]*,30\)/);
});

test('database due-date trigger reads app settings with safe 30-day fallback',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260921002000_configurable_sales_due_days.sql',import.meta.url),'utf8');
  assert.match(sql,/sales_default_due_days/i);
  assert.match(sql,/app_settings/i);
  assert.match(sql,/defaultDueDays/);
  assert.match(sql,/coalesce/i);
  assert.match(sql,/30/);
  assert.doesNotMatch(sql,/new\.due_date\s*:=\s*new\.issue_date\s*\+\s*30/i);
});
