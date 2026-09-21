export function normalizeAlias(value:string){
  return String(value||'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[—–-]+/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\bs\s+l\s+u\b/g,'slu')
    .replace(/\bs\s+l\b/g,'sl')
    .replace(/\bs\s+a\b/g,'sa')
    .replace(/\bc\s+b\b/g,'cb')
    .replace(/\bb\s+v\b/g,'bv')
    .replace(/\s+/g,' ')
    .trim();
}
