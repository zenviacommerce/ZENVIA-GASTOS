import type { ReactNode } from 'react';
import '../bulk-selection.css';

export function BulkSelectCheckbox({
  checked,disabled=false,onChange,label='Seleccionar fila',
}:{checked:boolean;disabled?:boolean;onChange:(checked:boolean)=>void;label?:string}){
  return <label className="bulkSelectCheckbox" title={label}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)} aria-label={label}/>
    <span aria-hidden="true"/>
  </label>;
}

export function BulkSelectionToolbar({
  selectedCount,totalCount,allSelected,onToggleAll,children,label='seleccionados',
}:{
  selectedCount:number;
  totalCount:number;
  allSelected:boolean;
  onToggleAll:(checked:boolean)=>void;
  children?:ReactNode;
  label?:string;
}){
  if(totalCount<=0)return null;
  return <div className="bulkSelectionToolbar">
    <div className="bulkSelectionToggle">
      <BulkSelectCheckbox
        checked={allSelected}
        onChange={onToggleAll}
        label={allSelected?'Deseleccionar todos':'Seleccionar todos'}
      />
      <button type="button" className="bulkSelectionTextButton" onClick={()=>onToggleAll(!allSelected)}>
        {allSelected?'Deseleccionar todos':'Seleccionar todos'}
      </button>
      <span className="bulkSelectionCount">{selectedCount} de {totalCount} {label}</span>
    </div>
    <div className="bulkSelectionActions">{children}</div>
  </div>;
}
