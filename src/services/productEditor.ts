import { supabase } from './supabase';

export type ProductInput = {
  name: string;
  sku?: string;
  ean?: string;
  category?: string;
  unit: string;
  price?: number | null;
  salePrice?: number | null;
  salesTaxRate?: number | null;
  invoiceDescription?: string;
};

function localDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizePrice(value: number | null | undefined, label='El precio') {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} debe ser un número igual o superior a 0.`);
  return number;
}

function normalizeTaxRate(value: number | null | undefined) {
  if (value == null) return 21;
  const number=Number(value);
  if(!Number.isFinite(number)||number<0||number>100)throw new Error('El IVA de venta debe estar entre 0 y 100.');
  return number;
}

function samePrice(a: number | null, b: number | null) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.000001;
}

async function addManualPriceHistory(productId: string, price: number, unit: string) {
  const { error } = await supabase.from('product_price_history').insert({
    product_id: productId,
    supplier_id: null,
    invoice_id: null,
    invoice_line_id: null,
    price_date: localDate(),
    purchase_unit_price: price,
    normalized_unit_price: price,
    base_unit: unit,
    currency: 'EUR',
  });
  if (error) throw error;
}

export async function getProductSalesDetails(productId:string){
  const {data,error}=await supabase.from('products').select('sale_price,sales_tax_rate,invoice_description,ean').eq('id',productId).single();
  if(error)throw error;
  return {salePrice:data.sale_price==null?null:Number(data.sale_price),salesTaxRate:data.sales_tax_rate==null?21:Number(data.sales_tax_rate),invoiceDescription:data.invoice_description||'',ean:data.ean||''};
}

export async function loadProductSalesMap(productIds:string[]){
  if(!productIds.length)return new Map<string,{salePrice:number|null;salesTaxRate:number;invoiceDescription:string;ean:string}>();
  const {data,error}=await supabase.from('products').select('id,sale_price,sales_tax_rate,invoice_description,ean').in('id',productIds);
  if(error)throw error;
  return new Map((data??[]).map((row:any)=>[row.id,{salePrice:row.sale_price==null?null:Number(row.sale_price),salesTaxRate:row.sales_tax_rate==null?21:Number(row.sales_tax_rate),invoiceDescription:row.invoice_description||'',ean:row.ean||''}]));
}

export async function addProduct(input: ProductInput) {
  const unit = input.unit.trim() || 'ud';
  const price = normalizePrice(input.price,'El coste');
  const salePrice=normalizePrice(input.salePrice,'El precio de venta');
  const salesTaxRate=normalizeTaxRate(input.salesTaxRate);
  const { data, error } = await supabase.from('products').insert({
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    ean: input.ean?.trim() || null,
    category: input.category?.trim() || null,
    base_unit: unit,
    last_cost: price,
    previous_cost: null,
    cost_unit: price == null ? null : unit,
    sale_price:salePrice,
    sales_tax_rate:salesTaxRate,
    invoice_description:input.invoiceDescription?.trim()||null,
  }).select('id').single();
  if (error) throw error;

  if (price != null) {
    try {
      await addManualPriceHistory(data.id, price, unit);
    } catch (historyError) {
      await supabase.from('products').delete().eq('id', data.id);
      throw historyError;
    }
  }
}

export async function updateProduct(productId: string, input: ProductInput) {
  const { data: existing, error: readError } = await supabase.from('products')
    .select('name,sku,ean,category,base_unit,last_cost,previous_cost,cost_unit,sale_price,sales_tax_rate,invoice_description')
    .eq('id', productId)
    .single();
  if (readError) throw readError;

  const unit = input.unit.trim() || 'ud';
  const newPrice = normalizePrice(input.price,'El coste');
  const salePrice=normalizePrice(input.salePrice,'El precio de venta');
  const salesTaxRate=normalizeTaxRate(input.salesTaxRate);
  const oldPrice = existing.last_cost == null ? null : Number(existing.last_cost);
  const priceChanged = !samePrice(oldPrice, newPrice);

  const update = {
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    ean:input.ean?.trim()||null,
    category: input.category?.trim() || null,
    base_unit: unit,
    cost_unit: newPrice == null ? existing.cost_unit : unit,
    sale_price:salePrice,
    sales_tax_rate:salesTaxRate,
    invoice_description:input.invoiceDescription?.trim()||null,
    ...(priceChanged ? { previous_cost: oldPrice, last_cost: newPrice } : {}),
  };

  const { error: updateError } = await supabase.from('products').update(update).eq('id', productId);
  if (updateError) throw updateError;

  if (priceChanged && newPrice != null) {
    try {
      await addManualPriceHistory(productId, newPrice, unit);
    } catch (historyError) {
      await supabase.from('products').update({
        name: existing.name,
        sku: existing.sku,
        ean:existing.ean,
        category: existing.category,
        base_unit: existing.base_unit,
        last_cost: existing.last_cost,
        previous_cost: existing.previous_cost,
        cost_unit: existing.cost_unit,
        sale_price:existing.sale_price,
        sales_tax_rate:existing.sales_tax_rate,
        invoice_description:existing.invoice_description,
      }).eq('id', productId);
      throw historyError;
    }
  }
}
