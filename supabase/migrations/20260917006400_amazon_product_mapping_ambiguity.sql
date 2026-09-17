-- Fix PL/pgSQL ambiguity between the public RPC argument `seller_sku`
-- and the amazon_product_mappings.seller_sku column.
-- Keep the public argument names unchanged because the frontend calls the RPC by name.

create or replace function public.amazon_set_product_mapping(
  seller_sku text,
  product_id uuid,
  consumption_factor numeric default 1
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_product uuid;
  v_account uuid;
  v_mapping uuid;
  v_seller_sku text;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then
    raise exception 'Forbidden';
  end if;

  v_seller_sku:=trim(seller_sku);
  if coalesce(v_seller_sku,'')='' then
    raise exception 'seller_sku is required';
  end if;
  if consumption_factor is null or consumption_factor<=0 then
    raise exception 'consumption_factor must be greater than zero';
  end if;

  select p.id
  into v_product
  from public.products p
  where p.id=product_id
    and p.owner_id=v_owner;

  if v_product is null then
    raise exception 'Product not found in workspace';
  end if;

  select a.id
  into v_account
  from public.amazon_accounts a
  where a.owner_id=v_owner
    and a.status='connected'
  order by a.created_at
  limit 1;

  if v_account is null then
    raise exception 'Amazon account not connected';
  end if;

  insert into public.amazon_product_mappings(
    owner_id,
    amazon_account_id,
    seller_sku,
    product_id,
    consumption_factor,
    mapping_source,
    created_at,
    updated_at
  )
  values(
    v_owner,
    v_account,
    v_seller_sku,
    v_product,
    consumption_factor,
    'manual',
    now(),
    now()
  )
  on conflict on constraint amazon_product_mappings_owner_id_amazon_account_id_seller_s_key
  do update set
    product_id=excluded.product_id,
    consumption_factor=excluded.consumption_factor,
    mapping_source='manual',
    updated_at=now()
  returning id into v_mapping;

  return jsonb_build_object(
    'ok',true,
    'id',v_mapping,
    'sellerSku',v_seller_sku,
    'productId',v_product,
    'consumptionFactor',consumption_factor
  );
end;
$$;

create or replace function public.amazon_delete_product_mapping(seller_sku text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_count integer;
  v_seller_sku text;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then
    raise exception 'Forbidden';
  end if;

  v_seller_sku:=trim(seller_sku);
  if coalesce(v_seller_sku,'')='' then
    raise exception 'seller_sku is required';
  end if;

  delete from public.amazon_product_mappings m
  using public.amazon_accounts a
  where m.amazon_account_id=a.id
    and m.owner_id=v_owner
    and a.owner_id=v_owner
    and a.status='connected'
    and m.seller_sku=v_seller_sku;

  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'deleted',v_count);
end;
$$;
