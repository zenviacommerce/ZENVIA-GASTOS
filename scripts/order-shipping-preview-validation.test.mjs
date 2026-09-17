import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root=(path)=>new URL(`../${path}`,import.meta.url);
const read=(path)=>readFile(root(path),'utf8');

test('orders expose a visible shipping-cost column using the shared preview helper',async()=>{
  const source=await read('src/pages/Orders.tsx');
  assert.match(source,/<th>Envío<\/th>/,'Pedidos debe mostrar la columna Envío');
  assert.match(source,/orderShippingCostDisplay\(/,'Pedidos debe usar una única función para real o estimado');
  assert.match(source,/ordersShippingCost/,'el coste debe usar el patrón visual de la tabla');
});

test('shared order shipping logic follows current MRW hard limits',async()=>{
  const path='src/services/orderShipping.ts';
  assert.ok(existsSync(root(path)),'falta src/services/orderShipping.ts');
  const source=await read(path);
  assert.match(source,/validateOrderForCarrier/);
  assert.match(source,/name[^\n]{0,180}50/i,'MRW nombre máximo 50');
  assert.match(source,/street[^\n]{0,180}50/i,'MRW dirección máximo 50');
  assert.match(source,/address2[^\n]{0,180}50/i,'MRW dirección 2 máximo 50');
  assert.match(source,/phone_required/,'MRW requiere teléfono');
  assert.doesNotMatch(source,/house_too_long/,'Sendcloud no publica máximo MRW para house_number');
  assert.match(source,/severity:OrderValidationSeverity='error'/,'los errores duros deben ser bloqueantes por defecto');
});

test('Sendcloud order tools validate remotely and read analysis-level corrections',async()=>{
  const source=await read('supabase/functions/sendcloud-order-tools/index.ts');
  assert.match(source,/action==='validate_order'/);
  assert.match(source,/\/addresses\/validate/);
  assert.match(source,/analysis\?\.changed_attributes/);
  assert.match(source,/analysis\?\.invalid_attributes/);
});

test('selected shipping cost snapshot is sent to label creation and persisted without inventing net VAT',async()=>{
  const [page,orders,backend]=await Promise.all([read('src/pages/Orders.tsx'),read('src/services/orders.ts'),read('supabase/functions/sendcloud-orders/index.ts')]);
  assert.match(page,/shippingCost:\s*selectedCost/,'la selección debe enviar el coste calculado');
  assert.match(orders,/shippingCost\?:/,'createOrderLabel debe aceptar el snapshot');
  assert.match(backend,/selectedCostSnapshot/,'backend debe priorizar el snapshot validado');
  assert.match(backend,/shipping_cost_net_amount:[^\n]*snapshot[^\n]*net/,'el neto debe venir del desglose, no copiar el total');
});

test('transport tariffs persist a VAT rate for gross shipping previews',async()=>{
  const migration='supabase/migrations/20260917234500_transport_tariff_vat_rate.sql';
  assert.ok(existsSync(root(migration)),'falta migración de tipo de IVA de la tarifa');
  const [sql,shipping]=await Promise.all([read(migration),read('src/services/orderShipping.ts')]);
  assert.match(sql,/vat_rate_pct/i);
  assert.match(shipping,/vatRatePct/);
  assert.match(shipping,/21/,'la tarifa MRW actual debe poder convertirse a total con IVA');
});
