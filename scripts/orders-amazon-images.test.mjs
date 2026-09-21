import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Amazon order lists render product thumbnails from order item data with cache fallback',async()=>{
  const source=await read('src/pages/Orders.tsx');
  assert.match(source,/item\.image_url/);
  assert.match(source,/loadAmazonProductImages/);
  assert.match(source,/ordersProductThumb/);
  assert.match(source,/order\.sourceChannel==='amazon'/);
  assert.match(source,/ordersMobileProductRow/);
});

test('order label downloads use centralized configurable filenames',async()=>{
  const source=await read('src/pages/Orders.tsx');
  assert.match(source,/labelFilenameOptions/);
  assert.match(source,/settings\.orders\.labelFilenameStrategy/);
  assert.match(source,/labelPdfFilename\(fresh,labelFilenameOptions\)/);
  assert.match(source,/labelPdfFilename\(order,labelFilenameOptions\)/);
  assert.doesNotMatch(source,/labelPdfBaseName\(/);
});
