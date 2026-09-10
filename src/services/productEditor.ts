import { supabase } from './supabase';

export type ProductInput = {
  name: string;
  sku?: string;
  category?: string;
  unit: string;
  price?: number | null;
};

function localDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizePrice(value: number | null | undefined) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('El precio debe ser un número igual o superior a 0.');
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

export async function addProduct(input: ProductInput) {
  const unit = input.unit.trim() || 'ud';
  const price = normalizePrice(input.price);
  const { data, error } = await supabase.from('products').insert({
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    category: input.category?.trim() || null,
    base_unit: unit,
    last_cost: price,
    previous_cost: null,
    cost_unit: price == null ? null : unit,
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
    .select('name,sku,category,base_unit,last_cost,previous_cost,cost_unit')
    .eq('id', productId)
    .single();
  if (readError) throw readError;

  const unit = input.unit.trim() || 'ud';
  const newPrice = normalizePrice(input.price);
  const oldPrice = existing.last_cost == null ? null : Number(existing.last_cost);
  const priceChanged = !samePrice(oldPrice, newPrice);

  const update = {
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    category: input.category?.trim() || null,
    base_unit: unit,
    cost_unit: newPrice == null ? existing.cost_unit : unit,
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
        category: existing.category,
        base_unit: existing.base_unit,
        last_cost: existing.last_cost,
        previous_cost: existing.previous_cost,
        cost_unit: existing.cost_unit,
      }).eq('id', productId);
      throw historyError;
    }
  }
}
