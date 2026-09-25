export type WorkspaceEntitlement={
  configured:boolean;
  enabled:boolean;
  limit:number|null;
};

export async function loadWorkspaceEntitlement(admin:any,workspaceId:string,entitlementKey:string):Promise<WorkspaceEntitlement>{
  const {data:subscription,error:subscriptionError}=await admin
    .from('workspace_subscriptions')
    .select('plan_key,status')
    .eq('workspace_id',workspaceId)
    .maybeSingle();
  if(subscriptionError)throw subscriptionError;
  if(!subscription?.plan_key||!['active','trialing'].includes(String(subscription.status||''))){
    return {configured:false,enabled:true,limit:null};
  }

  const {data:entitlement,error:entitlementError}=await admin
    .from('plan_entitlements')
    .select('enabled,limit_value')
    .eq('plan_key',subscription.plan_key)
    .eq('entitlement_key',entitlementKey)
    .maybeSingle();
  if(entitlementError)throw entitlementError;
  if(!entitlement)return {configured:false,enabled:true,limit:null};

  const raw=entitlement.limit_value;
  const limit=typeof raw==='number'
    ?raw
    :(raw===null||raw===undefined?null:Number.isFinite(Number(raw))?Number(raw):null);

  return {
    configured:true,
    enabled:entitlement.enabled!==false,
    limit,
  };
}

export async function requireWorkspaceEntitlement(
  admin:any,
  workspaceId:string,
  entitlementKey:string,
  disabledMessage:string,
):Promise<WorkspaceEntitlement>{
  const entitlement=await loadWorkspaceEntitlement(admin,workspaceId,entitlementKey);
  if(entitlement.configured&&!entitlement.enabled)throw new Error(disabledMessage);
  return entitlement;
}

export async function enforceWorkspaceLimit(
  admin:any,
  workspaceId:string,
  entitlementKey:string,
  currentUsage:number,
  zeroMessage:string,
  reachedMessage:(limit:number)=>string,
){
  const entitlement=await loadWorkspaceEntitlement(admin,workspaceId,entitlementKey);
  if(entitlement.configured&&!entitlement.enabled)throw new Error(zeroMessage);
  if(entitlement.limit!==null&&currentUsage>=entitlement.limit){
    throw new Error(entitlement.limit===0?zeroMessage:reachedMessage(entitlement.limit));
  }
  return entitlement;
}
