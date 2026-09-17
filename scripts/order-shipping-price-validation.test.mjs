import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('orders expose a shipping price column that prefers the recorded real cost',async()=>{
  const orders=await read('src/pages/Orders.tsx');
  const shipping=await read('src/services/orderShipping.ts');
  assert.match(orders,/<th>Envío<\/th>/);
  assert.match(orders,/shippingPriceForOrder\(/);
  assert.match(shipping,/shippingCostAmount/);
  assert.match(shipping,/preview/);
});

test('MRW pending orders can be priced from the active 19h tariff with VAT kept separate',async()=>{
  const shipping=await read('src/services/orderShipping.ts');
  assert.match(shipping,/manana-19h/);
  assert.match(shipping,/fuelSurchargePct/);
  assert.match(shipping,/netAmount/);
  assert.match(shipping,/taxAmount/);
  assert.match(shipping,/totalAmount/);
  assert.match(shipping,/pricesIncludeVat/);
});

test('MRW validation catches blocking carrier limits before label creation',async()=>{
  const shipping=await read('src/services/orderShipping.ts');
  assert.match(shipping,/name[^\n]{0,120}50/i);
  assert.match(shipping,/address_line_1[^\n]{0,120}50/i);
  assert.match(shipping,/city[^\n]{0,120}30/i);
  assert.match(shipping,/postal_code[^\n]{0,120}8/i);
  assert.match(shipping,/phone[^\n]{0,120}20/i);
  assert.match(shipping,/email[^\n]{0,120}50/i);
  assert.match(shipping,/blocking/);
});

test('Sendcloud address validation is available and the order editor shows validation feedback',async()=>{
  const edge=await read('supabase/functions/sendcloud-order-tools/index.ts');
  const service=await read('src/services/orders.ts');
  const editor=await read('src/components/OrderEditModal.tsx');
  assert.match(edge,/action==='validate_address'/);
  assert.match(edge,/\/addresses\/validate/);
  assert.match(service,/validateOrderAddress/);
  assert.match(editor,/validationIssues/);
  assert.match(editor,/Revisar antes de generar la etiqueta/);
});
