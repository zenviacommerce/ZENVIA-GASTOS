import { supabase } from './supabase';
import type { ExpenseImportPolicy } from './expenseImportPolicy';

export type AutomationRuleKey='order_label_created'|'expense_invoice_imported';

export type OrderLabelCreatedAutomationConfig={
  saveTracking:boolean;
  pushToMarketplace:boolean;
  markSent:boolean;
  downloadPdf:boolean;
  retryConfirmation:boolean;
};

export type ExpenseInvoiceImportedAutomationConfig={
  updateProductCosts:boolean;
  updatePriceHistory:boolean;
  createSupplierProductRelation:boolean;
};

export type AutomationRuleMap={
  order_label_created:OrderLabelCreatedAutomationConfig;
  expense_invoice_imported:ExpenseInvoiceImportedAutomationConfig;
};

export type AutomationRule<K extends AutomationRuleKey=AutomationRuleKey>={
  key:K;
  enabled:boolean;
  config:AutomationRuleMap[K];
};

export const ORDER_LABEL_CONFIG_KEYS=[
  'saveTracking','pushToMarketplace','markSent','downloadPdf','retryConfirmation',
] as const;

export const EXPENSE_IMPORT_CONFIG_KEYS=[
  'updateProductCosts','updatePriceHistory','createSupplierProductRelation',
] as const;

export const DEFAULT_AUTOMATION_RULES:{
  [K in AutomationRuleKey]:AutomationRule<K>
}={
  order_label_created:{
    key:'order_label_created',
    enabled:true,
    config:{
      saveTracking:true,
      pushToMarketplace:true,
      markSent:true,
      downloadPdf:true,
      retryConfirmation:true,
    },
  },
  expense_invoice_imported:{
    key:'expense_invoice_imported',
    enabled:true,
    config:{
      updateProductCosts:true,
      updatePriceHistory:true,
      createSupplierProductRelation:true,
    },
  },
};

function clone<T>(value:T):T{
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('La configuración de automatización debe ser un objeto.');
  return value as Record<string,unknown>;
}

function unknownKeys(input:Record<string,unknown>,allowed:readonly string[],path:string){
  const allowedSet=new Set(allowed);
  const extras=Object.keys(input).filter(key=>!allowedSet.has(key));
  if(extras.length)throw new Error(`${path}: propiedades no permitidas: ${extras.join(', ')}.`);
}

function bool(input:Record<string,unknown>,key:string,fallback:boolean){
  const value=input[key];
  if(value===undefined)return fallback;
  if(typeof value!=='boolean')throw new Error(`${key}: se esperaba true/false.`);
  return value;
}

function normalizeOrderLabelConfig(value:unknown):OrderLabelCreatedAutomationConfig{
  const input=record(value);
  unknownKeys(input,ORDER_LABEL_CONFIG_KEYS,'order_label_created.config');
  const d=DEFAULT_AUTOMATION_RULES.order_label_created.config;
  return {
    saveTracking:bool(input,'saveTracking',d.saveTracking),
    pushToMarketplace:bool(input,'pushToMarketplace',d.pushToMarketplace),
    markSent:bool(input,'markSent',d.markSent),
    downloadPdf:bool(input,'downloadPdf',d.downloadPdf),
    retryConfirmation:bool(input,'retryConfirmation',d.retryConfirmation),
  };
}

function normalizeExpenseConfig(value:unknown):ExpenseInvoiceImportedAutomationConfig{
  const input=record(value);
  unknownKeys(input,EXPENSE_IMPORT_CONFIG_KEYS,'expense_invoice_imported.config');
  const d=DEFAULT_AUTOMATION_RULES.expense_invoice_imported.config;
  return {
    updateProductCosts:bool(input,'updateProductCosts',d.updateProductCosts),
    updatePriceHistory:bool(input,'updatePriceHistory',d.updatePriceHistory),
    createSupplierProductRelation:bool(input,'createSupplierProductRelation',d.createSupplierProductRelation),
  };
}

