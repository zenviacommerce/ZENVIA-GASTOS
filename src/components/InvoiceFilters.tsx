import { CalendarDays, History, RotateCcw } from 'lucide-react';
import type { Invoice, Supplier } from '../types';
import { filterForPreset, quarterOptions, type InvoiceFilter, type PeriodPreset } from '../services/filters';

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
        <select value={filter.preset} onChange={event => selectPreset(event.target.value as PeriodPreset)}>
          <option value="today">Hoy</option>
          <option value="current_month">Mes actual</option>
          <option value="current_quarter">Trimestre actual</option>
          <option value="current_year">Año actual</option>
          <option value="all">Todo el histórico</option>
          <option value="custom">Personalizado</option>
          <optgroup label="Trimestres">
            {quarters.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </optgroup>
        </select>
      </label>
      {showSupplier&&<label>Proveedor
        <select value={filter.supplierId} onChange={event => onChange({ ...filter, supplierId: event.target.value })}>
          <option value="">Todos los proveedores</option>
          {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
      </label>}
      <label>Desde
        <input type="date" value={filter.from} onChange={event => setDate('from', event.target.value)}/>
      </label>
      <label>Hasta
        <input type="date" value={filter.to} onChange={event => setDate('to', event.target.value)}/>
      </label>
      <button className="filterReset" type="button" onClick={() => onChange(filterForPreset('current_quarter'))} title="Restablecer filtros">
        <RotateCcw size={15}/> Restablecer
      </button>
    </div>
  </section>;
}
