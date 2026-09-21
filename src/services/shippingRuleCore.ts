export type ShippingRuleConditions={
  countryCode?:string|null;
  postalPrefix?:string|null;
};

export type ShippingRuleAction={
  carrierContains:string;
  serviceIncludes:string[];
};

export type ShippingRule={
  id:string;
  name:string;
  priority:number;
  active:boolean;
  conditions:ShippingRuleConditions;
  action:ShippingRuleAction;
};

type RuleOrder={
  shippingAddress?:Record<string,unknown>|null;
};

type RuleOption={
  code?:string|null;
  name?:string|null;
  carrierCode?:string|null;
  carrierName?:string|null;
};

function normalized(value:unknown){
  return String(value??'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function shippingRuleMatchesOrder(order:RuleOrder,rule:ShippingRule){
  if(!rule.active)return false;
  const address=order.shippingAddress||{};
  const country=String(address.country_code||'').trim().toUpperCase();
  const postal=String(address.postal_code||'').replace(/\s+/g,'').trim();
  const wantedCountry=String(rule.conditions.countryCode||'').trim().toUpperCase();
  const postalPrefix=String(rule.conditions.postalPrefix||'').replace(/\s+/g,'').trim();
  if(wantedCountry&&country!==wantedCountry)return false;
  if(postalPrefix&&!postal.startsWith(postalPrefix))return false;
  return true;
}

export function shippingRuleMatchesOption(option:RuleOption,rule:ShippingRule){
  const carrier=normalized(`${option.carrierCode||''} ${option.carrierName||''}`);
  const all=normalized(`${option.carrierCode||''} ${option.carrierName||''} ${option.name||''} ${option.code||''}`);
  const carrierNeedle=normalized(rule.action.carrierContains);
  if(carrierNeedle&&!carrier.includes(carrierNeedle)&&!all.includes(carrierNeedle))return false;
  return (rule.action.serviceIncludes||[]).every(token=>all.includes(normalized(token)));
}

export function selectShippingOptionByRules<T extends RuleOption>(
  order:RuleOrder,
  options:T[],
  rules:ShippingRule[],
):T|null{
  const sorted=[...rules].filter(rule=>rule.active).sort((a,b)=>a.priority-b.priority||a.name.localeCompare(b.name));
  for(const rule of sorted){
    if(!shippingRuleMatchesOrder(order,rule))continue;
    const option=options.find(item=>shippingRuleMatchesOption(item,rule));
    if(option)return option;
  }
  return null;
}
