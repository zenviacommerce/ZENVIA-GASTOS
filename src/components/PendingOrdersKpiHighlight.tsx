import { useEffect } from 'react';

export function PendingOrdersKpiHighlight(){
  useEffect(()=>{
    const apply=()=>{
      const pages=Array.from(document.querySelectorAll<HTMLElement>('.page'));
      const page=pages.find(item=>item.querySelector('h1')?.textContent?.trim()==='Pedidos');
      if(!page)return;
      const stats=Array.from(page.querySelectorAll<HTMLElement>('.ordersStats .stat'));
      const pending=stats.find(card=>card.querySelector('span')?.textContent?.trim()==='Pendientes');
      if(!pending)return;
      const value=Number((pending.querySelector('strong')?.textContent||'0').replace(/[^0-9-]/g,''))||0;
      pending.classList.toggle('dashboardPendingOrders',value>0);
    };
    apply();
    const observer=new MutationObserver(apply);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    return()=>observer.disconnect();
  },[]);
  return null;
}
