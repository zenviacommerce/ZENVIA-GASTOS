export function safeStorageGet(storage:'local'|'session',key:string){
  try{
    const target=storage==='local'?window.localStorage:window.sessionStorage;
    return target.getItem(key);
  }catch{
    return null;
  }
}

export function safeStorageSet(storage:'local'|'session',key:string,value:string){
  try{
    const target=storage==='local'?window.localStorage:window.sessionStorage;
    target.setItem(key,value);
    return true;
  }catch{
    return false;
  }
}
