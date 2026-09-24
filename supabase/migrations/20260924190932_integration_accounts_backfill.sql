with ranked as (
  select a.*,
         row_number() over(partition by a.owner_id order by a.updated_at desc,a.created_at desc,a.id) as rn
  from public.amazon_accounts a
)
insert into public.integration_accounts(
  owner_id,provider,display_name,external_account_id,status,enabled,is_default,
  credential_source,linked_resource_id,last_success_at,created_at,updated_at
)
select owner_id,'amazon',coalesce(nullif(display_name,''),'Amazon'),seller_id,status,status<>'disabled',
       rn=1,'environment',id,last_successful_sync_at,created_at,updated_at
from ranked
on conflict (owner_id,provider,external_account_id) where external_account_id is not null
do update set linked_resource_id=excluded.linked_resource_id,
              display_name=excluded.display_name,
              status=excluded.status,
              last_success_at=excluded.last_success_at,
              updated_at=excluded.updated_at;

update public.amazon_accounts a
set integration_account_id=i.id
from public.integration_accounts i
where i.provider='amazon'
  and i.owner_id=a.owner_id
  and i.external_account_id=a.seller_id
  and a.integration_account_id is distinct from i.id;

insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,status,enabled,is_default,credential_source)
select distinct owner_id,'sendcloud','Sendcloud','legacy','connected',true,true,'environment'
from public.fulfillment_orders f
where not exists (
  select 1 from public.integration_accounts i
  where i.owner_id=f.owner_id and i.provider='sendcloud'
)
on conflict do nothing;

with shopify_sources as (
  select f.owner_id,f.integration_id,coalesce(max(nullif(f.integration_name,'')),'Shopify') as display_name
  from public.fulfillment_orders f
  where f.source_channel='shopify' and f.integration_id is not null
  group by f.owner_id,f.integration_id
),
ranked as (
  select s.*,row_number() over(partition by s.owner_id order by s.integration_id) as rn
  from shopify_sources s
)
insert into public.integration_accounts(
  owner_id,provider,display_name,external_account_id,status,enabled,is_default,
  credential_source,parent_account_id,config
)
select
  r.owner_id,'shopify',r.display_name,r.integration_id::text,'connected',true,r.rn=1,'derived',
  (select sc.id from public.integration_accounts sc
    where sc.owner_id=r.owner_id and sc.provider='sendcloud' and sc.is_default limit 1),
  jsonb_build_object('sendcloudIntegrationId',r.integration_id)
from ranked r
on conflict (owner_id,provider,external_account_id) where external_account_id is not null
do update set display_name=excluded.display_name,parent_account_id=excluded.parent_account_id,
              config=excluded.config,updated_at=now();

update public.fulfillment_orders f
set shipping_integration_account_id=sc.id
from public.integration_accounts sc
where sc.owner_id=f.owner_id and sc.provider='sendcloud' and sc.is_default
  and f.shipping_integration_account_id is null;

update public.fulfillment_orders f
set source_integration_account_id=sh.id
from public.integration_accounts sh
where f.source_channel='shopify'
  and sh.owner_id=f.owner_id
  and sh.provider='shopify'
  and sh.external_account_id=f.integration_id::text
  and f.source_integration_account_id is null;

update public.fulfillment_orders f
set source_integration_account_id=am.id
from public.integration_accounts am
where f.source_channel='amazon'
  and am.owner_id=f.owner_id
  and am.provider='amazon'
  and am.is_default
  and f.source_integration_account_id is null;

update public.fulfillment_orders f
set source_integration_account_id=sc.id
from public.integration_accounts sc
where f.source_channel='other'
  and sc.owner_id=f.owner_id
  and sc.provider='sendcloud'
  and sc.is_default
  and f.source_integration_account_id is null;

insert into public.integration_accounts(owner_id,provider,display_name,external_account_id,status,enabled,is_default,credential_source)
select distinct owner_id,'gmail','Gmail','legacy','connected',true,true,'session'
from public.gmail_imports g
where not exists (
  select 1 from public.integration_accounts i
  where i.owner_id=g.owner_id and i.provider='gmail'
)
on conflict do nothing;

update public.gmail_imports g
set integration_account_id=gi.id
from public.integration_accounts gi
where gi.owner_id=g.owner_id and gi.provider='gmail' and gi.is_default
  and g.integration_account_id is null;
