import { FormEvent, useState } from 'react';
import { LockKeyhole, ReceiptText } from 'lucide-react';
import { supabase } from '../services/supabase';

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage(data.session ? 'Cuenta creada.' : 'Cuenta creada. Revisa el correo para confirmar tu dirección.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la operación.');
    } finally { setBusy(false); }
  };

  return <div className="authPage">
    <div className="authPanel">
      <div className="authLogo"><div className="brandMark">Z</div><div><strong>ZENVIA COMMERCE</strong><span>Gestión de gastos</span></div></div>
      <div className="authHeroIcon"><ReceiptText/></div>
      <h1>{mode === 'login' ? 'Accede a ZENVIA Gastos' : 'Crea tu acceso'}</h1>
      <p>Facturas, proveedores y costes de producto centralizados y protegidos.</p>
      <form onSubmit={submit} className="authForm">
        <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="info@zenviacommerce.com"/></label>
        <label>Contraseña<input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"/></label>
        <button className="primary authSubmit" disabled={busy}><LockKeyhole size={17}/>{busy ? 'Procesando…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
      </form>
      {message && <div className="authMessage">{message}</div>}
      <button className="authSwitch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>
        {mode === 'login' ? '¿Primera vez? Crear cuenta' : 'Ya tengo cuenta · Entrar'}
      </button>
    </div>
  </div>;
}
