import { useEffect } from 'react';

const HOST_CLASS='zenviaUnifiedListHost';
const LIST_CLASS='zenviaUnifiedMobileList';
const TABLE_CLASS='zenviaUnifiedDesktopTable';

function clean(value:string){return value.replace(/\s+/g,' ').trim();}

function enhanceDetailDrawers(){
  document.querySelectorAll<HTMLElement>('.invoiceDetailModal,.salesDetailModal').forEach(modal=>{
    const backdrop=modal.closest<HTMLElement>('.modalBackdrop');
    if(!backdrop)return;
    backdrop.classList.add('zenviaDetailDrawerBackdrop');
    modal.classList.add('zenviaDetailDrawer');
  });
}

function shouldSkipTable(table:HTMLTableElement){
  if(table.closest('.masterTableCard'))return true;
  if(table.classList.contains('ordersTable')||table.closest('.ordersPage'))return true;
  if(table.classList.contains('detailLines')||table.closest('.detailLinesWrap'))return true;
  return false;
}

function buildMobileCards(table:HTMLTableElement){
  if(shouldSkipTable(table))return;
  const rows=Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody > tr.clickableRow'));
  if(!rows.length)return;
  const host=table.closest<HTMLElement>('.tableCard');
  if(!host)return;

  const headers=Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th')).map(th=>clean(th.textContent||''));
  const signature=rows.map(row=>clean(row.textContent||'')).join('||');
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

    const card=document.createElement('button');
    card.type='button';
    card.className='card zenviaUnifiedMobileRow';
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

    card.append(top,metrics);
    card.addEventListener('click',()=>row.click());
    list!.appendChild(card);
  });
}

export function UnifiedListExperience(){
  useEffect(()=>{
    let scheduled=false;
    const sync=()=>{
      scheduled=false;
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
