import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { amazonQuickRange, type AmazonAnalyticsFilters, type AmazonMarketplaceStatus, type AmazonRangeKey } from '../../services/amazon';

const presets:[AmazonRangeKey,string][]=[['today','Hoy'],['7d','7 días'],['30d','30 días'],['current_month','Mes actual'],['previous_month','Mes anterior'],['current_quarter','Trimestre actual'],['current_year','Año actual'],['custom','Personalizado']];

export function AmazonFilters({filters,marketplaces,onChange}:{filters:AmazonAnalyticsFilters;marketplaces:AmazonMarketplaceStatus[];onChange:(filters:AmazonAnalyticsFilters)=>void}){
  const [preset,setPreset]=useState<AmazonRangeKey>('current_month');
  const apply=(key:AmazonRangeKey)=>{setPreset(key);if(key!=='custom')onChange({...amazonQuickRange(key,new Date()),marketplaceIds:filters.marketplaceIds});};
  const toggleMarketplace=(id:string)=>{const selected=filters.marketplaceIds.includes(id);onChange({...filters,marketplaceIds:selected?filters.marketplaceIds.filter(value=>value!==id):[...filters.marketplaceIds,id]});};
  return <section className="card amazonFilters" aria-label="Filtros de Amazon Analytics">
    <div className="amazonFilterPresets">{presets.map(([key,label])=><button key={key} className={preset===key?'isActive':''} onClick={()=>apply(key)}>{label}</button>)}</div>
    {preset==='custom'&&<div className="amazonDateRange"><CalendarDays size={16}/><label>Desde<input type="date" value={filters.from} onChange={e=>onChange({...filters,from:e.target.value})}/></label><label>Hasta<input type="date" value={filters.to} min={filters.from} onChange={e=>onChange({...filters,to:e.target.value})}/></label></div>}
    <div className="amazonMarketplaceFilter"><span>Marketplace</span><button className={!filters.marketplaceIds.length?'isActive':''} onClick={()=>onChange({...filters,marketplaceIds:[]})}>Todos</button>{marketplaces.filter(item=>item.active).map(item=><button key={item.id} className={filters.marketplaceIds.includes(item.id)?'isActive':''} onClick={()=>toggleMarketplace(item.id)}>{item.countryCode}</button>)}</div>
  </section>;
}
