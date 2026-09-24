import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

async function loadShipping(){
  const source=await read('../src/services/orderShipping.ts');
  const output=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022},
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

function order(overrides={}){
  return {
    customerName:'Cliente',
    customerEmail:'cliente@example.com',
    customerPhone:'612345678',
    shippingAddress:{
      name:'Cliente',
      address_line_1:'Calle Mayor 1',
      address_line_2:'',
      house_number:'1',
      postal_code:'28001',
      city:'Madrid',
      country_code:'ES',
      email:'cliente@example.com',
      phone_number:'612345678',
    },
    weightKg:1,
    carrierCode:null,
    carrierName:null,
    shippingOptionCode:null,
    shippingServiceName:null,
    ...overrides,
  };
}

test('Spanish phone preflight rejects implausible Amazon-style long numbers before label creation',async()=>{
  const {validateOrderForCarrier}=await loadShipping();
  const result=validateOrderForCarrier(order({customerPhone:'349482964961163'}));
  assert.equal(result.blocking,true);
  const issue=result.issues.find(item=>item.field==='phone');
  assert.ok(issue);
  assert.match(issue.message,/para España debe tener 9 dígitos/);
});

test('Spanish national and +34 phone formats pass preflight',async()=>{
  const {validateOrderForCarrier}=await loadShipping();
  assert.equal(validateOrderForCarrier(order({customerPhone:'612345678'})).issues.some(item=>item.field==='phone'),false);
  assert.equal(validateOrderForCarrier(order({customerPhone:'+34 612 345 678'})).issues.some(item=>item.field==='phone'),false);
});

test('MRW final-carrier preflight requires a usable telephone',async()=>{
  const {validateOrderForCarrier}=await loadShipping();
  const result=validateOrderForCarrier(order({customerPhone:''}),'mrw');
  assert.equal(result.blocking,true);
  assert.match(result.issues.find(item=>item.field==='phone')?.message||'',/obligatorio/);
});

test('order edit form validates current values live and marks invalid fields',async()=>{
  const source=await read('../src/components/OrderEditModal.tsx');
  assert.match(source,/const liveValidation=validateOrderForCarrier\(liveOrder\)/);
  assert.match(source,/fieldIssue\('phone'\)/);
  assert.match(source,/aria-invalid=\{Boolean\(fieldIssue\('phone'\)\)\}/);
  assert.match(source,/ordersFieldError/);
});

test('order detail reuses product images from the list resolver',async()=>{
  const source=await read('../src/pages/Orders.tsx');
  assert.match(source,/productImages:Record<string,string>/);
  assert.match(source,/const image=itemImageUrl\(item,productImages\)/);
  assert.match(source,/ordersDrawerProductThumb/);
  assert.match(source,/productImages=\{amazonImages\}/);
});

test('label creation revalidates against the carrier actually selected',async()=>{
  const source=await read('../src/pages/Orders.tsx');
  assert.match(source,/finalValidation=validateOrderForCarrier\(order,option\?\.carrierCode\|\|validationCarrier\(order\)\)/);
  assert.match(source,/carrierValidation=validateOrderForCarrier\(order,option\.carrierCode\)/);
});

test('quick label format is styled as an active interactive control',async()=>{
  const css=await read('../src/orders.css');
  assert.match(css,/Quick label format is an active control/);
  assert.match(css,/\.ordersQuickLabelFormat \.searchableSelectTrigger[\s\S]*opacity:1!important/);
  assert.match(css,/cursor:pointer!important/);
  assert.match(css,/border:1px solid #94a3b8!important/);
});
