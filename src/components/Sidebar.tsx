import { BarChart3, FileText, Package, Building2, Mail, LogOut, WalletCards } from 'lucide-react';

export type Page = 'dashboard' | 'invoices' | 'products' | 'suppliers' | 'gmail';
const items = [
  ['dashboard','Resumen',BarChart3],
  ['invoices','Facturas',FileText],
  ['products','Productos y costes',Package],
  ['suppliers','Proveedores',Building2],
  ['gmail','Gmail',Mail],
] as const;

export function Sidebar({page,onChange,onLogout}:{page:Page;onChange:(p:Page)=>void;onLogout:()=>void}) {
  return <aside className="sidebar">
    <div className="brand"><div className="brandMark">Z</div><div><strong>ZENVIA</strong><span>Gastos</span></div></div>
    <nav>{items.map(([id,label,Icon]) => <button key={id} className={page===id?'active':''} onClick={()=>onChange(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>
    <div className="sidebarBottom"><div className="companyBadge"><WalletCards size={18}/><span>ZENVIA COMMERCE</span></div><button onClick={onLogout}><LogOut size={18}/>Cerrar sesión</button></div>
  </aside>
}
