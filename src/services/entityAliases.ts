import { supabase } from './supabase';
import { normalizeAlias } from './entityAliasCore';

export type EntityAliasType='supplier'|'client';

export type EntityAliasRule={
  id:string;
  entityType:EntityAliasType;
  alias:string;
  normalizedAlias:string;
  targetEntityId:string;
  priority:number;
  active:boolean;
};

const mapRule=(row:any):EntityAliasRule=>({
  id:row.id,
  entityType:row.entity_type,
  alias:row.alias,
  normalizedAlias:row.normalized_alias,
  targetEntityId:row.target_entity_id,
  priority:Number(row.priority??100),
  active:Boolean(row.active),
});

export async function loadEntityAliases(type?:EntityAliasType):Promise<EntityAliasRule[]>{
  let query=supabase.from('entity_alias_rules').select('*').order('priority').order('alias');
  if(type)query=query.eq('entity_type',type);
  const {data,error}=await query;
  if(error)throw error;
  return (data??[]).map(mapRule);
}

export async function resolveEntityAlias(type:EntityAliasType,detectedName:string):Promise<EntityAliasRule|null>{
  const normalized=normalizeAlias(detectedName);
  if(!normalized)return null;
  const {data,error}=await supabase
    .from('entity_alias_rules')
    .select('*')
    .eq('entity_type',type)
    .eq('normalized_alias',normalized)
    .eq('active',true)
    .order('priority')
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  return data?mapRule(data):null;
}

export async function addEntityAlias(input:Omit<EntityAliasRule,'id'|'normalizedAlias'>){
  const normalizedAlias=normalizeAlias(input.alias);
  if(!normalizedAlias)throw new Error('El alias no puede estar vacío.');
  const {data,error}=await supabase.from('entity_alias_rules').insert({
    entity_type:input.entityType,
    alias:input.alias.trim(),
    normalized_alias:normalizedAlias,
    target_entity_id:input.targetEntityId,
    priority:input.priority,
    active:input.active,
  }).select('id').single();
  if(error)throw error;
  return data.id as string;
}

export async function updateEntityAlias(id:string,input:Omit<EntityAliasRule,'id'|'normalizedAlias'>){
  const normalizedAlias=normalizeAlias(input.alias);
  if(!normalizedAlias)throw new Error('El alias no puede estar vacío.');
  const {error}=await supabase.from('entity_alias_rules').update({
    entity_type:input.entityType,
    alias:input.alias.trim(),
    normalized_alias:normalizedAlias,
    target_entity_id:input.targetEntityId,
    priority:input.priority,
    active:input.active,
  }).eq('id',id);
  if(error)throw error;
}

export async function deleteEntityAlias(id:string){
  const {error}=await supabase.from('entity_alias_rules').delete().eq('id',id);
  if(error)throw error;
}
