import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');
async function transpiled(path){
  const source=await read(path);
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('Pedidos and Envíos settings expose operational controls',async()=>{
  const page=await read('../src/pages/Settings.tsx');
  assert.match(page,/function OrdersSection/);
  assert.match(page,/function ShippingSection/);
  for(const label of [
    'Estado inicial','Canal por defecto','País de origen','Transportista por defecto',
    'Generar etiqueta automáticamente','Descargar etiqueta tras crearla','Nombre de etiqueta',
    'Nombre del ZIP','Enviar tracking al marketplace','Marcar enviado tras etiqueta',
    'Reintentar confirmación de tracking','Refresco de pedidos','Pedido pendiente más de',
    'Nombre del remitente','Dirección del remitente','Peso de respaldo','Tamaño de etiqueta',
    'Orientación','Copias','Descarga automática','Transportistas habilitados',
    'Sin método válido','Confirmar expedición tras etiqueta','Guardar coste de envío',
    'Reglas automáticas de envío'
  ]) assert.match(page,new RegExp(label,'i'),label);
  assert.match(page,/updateSection\('orders'/);
  assert.match(page,/updateSection\('shipping'/);
  assert.match(page,/loadShippingRules/);
});

test('shipping rules persist and preserve Baleares Correos plus mainland MRW defaults',async()=>{
  const service=await read('../src/services/shippingRules.ts');
  assert.match(service,/from\(['"]shipping_rules['"]\)/);
  assert.match(service,/Baleares/);
  assert.match(service,/postalPrefix:\s*'07'/);
  assert.match(service,/carrierContains:\s*'correos'/);
  assert.match(service,/MRW Urgent 19:00/);
  assert.match(service,/carrierContains:\s*'mrw'/);
  assert.match(service,/serviceIncludes:\s*\['urgent','19','expedition'\]/);
  assert.match(service,/addShippingRule/);
  assert.match(service,/updateShippingRule/);
  assert.match(service,/deleteShippingRule/);
});

test('shipping rule core chooses the first matching active rule by priority',async()=>{
  const {selectShippingOptionByRules}=await transpiled('../src/services/shippingRuleCore.ts');
  const options=[
    {code:'mrw:timeslot=19:00:expedition',name:'MRW Urgent 19:00 Expedition',carrierCode:'mrw',carrierName:'MRW',contractId:null},
    {code:'correos-standard',name:'Correos Estándar',carrierCode:'correos',carrierName:'Correos',contractId:null},
  ];
  const rules=[
    {id:'1',name:'Baleares',priority:100,active:true,conditions:{countryCode:'ES',postalPrefix:'07'},action:{carrierContains:'correos',serviceIncludes:[]}},
    {id:'2',name:'MRW',priority:200,active:true,conditions:{},action:{carrierContains:'mrw',serviceIncludes:['urgent','19','expedition']}},
  ];
  const balearic={shippingAddress:{country_code:'ES',postal_code:'07001'}};
  const mainland={shippingAddress:{country_code:'ES',postal_code:'28001'}};
  assert.equal(selectShippingOptionByRules(balearic,options,rules)?.carrierCode,'correos');
  assert.equal(selectShippingOptionByRules(mainland,options,rules)?.carrierCode,'mrw');
});

test('label filenames support configured strategies and templates',async()=>{
  const {labelPdfFilename}=await transpiled('../src/services/orderLabelFiles.ts');
  const order={orderNumber:'AMZ-123',customerName:'Cliente Uno',shippingAddress:{},items:[{sku:'FILM-45',name:'Film 45 cm'}]};
  assert.equal(labelPdfFilename(order,{strategy:'order_number'}),'AMZ-123.pdf');
  assert.equal(labelPdfFilename(order,{strategy:'sku'}),'FILM-45.pdf');
  assert.equal(labelPdfFilename(order,{strategy:'product'}),'Film_45_cm.pdf');
  assert.equal(labelPdfFilename(order,{strategy:'custom',template:'{customer}_{order}'}),'Cliente_Uno_AMZ-123.pdf');
});

test('orders runtime consumes refresh tracking label and shipping settings',async()=>{
  const page=await read('../src/pages/Orders.tsx');
  assert.match(page,/useSettings/);
  assert.match(page,/settings\.orders\.refreshSeconds/);
  assert.match(page,/settings\.orders\.labelFilenameStrategy/);
  assert.match(page,/settings\.orders\.bulkZipFilenameTemplate/);
  assert.match(page,/settings\.orders\.pushTrackingToMarketplace/);
  assert.match(page,/settings\.orders\.generateLabelAutomatically/);
  assert.match(page,/settings\.shipping\.fallbackWeightKg/);
  assert.match(page,/settings\.shipping\.enabledCarriers/);
  assert.match(page,/prepareLabelPdf/);
  assert.match(page,/loadShippingRules/);
});

test('Sendcloud backend enforces configured shipping and post-label behavior',async()=>{
  const orders=await read('../supabase/functions/sendcloud-orders/index.ts');
  const tools=await read('../supabase/functions/sendcloud-order-tools/index.ts');
  for(const source of [orders,tools])assert.match(source,/app_settings/);
  assert.match(orders,/markSentAfterLabel/);
  assert.match(orders,/confirmShipmentAfterLabel/);
  assert.match(orders,/persistShippingCost/);
  assert.match(orders,/enabledCarriers/);
  assert.doesNotMatch(orders,/Destino Baleares: MRW está bloqueado/);
  assert.match(tools,/fallbackWeightKg/);
  assert.match(tools,/enabledCarriers/);
});
