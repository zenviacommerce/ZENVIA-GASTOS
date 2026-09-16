import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useFloatingSelectMenu } from './useFloatingSelectMenu';
import '../../shared-forms.css';

export type SearchableSelectOption={value:string;label:string;searchText?:string;description?:string};

type Props={
  value:string;
  options:SearchableSelectOption[];
  onChange:(value:string)=>void;
  placeholder?:string;
  searchPlaceholder?:string;
  disabled?:boolean;
  allowEmpty?:boolean;
  emptyLabel?:string;
  ariaLabel?:string;
};

const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function SearchableSelect({value,options,onChange,placeholder='Selecciona…',searchPlaceholder='Buscar…',disabled=false,allowEmpty=false,emptyLabel='Sin seleccionar',ariaLabel}:Props){
  const searchRef=useRef<HTMLInputElement>(null);
  const listId=useId();
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState('');
  const [active,setActive]=useState(0);
  const {rootRef,menuRef,menuPosition,positionMenu,hideMenu}=useFloatingSelectMenu(open);
  const selected=options.find(option=>option.value===value);
  const filtered=useMemo(()=>{
    const needle=normalize(query);
    const rows=allowEmpty?[{value:'',label:emptyLabel,searchText:emptyLabel},...options]:options;
    if(!needle)return rows;
    return rows.filter(option=>normalize(`${option.label} ${option.searchText||''} ${option.value}`).includes(needle));
  },[allowEmpty,emptyLabel,options,query]);

  useEffect(()=>{
    if(!open)return;
    const onPointerDown=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(rootRef.current?.contains(target)||menuRef.current?.contains(target))return;
      setOpen(false);
    };
    document.addEventListener('pointerdown',onPointerDown);
    return()=>document.removeEventListener('pointerdown',onPointerDown);
  },[open,menuRef,rootRef]);

  useEffect(()=>{
    if(!open)return;
    setQuery('');
    setActive(Math.max(0,options.findIndex(option=>option.value===value)));
    hideMenu();
    requestAnimationFrame(()=>{
      positionMenu();
      searchRef.current?.focus();
      requestAnimationFrame(positionMenu);
    });
  },[open,options,value]);

  useEffect(()=>{setActive(current=>Math.min(current,Math.max(0,filtered.length-1)))},[filtered.length]);

  const choose=(next:string)=>{onChange(next);setOpen(false);setQuery('')};
  const move=(delta:number)=>setActive(current=>filtered.length?((current+delta+filtered.length)%filtered.length):0);
  const onKeyDown=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}
    if(event.key==='ArrowDown'){event.preventDefault();if(!open)setOpen(true);else move(1);return;}
    if(event.key==='ArrowUp'){event.preventDefault();if(!open)setOpen(true);else move(-1);return;}
    if(event.key==='Enter'&&open){event.preventDefault();const option=filtered[active];if(option)choose(option.value);}
  };

  const menu=open&&typeof document!=='undefined'?createPortal(
    <div ref={menuRef} className="searchableSelectMenu" style={{position:'fixed',top:menuPosition.top,left:menuPosition.left,width:menuPosition.width,visibility:menuPosition.visibility}}>
      <div className="search"><Search size={15}/><input ref={searchRef} className="searchableSelectSearch" value={query} onChange={e=>{setQuery(e.target.value);setActive(0)}} onKeyDown={onKeyDown} placeholder={searchPlaceholder} aria-label={searchPlaceholder}/></div>
      <div id={listId} role="listbox" className="searchableSelectList">{filtered.length?filtered.map((option,index)=><button id={`${listId}-${index}`} role="option" aria-selected={option.value===value} key={`${option.value}-${index}`} type="button" className={`searchableSelectOption ${index===active?'isActive':''} ${option.value===value?'isSelected':''}`} onMouseEnter={()=>setActive(index)} onClick={()=>choose(option.value)}><span>{option.label}{option.value===value&&<Check size={14}/>}</span>{option.description&&<small>{option.description}</small>}</button>):<div className="searchableSelectEmpty">Sin resultados</div>}</div>
    </div>,
    document.body,
  ):null;

  return <div className="searchableSelect" ref={rootRef}>
    <button type="button" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} aria-activedescendant={open&&filtered[active]?`${listId}-${active}`:undefined} disabled={disabled} className={`searchableSelectTrigger ${selected||value?'':'isPlaceholder'}`} onClick={()=>setOpen(current=>!current)} onKeyDown={onKeyDown}>
      <span>{selected?.label||(value?value:placeholder)}</span><ChevronDown size={16}/>
    </button>
    {menu}
  </div>;
}
