import type { ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { dateFilterForPreset, periodLabel, type DateRangeFilter } from '../services/filters';

const quickPresets = [
  ['today', 'Hoy'],
  ['current_month', 'Mes actual'],
  ['current_quarter', 'Trimestre actual'],
  ['current_year', 'Año actual'],
  ['all', 'Todo'],
] as const;

export function PeriodFilterPanel({
  filter,
  onChange,
  title='Periodo de análisis',
  note,
  className='',
}: {
  filter: DateRangeFilter;
  onChange: (next: DateRangeFilter) => void;
  title?: string;
  note?: ReactNode;
  className?: string;
}) {
  const applyPreset=(preset:'today'|'current_month'|'current_quarter'|'current_year'|'all')=>onChange(dateFilterForPreset(preset));
  const setDate=(key:'from'|'to',value:string)=>onChange({...filter,preset:'custom',[key]:value});

  return <section className={`masterPeriodPanel sharedPeriodPanel ${className}`.trim()}>
    <div className="masterPeriodTop">
      <div><CalendarDays size={17}/><div><strong>{title}</strong><span>{periodLabel(filter)}</span></div></div>
      <div className="masterPeriodQuick">
        {quickPresets.map(([preset,label])=><button key={preset} type="button" className={filter.preset===preset?'active':''} onClick={()=>applyPreset(preset)}>{label}</button>)}
      </div>
    </div>
    <div className="masterPeriodDates">
      <label>Desde<input type="date" value={filter.from} onChange={event=>setDate('from',event.target.value)}/></label>
      <label>Hasta<input type="date" value={filter.to} min={filter.from||undefined} onChange={event=>setDate('to',event.target.value)}/></label>
      {filter.preset==='custom'&&<button className="secondary" type="button" onClick={()=>applyPreset('current_quarter')}>Restablecer trimestre</button>}
    </div>
    {note&&<small className="sharedPeriodNote">{note}</small>}
  </section>;
}
