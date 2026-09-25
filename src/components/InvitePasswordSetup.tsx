import { FormEvent, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { ZENVIA_LOGO } from '../branding';
import { supabase } from '../services/supabase';

export function InvitePasswordSetup({session,onComplete}:{session:Session;onComplete:()=>Promise<void>|void}){
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    setMessage('');
    if(password.length<8){setMessage('La contraseña debe tener al menos 8 caracteres.');return;}
    if(password!==confirm){setMessage('Las contraseñas no coinciden.');return;}
    setBusy(true);
    try{
      const metadata={...(session.user.user_metadata||{}),onboarding_pending:false};
      const {error}=await supabase.auth.updateUser({password,data:metadata});
      if(error)throw error;
      await onComplete();
    }catch(error){
      setMessage(error instanceof Error?error.message:'No se pudo crear la contraseña.');
    }finally{
      setBusy(false);
    }
  };

  return <div className="authPage">
    <div className="authPanel">
      <div className="authLogo"><img src={ZENVIA_LOGO} alt="ZENVIA COMMERCE"/><span>Gestión empresarial</span></div>
      <div className="authHeroIcon"><KeyRound/></div>
      <h1>Activa tu cuenta</h1>
      <p>Tu empresa ya está preparada en ZENVIA Gestión. Crea una contraseña para terminar la activación de tu acceso.</p>
      <div className="authMessage inviteAccountEmail">{session.user.email}</div>
      <form onSubmit={submit} className="authForm" noValidate>
        <label>Nueva contraseña<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 8 caracteres"/></label>
        <label>Repite la contraseña<input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repite la contraseña"/></label>
        <button className="primary authSubmit" disabled={busy}><KeyRound size={17}/>{busy?<><LoaderCircle className="spin" size={17}/> Guardando…</>:'Crear contraseña y entrar'}</button>
      </form>
      {message&&<div className="authMessage inviteSetupError">{message}</div>}
    </div>
  </div>;
}
