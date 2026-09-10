import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { TOAST_EVENT, type ToastPayload } from '../services/toast';

type ToastItem = ToastPayload & { id: string };

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const payload = (event as CustomEvent<ToastPayload>).detail;
      if (!payload?.message) return;
      const id = crypto.randomUUID();
      setItems(current => [...current.slice(-3), { ...payload, id }]);
      window.setTimeout(() => setItems(current => current.filter(item => item.id !== id)), payload.duration ?? 4000);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (!items.length) return null;
  return <div className="toastHost" aria-live="polite" aria-atomic="false">
    {items.map(item => <div key={item.id} className={`appToast ${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
      {item.kind === 'success' ? <CheckCircle2 size={20}/> : <AlertCircle size={20}/>}<span>{item.message}</span>
      <button onClick={() => setItems(current => current.filter(toast => toast.id !== item.id))} aria-label="Cerrar aviso"><X size={16}/></button>
    </div>)}
  </div>;
}
