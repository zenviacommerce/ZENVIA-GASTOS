import { useEffect, useState } from 'react';
import { Fingerprint, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../services/supabase';
import { showError, showSuccess } from '../services/toast';

function supportsPasskeys(){
  return typeof window!=='undefined' && window.isSecureContext && 'PublicKeyCredential' in window && !!navigator.credentials;
}

function errorText(error:unknown){
  const code=typeof error==='object'&&error&&'code' in error?String((error as {code?:unknown}).code||''):'';
  if(code==='passkey_disabled')return 'Face ID / huella todavía no está habilitado en Supabase para este dominio.';
  if(code==='webauthn_credential_exists')return 'Este dispositivo ya tiene una passkey registrada.';
  if(code==='too_many_passkeys')return 'Has alcanzado el máximo de dispositivos biométricos registrados.';
  if(error instanceof DOMException&&error.name==='NotAllowedError')return 'Se canceló la verificación biométrica.';
  if(error instanceof Error)return error.message;
  return 'No se pudo activar Face ID / huella.';
}

export function PasskeySetup({userId}:{userId:string}){
  const [supported,setSupported]=useState(false);
  const [registered,setRegistered]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [dismissed,setDismissed]=useState(false);

  useEffect(()=>{
    const ok=supportsPasskeys();
    setSupported(ok);
    setDismissed(window.sessionStorage.getItem(`zenvia-passkey-dismissed-${userId}`)==='1');
    if(!ok){setRegistered(false);return;}
    let active=true;
    supabase.auth.passkey.list().then(({data,error})=>{
      if(!active)return;
      if(error){setRegistered(false);return;}
      setRegistered(Array.isArray(data)&&data.length>0);
    }).catch(()=>{if(active)setRegistered(false)});
    return()=>{active=false};
  },[userId]);

  const dismiss=()=>{
    window.sessionStorage.setItem(`zenvia-passkey-dismissed-${userId}`,'1');
    setDismissed(true);
  };

  const register=async()=>{
    setBusy(true);
    try{
      const {error}=await supabase.auth.registerPasskey();
      if(error)throw error;
      setRegistered(true);
      showSuccess('Face ID / huella activado para este dispositivo.');
    }catch(error){showError(errorText(error))}
    finally{setBusy(false)}
  };

  if(!supported||registered===null||registered||dismissed)return null;
  return <div className="passkeySetupBanner">
    <div className="passkeySetupIcon"><Fingerprint size={21}/></div>
    <div className="passkeySetupText"><strong>Acceso con Face ID / huella</strong><span>Actívalo una vez y podrás entrar sin escribir la contraseña.</span></div>
    <button className="primary passkeySetupAction" onClick={register} disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ShieldCheck size={17}/>} {busy?'Activando…':'Activar'}</button>
    <button className="passkeySetupClose" onClick={dismiss} title="Ahora no" aria-label="Ahora no"><X size={17}/></button>
  </div>;
}
