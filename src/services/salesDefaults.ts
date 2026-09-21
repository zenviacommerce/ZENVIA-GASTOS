export function normalizeSalesDueDays(value:unknown,fallback=30){
  return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=365?value:fallback;
}

export function resolveSalesDueDays(clientTermsDays:number|undefined|null,globalDays:number|undefined|null){
  const globalValue=normalizeSalesDueDays(globalDays,30);
  return typeof clientTermsDays==='number'&&Number.isInteger(clientTermsDays)&&clientTermsDays>0&&clientTermsDays<=365
    ?clientTermsDays
    :globalValue;
}

export function defaultSalesDueDate(issueDate:string,days:number){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(issueDate))return '';
  const date=new Date(`${issueDate}T12:00:00`);
  if(Number.isNaN(date.getTime()))return '';
  date.setDate(date.getDate()+normalizeSalesDueDays(days,30));
  return date.toISOString().slice(0,10);
}
