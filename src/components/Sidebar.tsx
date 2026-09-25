import { useEffect, useState } from 'react';
import { BarChart3, Building2, CircleHelp, FileText, LogOut, Menu, Moon, Package, ReceiptText, Settings2, ShieldCheck, ShoppingBag, Store, Sun, Users, X, type LucideIcon } from 'lucide-react';
import { ZENVIA_LOGO } from '../branding';

export type Page = 'dashboard' | 'sales' | 'orders' | 'invoices' | 'clients' | 'products' | 'suppliers' | 'amazon' | 'support' | 'settings' | 'admin';
export type ThemeMode = 'light' | 'dark';

type SidebarUser = {
  fullName: string;
  email: string;
  role: 'admin' | 'user';
};

type NavItem = readonly [Page,string,string,LucideIcon];
type NavGroup = { label:string; items:NavItem[] };

const navGroups:NavGroup[] = [
  {
    label:'Inicio',
    items:[
      ['dashboard','Resumen','Resumen',BarChart3],
    ],
  },
  {
    label:'Operaciones',
    items:[
      ['orders','Pedidos','Pedidos',ShoppingBag],
      ['sales','Facturación','Ventas',ReceiptText],
      ['invoices','Gastos','Gastos',FileText],
    ],
  },
  {
    label:'Gestión',
    items:[
      ['products','Productos','Productos',Package],
      ['clients','Clientes','Clientes',Users],
      ['suppliers','Proveedores','Proveedores',Building2],
    ],
  },
  {
    label:'Canales',
    items:[
      ['amazon','Amazon','Amazon',Store],
    ],
  },
  {
    label:'Ayuda',
    items:[
      ['support','Soporte','Soporte',CircleHelp],
    ],
  },
];

const items:NavItem[]=navGroups.flatMap(group=>group.items);

function initials(fullName: string, email: string) {
  const source = fullName.trim() || email.split('@')[0] || 'U';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ''}${parts.at(-1)?.[0] || ''}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function Sidebar({page,onChange,onLogout,theme,onToggleTheme,allowedPages,isAdmin,user}:{page:Page;onChange:(p:Page)=>void;onLogout:()=>void;theme:ThemeMode;onToggleTheme:()=>void;allowedPages:Page[];isAdmin:boolean;user:SidebarUser}) {
  const [mobileOpen,setMobileOpen]=useState(false);
  const canOpenSettings = allowedPages.includes('settings');
  const canOpenAdmin = isAdmin && allowedPages.includes('admin');
  const displayName = user.fullName.trim() || user.email.split('@')[0] || 'Usuario';
  const roleLabel = user.role === 'admin' ? 'Administrador' : 'Usuario';
  const activeLabel=page==='support'?'Soporte':page==='settings'?'Configuración':page==='admin'?'Administración':items.find(([id])=>id===page)?.[1]||'Menú';

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

      <nav className="sidebarNav" aria-label="Navegación principal">
        {navGroups.map(group=>{
          const visibleItems=group.items.filter(([id])=>allowedPages.includes(id));
          if(!visibleItems.length)return null;
          return <div className="sidebarNavGroup" key={group.label}>
            <div className="sidebarSectionLabel">{group.label}</div>
            <div className="sidebarNavItems">
              {visibleItems.map(([id,label,mobileLabel,Icon])=>
                <button key={id} className={page===id?'active':''} onClick={()=>navigate(id)} title={label} aria-label={label}>
                  <Icon size={18}/>
                  <span className="navLabelDesktop">{label}</span>
                  <span className="navLabelMobile">{mobileLabel}</span>
                </button>
              )}
            </div>
          </div>;
        })}
      </nav>

      <div className="sidebarBottom">
        <div className="sidebarUserCard" title={`${displayName} · ${user.email}`}>
          <div className="sidebarUserAvatar" aria-hidden="true">{initials(displayName, user.email)}</div>
          <div className="sidebarUserInfo">
            <strong>{displayName}</strong>
            <span className="sidebarUserRole">{roleLabel} · ZENVIA</span>
            <span className="sidebarUserEmail">{user.email}</span>
          </div>
        </div>
        <div className="sidebarSectionLabel sidebarSystemLabel">Sistema</div>
        {canOpenSettings&&<button className={page==='settings'?'settingsSidebarButton active':'settingsSidebarButton'} onClick={()=>navigate('settings')}><Settings2 size={18}/><span>Configuración</span></button>}
        {canOpenAdmin&&<button className={page==='admin'?'adminSidebarButton active':'adminSidebarButton'} onClick={()=>navigate('admin')}><ShieldCheck size={18}/><span>Administración</span></button>}
        <button className="themeSidebarButton" onClick={onToggleTheme}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}<span>{theme==='dark'?'Modo claro':'Modo oscuro'}</span></button>
        <button onClick={onLogout}><LogOut size={18}/><span>Cerrar sesión</span></button>
      </div>
    </aside>
  </>;
}
