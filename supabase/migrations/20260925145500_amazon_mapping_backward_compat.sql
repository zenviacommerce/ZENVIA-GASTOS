-- Keep the legacy 1:1 setter safe for clients that have not yet received
-- the multi-component UI. New clients use amazon_add_product_mapping.

create or replace function public.amazon_add_product_mapping(
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
  v_sku_assigned boolean:=false;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;

  v_seller_sku:=trim(seller_sku);
  if coalesce(v_seller_sku,'')='' then raise exception 'seller_sku is required'; end if;
  if consumption_factor is null or consumption_factor<=0 then raise exception 'consumption_factor must be greater than zero'; end if;

  select p.id into v_product
  from public.products p
  where p.id=product_id and p.owner_id=v_owner;
  if v_product is null then raise exception 'Product not found in workspace'; end if;

  select a.id into v_account
  from public.amazon_accounts a
  where a.owner_id=v_owner and a.status='connected'
  order by a.created_at limit 1;
  if v_account is null then raise exception 'Amazon account not connected'; end if;

  insert into public.amazon_product_mappings(
    owner_id,amazon_account_id,seller_sku,product_id,consumption_factor,mapping_source,created_at,updated_at
  )
  values(v_owner,v_account,v_seller_sku,v_product,consumption_factor,'manual',now(),now())
  on conflict (owner_id,amazon_account_id,seller_sku,product_id)
  do update set consumption_factor=excluded.consumption_factor,mapping_source='manual',updated_at=now()
  returning id into v_mapping;

  begin
    update public.products p
    set sku=v_seller_sku,updated_at=now()
    where p.id=v_product and p.owner_id=v_owner
      and nullif(trim(coalesce(p.sku,'')),'') is null;
    v_sku_assigned:=found;
  exception when unique_violation then
    v_sku_assigned:=false;
  end;

  return jsonb_build_object(
    'ok',true,'id',v_mapping,'sellerSku',v_seller_sku,'productId',v_product,
    'consumptionFactor',consumption_factor,'skuAssigned',v_sku_assigned
  );
end;
$$;

revoke all on function public.amazon_add_product_mapping(text,uuid,numeric) from public,anon;
grant execute on function public.amazon_add_product_mapping(text,uuid,numeric) to authenticated;

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
  v_sku_assigned boolean:=false;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;

  v_seller_sku:=trim(seller_sku);
  if coalesce(v_seller_sku,'')='' then raise exception 'seller_sku is required'; end if;
  if consumption_factor is null or consumption_factor<=0 then raise exception 'consumption_factor must be greater than zero'; end if;

  select p.id into v_product
  from public.products p
  where p.id=product_id and p.owner_id=v_owner;
  if v_product is null then raise exception 'Product not found in workspace'; end if;

  select a.id into v_account
  from public.amazon_accounts a
  where a.owner_id=v_owner and a.status='connected'
  order by a.created_at limit 1;
  if v_account is null then raise exception 'Amazon account not connected'; end if;

  -- Legacy clients expect "set" to replace the previous relation.
  delete from public.amazon_product_mappings m
  where m.owner_id=v_owner
    and m.amazon_account_id=v_account
    and m.seller_sku=v_seller_sku
    and m.product_id<>v_product;

  insert into public.amazon_product_mappings(
    owner_id,amazon_account_id,seller_sku,product_id,consumption_factor,mapping_source,created_at,updated_at
  )
  values(v_owner,v_account,v_seller_sku,v_product,consumption_factor,'manual',now(),now())
  on conflict (owner_id,amazon_account_id,seller_sku,product_id)
  do update set consumption_factor=excluded.consumption_factor,mapping_source='manual',updated_at=now()
  returning id into v_mapping;

  begin
    update public.products p
    set sku=v_seller_sku,updated_at=now()
    where p.id=v_product and p.owner_id=v_owner
      and nullif(trim(coalesce(p.sku,'')),'') is null;
    v_sku_assigned:=found;
  exception when unique_violation then
    v_sku_assigned:=false;
  end;

  return jsonb_build_object(
    'ok',true,'id',v_mapping,'sellerSku',v_seller_sku,'productId',v_product,
    'consumptionFactor',consumption_factor,'skuAssigned',v_sku_assigned
  );
end;
$$;

revoke all on function public.amazon_set_product_mapping(text,uuid,numeric) from public,anon;
grant execute on function public.amazon_set_product_mapping(text,uuid,numeric) to authenticated;
