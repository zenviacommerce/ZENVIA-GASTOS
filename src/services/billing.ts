import { supabase } from './supabase';
import { listManagedUsers, type AccessProfile, type WorkspaceEntitlement } from './access';
import { createSupportTicket } from './support';

export type BillingCycle='monthly'|'yearly';

export type CustomerPlanEntitlement={
  key:string;
  enabled:boolean;
  limit:number|null;
  config:Record<string,unknown>;
};

export type CustomerBillingPlan={
  planKey:string;
  name:string;
  description:string;
  monthlyPriceCents:number|null;
  yearlyPriceCents:number|null;
  sortOrder:number;
  isPublic:boolean;
  entitlements:CustomerPlanEntitlement[];
};

export type CustomerSubscription={
  planKey:string;
  status:string;
  billingProvider:string;
  trialEndsAt:string|null;
  currentPeriodEndsAt:string|null;
  cancelAtPeriodEnd:boolean;
};

export type CustomerPlanUsage={
  users:{value:number;limit:number|null};
  amazonAccounts:{value:number;limit:number|null};
  monthlyOrders:{value:number;limit:number|null};
};

export type CustomerBillingOverview={
  currentPlan:CustomerBillingPlan;
  subscription:CustomerSubscription;
  usage:CustomerPlanUsage;
  availablePlans:CustomerBillingPlan[];
};

type PlanRow={
  plan_key:string;
  name:string;
  description:string|null;
  is_public:boolean;
  active:boolean;
  monthly_price_cents:number|null;
  yearly_price_cents:number|null;
  sort_order:number;
};

type EntitlementRow={
  plan_key:string;
  entitlement_key:string;
  enabled:boolean;
  limit_value:number|null;
  config:Record<string,unknown>|null;
};

function toEntitlement(key:string,value:WorkspaceEntitlement):CustomerPlanEntitlement{
  return {key,enabled:value.enabled,limit:value.limit,config:value.config};
}

function mapPlan(row:PlanRow,entitlements:EntitlementRow[]):CustomerBillingPlan{
  return {
    planKey:row.plan_key,
    name:row.name,
    description:row.description||'',
    monthlyPriceCents:row.monthly_price_cents,
    yearlyPriceCents:row.yearly_price_cents,
    sortOrder:Number(row.sort_order)||0,
    isPublic:Boolean(row.is_public),
    entitlements:entitlements
      .filter(item=>item.plan_key===row.plan_key)
      .map(item=>({
        key:item.entitlement_key,
        enabled:item.enabled!==false,
        limit:item.limit_value==null?null:Number(item.limit_value),
        config:item.config&&typeof item.config==='object'?item.config:{},
      })),
  };
}

function limitFor(access:AccessProfile,key:string){
  return access.entitlements[key]?.enabled===false?0:(access.entitlements[key]?.limit??null);
}

function startOfCurrentUtcMonth(){
  const now=new Date();
  return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
}
function startOfNextUtcMonth(){
  const now=new Date();
  return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString();
}

