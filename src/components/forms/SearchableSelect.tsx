import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
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

type MenuPosition={top:number;left:number;width:number;visibility:'visible'|'hidden'};

const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function SearchableSelect({value,options,onChange,placeholder='Selecciona…',searchPlaceholder='Buscar…',disabled=false,allowEmpty=false,emptyLabel='Sin seleccionar',ariaLabel}:Props){
  const rootRef=useRef<HTMLDivElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const listId=useId();
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState('');
  const [active,setActive]=useState(0);
  const [menuPosition,setMenuPosition]=useState<MenuPosition>({top:0,left:-10000,width:0,visibility:'hidden'});
  const selected=options.find(option=>option.value===value);
  const filtered=useMemo(()=>{
    const needle=normalize(query);
    const rows=allowEmpty?[{value:'',label:emptyLabel,searchText:emptyLabel},...options]:options;
    if(!needle)return rows;
    return rows.filter(option=>normalize(`${option.label} ${option.searchText||''} ${option.value}`).includes(needle));
  },[allowEmpty,emptyLabel,options,query]);

  const positionMenu=()=>{
    const root=rootRef.current;
    if(!root)return;
    const rect=root.getBoundingClientRect();
    const measuredHeight=menuRef.current?.getBoundingClientRect().height||320;
    const below=window.innerHeight-rect.bottom-8;
    const above=rect.top-8;
    const openAbove=below<Math.min(measuredHeight,220)&&above>below;
    const top=openAbove
      ?Math.max(8,rect.top-measuredHeight-6)
      :Math.min(rect.bottom+6,Math.max(8,window.innerHeight-measuredHeight-8));
    const width=Math.min(rect.width,Math.max(0,window.innerWidth-16));
    const left=Math.min(Math.max(8,rect.left),Math.max(8,window.innerWidth-width-8));
    setMenuPosition({top,left,width,visibility:'visible'});
  };

  useEffect(()=>{
    if(!open)return;
    const onPointerDown=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(rootRef.current?.contains(target)||menuRef.current?.contains(target))return;
      setOpen(false);
    };
    const reposition=()=>positionMenu();
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('scroll',reposition,true);
    window.addEventListener('resize',reposition);
    return()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      document.removeEventListener('scroll',reposition,true);
      window.removeEventListener('resize',reposition);
    };
  },[open]);

  useEffect(()=>{
    if(!open)return;
    setQuery('');
    setActive(Math.max(0,options.findIndex(option=>option.value===value)));
    setMenuPosition(position=>({...position,visibility:'hidden'}));
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
