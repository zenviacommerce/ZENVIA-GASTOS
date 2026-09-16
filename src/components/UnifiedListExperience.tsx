import { useEffect } from 'react';
import { isTextOverflowing, isTooltipEligible, tooltipTextFor } from '../services/truncatedTextTooltip';

const HOST_CLASS='zenviaUnifiedListHost';
const LIST_CLASS='zenviaUnifiedMobileList';
const TABLE_CLASS='zenviaUnifiedDesktopTable';
const MASTER_ACTIONS='zenviaMasterRowActions';
const MASTER_MOBILE_ACTIONS='zenviaMasterMobileActions';
const TOOLTIP_SCOPE='.tableCard,.masterMobileList,.zenviaUnifiedMobileList,.ordersPage,[class*="gmail"]';

function clean(value:string){return value.replace(/\s+/g,' ').trim();}

const ICONS={
  edit:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  delete:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>`,
};

function actionButton(kind:'edit'|'delete',label:string){
  const button=document.createElement('button');
  button.type='button';
  button.className=`zenviaRowAction ${kind==='delete'?'danger':''}`;
  button.title=label;
  button.setAttribute('aria-label',label);
  button.innerHTML=ICONS[kind];
  return button;
}

function findDrawerButton(kind:'edit'|'delete'){
  const visibleDrawers=Array.from(document.querySelectorAll<HTMLElement>('.masterDrawer,.zenviaDetailDrawer,.invoiceDetailModal,.salesDetailModal'))
    .filter(drawer=>drawer.offsetParent!==null);
  const drawer=visibleDrawers.at(-1);
  if(!drawer)return null;
  const matcher=kind==='edit'?/editar/i:/eliminar/i;
  return Array.from(drawer.querySelectorAll<HTMLButtonElement>('button')).find(button=>matcher.test(clean(button.textContent||'')))||null;
}

function invokeRowAction(row:HTMLTableRowElement,kind:'edit'|'delete'){
  row.click();
  window.setTimeout(()=>{
    const target=findDrawerButton(kind);
    if(target)target.click();
  },40);
}

function enhanceDetailDrawers(){
  document.querySelectorAll<HTMLElement>('.invoiceDetailModal,.salesDetailModal').forEach(modal=>{
    const backdrop=modal.closest<HTMLElement>('.modalBackdrop');
    if(!backdrop)return;
    backdrop.classList.add('zenviaDetailDrawerBackdrop');
    modal.classList.add('zenviaDetailDrawer');
  });
}

function enhanceExpenseDesktopEdit(){
  document.querySelectorAll<HTMLTableRowElement>('.expenseInvoicesHub .tableCard tbody > tr.clickableRow').forEach(row=>{
    const actions=row.querySelector<HTMLElement>('.invoiceActions');
    if(!actions||actions.querySelector('[data-zenvia-expense-edit]'))return;
    const edit=actionButton('edit','Editar factura');
    edit.dataset.zenviaExpenseEdit='true';
    edit.addEventListener('click',event=>{event.stopPropagation();row.click();});
    actions.insertBefore(edit,actions.firstChild);
  });
}

function enhanceMasterDesktopActions(){
  document.querySelectorAll<HTMLTableElement>('.masterTableCard table.masterTable').forEach(table=>{
    const rows=Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody > tr.clickableRow'));
    rows.forEach(row=>{
      const lastCell=row.lastElementChild instanceof HTMLTableCellElement?row.lastElementChild:null;
      if(!lastCell||lastCell.querySelector(`.${MASTER_ACTIONS}`))return;
      const actions=document.createElement('div');
      actions.className=MASTER_ACTIONS;
      const edit=actionButton('edit','Editar');
      const remove=actionButton('delete','Eliminar');
      edit.addEventListener('click',event=>{event.stopPropagation();invokeRowAction(row,'edit');});
      remove.addEventListener('click',event=>{event.stopPropagation();invokeRowAction(row,'delete');});
      actions.append(edit,remove);
      lastCell.appendChild(actions);
    });
  });
}

function enhanceMasterMobileActions(){
  document.querySelectorAll<HTMLElement>('.masterPage').forEach(page=>{
    const rows=Array.from(page.querySelectorAll<HTMLTableRowElement>('.masterTableCard table.masterTable tbody > tr.clickableRow'));
    const cards=Array.from(page.querySelectorAll<HTMLElement>('.masterMobileList > .masterMobileRow'));
    cards.forEach((card,index)=>{
      if(card.nextElementSibling?.classList.contains(MASTER_MOBILE_ACTIONS))return;
      const row=rows[index];
      if(!row)return;
      const actions=document.createElement('div');
      actions.className=MASTER_MOBILE_ACTIONS;
      const edit=document.createElement('button');
      edit.type='button';
      edit.className='zenviaMobileAction edit';
      edit.innerHTML=`${ICONS.edit}<span>Editar</span>`;
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='zenviaMobileAction danger';
      remove.innerHTML=`${ICONS.delete}<span>Eliminar</span>`;
      edit.addEventListener('click',event=>{event.stopPropagation();invokeRowAction(row,'edit');});
      remove.addEventListener('click',event=>{event.stopPropagation();invokeRowAction(row,'delete');});
      actions.append(edit,remove);
      card.insertAdjacentElement('afterend',actions);
    });
  });
}

function shouldSkipTable(table:HTMLTableElement){
  if(table.closest('.masterTableCard'))return true;
  if(table.classList.contains('ordersTable')||table.closest('.ordersPage'))return true;
  if(table.classList.contains('detailLines')||table.closest('.detailLinesWrap'))return true;
  return false;
}

function matchingRowAction(row:HTMLTableRowElement,kind:'edit'|'delete'){
  const buttons=Array.from(row.querySelectorAll<HTMLButtonElement>('button'));
  if(kind==='edit')return buttons.find(button=>/editar/i.test(`${button.title} ${button.getAttribute('aria-label')||''}`))||null;
  return buttons.find(button=>/eliminar/i.test(`${button.title} ${button.getAttribute('aria-label')||''}`))||null;
}

function buildMobileCards(table:HTMLTableElement){
  if(shouldSkipTable(table))return;
  const rows=Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody > tr.clickableRow'));
  if(!rows.length)return;
  const host=table.closest<HTMLElement>('.tableCard');
  if(!host)return;

  const headers=Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th')).map(th=>clean(th.textContent||''));
  const signature=rows.map(row=>`${clean(row.textContent||'')}|e:${Boolean(matchingRowAction(row,'edit'))}|d:${Boolean(matchingRowAction(row,'delete'))}`).join('||');
  let list=host.querySelector<HTMLElement>(`:scope > .${LIST_CLASS}`);
  if(list?.dataset.signature===signature)return;
  if(!list){
    list=document.createElement('div');
    list.className=LIST_CLASS;
    host.appendChild(list);
  }
  list.dataset.signature=signature;
  list.replaceChildren();
  host.classList.add(HOST_CLASS);
  table.classList.add(TABLE_CLASS);

  rows.forEach(row=>{
    const cells=Array.from(row.children).filter((node):node is HTMLTableCellElement=>node instanceof HTMLTableCellElement);
    const values=cells.map(cell=>clean(cell.textContent||''));
    const strongIndex=cells.findIndex(cell=>Boolean(cell.querySelector('strong')));
    const primaryIndex=strongIndex>=0?strongIndex:(values[1]?1:0);
    const primary=clean(cells[primaryIndex]?.querySelector('strong')?.textContent||values[primaryIndex]||'Registro');

    const card=document.createElement('div');
    card.className='card zenviaUnifiedMobileRow';
    card.setAttribute('role','button');
    card.tabIndex=0;
    card.setAttribute('aria-label',`Abrir ${primary}`);

    const top=document.createElement('div');
    top.className='zenviaUnifiedMobileTop';
    const identity=document.createElement('div');
    identity.className='zenviaUnifiedMobileIdentity';
    const title=document.createElement('strong');
    title.textContent=primary;
    const subtitle=document.createElement('small');
    const subtitleParts=values
      .map((value,index)=>({value,index}))
      .filter(item=>item.value&&item.index!==primaryIndex&&!/acciones?/i.test(headers[item.index]||''))
      .slice(0,2)
      .map(item=>item.value);
    subtitle.textContent=subtitleParts.join(' · ');
    identity.append(title,subtitle);
    const arrow=document.createElement('span');
    arrow.className='zenviaUnifiedMobileArrow';
    arrow.textContent='›';
    top.append(identity,arrow);

    const metrics=document.createElement('div');
    metrics.className='zenviaUnifiedMobileMetrics';
    const preferred=values
      .map((value,index)=>({value,index,label:headers[index]||''}))
      .filter(item=>item.value&&item.index!==primaryIndex&&!/acciones?/i.test(item.label))
      .filter(item=>/(total|pendiente|estado|iva|fecha|facturas|gasto|importe|transportista|margen|coste|venta)/i.test(item.label));
    const chosen=(preferred.length?preferred:values.map((value,index)=>({value,index,label:headers[index]||''})).filter(item=>item.value&&item.index!==primaryIndex&&!/acciones?/i.test(item.label))).slice(0,3);
    chosen.forEach(item=>{
      const metric=document.createElement('span');
      const label=document.createElement('small');
      label.textContent=item.label||'Dato';
      const value=document.createElement('strong');
      value.textContent=item.value;
      metric.append(label,value);
      metrics.appendChild(metric);
    });

    const editSource=matchingRowAction(row,'edit');
    const deleteSource=matchingRowAction(row,'delete');
    const actions=document.createElement('div');
    actions.className='zenviaUnifiedMobileActions';
    if(editSource){
      const edit=document.createElement('button');
      edit.type='button';edit.className='zenviaMobileAction edit';edit.innerHTML=`${ICONS.edit}<span>Editar</span>`;
      edit.addEventListener('click',event=>{event.stopPropagation();editSource.click();});
      actions.appendChild(edit);
    }
    if(deleteSource){
      const remove=document.createElement('button');
      remove.type='button';remove.className='zenviaMobileAction danger';remove.innerHTML=`${ICONS.delete}<span>Eliminar</span>`;
      remove.addEventListener('click',event=>{event.stopPropagation();deleteSource.click();});
      actions.appendChild(remove);
    }

    const open=()=>row.click();
    card.addEventListener('click',open);
    card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
    card.append(top,metrics);
    if(actions.children.length)card.appendChild(actions);
    list!.appendChild(card);
  });
}

function tooltipTargetFrom(origin:EventTarget|null){
  if(!(origin instanceof Element))return null;
  const scope=origin.closest<HTMLElement>(TOOLTIP_SCOPE);
  if(!scope)return null;
  let current:HTMLElement|null=origin instanceof HTMLElement?origin:origin.parentElement;
  while(current&&scope.contains(current)){
    if(isTooltipEligible(current)&&isTextOverflowing(current))return current;
    if(current===scope)break;
    current=current.parentElement;
  }
  return null;
}

export function UnifiedListExperience(){
  useEffect(()=>{
    let scheduled=false;
    let showTimer:number|null=null;
    let activeTarget:HTMLElement|null=null;
    const tooltip=document.createElement('div');
    tooltip.className='zenviaTruncatedTooltip';
    tooltip.setAttribute('role','tooltip');
    document.body.appendChild(tooltip);

    const cancelTimer=()=>{
      if(showTimer!=null){window.clearTimeout(showTimer);showTimer=null;}
    };
    const hideTooltip=()=>{
      cancelTimer();
      activeTarget=null;
      tooltip.classList.remove('visible');
      tooltip.removeAttribute('data-placement');
    };
    const positionTooltip=(target:HTMLElement)=>{
      const targetRect=target.getBoundingClientRect();
      const tooltipRect=tooltip.getBoundingClientRect();
      let placement:'top'|'bottom'='top';
      let top=targetRect.top-tooltipRect.height-8;
      if(top<8){placement='bottom';top=targetRect.bottom+8;}
      if(top+tooltipRect.height>window.innerHeight-8)top=Math.max(8,window.innerHeight-tooltipRect.height-8);
      const preferredLeft=targetRect.left+(targetRect.width-tooltipRect.width)/2;
      const left=Math.min(Math.max(8,preferredLeft),Math.max(8,window.innerWidth-tooltipRect.width-8));
      tooltip.dataset.placement=placement;
      tooltip.style.left=`${left}px`;
      tooltip.style.top=`${top}px`;
    };
    const displayTooltip=(target:HTMLElement)=>{
      if(!target.isConnected||!isTooltipEligible(target)||!isTextOverflowing(target)){hideTooltip();return;}
      const text=tooltipTextFor(target);
      if(!text){hideTooltip();return;}
      activeTarget=target;
      tooltip.textContent=text;
      tooltip.style.left='0px';
      tooltip.style.top='0px';
      tooltip.classList.add('visible');
      positionTooltip(target);
    };
    const queueTooltip=(target:HTMLElement,delay:number)=>{
      cancelTimer();
      if(activeTarget===target&&tooltip.classList.contains('visible'))return;
      showTimer=window.setTimeout(()=>{showTimer=null;displayTooltip(target);},delay);
    };
    const onPointerOver=(event:PointerEvent)=>{
      const target=tooltipTargetFrom(event.target);
      if(target)queueTooltip(target,180);else hideTooltip();
    };
    const onPointerOut=(event:PointerEvent)=>{
      if(!activeTarget){cancelTimer();return;}
      const related=event.relatedTarget;
      if(related instanceof Node&&activeTarget.contains(related))return;
      hideTooltip();
    };
    const onFocusIn=(event:FocusEvent)=>{
      const target=tooltipTargetFrom(event.target);
      if(target)queueTooltip(target,0);else hideTooltip();
    };
    const onFocusOut=()=>hideTooltip();
    const onScroll=()=>hideTooltip();

    const sync=()=>{
      scheduled=false;
      hideTooltip();
      enhanceExpenseDesktopEdit();
      enhanceMasterDesktopActions();
      enhanceMasterMobileActions();
      document.querySelectorAll<HTMLTableElement>('.page .tableCard table').forEach(buildMobileCards);
      enhanceDetailDrawers();
    };
    const schedule=()=>{
      if(scheduled)return;
      scheduled=true;
      requestAnimationFrame(sync);
    };
    const onResize=()=>{hideTooltip();schedule();};

    sync();
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    document.addEventListener('pointerover',onPointerOver);
    document.addEventListener('pointerout',onPointerOut);
    document.addEventListener('focusin',onFocusIn);
    document.addEventListener('focusout',onFocusOut);
    document.addEventListener('scroll',onScroll,true);
    window.addEventListener('resize',onResize);
    return()=>{
      observer.disconnect();
      hideTooltip();
      tooltip.remove();
      document.removeEventListener('pointerover',onPointerOver);
      document.removeEventListener('pointerout',onPointerOut);
      document.removeEventListener('focusin',onFocusIn);
      document.removeEventListener('focusout',onFocusOut);
      document.removeEventListener('scroll',onScroll,true);
      window.removeEventListener('resize',onResize);
    };
  },[]);
  return null;
}
