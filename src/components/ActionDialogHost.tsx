import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Circle, LoaderCircle, ShieldAlert, X, XCircle } from 'lucide-react';
import {
  ACTION_CONFIRM_EVENT, ACTION_PROCESS_EVENT,
  type ActionProcessItem, type ActionProcessOpen, type ActionProcessUpdate,
  type ConfirmActionOptions,
} from '../services/actionDialog';
import '../action-dialog.css';

type ConfirmState=(ConfirmActionOptions&{resolve:(value:boolean)=>void})|null;
type ProcessState=(ActionProcessOpen&{summary?:string;done?:boolean;tone?:'success'|'warning'|'error'})|null;

export function ActionDialogHost(){
  const [confirm,setConfirm]=useState<ConfirmState>(null);
  const [process,setProcess]=useState<ProcessState>(null);

  useEffect(()=>{
    const onConfirm=(event:Event)=>{
      const detail=(event as CustomEvent<ConfirmActionOptions&{resolve:(value:boolean)=>void}>).detail;
      setConfirm(detail);
    };
    const onProcess=(event:Event)=>{
      const detail=(event as CustomEvent<ActionProcessOpen|ActionProcessUpdate>).detail;
      if('title' in detail){
        setProcess({...detail,done:false});
        return;
      }
      setProcess(current=>current&&current.id===detail.id?{...current,...detail}:current);
    };
    window.addEventListener(ACTION_CONFIRM_EVENT,onConfirm);
    window.addEventListener(ACTION_PROCESS_EVENT,onProcess);
    return()=>{
      window.removeEventListener(ACTION_CONFIRM_EVENT,onConfirm);
      window.removeEventListener(ACTION_PROCESS_EVENT,onProcess);
    };
  },[]);

  const answer=(value:boolean)=>{
    if(!confirm)return;
    const resolver=confirm.resolve;
    setConfirm(null);
    resolver(value);
  };

  const completed=useMemo(()=>process?.items.filter(item=>['success','error','skipped'].includes(item.status)).length||0,[process]);
  const progress=process?.items.length?Math.round(completed/process.items.length*100):0;

  return <>
    {confirm&&<div className="actionDialogBackdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)answer(false)}}>
      <div className={`actionDialog actionDialog-${confirm.tone||'default'}`} role="dialog" aria-modal="true" aria-labelledby="action-dialog-title">
        <div className="actionDialogIcon">{confirm.tone==='danger'?<ShieldAlert/>:confirm.tone==='warning'?<AlertTriangle/>:<CheckCircle2/>}</div>
        <div className="actionDialogBody">
          <h3 id="action-dialog-title">{confirm.title}</h3>
          <p>{confirm.message}</p>
          {!!confirm.details?.length&&<div className="actionDialogDetails">{confirm.details.map((detail,index)=><div key={index}>{detail}</div>)}</div>}
        </div>
        <div className="actionDialogActions">
          <button type="button" className="secondary" onClick={()=>answer(false)}>{confirm.cancelLabel||'Cancelar'}</button>
          <button type="button" className={confirm.tone==='danger'?'dangerAction':'primary'} onClick={()=>answer(true)}>{confirm.confirmLabel||'Continuar'}</button>
        </div>
      </div>
    </div>}

    {process&&<div className="actionDialogBackdrop actionProcessBackdrop" role="presentation">
      <div className="actionDialog actionProcessDialog" role="dialog" aria-modal="true" aria-labelledby="action-process-title">
        <div className="actionProcessHeader">
          <div className={`actionDialogIcon ${process.done?`is-${process.tone||'success'}`:'is-running'}`}>
            {!process.done?<LoaderCircle className="spin"/>:process.tone==='error'?<XCircle/>:process.tone==='warning'?<AlertTriangle/>:<CheckCircle2/>}
          </div>
          <div>
            <h3 id="action-process-title">{process.title}</h3>
            {process.description&&<p>{process.description}</p>}
          </div>
          {process.done&&<button className="actionProcessClose" type="button" onClick={()=>setProcess(null)} aria-label="Cerrar"><X/></button>}
        </div>

        <div className="actionProcessProgress">
          <div className="actionProcessProgressMeta"><strong>{process.done?'Proceso terminado':'Procesando…'}</strong><span>{completed} de {process.items.length}</span></div>
          <div className="actionProcessTrack"><span style={{width:`${progress}%`}}/></div>
        </div>

        <div className="actionProcessList">
          {process.items.map(item=><ProcessRow key={item.id} item={item}/>)}
        </div>

        {process.summary&&<div className={`actionProcessSummary ${process.tone||'success'}`}>{process.summary}</div>}
        {process.done&&<div className="actionDialogActions"><button type="button" className="primary" onClick={()=>setProcess(null)}>Cerrar</button></div>}
      </div>
    </div>}
  </>;
}

function ProcessRow({item}:{item:ActionProcessItem}){
  return <div className={`actionProcessRow ${item.status}`}>
    <span className="actionProcessState" aria-hidden="true">
      {item.status==='running'?<LoaderCircle className="spin"/>:item.status==='success'?<Check/>:item.status==='error'?<X/>:item.status==='skipped'?<AlertTriangle/>:<Circle/>}
    </span>
    <div><strong>{item.label}</strong>{item.message&&<small>{item.message}</small>}</div>
  </div>;
}
