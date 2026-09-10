import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, Pencil, ShieldCheck, Trash2, UserRoundPlus, Users, X } from 'lucide-react';
import { createManagedUser, deleteManagedUser, listManagedUsers, permissionOptions, updateManagedUser, type ManagedUser, type MenuPermission } from '../services/access';
import '../admin.css';

type EditorState = { user: ManagedUser | null } | null;

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

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setUsers(await listManagedUsers()); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los usuarios.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cambiar el acceso.'); }
    finally { setBusyId(null); }
  };

  const remove = async (user: ManagedUser) => {
    if (user.role === 'admin' || user.userId === currentUserId) return;
    if (!window.confirm(`¿Eliminar definitivamente el acceso de ${user.email}?\n\nSi ha subido archivos, Supabase puede impedir el borrado; en ese caso puedes dejarlo desactivado.`)) return;
    setBusyId(user.userId); setError('');
    try { await deleteManagedUser(user.userId); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar el usuario.'); }
    finally { setBusyId(null); }
  };

  const activeCount = users.filter(user => user.active).length;
  return <div className="page adminPage">
    <div className="pageHead">
      <div><div className="eyebrow">ADMINISTRACIÓN</div><h1>Usuarios y accesos</h1><p>Controla quién puede entrar en ZENVIA Gastos y qué módulos puede utilizar.</p></div>
      <button className="primary" onClick={() => setEditor({ user: null })}><UserRoundPlus size={17}/> Nuevo usuario</button>
    </div>

    <div className="adminStats">
      <div className="card adminStat"><Users/><div><span>Usuarios</span><strong>{users.length}</strong></div></div>
      <div className="card adminStat"><Check/><div><span>Con acceso</span><strong>{activeCount}</strong></div></div>
      <div className="card adminStat"><ShieldCheck/><div><span>Administradores</span><strong>{users.filter(user => user.role === 'admin').length}</strong></div></div>
    </div>

    {error && <div className="errorBox adminError">{error}</div>}
    <section className="card adminUsersCard">
      <div className="adminUsersHead"><div><h3>Accesos de ZENVIA COMMERCE</h3><p>Los permisos se aplican también en la base de datos, no solo al menú.</p></div>{loading && <span className="adminLoading">Actualizando…</span>}</div>
      <div className="adminUsersList">
        {users.map(user => <div className="adminUserRow" key={user.userId}>
          <div className="adminAvatar">{(user.fullName || user.email).slice(0, 2).toUpperCase()}</div>
          <div className="adminUserIdentity"><strong>{user.fullName || 'Sin nombre'}</strong><span>{user.email}</span><small>Último acceso: {formatDate(user.lastSignInAt)}</small></div>
          <div className="adminRole"><span className={user.role === 'admin' ? 'adminRolePill admin' : 'adminRolePill'}>{user.role === 'admin' ? 'Administrador' : 'Usuario'}</span><span className={user.active ? 'adminStatus active' : 'adminStatus'}>{user.active ? 'Activo' : 'Sin acceso'}</span></div>
          <div className="adminPermissionChips">{(user.role === 'admin' ? permissionOptions.map(option => option.id) : user.permissions).map(permission => <span key={permission}>{permissionOptions.find(option => option.id === permission)?.label || permission}</span>)}</div>
          <div className="adminRowActions">
            <button className="iconAction" title="Editar usuario" onClick={() => setEditor({ user })} disabled={busyId === user.userId}><Pencil size={16}/></button>
            {user.role !== 'admin' && <button className={user.active ? 'adminAccessButton dangerText' : 'adminAccessButton'} onClick={() => toggleActive(user)} disabled={busyId === user.userId}>{user.active ? 'Desactivar' : 'Activar'}</button>}
            {user.role !== 'admin' && <button className="iconAction danger" title="Eliminar usuario" onClick={() => remove(user)} disabled={busyId === user.userId}><Trash2 size={16}/></button>}
          </div>
        </div>)}
        {!loading && !users.length && <div className="emptyState">No hay usuarios configurados.</div>}
      </div>
    </section>

    {editor && <UserEditor user={editor.user} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await refresh(); }}/>} 
  </div>;
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
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el usuario.'); }
    finally { setBusy(false); }
  };

  return <div className="modalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal adminUserModal" onSubmit={submit}>
      <div className="modalHead"><div><h3>{editing ? 'Editar acceso' : 'Nuevo usuario'}</h3><p>{isAdmin ? 'Administrador principal de ZENVIA Gastos.' : 'Configura su acceso a los módulos de la aplicación.'}</p></div><button type="button" onClick={onClose}><X size={18}/></button></div>
      <div className="stackForm adminUserFields">
        <label>Nombre<input required value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Nombre y apellidos"/></label>
        <label>Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="usuario@zenviacommerce.com"/></label>
        <label>{editing ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}<div className="adminPasswordField"><KeyRound size={16}/><input type="password" required={!editing} minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder={editing ? 'Dejar en blanco para no cambiar' : 'Mínimo 8 caracteres'}/></div></label>
      </div>

      {!isAdmin && <>
        <div className="adminPermissionsTitle"><strong>Acceso al menú</strong><span>Selecciona las áreas que podrá utilizar.</span></div>
        <div className="adminPermissionGrid">{permissionOptions.map(option => <label className={permissions.includes(option.id) ? 'adminPermissionOption selected' : 'adminPermissionOption'} key={option.id}><input type="checkbox" checked={permissions.includes(option.id)} onChange={() => togglePermission(option.id)}/><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div>
        {editing && <label className="adminActiveToggle"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)}/><span><strong>Usuario activo</strong><small>Si lo desactivas, podrá autenticarse pero no acceder a datos ni módulos.</small></span></label>}
      </>}

      {isAdmin && <div className="adminLockedNotice"><ShieldCheck size={18}/><div><strong>Acceso total</strong><span>El administrador principal siempre conserva todos los permisos y no puede desactivarse desde la aplicación.</span></div></div>}
      {error && <div className="errorBox">{error}</div>}
      <div className="modalActions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear usuario'}</button></div>
    </form>
  </div>;
}
