const PREFIX='zenvia-view-cache:';

export function readViewCache<T>(key:string):T|null{
  try{
    const raw=window.sessionStorage.getItem(PREFIX+key);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    return parsed?.value as T??null;
  }catch{return null;}
}

export function writeViewCache<T>(key:string,value:T){
  try{window.sessionStorage.setItem(PREFIX+key,JSON.stringify({savedAt:Date.now(),value}));}catch{/* cache is best effort */}
}

export function removeViewCache(key:string){
  try{window.sessionStorage.removeItem(PREFIX+key);}catch{/* noop */}
}

export function stableCacheKey(scope:string,input:unknown){
  const normalize=(value:any):any=>{
    if(Array.isArray(value))return value.map(normalize);
    if(value&&typeof value==='object')return Object.keys(value).sort().reduce<Record<string,unknown>>((acc,key)=>{acc[key]=normalize(value[key]);return acc;},{});
    return value;
  };
  return `${scope}:${JSON.stringify(normalize(input))}`;
}
