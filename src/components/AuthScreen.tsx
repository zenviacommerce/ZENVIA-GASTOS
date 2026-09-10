import { FormEvent, useState } from 'react';
import { ZENVIA_LOGO } from '../branding';
import { LockKeyhole, ReceiptText } from 'lucide-react';
import { supabase } from '../services/supabase';
import { emailError, normalizeEmail } from '../services/validation';

export function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    const emailMessage=emailError(email,true);
    if(emailMessage){setMessage(emailMessage);return;}
    if(password.length<8){setMessage('La contraseña debe tener al menos 8 caracteres.');return;}
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    } finally { setBusy(false); }
  };

  return <div className="authPage">
    <div className="authPanel">
      <div className="authLogo"><img src={ZENVIA_LOGO} alt="ZENVIA COMMERCE"/><span>Gestión de gastos</span></div>
      <div className="authHeroIcon"><ReceiptText/></div>
      <h1>Accede a ZENVIA Gastos</h1>
      <p>Acceso privado para usuarios autorizados por ZENVIA COMMERCE.</p>
      <form onSubmit={submit} className="authForm" noValidate>
        <label>Email<input type="email" required inputMode="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@zenviacommerce.com"/></label>
        <label>Contraseña<input type="password" required minLength={8} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"/></label>
        <button className="primary authSubmit" disabled={busy}><LockKeyhole size={17}/>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      {message && <div className="authMessage">{message}</div>}
      <div className="authMessage">Las cuentas se crean y administran desde la propia aplicación.</div>
    </div>
  </div>;
}
