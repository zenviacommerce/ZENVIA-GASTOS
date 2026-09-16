import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import '../../shared-forms.css';

type FormModalProps={
  open?:boolean;
  eyebrow?:string;
  title:string;
  subtitle?:string;
  onClose:()=>void;
  children:ReactNode;
  actions?:ReactNode;
  className?:string;
};

export function FormModal({open=true,eyebrow,title,subtitle,onClose,children,actions,className=''}:FormModalProps){
  if(!open)return null;
  return <div className="modalBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><div className={`modal formModal polishedModal ${className}`.trim()}>
    <div className="formModalHead"><div>{eyebrow&&<div className="formModalEyebrow">{eyebrow}</div>}<h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div><button type="button" className="formModalClose" onClick={onClose} aria-label="Cerrar"><X size={19}/></button></div>
    <div className="formModalBody">{children}</div>
    {actions&&<div className="formModalActions">{actions}</div>}
  </div></div>;
}

type FormSectionProps={icon?:ReactNode;title:string;subtitle?:string;children:ReactNode;className?:string};
export function FormSection({icon,title,subtitle,children,className=''}:FormSectionProps){
  return <section className={`formSection ${className}`.trim()}><div className="formSectionTitle">{icon}<div><strong>{title}</strong>{subtitle&&<span>{subtitle}</span>}</div></div>{children}</section>;
}

export function FormGrid({children,className=''}:{children:ReactNode;className?:string}){
  return <div className={`formGrid ${className}`.trim()}>{children}</div>;
}

export const FormFieldSpan={full:'formSpan2'} as const;
