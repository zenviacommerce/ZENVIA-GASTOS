import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock3, History, KeyRound, Pencil, RefreshCw, Search, ShieldCheck, Trash2, UserRoundPlus, Users, X } from 'lucide-react';
import { createManagedUser, deleteManagedUser, listManagedUsers, permissionOptions, updateManagedUser, type ManagedUser, type MenuPermission } from '../services/access';
import { listAuditLogs, type AuditEntry } from '../services/audit';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { Pagination } from '../components/Pagination';
import { SelectField } from '../components/forms/SelectField';
import { SearchableSelect } from '../components/forms/SearchableSelect';
import '../admin.css';

const PAGE_SIZE=20;
type EditorState = { user: ManagedUser | null } | null;
type AdminTab = 'users' | 'audit';

function formatDate(value?: string | null) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

export function AdminPage({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>('users');
  const [page,setPage]=useState(1);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setUsers(await listManagedUsers()); }
    catch (e) { const message=errorMessage(e,'No se pudieron cargar los usuarios.'); setError(message); showError(message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const userPages=Math.max(1,Math.ceil(users.length/PAGE_SIZE));
  const pagedUsers=useMemo(()=>users.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[users,page]);
  useEffect(()=>{setPage(current=>Math.min(current,userPages))},[userPages]);
  useEffect(()=>{if(tab==='users')setPage(1)},[tab]);

  const toggleActive = async (user: ManagedUser) => {
    if (user.role === 'admin') return;
    setBusyId(user.userId); setError('');
    try {
      await updateManagedUser({
        userId: user.userId,
        email: user.email,
        fullName: user.fullName,
        active: !user.active,
        permissions: user.permissions,
      });
      await refresh();
      showSuccess(`Usuario ${user.active ? 'desactivado' : 'activado'} correctamente.`);
    } catch (e) { const message=errorMessage(e,'No se pudo cambiar el acceso.'); setError(message); showError(message); }
    finally { setBusyId(null); }
  };

  const remove = async (user: ManagedUser) => {
    if (user.role === 'admin' || user.userId === currentUserId) return;
    if (!window.confirm(`¿Eliminar definitivamente el acceso de ${user.email}?\n\nSi ha subido archivos, Supabase puede impedir el borrado; en ese caso puedes dejarlo desactivado.`)) return;
    setBusyId(user.userId); setError('');
    try { await deleteManagedUser(user.userId); await refresh(); showSuccess('Usuario eliminado correctamente.'); }
    catch (e) { const message=errorMessage(e,'No se pudo eliminar el usuario.'); setError(message); showError(message); }
    finally { setBusyId(null); }
  };

  const activeCount = users.filter(user => user.active).length;
  return <div className="page adminPage">
    <div className="pageHead">
      <div><div className="eyebrow">ADMINISTRACIÓN</div><h1>Administración</h1><p>Gestiona usuarios, permisos y revisa la actividad realizada dentro de ZENVIA Gestión.</p></div>
      {tab==='users'&&<button className="primary" onClick={() => setEditor({ user: null })}><UserRoundPlus size={17}/> Nuevo usuario</button>}
    </div>

    <div className="adminTabs" role="tablist">
      <button className={tab==='users'?'active':''} onClick={()=>setTab('users')}><Users size={16}/> Usuarios y accesos</button>
      <button className={tab==='audit'?'active':''} onClick={()=>setTab('audit')}><History size={16}/> Auditoría</button>
    </div>

    {tab==='users'?<>
      <div className="adminStats">
        <div className="card adminStat"><Users/><div><span>Usuarios</span><strong>{users.length}</strong></div></div>
        <div className="card adminStat"><Check/><div><span>Con acceso</span><strong>{activeCount}</strong></div></div>
        <div className="card adminStat"><ShieldCheck/><div><span>Administradores</span><strong>{users.filter(user => user.role === 'admin').length}</strong></div></div>
      </div>

      {error && <div className="errorBox adminError">{error}</div>}
      <section className="card adminUsersCard">
        <div className="adminUsersHead"><div><h3>Accesos de ZENVIA COMMERCE</h3><p>Los permisos corresponden a los módulos actuales y se aplican también al acceso a los datos.</p></div>{loading && <span className="adminLoading">Actualizando…</span>}</div>
        <div className="adminUsersList">
          {pagedUsers.map(user => {
            const permissionLabels = user.role === 'admin'
              ? [...permissionOptions.map(option => option.label), 'Administración']
              : user.permissions.map(permission => permissionOptions.find(option => option.id === permission)?.label || permission);
            return <div className="adminUserRow" key={user.userId}>
              <div className="adminAvatar">{(user.fullName || user.email).slice(0, 2).toUpperCase()}</div>
              <div className="adminUserIdentity"><strong>{user.fullName || 'Sin nombre'}</strong><span>{user.email}</span><small>Último acceso: {formatDate(user.lastSignInAt)}</small></div>
              <div className="adminRole"><span className={user.role === 'admin' ? 'adminRolePill admin' : 'adminRolePill'}>{user.role === 'admin' ? 'Administrador' : 'Usuario'}</span><span className={user.active ? 'adminStatus active' : 'adminStatus'}>{user.active ? 'Activo' : 'Sin acceso'}</span></div>
              <div className="adminPermissionChips">{permissionLabels.map(label => <span key={label}>{label}</span>)}</div>
              <div className="adminRowActions">
                <button className="iconAction" title="Editar usuario" onClick={() => setEditor({ user })} disabled={busyId === user.userId}><Pencil size={16}/></button>
                {user.role !== 'admin' && <button className={user.active ? 'adminAccessButton dangerText' : 'adminAccessButton'} onClick={() => toggleActive(user)} disabled={busyId === user.userId}>{user.active ? 'Desactivar' : 'Activar'}</button>}
                {user.role !== 'admin' && <button className="iconAction danger" title="Eliminar usuario" onClick={() => remove(user)} disabled={busyId === user.userId}><Trash2 size={16}/></button>}
              </div>
            </div>;
          })}
          {!loading && !users.length && <div className="emptyState">No hay usuarios configurados.</div>}
        </div>
        {users.length>0&&<Pagination page={page} totalItems={users.length} pageSize={PAGE_SIZE} onPageChange={setPage}/>}
      </section>
    </>:<AuditPanel users={users} currentUserId={currentUserId}/>}

    {editor && <UserEditor user={editor.user} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await refresh(); }}/>} 
  </div>;
}

