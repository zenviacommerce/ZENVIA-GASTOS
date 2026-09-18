export type ActionTone = 'default' | 'warning' | 'danger';

export type ConfirmActionOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ActionTone;
  details?: string[];
};

export type ActionProcessStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export type ActionProcessItem = {
  id: string;
  label: string;
  status: ActionProcessStatus;
  message?: string;
};

export type ActionProcessOpen = {
  id: string;
  title: string;
  description?: string;
  items: ActionProcessItem[];
};

export type ActionProcessUpdate = {
  id: string;
  items?: ActionProcessItem[];
  summary?: string;
  done?: boolean;
  tone?: 'success' | 'warning' | 'error';
};

export const ACTION_CONFIRM_EVENT='zenvia:action-confirm';
export const ACTION_PROCESS_EVENT='zenvia:action-process';

type ConfirmEventDetail = ConfirmActionOptions & {resolve:(value:boolean)=>void};

function uid(){
  return typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():`action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function confirmAction(options:ConfirmActionOptions){
  return new Promise<boolean>(resolve=>{
    window.dispatchEvent(new CustomEvent<ConfirmEventDetail>(ACTION_CONFIRM_EVENT,{detail:{...options,resolve}}));
  });
}

export function openActionProcess(input:{title:string;description?:string;items:Array<{id:string;label:string}>}){
  const id=uid();
  let items:ActionProcessItem[]=input.items.map(item=>({...item,status:'pending'}));
  window.dispatchEvent(new CustomEvent<ActionProcessOpen>(ACTION_PROCESS_EVENT,{detail:{id,title:input.title,description:input.description,items}}));

  const emit=(patch:Omit<ActionProcessUpdate,'id'>)=>{
    window.dispatchEvent(new CustomEvent<ActionProcessUpdate>(ACTION_PROCESS_EVENT,{detail:{id,...patch}}));
  };

  return {
    id,
    setItem(itemId:string,status:ActionProcessStatus,message?:string){
      items=items.map(item=>item.id===itemId?{...item,status,message}:item);
      emit({items});
    },
    finish(summary:string,tone:'success'|'warning'|'error'='success'){
      emit({items,summary,done:true,tone});
    },
  };
}
