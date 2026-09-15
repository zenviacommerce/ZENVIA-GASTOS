import type { ReactNode } from 'react';
export function StatCard({label,value,sub,icon,className=''}:{label:string;value:string;sub?:string;icon:ReactNode;className?:string}){
  return <div className={`stat ${className}`.trim()}><div className="statIcon">{icon}</div><div><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div></div>
}