const moduleLabels: Record<string,string>={dashboard:'Resumen',sales:'Facturación',invoices:'Gastos',clients:'Clientes',products:'Productos',suppliers:'Proveedores',gmail:'Gastos · Gmail',amazon:'Amazon',admin:'Administración'};
const actionLabels: Record<string,string>={create:'Creación',update:'Modificación',delete:'Eliminación',import:'Importación',ignore:'Ignorado',recover:'Recuperado',error:'Error',status_change:'Cambio de estado',price_update:'Cambio de precio',export:'Exportación',create_user:'Alta de usuario',update_user:'Cambio de usuario',activate_user:'Activación',deactivate_user:'Desactivación',delete_user:'Baja de usuario'};

function AuditPanel({users,currentUserId}:{users:ManagedUser[];currentUserId:string}){
  const [entries,setEntries]=useState<AuditEntry[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [actor,setActor]=useState('');
  const [module,setModule]=useState('');
  const [action,setAction]=useState('');
  const [days,setDays]=useState('30');
  const [page,setPage]=useState(1);

  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{setEntries(await listAuditLogs())}
    catch(e){const message=errorMessage(e,'No se pudo cargar la auditoría.');setError(message);showError(message)}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{void refresh()},[refresh]);

  const actorName=(entry:AuditEntry)=>{
    const user=entry.actorUserId?users.find(item=>item.userId===entry.actorUserId):undefined;
    if(user?.fullName)return `${user.fullName}${entry.actorUserId===currentUserId?' (tú)':''}`;
    return entry.actorEmail||'Sistema';
  };
  const actorOptions=useMemo(()=>{
    const map=new Map<string,string>();
    entries.forEach(entry=>{const key=entry.actorUserId||`email:${entry.actorEmail||'system'}`;map.set(key,actorName(entry))});
    return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1],'es'));
  },[entries,users,currentUserId]);
  const modules=useMemo(()=>[...new Set(entries.map(entry=>entry.module))].sort(),[entries]);
  const actions=useMemo(()=>[...new Set(entries.map(entry=>entry.action))].sort(),[entries]);
  const shown=useMemo(()=>{
    const q=query.trim().toLowerCase();
    const cutoff=days==='all'?0:Date.now()-Number(days)*86400000;
    return entries.filter(entry=>{
      const actorKey=entry.actorUserId||`email:${entry.actorEmail||'system'}`;
      if(actor&&actorKey!==actor)return false;
      if(module&&entry.module!==module)return false;
      if(action&&entry.action!==action)return false;
      if(cutoff&&new Date(entry.createdAt).getTime()<cutoff)return false;
      if(q&&!`${entry.summary} ${entry.actorEmail||''} ${entry.entityLabel||''} ${entry.module}`.toLowerCase().includes(q))return false;
      return true;
    });
  },[entries,query,actor,module,action,days]);
  const totalPages=Math.max(1,Math.ceil(shown.length/PAGE_SIZE));
  const paged=useMemo(()=>shown.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[shown,page]);
  useEffect(()=>{setPage(1)},[query,actor,module,action,days]);
  useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);

  return <>
    <div className="adminAuditStats">
      <div className="card adminAuditStat"><History/><div><span>Movimientos cargados</span><strong>{entries.length}</strong></div></div>
      <div className="card adminAuditStat"><Users/><div><span>Usuarios con actividad</span><strong>{actorOptions.length}</strong></div></div>
      <div className="card adminAuditStat"><Clock3/><div><span>Mostrando</span><strong>{shown.length}</strong></div></div>
    </div>
    <section className="card adminAuditCard">
      <div className="adminUsersHead"><div><h3>Registro de actividad</h3><p>Acciones realizadas por los usuarios desde que se activó la auditoría.</p></div><button className="secondary" onClick={refresh} disabled={loading}><RefreshCw size={15} className={loading?'spin':''}/> Actualizar</button></div>
      <div className="auditFilters">
        <div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar acción, elemento o usuario…"/></div>
        <SearchableSelect value={actor} options={actorOptions.map(([value,label])=>({value,label}))} onChange={setActor} allowEmpty emptyLabel="Todos los usuarios" searchPlaceholder="Buscar usuario…" ariaLabel="Filtrar auditoría por usuario"/>
        <SelectField value={module} options={[{value:'',label:'Todos los módulos'},...modules.map(value=>({value,label:moduleLabels[value]||value}))]} onChange={setModule} ariaLabel="Filtrar auditoría por módulo"/>
        <SelectField value={action} options={[{value:'',label:'Todas las acciones'},...actions.map(value=>({value,label:actionLabels[value]||value}))]} onChange={setAction} ariaLabel="Filtrar auditoría por acción"/>
        <SelectField value={days} options={[{value:'7',label:'7 días'},{value:'30',label:'30 días'},{value:'90',label:'90 días'},{value:'365',label:'1 año'},{value:'all',label:'Todo'}]} onChange={setDays} ariaLabel="Periodo de auditoría"/>
      </div>
      {error&&<div className="errorBox adminError">{error}</div>}
      <div className="auditList">
        {paged.map(entry=><article className="auditRow" key={entry.id}>
          <div className={`auditIcon ${entry.action}`}><History size={16}/></div>
          <div className="auditMain"><strong>{entry.summary}</strong><span>{actorName(entry)} · {formatDate(entry.createdAt)}</span>{Object.keys(entry.details||{}).length>0&&<details><summary>Ver detalles</summary><pre>{JSON.stringify(entry.details,null,2)}</pre></details>}</div>
          <div className="auditMeta"><span>{moduleLabels[entry.module]||entry.module}</span><small>{actionLabels[entry.action]||entry.action}</small></div>
        </article>)}
        {!loading&&!shown.length&&<div className="emptyState large">No hay movimientos para los filtros seleccionados.</div>}
        {loading&&!entries.length&&<div className="emptyState large">Cargando auditoría…</div>}
      </div>
      {shown.length>0&&<Pagination page={page} totalItems={shown.length} pageSize={PAGE_SIZE} onPageChange={setPage}/>}
    </section>
  </>;
}

