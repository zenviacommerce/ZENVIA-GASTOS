import { CalendarDays, History, RotateCcw } from 'lucide-react';
import type { Invoice, Supplier } from '../types';
import { filterForPreset, quarterOptions, type InvoiceFilter, type PeriodPreset } from '../services/filters';
import { SearchableSelect } from './forms/SearchableSelect';
import { SelectField } from './forms/SelectField';

export function InvoiceFilters({
  filter,
  onChange,
  invoices,
  suppliers,
  showSupplier = true,
}: {
  filter: InvoiceFilter;
  onChange: (next: InvoiceFilter) => void;
  invoices: Invoice[];
  suppliers: Supplier[];
  showSupplier?: boolean;
}) {
  const quarters = quarterOptions(invoices);
  const supplierOptions = suppliers.map(supplier=>({
    value:supplier.id,
    label:supplier.name,
    searchText:[supplier.taxId,supplier.email,supplier.phone,supplier.address].filter(Boolean).join(' '),
  }));
  const periodOptions=[
    {value:'today',label:'Hoy'},
    {value:'current_month',label:'Mes actual'},
    {value:'current_quarter',label:'Trimestre actual'},
    {value:'current_year',label:'Año actual'},
    {value:'all',label:'Todo el histórico'},
    {value:'custom',label:'Personalizado'},
    ...quarters.map(option=>({value:option.value,label:option.label})),
  ];

  const selectPreset = (preset: PeriodPreset) => {
    if (preset === 'custom') {
      onChange({ ...filter, preset });
      return;
    }
    onChange(filterForPreset(preset, showSupplier ? filter.supplierId : ''));
  };

  const setDate = (key: 'from' | 'to', value: string) => {
    onChange({ ...filter, supplierId: showSupplier ? filter.supplierId : '', preset: 'custom', [key]: value });
  };

  const quick = [
    ['today', 'Hoy'],
    ['current_month', 'Mes actual'],
    ['current_quarter', 'Trimestre actual'],
    ['current_year', 'Año actual'],
    ['all', 'Histórico'],
  ] as const;

  return <section className={`invoiceFilterPanel card${showSupplier?'':' noSupplier'}`}>
    <div className="filterQuick" aria-label="Filtros rápidos de fecha">
      {quick.map(([value, label]) => <button
        key={value}
        className={filter.preset === value ? 'filterChip active' : 'filterChip'}
        onClick={() => selectPreset(value)}
        type="button"
      >{value === 'all' ? <History size={14}/> : <CalendarDays size={14}/>} {label}</button>)}
    </div>
    <div className="filterGrid">
      <label>Periodo
        <SelectField value={filter.preset} options={periodOptions} onChange={value=>selectPreset(value as PeriodPreset)} ariaLabel="Periodo de facturas"/>
      </label>
      {showSupplier&&<label>Proveedor
        <SearchableSelect
          value={filter.supplierId}
          options={supplierOptions}
          onChange={supplierId=>onChange({...filter,supplierId})}
          allowEmpty
          emptyLabel="Todos los proveedores"
          searchPlaceholder="Buscar proveedor…"
          ariaLabel="Filtrar por proveedor"
        />
      </label>}
      <label>Desde
        <input type="date" value={filter.from} onChange={event => setDate('from', event.target.value)}/>
      </label>
      <label>Hasta
        <input type="date" value={filter.to} onChange={event => setDate('to', event.target.value)}/>
      </label>
      <button className="filterReset" type="button" onClick={() => onChange(filterForPreset('all'))} title="Restablecer filtros">
        <RotateCcw size={15}/> Restablecer
      </button>
    </div>
  </section>;
}