export function normalizeAutomationRule<K extends AutomationRuleKey>(
  key:K,
  row:unknown,
):AutomationRule<K>{
  if(key!=='order_label_created'&&key!=='expense_invoice_imported')throw new Error('Unknown automation rule key. Regla de automatización no permitida.');
  if(row==null)return clone(DEFAULT_AUTOMATION_RULES[key]) as AutomationRule<K>;
  const input=record(row);
  unknownKeys(input,['key','rule_key','enabled','config'],'automation_rule');
  const rawKey=String(input.key??input.rule_key??key);
  if(rawKey!==key)throw new Error('Unknown automation rule key. Regla de automatización no permitida.');
  const enabled=input.enabled===undefined?DEFAULT_AUTOMATION_RULES[key].enabled:input.enabled;
  if(typeof enabled!=='boolean')throw new Error('automation_rule.enabled: se esperaba true/false.');
  const rawConfig=input.config===undefined?DEFAULT_AUTOMATION_RULES[key].config:input.config;
  const config=(key==='order_label_created'
    ?normalizeOrderLabelConfig(rawConfig)
    :normalizeExpenseConfig(rawConfig)) as AutomationRuleMap[K];
  return {key,enabled,config};
}

async function workspaceOwnerId(){
  const {data:{user},error:userError}=await supabase.auth.getUser();
  if(userError)throw userError;
  if(!user)throw new Error('No hay una sesión activa.');
  const {data:profile,error:profileError}=await supabase
    .from('app_users')
    .select('data_owner_id')
    .eq('user_id',user.id)
    .maybeSingle();
  if(profileError)throw profileError;
  return String(profile?.data_owner_id||user.id);
}

export async function loadAutomationRules():Promise<{
  order_label_created:AutomationRule<'order_label_created'>;
  expense_invoice_imported:AutomationRule<'expense_invoice_imported'>;
}>{
  const keys:AutomationRuleKey[]=['order_label_created','expense_invoice_imported'];
  const {data,error}=await supabase.from('automation_rules').select('rule_key,enabled,config').in('rule_key',keys);
  if(error)throw error;
  const rowsByKey=new Map((data||[]).map((row:any)=>[String(row.rule_key),row]));
  return {
    order_label_created:normalizeAutomationRule('order_label_created',rowsByKey.get('order_label_created')||DEFAULT_AUTOMATION_RULES.order_label_created),
    expense_invoice_imported:normalizeAutomationRule('expense_invoice_imported',rowsByKey.get('expense_invoice_imported')||DEFAULT_AUTOMATION_RULES.expense_invoice_imported),
  };
}

export async function loadAutomationRule<K extends AutomationRuleKey>(key:K):Promise<AutomationRule<K>>{
  const {data,error}=await supabase.from('automation_rules').select('rule_key,enabled,config').eq('rule_key',key).maybeSingle();
  if(error)throw error;
  return normalizeAutomationRule(key,data);
}

export async function saveAutomationRule<K extends AutomationRuleKey>(rule:AutomationRule<K>):Promise<AutomationRule<K>>{
  const normalized=normalizeAutomationRule(rule.key,rule);
  const ownerId=await workspaceOwnerId();
  const {data,error}=await supabase.from('automation_rules').upsert({
    owner_id:ownerId,
    rule_key:normalized.key,
    enabled:normalized.enabled,
    config:normalized.config,
  },{onConflict:'owner_id,rule_key'}).select('rule_key,enabled,config').single();
  if(error)throw error;
  return normalizeAutomationRule(rule.key,data);
}

export function applyExpenseInvoiceImportedAutomation(
  policy:ExpenseImportPolicy,
  rule:AutomationRule<'expense_invoice_imported'>,
):ExpenseImportPolicy{
  if(!rule.enabled){
    return {
      ...policy,
      updateProductCosts:false,
      updatePriceHistory:false,
      createSupplierProductRelation:false,
    };
  }
  return {
    ...policy,
    updateProductCosts:policy.updateProductCosts&&rule.config.updateProductCosts,
    updatePriceHistory:policy.updatePriceHistory&&rule.config.updatePriceHistory,
    createSupplierProductRelation:policy.createSupplierProductRelation&&rule.config.createSupplierProductRelation,
  };
}
