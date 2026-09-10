import { BarChart3, FileText, Package, Building2, Mail, LogOut, WalletCards, Moon, Sun } from 'lucide-react';
import { ZENVIA_LOGO } from '../branding';

export type Page = 'dashboard' | 'invoices' | 'products' | 'suppliers' | 'gmail';
export type ThemeMode = 'light' | 'dark';
const items = [
  ['dashboard','Resumen','Resumen',BarChart3],
  ['invoices','Facturas','Facturas',FileText],
  ['products','Productos y costes','Productos',Package],
  ['suppliers','Proveedores','Proveedores',Building2],
  ['gmail','Gmail','Gmail',Mail],
] as const;

export function Sidebar({page,onChange,onLogout,theme,onToggleTheme}:{page:Page;onChange:(p:Page)=>void;onLogout:()=>void;theme:ThemeMode;onToggleTheme:()=>void}) {
  return <aside className="sidebar">
    <div className="brand"><div className="brandLogoWrap"><img className="brandLogo" src={ZENVIA_LOGO} alt="ZENVIA COMMERCE"/></div><span className="brandSection">Gastos</span></div>
    <nav>{items.map(([id,label,mobileLabel,Icon]) => <button key={id} className={page===id?'active':''} onClick={()=>onChange(id)} title={label} aria-label={label}><Icon size={18}/><span className="navLabelDesktop">{label}</span><span className="navLabelMobile">{mobileLabel}</span></button>)}</nav>
    <div className="sidebarBottom"><div className="companyBadge"><WalletCards size={18}/><span>ZENVIA COMMERCE</span></div><button className="themeSidebarButton" onClick={onToggleTheme}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>} {theme==='dark'?'Modo claro':'Modo oscuro'}</button><button onClick={onLogout}><LogOut size={18}/>Cerrar sesión</button></div>
  </aside>
}
