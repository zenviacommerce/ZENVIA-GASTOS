import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useFloatingSelectMenu } from './useFloatingSelectMenu';
import '../../shared-forms.css';

export type SelectFieldOption={value:string;label:string;description?:string};

type Props={
  value:string;
  options:SelectFieldOption[];
  onChange:(value:string)=>void;
  placeholder?:string;
  disabled?:boolean;
  allowEmpty?:boolean;
  emptyLabel?:string;
  ariaLabel?:string;
  className?:string;
};

export function SelectField({value,options,onChange,placeholder='Selecciona…',disabled=false,allowEmpty=false,emptyLabel='Sin seleccionar',ariaLabel,className=''}:Props){
  const listId=useId();
  const [open,setOpen]=useState(false);
  const rows=useMemo(()=>allowEmpty?[{value:'',label:emptyLabel},...options]:options,[allowEmpty,emptyLabel,options]);
  const selected=rows.find(option=>option.value===value);
  const [active,setActive]=useState(Math.max(0,rows.findIndex(option=>option.value===value)));
  const {rootRef,menuRef,menuPosition,positionMenu,hideMenu}=useFloatingSelectMenu(open);

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
    const index=rows.findIndex(option=>option.value===value);
    setActive(Math.max(0,index));
    hideMenu();
    requestAnimationFrame(()=>{positionMenu();requestAnimationFrame(positionMenu)});
  },[open,rows,value]);

  useEffect(()=>{setActive(current=>Math.min(current,Math.max(0,rows.length-1)))},[rows.length]);

  const choose=(next:string)=>{onChange(next);setOpen(false)};
  const move=(delta:number)=>setActive(current=>rows.length?((current+delta+rows.length)%rows.length):0);
  const onKeyDown=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}
    if(event.key==='ArrowDown'){event.preventDefault();if(!open)setOpen(true);else move(1);return;}
    if(event.key==='ArrowUp'){event.preventDefault();if(!open)setOpen(true);else move(-1);return;}
    if(event.key==='Enter'&&open){event.preventDefault();const option=rows[active];if(option)choose(option.value);}
  };

  const menu=open&&typeof document!=='undefined'?createPortal(
    <div ref={menuRef} className="searchableSelectMenu" style={{position:'fixed',top:menuPosition.top,left:menuPosition.left,width:menuPosition.width,visibility:menuPosition.visibility}}>
      <div id={listId} role="listbox" className="searchableSelectList">{rows.length?rows.map((option,index)=><button id={`${listId}-${index}`} role="option" aria-selected={option.value===value} key={`${option.value}-${index}`} type="button" className={`searchableSelectOption ${index===active?'isActive':''} ${option.value===value?'isSelected':''}`} onMouseEnter={()=>setActive(index)} onClick={()=>choose(option.value)}><span>{option.label}{option.value===value&&<Check size={14}/>}</span>{option.description&&<small>{option.description}</small>}</button>):<div className="searchableSelectEmpty">Sin opciones</div>}</div>
    </div>,
    document.body,
  ):null;

  return <div className={`searchableSelect ${className}`.trim()} ref={rootRef}>
    <button type="button" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} aria-activedescendant={open&&rows[active]?`${listId}-${active}`:undefined} disabled={disabled} className={`searchableSelectTrigger ${selected||value?'':'isPlaceholder'}`} onClick={()=>setOpen(current=>!current)} onKeyDown={onKeyDown}>
      <span>{selected?.label||(value?value:placeholder)}</span><ChevronDown size={16}/>
    </button>
    {menu}
  </div>;
}
