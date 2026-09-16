import { useEffect, useRef, useState } from 'react';

export type FloatingSelectMenuPosition={top:number;left:number;width:number;visibility:'visible'|'hidden'};

export function useFloatingSelectMenu(open:boolean){
  const rootRef=useRef<HTMLDivElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const [menuPosition,setMenuPosition]=useState<FloatingSelectMenuPosition>({top:0,left:-10000,width:0,visibility:'hidden'});

  const positionMenu=()=>{
    const root=rootRef.current;
    if(!root)return;
    const rect=root.getBoundingClientRect();
    const measuredHeight=menuRef.current?.getBoundingClientRect().height||320;
    const below=window.innerHeight-rect.bottom-8;
    const above=rect.top-8;
    const openAbove=below<Math.min(measuredHeight,220)&&above>below;
    const top=openAbove?Math.max(8,rect.top-measuredHeight-6):Math.min(rect.bottom+6,Math.max(8,window.innerHeight-measuredHeight-8));
    const width=Math.min(rect.width,Math.max(0,window.innerWidth-16));
    const left=Math.min(Math.max(8,rect.left),Math.max(8,window.innerWidth-width-8));
    setMenuPosition({top,left,width,visibility:'visible'});
  };

  useEffect(()=>{
    if(!open)return;
    const reposition=()=>positionMenu();
    document.addEventListener('scroll',reposition,true);
    window.addEventListener('resize',reposition);
    return()=>{document.removeEventListener('scroll',reposition,true);window.removeEventListener('resize',reposition)};
  },[open]);

  const hideMenu=()=>setMenuPosition(position=>({...position,visibility:'hidden'}));
  return {rootRef,menuRef,menuPosition,positionMenu,hideMenu};
}
