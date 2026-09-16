export function productMarginMetrics(cost:number|null|undefined,sale:number|null|undefined){
  if(cost==null||sale==null)return {margin:null,marginPct:null};
  const margin=sale-cost;
  return {margin,marginPct:cost>0?margin/cost*100:null};
}
