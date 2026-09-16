const INTERACTIVE_SELECTOR='button,input,select,textarea,a,[role="button"],[contenteditable="true"]';
const ACTION_SELECTOR='.zenviaRowAction,.iconBtn,.statusBtn,.zenviaMobileAction,.invoiceActions,.zenviaMasterRowActions,.zenviaMasterMobileActions,.zenviaUnifiedMobileActions';

export function isTextOverflowing(element:HTMLElement){
  return element.scrollWidth>element.clientWidth+1||element.scrollHeight>element.clientHeight+1;
}

export function tooltipTextFor(element:HTMLElement){
  return (element.textContent||'').replace(/\s+/g,' ').trim();
}

export function isTooltipEligible(element:HTMLElement){
  if(element.closest(INTERACTIVE_SELECTOR)||element.closest(ACTION_SELECTOR))return false;
  if(element.hidden||element.getAttribute('aria-hidden')==='true')return false;
  const text=tooltipTextFor(element);
  if(!text)return false;
  const style=window.getComputedStyle(element);
  if(style.display==='none'||style.visibility==='hidden')return false;
  const lineClamp=Number.parseInt(style.webkitLineClamp||'0',10)>0;
  const singleLineClip=style.textOverflow==='ellipsis'||((style.overflowX==='hidden'||style.overflowX==='clip')&&style.whiteSpace==='nowrap');
  return singleLineClip||lineClamp;
}
