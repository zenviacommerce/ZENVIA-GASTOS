import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type PlatformRole='super_admin'|'support_admin'|'billing_admin';
export type WorkspaceStatus='active'|'trialing'|'suspended'|'cancelled';
export type PlatformStats={workspaces:number;subscriptions:number;openTickets:number;activePlans:number};
export type Bootstrap={actor:{id:string;email:string;role:PlatformRole};stats:PlatformStats};

export type Workspace={
  id:string;slug:string;name:string;legal_name?:string|null;status:WorkspaceStatus;created_at:string;updated_at:string;
  subscription?:{workspace_id:string;plan_key:string;status:string;billing_provider:string;trial_ends_at?:string|null;current_period_ends_at?:string|null;cancel_at_period_end?:boolean}|null;
  users:{total:number;active:number};
  amazonAccounts:number;
  usage:{
    users:{value:number;limit:number|null};
    amazonAccounts:{value:number;limit:number|null};
    monthlyOrders:{value:number;limit:number|null};
  };
};

export type Entitlement={plan_key:string;entitlement_key:string;enabled:boolean;limit_value:number|null;config:Record<string,unknown>};
export type BillingPlan={
  plan_key:string;name:string;description?:string|null;is_public:boolean;active:boolean;
  monthly_price_cents:number|null;yearly_price_cents:number|null;sort_order:number;subscriptions:number;
  entitlements:Entitlement[];
};

export type Ticket={
  id:string;owner_id:string;ticket_number:string;created_by:string;created_by_email:string;created_by_name?:string|null;
  type:'incident'|'request';subject:string;description?:string;status:'open'|'in_progress'|'waiting_user'|'resolved'|'closed';
  priority:'low'|'normal'|'high'|'urgent';assigned_to?:string|null;created_at:string;updated_at:string;last_activity_at:string;
  workspace_name:string;
};
export type TicketMessage={id:string;ticket_id:string;author_user_id:string;author_email:string;author_name?:string|null;author_role:'user'|'admin';body:string;created_at:string};
export type TicketAttachment={id:string;ticket_id:string;message_id?:string|null;file_name:string;mime_type?:string|null;file_size:number;storage_path:string;created_at:string};
export type AuditEntry={id:string;actor_user_id:string;workspace_id?:string|null;action:string;entity_type:string;entity_id?:string|null;summary:string;details:Record<string,unknown>;created_at:string};

async function invoke<T>(action:string,payload:Record<string,unknown>={}):Promise<T>{
  const {data,error}=await supabase.functions.invoke('platform-admin',{body:{action,...payload}});
  if(error){
    if(error instanceof FunctionsHttpError){
      try{
        const body=await error.context.clone().json();
        const message=String(body?.error||body?.message||'').trim();
        if(message)throw new Error(message);
      }catch(parsedError){
        if(parsedError instanceof Error&&parsedError.message&&parsedError.message!==error.message)throw parsedError;
      }
    }
    throw new Error(error.message||'No se pudo completar la operación.');
  }
  if(data?.error)throw new Error(String(data.error));
  return data as T;
}

export const platformApi={
  bootstrap:()=>invoke<Bootstrap>('bootstrap'),
  listWorkspaces:()=>invoke<{workspaces:Workspace[]}>('list_workspaces'),
  createWorkspace:(input:{name:string;legalName:string;ownerEmail:string;ownerFullName:string;planKey:string})=>invoke<{ok:true;workspaceId:string}>('create_workspace',input),
  listPlans:()=>invoke<{plans:BillingPlan[]}>('list_plans'),
  updatePlan:(input:{planKey:string;name:string;description:string;active:boolean;isPublic:boolean;monthlyPriceCents:number|null;yearlyPriceCents:number|null;entitlements:Array<{key:string;enabled:boolean;limit:number|null}>})=>invoke<{ok:true}>('update_plan',input),
  assignPlan:(workspaceId:string,planKey:string)=>invoke<{ok:true}>('assign_plan',{workspaceId,planKey}),
  updateWorkspaceStatus:(workspaceId:string,status:WorkspaceStatus)=>invoke<{ok:true;status:WorkspaceStatus}>('update_workspace',{workspaceId,status}),
  listTickets:()=>invoke<{tickets:Ticket[]}>('list_tickets'),
  ticketDetail:(ticketId:string)=>invoke<{ticket:Ticket;messages:TicketMessage[];attachments:TicketAttachment[]}>('ticket_detail',{ticketId}),
  updateTicket:(ticketId:string,patch:{status?:Ticket['status'];priority?:Ticket['priority'];assignedTo?:string|null})=>invoke<{ok:true}>('update_ticket',{ticketId,...patch}),
  replyTicket:(ticketId:string,message:string)=>invoke<{ok:true;messageId:string;notified:boolean;notificationReason?:string}>('reply_ticket',{ticketId,message}),
  listAudit:()=>invoke<{entries:AuditEntry[]}>('list_platform_audit'),
};

export function moneyFromCents(value:number|null){
  if(value===null)return '—';
  return new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(value/100);
}
export function formatDate(value?:string|null){
  if(!value)return '—';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?'—':d.toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});
}