function UserEditor({ user, onClose, onSaved }: { user: ManagedUser | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const editing = Boolean(user);
  const isAdmin = user?.role === 'admin';
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(user?.active ?? true);
  const [permissions, setPermissions] = useState<MenuPermission[]>(user?.permissions?.length ? user.permissions : ['dashboard', 'invoices']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const togglePermission = (permission: MenuPermission) => setPermissions(current => current.includes(permission) ? current.filter(item => item !== permission) : [...current, permission]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (editing && user) {
        await updateManagedUser({ userId: user.userId, email, fullName, password: password || undefined, active: isAdmin ? true : active, permissions: isAdmin ? permissionOptions.map(option => option.id) : permissions });
      } else {
        await createManagedUser({ email, fullName, password, permissions });
      }
      await onSaved();
      showSuccess(editing?'Usuario modificado correctamente.':'Usuario creado correctamente.');
    } catch (e) { const message=errorMessage(e,'No se pudo guardar el usuario.'); setError(message); showError(message); }
    finally { setBusy(false); }
  };

  return <div className="modalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal adminUserModal" onSubmit={submit}>
      <div className="modalHead"><div><h3>{editing ? 'Editar acceso' : 'Nuevo usuario'}</h3><p>{isAdmin ? 'Administrador principal de ZENVIA Gestión.' : 'Configura su acceso a los módulos actuales de la aplicación.'}</p></div><button type="button" onClick={onClose}><X size={18}/></button></div>
      <div className="stackForm adminUserFields">
        <label>Nombre<input required value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Nombre y apellidos"/></label>
        <label>Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="usuario@zenviacommerce.com"/></label>
        <label>{editing ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}<div className="adminPasswordField"><KeyRound size={16}/><input type="password" required={!editing} minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder={editing ? 'Dejar en blanco para no cambiar' : 'Mínimo 8 caracteres'}/></div></label>
      </div>

      {!isAdmin && <>
        <div className="adminPermissionsTitle"><strong>Acceso a módulos</strong><span>Selecciona las áreas que podrá utilizar. Administración está reservada a administradores.</span></div>
        <div className="adminPermissionGrid">{permissionOptions.map(option => <label className={permissions.includes(option.id) ? 'adminPermissionOption selected' : 'adminPermissionOption'} key={option.id}><input type="checkbox" checked={permissions.includes(option.id)} onChange={() => togglePermission(option.id)}/><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div>
        {editing && <label className="adminActiveToggle"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)}/><span><strong>Usuario activo</strong><small>Si lo desactivas, podrá autenticarse pero no acceder a datos ni módulos.</small></span></label>}
      </>}

      {isAdmin && <div className="adminLockedNotice"><ShieldCheck size={18}/><div><strong>Acceso total</strong><span>El administrador principal conserva Resumen, Facturación, Gastos, Clientes, Productos, Proveedores y Administración, y no puede desactivarse desde la aplicación.</span></div></div>}
      {error && <div className="errorBox">{error}</div>}
      <div className="modalActions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear usuario'}</button></div>
    </form>
  </div>;
}