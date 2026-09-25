export type ActivityInput={
  label:string;
  detail?:string;
  progress?:number;
  current?:number;
  total?:number;
  showAfterMs?:number;
};

export type ActivityRecord=ActivityInput&{
  id:string;
  startedAt:number;
  updatedAt:number;
};

export type ActivityPatch=Partial<Omit<ActivityRecord,'id'|'startedAt'|'updatedAt'>>;

export const ACTIVITY_EVENT='zenvia:activity';

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

export function startActivity(input:ActivityInput){
  const id=uid();
  let state:ActivityRecord={
    id,
    label:input.label,
    detail:input.detail,
    progress:input.progress,
    current:input.current,
    total:input.total,
    showAfterMs:input.showAfterMs??250,
    startedAt:Date.now(),
    updatedAt:Date.now(),
  };
  let finished=false;
  emit({type:'upsert',activity:state});

  return {
    id,
    update(patch:ActivityPatch){
      if(finished)return;
      state={...state,...patch,updatedAt:Date.now()};
      emit({type:'upsert',activity:state});
    },
    finish(){
      if(finished)return;
      finished=true;
      emit({type:'remove',id});
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
