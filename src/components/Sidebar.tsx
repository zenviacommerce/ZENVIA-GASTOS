import { useEffect, useState } from 'react';
import { BarChart3, Building2, FileText, LogOut, Menu, Moon, Package, ReceiptText, ShieldCheck, ShoppingBag, Store, Sun, Users, X } from 'lucide-react';
import { ZENVIA_LOGO } from '../branding';

export type Page = 'dashboard' | 'sales' | 'orders' | 'invoices' | 'clients' | 'products' | 'suppliers' | 'amazon' | 'admin';
export type ThemeMode = 'light' | 'dark';

type SidebarUser = {
  fullName: string;
  email: string;
  role: 'admin' | 'user';
};

const items = [
  ['dashboard','Resumen','Resumen',BarChart3],
  ['sales','Facturación','Ventas',ReceiptText],
  ['orders','Pedidos','Pedidos',ShoppingBag],
  ['invoices','Gastos','Gastos',FileText],
  ['clients','Clientes','Clientes',Users],
  ['products','Productos','Productos',Package],
  ['suppliers','Proveedores','Proveedores',Building2],
  ['amazon','Amazon','Amazon',Store],
] as const;

function initials(fullName: string, email: string) {
  const source = fullName.trim() || email.split('@')[0] || 'U';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ''}${parts.at(-1)?.[0] || ''}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function Sidebar({page,onChange,onLogout,theme,onToggleTheme,allowedPages,isAdmin,user}:{page:Page;onChange:(p:Page)=>void;onLogout:()=>void;theme:ThemeMode;onToggleTheme:()=>void;allowedPages:Page[];isAdmin:boolean;user:SidebarUser}) {
  const [mobileOpen,setMobileOpen]=useState(false);
  const visibleItems = items.filter(([id]) => allowedPages.includes(id));
  const canOpenAdmin = isAdmin && allowedPages.includes('admin');
  const displayName = user.fullName.trim() || user.email.split('@')[0] || 'Usuario';
  const roleLabel = user.role === 'admin' ? 'Administrador' : 'Usuario';
  const activeLabel=page==='admin'?'Administración':items.find(([id])=>id===page)?.[1]||'Menú';

  useEffect(()=>{
    setMobileOpen(false);
  },[page]);

  useEffect(()=>{
    if(!mobileOpen)return;
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')setMobileOpen(false);};
    document.addEventListener('keydown',onKeyDown);
    return()=>document.removeEventListener('keydown',onKeyDown);
  },[mobileOpen]);

  const navigate=(next:Page)=>{onChange(next);setMobileOpen(false);};

  return <>
    <div className="mobileNavHeader">
      <button className="mobileMenuButton" type="button" onClick={()=>setMobileOpen(true)} aria-label="Abrir menú" aria-expanded={mobileOpen}><Menu size={22}/></button>
      <strong>{activeLabel}</strong>
    </div>
    {mobileOpen&&<button className="mobileSidebarBackdrop" type="button" aria-label="Cerrar menú" onClick={()=>setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen?'mobileOpen':''}`}>
    <div className="brand">
      <div className="brandLogoWrap"><img className="brandLogo" src={ZENVIA_LOGO} alt="ZENVIA COMMERCE"/></div>
      <div className="brandProductLockup"><span className="brandProductDot"/><div className="brandProductText"><strong>Gestión</strong><span>Gestión empresarial</span></div></div>
      <button className="mobileMenuClose" type="button" onClick={()=>setMobileOpen(false)} aria-label="Cerrar menú"><X size={20}/></button>
    </div>
    <nav className={isAdmin?'hasAdmin':''}>{visibleItems.map(([id,label,mobileLabel,Icon]) => <button key={id} className={page===id?'active':''} onClick={()=>navigate(id)} title={label} aria-label={label}><Icon size={18}/><span className="navLabelDesktop">{label}</span><span className="navLabelMobile">{mobileLabel}</span></button>)}{canOpenAdmin&&<button className={page==='admin'?'active adminNavMobile':'adminNavMobile'} onClick={()=>navigate('admin')} title="Administración" aria-label="Administración"><ShieldCheck size={18}/><span className="navLabelDesktop">Administración</span><span className="navLabelMobile">Admin</span></button>}</nav>
    <div className="sidebarBottom">
      <div className="sidebarUserCard" title={`${displayName} · ${user.email}`}>
        <div className="sidebarUserAvatar" aria-hidden="true">{initials(displayName, user.email)}</div>
        <div className="sidebarUserInfo">
          <strong>{displayName}</strong>
          <span className="sidebarUserRole">{roleLabel} · ZENVIA</span>
          <span className="sidebarUserEmail">{user.email}</span>
        </div>
      </div>
      {canOpenAdmin&&<button className={page==='admin'?'adminSidebarButton active':'adminSidebarButton'} onClick={()=>navigate('admin')}><ShieldCheck size={18}/>Administración</button>}
      <button className="themeSidebarButton" onClick={onToggleTheme}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>} {theme==='dark'?'Modo claro':'Modo oscuro'}</button>
      <button onClick={onLogout}><LogOut size={18}/>Cerrar sesión</button>
    </div>
  </aside>
  </>;
}
