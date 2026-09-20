import { useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
const CONTROL_CLASS='autoListPagination';

type PaginationTarget={anchor:HTMLElement;containers:HTMLElement[];key:string};

function directItems(container:HTMLElement){return Array.from(container.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&!node.classList.contains('listPagination'));}

function signature(items:HTMLElement[]){
  const first=items[0]?.textContent?.trim().slice(0,80)||'';
  const last=items.at(-1)?.textContent?.trim().slice(0,80)||'';
  return `${items.length}|${first}|${last}`;
}

function controlsFor(anchor:HTMLElement){
  const next=anchor.nextElementSibling;
  return next instanceof HTMLElement&&next.classList.contains(CONTROL_CLASS)?next:null;
}

function renderTarget({anchor,containers,key}:PaginationTarget,pageSize:number){
  const lists=containers.map(directItems);
  const total=Math.max(0,...lists.map(items=>items.length));
  const sig=signature(lists.find(items=>items.length===total)||[]);
  const oldSig=anchor.dataset.autoPaginationSignature||'';
  let page=Number(anchor.dataset.autoPaginationPage||'1')||1;
  if(oldSig&&oldSig!==sig)page=1;
  const pages=Math.max(1,Math.ceil(total/pageSize));
  page=Math.min(Math.max(1,page),pages);
  anchor.dataset.autoPaginationPage=String(page);
  anchor.dataset.autoPaginationSignature=sig;

  lists.forEach(items=>items.forEach((item,index)=>{item.style.display=index>=(page-1)*pageSize&&index<page*pageSize?'':'none'}));

  let controls=controlsFor(anchor);
  if(!total){controls?.remove();return;}
  if(!controls){controls=document.createElement('div');controls.className=`listPagination ${CONTROL_CLASS}`;controls.dataset.paginationKey=key;anchor.insertAdjacentElement('afterend',controls);}
  const from=(page-1)*pageSize+1,to=Math.min(page*pageSize,total);
  const renderKey=`${page}|${pages}|${total}|${from}|${to}`;
  if(controls.dataset.renderKey===renderKey)return;
  controls.dataset.renderKey=renderKey;
  controls.innerHTML=`<span>Mostrando <strong>${from}-${to}</strong> de <strong>${total}</strong></span><div><button class="secondary" data-dir="prev" ${page<=1?'disabled':''}>‹ Anterior</button><span>Página ${page} de ${pages}</span><button class="secondary" data-dir="next" ${page>=pages?'disabled':''}>Siguiente ›</button></div>`;
  controls.querySelectorAll<HTMLButtonElement>('button[data-dir]').forEach(button=>{button.onclick=()=>{const dir=button.dataset.dir;const nextPage=dir==='prev'?page-1:page+1;anchor.dataset.autoPaginationPage=String(Math.min(Math.max(1,nextPage),pages));renderTarget({anchor,containers,key},pageSize);anchor.scrollIntoView({behavior:'smooth',block:'nearest'});};});
}

function collectTargets():PaginationTarget[]{
  const targets:PaginationTarget[]=[];
  const orders=document.querySelector<HTMLElement>('.ordersPage');
  if(orders){
    const anchor=orders.querySelector<HTMLElement>('.ordersTableCard');
    const table=orders.querySelector<HTMLElement>('.ordersTable tbody');
    const mobile=orders.querySelector<HTMLElement>('.ordersMobileList');
    if(anchor&&(table||mobile))targets.push({anchor,containers:[table,mobile].filter(Boolean) as HTMLElement[],key:'orders'});
  }

  document.querySelectorAll<HTMLElement>('.tableCard').forEach((card,index)=>{
    if(card.classList.contains('ordersTableCard')||card.classList.contains('masterTableCard'))return;
    if(card.querySelector('.listPagination'))return;
    const tbody=card.querySelector<HTMLElement>('table tbody');
    if(tbody)targets.push({anchor:card,containers:[tbody],key:`table-${index}`});
  });
  return targets;
}

export function AutoPagination(){
  const {preferences}=useSettings();
  const pageSize=preferences.pageSize;
  useEffect(()=>{
    let scheduled=false;
    const apply=()=>{scheduled=false;collectTargets().forEach(target=>renderTarget(target,pageSize));};
    const schedule=()=>{if(scheduled)return;scheduled=true;window.requestAnimationFrame(apply);};
    schedule();
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('resize',schedule);
    return()=>{observer.disconnect();window.removeEventListener('resize',schedule);document.querySelectorAll(`.${CONTROL_CLASS}`).forEach(node=>node.remove());};
  },[pageSize]);
  return null;
}
