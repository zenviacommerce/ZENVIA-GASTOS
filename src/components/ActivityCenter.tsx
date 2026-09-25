import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { ACTIVITY_EVENT, type ActivityRecord } from '../services/activity';

function clampProgress(value:number|undefined){
  if(value==null||!Number.isFinite(value))return null;
  return Math.min(100,Math.max(0,value));
}

function elapsedLabel(ms:number){
  const seconds=Math.max(1,Math.floor(ms/1000));
  if(seconds<60)return `${seconds} s`;
  const minutes=Math.floor(seconds/60);
  const rest=seconds%60;
  return rest?`${minutes} min ${rest} s`:`${minutes} min`;
}

function etaLabel(activity:ActivityRecord,progress:number,now:number){
  if(progress<5||progress>=100)return null;
  const elapsed=Math.max(0,now-activity.startedAt);
  if(elapsed<1500)return null;
  const remaining=elapsed*(100-progress)/progress;
  if(!Number.isFinite(remaining)||remaining<1000)return null;
  if(remaining<60_000)return `~${Math.max(1,Math.ceil(remaining/1000))} s restantes`;
  return `~${Math.max(1,Math.ceil(remaining/60_000))} min restantes`;
}

export function ActivityCenter(){
  const [activities,setActivities]=useState<Record<string,ActivityRecord>>({});
  const [now,setNow]=useState(Date.now());

  useEffect(()=>{
    const onActivity=(event:Event)=>{
      const detail=(event as CustomEvent<{type:'upsert'|'remove';activity?:ActivityRecord;id?:string}>).detail;
      if(detail.type==='upsert'&&detail.activity){
        setActivities(current=>({...current,[detail.activity!.id]:detail.activity!}));
      }else if(detail.type==='remove'&&detail.id){
        setActivities(current=>{
          if(!current[detail.id!])return current;
          const next={...current};
          delete next[detail.id!];
          return next;
        });
      }
    };
    window.addEventListener(ACTIVITY_EVENT,onActivity);
    return()=>window.removeEventListener(ACTIVITY_EVENT,onActivity);
  },[]);

  useEffect(()=>{
    if(!Object.keys(activities).length)return;
    const timer=window.setInterval(()=>setNow(Date.now()),250);
    return()=>window.clearInterval(timer);
  },[Object.keys(activities).length]);

  const visible=useMemo(
    ()=>Object.values(activities)
      .filter(activity=>now-activity.startedAt>=(activity.showAfterMs??250))
      .sort((a,b)=>a.startedAt-b.startedAt)
      .slice(-4),
    [activities,now],
  );

  if(!visible.length)return null;

  return <div className="activityCenter" aria-live="polite" aria-label="Operaciones en curso">
    {visible.map(activity=>{
      const inferred=activity.total&&activity.current!=null
        ?activity.current/activity.total*100
        :undefined;
      const progress=clampProgress(activity.progress??inferred);
      const eta=progress==null?null:etaLabel(activity,progress,now);
      const remaining=activity.total!=null&&activity.current!=null
        ?Math.max(0,activity.total-activity.current)
        :null;
      return <section className="activityItem" key={activity.id} role="status">
        <div className="activityIcon"><LoaderCircle className="spin" size={18}/></div>
        <div className="activityBody">
          <div className="activityTitle"><strong>{activity.label}</strong>{progress!=null&&<span>{Math.round(progress)}%</span>}</div>
          {activity.detail&&<div className="activityDetail">{activity.detail}</div>}
          <div className={progress==null?'activityTrack isIndeterminate':'activityTrack'}>
            <span style={progress==null?undefined:{width:`${progress}%`}}/>
          </div>
          <div className="activityMeta">
            <span>
              {activity.total!=null&&activity.current!=null
                ?`${Math.min(activity.current,activity.total)} de ${activity.total}${remaining? ` · quedan ${remaining}` : ''}`
                :`En curso · ${elapsedLabel(now-activity.startedAt)}`}
            </span>
            {eta&&<span>{eta}</span>}
          </div>
        </div>
      </section>;
    })}
    {Object.keys(activities).length>visible.length&&<div className="activityMore">+{Object.keys(activities).length-visible.length} procesos en curso</div>}
  </div>;
}
