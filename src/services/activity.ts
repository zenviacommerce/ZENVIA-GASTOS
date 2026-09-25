export type ActivityInput={
  label:string;
  detail?:string;
  progress?:number;
  current?:number;
  total?:number;
  showAfterMs?:number;
  /** Replaces any previous visible activity with the same key. */
  key?:string;
  /** Lets a page clear its own transient activities on unmount/navigation. */
  scope?:string;
  /** Safety valve for network requests that never settle. */
  maxAgeMs?:number;
};

export type ActivityRecord=ActivityInput&{
  id:string;
  startedAt:number;
  updatedAt:number;
};

export type ActivityPatch=Partial<Omit<ActivityRecord,'id'|'startedAt'|'updatedAt'|'key'|'scope'|'maxAgeMs'>>;

export const ACTIVITY_EVENT='zenvia:activity';
const activeActivities=new Map<string,ActivityRecord>();
const activityByKey=new Map<string,string>();
const cancelledActivities=new Set<string>();
const staleTimers=new Map<string,ReturnType<typeof setTimeout>>();

export function getActiveActivities(){return Array.from(activeActivities.values());}

type ActivityEventDetail=
  |{type:'upsert';activity:ActivityRecord}
  |{type:'remove';id:string};

function uid(){
  return typeof crypto!=='undefined'&&'randomUUID' in crypto
    ?crypto.randomUUID()
    :`activity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emit(detail:ActivityEventDetail){
  if(typeof window==='undefined')return;
  window.dispatchEvent(new CustomEvent<ActivityEventDetail>(ACTIVITY_EVENT,{detail}));
}

function removeActivity(id:string,cancel=false){
  const current=activeActivities.get(id);
  if(cancel)cancelledActivities.add(id);
  if(current?.key&&activityByKey.get(current.key)===id)activityByKey.delete(current.key);
  activeActivities.delete(id);
  const timer=staleTimers.get(id);
  if(timer){clearTimeout(timer);staleTimers.delete(id);}
  emit({type:'remove',id});
}

export function clearActivities(scope?:string){
  for(const activity of Array.from(activeActivities.values())){
    if(scope&&activity.scope!==scope)continue;
    removeActivity(activity.id,true);
  }
}

export function startActivity(input:ActivityInput){
  if(input.key){
    const previousId=activityByKey.get(input.key);
    if(previousId)removeActivity(previousId,true);
  }

  const id=uid();
  let state:ActivityRecord={
    id,
    label:input.label,
    detail:input.detail,
    progress:input.progress,
    current:input.current,
    total:input.total,
    showAfterMs:input.showAfterMs??250,
    key:input.key,
    scope:input.scope,
    maxAgeMs:input.maxAgeMs,
    startedAt:Date.now(),
    updatedAt:Date.now(),
  };
  let finished=false;
  activeActivities.set(id,state);
  if(input.key)activityByKey.set(input.key,id);
  emit({type:'upsert',activity:state});

  if(input.maxAgeMs&&input.maxAgeMs>0){
    staleTimers.set(id,setTimeout(()=>removeActivity(id,true),input.maxAgeMs));
  }

  const stillActive=()=>!finished&&!cancelledActivities.has(id)&&activeActivities.has(id);

  return {
    id,
    update(patch:ActivityPatch){
      if(!stillActive())return;
      state={...state,...patch,updatedAt:Date.now()};
      activeActivities.set(id,state);
      emit({type:'upsert',activity:state});
    },
    finish(){
      if(finished)return;
      finished=true;
      const wasCancelled=cancelledActivities.delete(id);
      if(!wasCancelled&&activeActivities.has(id))removeActivity(id);
      else{
        const timer=staleTimers.get(id);
        if(timer){clearTimeout(timer);staleTimers.delete(id);}
      }
    },
  };
}

export async function withActivity<T>(
  input:ActivityInput,
  work:(activity:ReturnType<typeof startActivity>)=>Promise<T>,
):Promise<T>{
  const activity=startActivity(input);
  try{return await work(activity);}
  finally{activity.finish();}
}
