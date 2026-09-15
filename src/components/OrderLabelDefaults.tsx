import { useEffect } from 'react';

const ENHANCED='zenviaLabelDefaultsReady';
const SELECTED='zenvia-default-selected';
let allowedButton:HTMLButtonElement|null=null;

function normalized(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}

function isBalearicModal(modal:HTMLElement){
  const destination=modal.querySelector<HTMLElement>('.ordersLabelContext > div:nth-child(2) strong')?.textContent||'';
  return /(?:^|\D)07\d{3}(?:\D|$)/.test(destination);
}

function carrierCard(modal:HTMLElement,carrier:'mrw'|'correos'){
  return Array.from(modal.querySelectorAll<HTMLElement>('.ordersCarrierCard')).find(card=>{
    const heading=normalized(card.querySelector<HTMLElement>('.ordersCarrierHead strong')?.textContent||'');
    return carrier==='mrw'?heading.includes('mrw'):heading.includes('correos');
  })||null;
}

function mrwUrgent1900(button:HTMLButtonElement){
  const value=normalized(button.textContent||'');
  return value.includes('urgent')&&value.includes('19:00')&&value.includes('expedition')&&/0\s*[-–]\s*80\s*kg/.test(value);
}

function serviceName(button:HTMLButtonElement){
  return button.querySelector<HTMLElement>('strong')?.textContent?.trim()||'servicio seleccionado';
}

function setSelected(modal:HTMLElement,button:HTMLButtonElement,confirm:HTMLButtonElement,caption:HTMLElement){
  modal.querySelectorAll(`.${SELECTED}`).forEach(node=>node.classList.remove(SELECTED));
  button.classList.add(SELECTED);
  confirm.disabled=false;
  confirm.textContent=`Crear etiqueta · ${serviceName(button)}`;
  caption.textContent='Servicio preseleccionado. Puedes escoger cualquier otro antes de crear la etiqueta.';
}

function enhanceModal(modal:HTMLElement){
  if(modal.dataset[ENHANCED]==='true')return;
  const optionButtons=Array.from(modal.querySelectorAll<HTMLButtonElement>('.ordersOptionList button'));
  if(!optionButtons.length)return;

  const balearic=isBalearicModal(modal);
  const mrwCard=carrierCard(modal,'mrw');
  const correosCard=carrierCard(modal,'correos');
  const mrwButtons=mrwCard?Array.from(mrwCard.querySelectorAll<HTMLButtonElement>('.ordersOptionList button')):[];
  const correosButtons=correosCard?Array.from(correosCard.querySelectorAll<HTMLButtonElement>('.ordersOptionList button')):[];

  if(balearic){
    mrwButtons.forEach(button=>{
      button.disabled=true;
      button.classList.add('zenvia-island-disabled');
      button.title='Baleares: utilizar Correos para evitar la tarifa alta de MRW.';
    });
    const rules=modal.querySelector<HTMLButtonElement>('.ordersRulesButton');
    if(rules){
      rules.disabled=true;
      rules.classList.add('zenvia-island-disabled');
      rules.title='En Baleares se desactivan las reglas automáticas para evitar seleccionar MRW.';
    }
  }

  const actions=modal.querySelector<HTMLElement>('.modalActions');
  if(!actions)return;
  const chooser=document.createElement('div');
  chooser.className=`zenviaLabelConfirm${balearic?' is-balearic':''}`;
  const notice=document.createElement('div');
  notice.className='zenviaLabelDefaultNotice';
  notice.innerHTML=balearic
    ? '<strong>🏝 Baleares · Correos</strong><span>MRW está bloqueado para este envío por su tarifa.</span>'
    : '<strong>Servicio habitual</strong><span>MRW Urgent 19:00 Expedition 0-80kg</span>';
  const caption=document.createElement('small');
  caption.textContent='Selecciona un servicio para crear la etiqueta.';
  const confirm=document.createElement('button');
  confirm.type='button';
  confirm.className='primary zenviaLabelConfirmButton';
  confirm.disabled=true;
  confirm.textContent='Crear etiqueta';
  confirm.onclick=()=>{
    const selected=modal.querySelector<HTMLButtonElement>(`.ordersOptionList button.${SELECTED}`);
    if(!selected||selected.disabled)return;
    allowedButton=selected;
    selected.click();
  };
  chooser.append(notice,caption,confirm);
  actions.insertAdjacentElement('beforebegin',chooser);

  const defaultButton=balearic
    ? correosButtons[0]||null
    : mrwButtons.find(mrwUrgent1900)||null;
  if(defaultButton){
    setSelected(modal,defaultButton,confirm,caption);
  }else if(!balearic){
    caption.textContent='No se encontró MRW Urgent 19:00 Expedition 0-80kg. Escoge manualmente otro servicio.';
  }

  modal.dataset[ENHANCED]='true';
}

export function OrderLabelDefaults(){
  useEffect(()=>{
    const enhance=()=>document.querySelectorAll<HTMLElement>('.ordersLabelModal').forEach(enhanceModal);
    const clickCapture=(event:MouseEvent)=>{
      const target=event.target instanceof Element?event.target:null;
      const button=target?.closest<HTMLButtonElement>('.ordersLabelModal .ordersOptionList button');
      if(!button||button.disabled)return;
      if(allowedButton===button){allowedButton=null;return;}
      const modal=button.closest<HTMLElement>('.ordersLabelModal');
      if(!modal||modal.dataset[ENHANCED]!=='true')return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const confirm=modal.querySelector<HTMLButtonElement>('.zenviaLabelConfirmButton');
      const caption=modal.querySelector<HTMLElement>('.zenviaLabelConfirm small');
      if(confirm&&caption)setSelected(modal,button,confirm,caption);
    };
    enhance();
    const observer=new MutationObserver(enhance);
    observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('click',clickCapture,true);
    return()=>{
      observer.disconnect();
      document.removeEventListener('click',clickCapture,true);
      allowedButton=null;
    };
  },[]);
  return null;
}
