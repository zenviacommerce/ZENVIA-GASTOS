const INTERACTIVE_SELECTOR='button,input,select,textarea,a,[role="button"],[contenteditable="true"]';
const ACTION_SELECTOR='.zenviaRowAction,.iconBtn,.statusBtn,.zenviaMobileAction,.invoiceActions,.zenviaMasterRowActions,.zenviaMasterMobileActions,.zenviaUnifiedMobileActions';

export function isTextOverflowing(element:HTMLElement){
  return element.scrollWidth>element.clientWidth+1||element.scrollHeight>element.clientHeight+1;
}

export function tooltipTextFor(element:HTMLElement){
  return (element.textContent||'').replace(/\s+/g,' ').trim();
}

export function isTooltipEligible(element:HTMLElement){
  if(element.matches(INTERACTIVE_SELECTOR)||element.closest(ACTION_SELECTOR))return false;
  if(element.hidden||element.getAttribute('aria-hidden')==='true')return false;
  const text=tooltipTextFor(element);
  if(!text)return false;
  const style=window.getComputedStyle(element);
  return style.display!=='none'&&style.visibility!=='hidden';
}
