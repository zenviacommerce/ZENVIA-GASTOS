import { supabase } from './supabase';
import type { ShippingRule, ShippingRuleAction, ShippingRuleConditions } from './shippingRuleCore';

export type { ShippingRule, ShippingRuleAction, ShippingRuleConditions } from './shippingRuleCore';

export const DEFAULT_SHIPPING_RULES:Array<Omit<ShippingRule,'id'>>=[
  {
    name:'Baleares · Correos',
    priority:100,
    active:true,
    conditions:{countryCode:'ES',postalPrefix:'07'},
    action:{carrierContains:'correos',serviceIncludes:[]},
  },
  {
    name:'MRW Urgent 19:00',
    priority:200,
    active:true,
    conditions:{},
    action:{carrierContains:'mrw',serviceIncludes:['urgent','19','expedition']},
  },
];

const mapRule=(row:any):ShippingRule=>({
  id:row.id,
  name:String(row.name||'Regla de envío'),
  priority:Number(row.priority??100),
  active:Boolean(row.active),
  conditions:(row.conditions||{}) as ShippingRuleConditions,
  action:{
    carrierContains:String(row.action?.carrierContains||''),
    serviceIncludes:Array.isArray(row.action?.serviceIncludes)?row.action.serviceIncludes.map(String):[],
  },
});

export async function loadShippingRules({ensureDefaults=true}:{ensureDefaults?:boolean}={}):Promise<ShippingRule[]>{
  const {data,error}=await supabase.from('shipping_rules').select('*').order('priority').order('name');
  if(error)throw error;
  if((data??[]).length||!ensureDefaults)return (data??[]).map(mapRule);

  const rows=DEFAULT_SHIPPING_RULES.map(rule=>({
    name:rule.name,
    priority:rule.priority,
    active:rule.active,
    conditions:rule.conditions,
    action:rule.action,
  }));
  const {error:insertError}=await supabase.from('shipping_rules').insert(rows);
  if(insertError)throw insertError;

  const {data:created,error:reloadError}=await supabase.from('shipping_rules').select('*').order('priority').order('name');
  if(reloadError)throw reloadError;
  return (created??[]).map(mapRule);
}

export async function addShippingRule(input:Omit<ShippingRule,'id'>){
  const {data,error}=await supabase.from('shipping_rules').insert({
    name:input.name.trim(),
    priority:input.priority,
    active:input.active,
    conditions:input.conditions,
    action:input.action,
  }).select('id').single();
  if(error)throw error;
  return data.id as string;
}

export async function updateShippingRule(id:string,input:Omit<ShippingRule,'id'>){
  const {error}=await supabase.from('shipping_rules').update({
    name:input.name.trim(),
    priority:input.priority,
    active:input.active,
    conditions:input.conditions,
    action:input.action,
  }).eq('id',id);
  if(error)throw error;
}

export async function deleteShippingRule(id:string){
  const {error}=await supabase.from('shipping_rules').delete().eq('id',id);
  if(error)throw error;
}
