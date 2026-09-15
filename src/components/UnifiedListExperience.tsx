import { useEffect } from 'react';

const HOST_CLASS='zenviaUnifiedListHost';
const LIST_CLASS='zenviaUnifiedMobileList';
const TABLE_CLASS='zenviaUnifiedDesktopTable';
const MASTER_ACTIONS='zenviaMasterRowActions';
const MASTER_MOBILE_ACTIONS='zenviaMasterMobileActions';

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

export function UnifiedListExperience(){
  useEffect(()=>{
    let scheduled=false;
    const sync=()=>{
      scheduled=false;
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
    sync();
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    window.addEventListener('resize',schedule);
    return()=>{
      observer.disconnect();
      window.removeEventListener('resize',schedule);
    };
  },[]);
  return null;
}
