import type { ReactNode } from 'react';
export function StatCard({label,value,sub,icon}:{label:string;value:string;sub?:string;icon:ReactNode}){
  return <div className="stat"><div className="statIcon">{icon}</div><div><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div></div>
}
