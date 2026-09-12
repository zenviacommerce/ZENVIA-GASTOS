import { BarChart3, FileText, Package, Building2, Mail, LogOut, Moon, Sun, ShieldCheck } from 'lucide-react';
import { ZENVIA_LOGO } from '../branding';

export type Page = 'dashboard' | 'invoices' | 'products' | 'suppliers' | 'gmail' | 'admin';
export type ThemeMode = 'light' | 'dark';

type SidebarUser = {
  fullName: string;
  email: string;
  role: 'admin' | 'user';
};

const items = [
  ['dashboard','Resumen','Resumen',BarChart3],
  ['invoices','Facturas','Facturas',FileText],
  ['products','Productos y costes','Productos',Package],
  ['suppliers','Proveedores','Proveedores',Building2],
  ['gmail','Gmail','Gmail',Mail],
  ['admin','Administración','Admin',ShieldCheck],
] as const;

function initials(fullName: string, email: string) {
  const source = fullName.trim() || email.split('@')[0] || 'U';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ''}${parts.at(-1)?.[0] || ''}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function Sidebar({page,onChange,onLogout,theme,onToggleTheme,allowedPages,isAdmin,user}:{page:Page;onChange:(p:Page)=>void;onLogout:()=>void;theme:ThemeMode;onToggleTheme:()=>void;allowedPages:Page[];isAdmin:boolean;user:SidebarUser}) {
  const visibleItems = items.filter(([id]) => allowedPages.includes(id));
  const displayName = user.fullName.trim() || user.email.split('@')[0] || 'Usuario';
  const roleLabel = user.role === 'admin' ? 'Administrador' : 'Usuario';

  return <aside className="sidebar">
    <div className="brand">
      <div className="brandLogoWrap"><img className="brandLogo" src={ZENVIA_LOGO} alt="ZENVIA COMMERCE"/></div>
      <div className="brandProductLockup"><span className="brandProductDot"/><div className="brandProductText"><strong>Gastos</strong><span>Control financiero</span></div></div>
    </div>
    <nav className={isAdmin?'hasAdmin':''}>{visibleItems.map(([id,label,mobileLabel,Icon]) => <button key={id} className={page===id?'active':''} onClick={()=>onChange(id)} title={label} aria-label={label}><Icon size={18}/><span className="navLabelDesktop">{label}</span><span className="navLabelMobile">{mobileLabel}</span></button>)}</nav>
    <div className="sidebarBottom">
      <div className="sidebarUserCard" title={`${displayName} · ${user.email}`}>
        <div className="sidebarUserAvatar" aria-hidden="true">{initials(displayName, user.email)}</div>
        <div className="sidebarUserInfo">
          <strong>{displayName}</strong>
          <span className="sidebarUserRole">{roleLabel} · ZENVIA</span>
          <span className="sidebarUserEmail">{user.email}</span>
        </div>
      </div>
      <button className="themeSidebarButton" onClick={onToggleTheme}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>} {theme==='dark'?'Modo claro':'Modo oscuro'}</button>
      <button onClick={onLogout}><LogOut size={18}/>Cerrar sesión</button>
    </div>
  </aside>
}