export async function loadCustomerBillingOverview(access:AccessProfile):Promise<CustomerBillingOverview>{
  const [plansResult,entitlementsResult,subscriptionResult,users,amazonResult,ordersResult]=await Promise.all([
    supabase.from('billing_plans')
      .select('plan_key,name,description,is_public,active,monthly_price_cents,yearly_price_cents,sort_order')
      .eq('active',true)
      .order('sort_order',{ascending:true}),
    supabase.from('plan_entitlements')
      .select('plan_key,entitlement_key,enabled,limit_value,config')
      .order('entitlement_key',{ascending:true}),
    supabase.from('workspace_subscriptions')
      .select('workspace_id,plan_key,status,billing_provider,trial_ends_at,current_period_ends_at,cancel_at_period_end')
      .eq('workspace_id',access.workspaceId)
      .maybeSingle(),
    listManagedUsers(),
    supabase.from('amazon_accounts').select('id,status').eq('owner_id',access.workspaceId),
    supabase.from('fulfillment_orders')
      .select('id',{count:'exact',head:true})
      .eq('owner_id',access.workspaceId)
      .gte('order_created_at',startOfCurrentUtcMonth())
      .lt('order_created_at',startOfNextUtcMonth()),
  ]);

  if(plansResult.error)throw plansResult.error;
  if(entitlementsResult.error)throw entitlementsResult.error;
  if(subscriptionResult.error)throw subscriptionResult.error;
  if(amazonResult.error)throw amazonResult.error;
  if(ordersResult.error)throw ordersResult.error;

  const planRows=(plansResult.data||[]) as PlanRow[];
  const entitlementRows=(entitlementsResult.data||[]) as EntitlementRow[];
  const currentRow=planRows.find(plan=>plan.plan_key===access.planKey);
  const currentPlan=currentRow
    ?mapPlan(currentRow,entitlementRows)
    :{
      planKey:access.planKey,
      name:access.planName,
      description:access.planKey==='internal'?'Plan interno de ZENVIA.':'',
      monthlyPriceCents:null,
      yearlyPriceCents:null,
      sortOrder:0,
      isPublic:false,
      entitlements:Object.entries(access.entitlements).map(([key,value])=>toEntitlement(key,value)),
    };

  const subscriptionRow=subscriptionResult.data;
  const activeUsers=users.filter(user=>user.active).length;
  const amazonAccounts=(amazonResult.data||[]).filter((row:any)=>row.status!=='disabled').length;
  const monthlyOrders=Number(ordersResult.count||0);

  return {
    currentPlan,
    subscription:{
      planKey:subscriptionRow?.plan_key||access.planKey,
      status:subscriptionRow?.status||access.subscriptionStatus,
      billingProvider:subscriptionRow?.billing_provider||'manual',
      trialEndsAt:subscriptionRow?.trial_ends_at||null,
      currentPeriodEndsAt:subscriptionRow?.current_period_ends_at||null,
      cancelAtPeriodEnd:Boolean(subscriptionRow?.cancel_at_period_end),
    },
    usage:{
      users:{value:activeUsers,limit:limitFor(access,'users')},
      amazonAccounts:{value:amazonAccounts,limit:limitFor(access,'amazon_accounts')},
      monthlyOrders:{value:monthlyOrders,limit:limitFor(access,'monthly_orders')},
    },
    availablePlans:planRows
      .filter(plan=>plan.plan_key!=='internal'&&plan.is_public)
      .map(plan=>mapPlan(plan,entitlementRows)),
  };
}

export async function requestCustomerPlanChange(input:{
  access:AccessProfile;
  targetPlan:CustomerBillingPlan;
  cycle:BillingCycle;
}){
  if(input.targetPlan.planKey==='internal'||!input.targetPlan.isPublic)throw new Error('El plan seleccionado no está disponible para contratación.');
  if(input.targetPlan.planKey===input.access.planKey)throw new Error('Ese ya es tu plan actual.');
  const cycleLabel=input.cycle==='yearly'?'anual':'mensual';
  const price=input.cycle==='yearly'?input.targetPlan.yearlyPriceCents:input.targetPlan.monthlyPriceCents;
  const priceText=price==null?'Precio pendiente de confirmación':new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(price/100);
  return createSupportTicket({
    type:'request',
    subject:`Cambio de plan: ${input.access.planName} → ${input.targetPlan.name}`,
    description:[
      'Solicitud de cambio de plan desde ZENVIA Gestión.',
      `Empresa: ${input.access.workspaceName||input.access.workspaceId}`,
      `Plan actual: ${input.access.planName} (${input.access.planKey})`,
      `Plan solicitado: ${input.targetPlan.name} (${input.targetPlan.planKey})`,
      `Modalidad: ${cycleLabel}`,
      `Precio mostrado: ${priceText}`,
      '',
      'Hasta que la contratación/pago quede confirmado, el plan actual permanece sin cambios.',
    ].join('\n'),
  });
}
