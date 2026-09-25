import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Building2, CircleDollarSign, Headphones, History, KeyRound, LogOut, Menu, Plus,
  RefreshCcw, Search, ShieldCheck, TicketCheck, UserPlus, Users, X
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  platformApi, type AuditEntry, type BillingPlan, type Bootstrap, type PlatformPermission,
  type PlatformRole, type PlatformRoleDefinition, type PlatformUser, type Ticket,
  type TicketMessage, type Workspace, type WorkspaceStatus, formatDate, moneyFromCents
} from './api';

type Section='dashboard'|'clients'|'plans'|'tickets'|'users'|'audit';

const statusLabels:Record<string,string>={
  active:'Activo',trialing:'Prueba',suspended:'Suspendido',cancelled:'Cancelado',
  open:'Abierto',in_progress:'En curso',waiting_user:'Esperando cliente',resolved:'Resuelto',closed:'Cerrado',
};
const priorityLabels:Record<string,string>={low:'Baja',normal:'Normal',high:'Alta',urgent:'Urgente'};
const platformRoleLabels:Record<PlatformRole,string>={
  super_admin:'Superadministrador',support_admin:'Soporte',billing_admin:'Facturación',operations_admin:'Operaciones',
};

function usageText(value:number,limit:number|null){
  return limit===null?`${value} / ∞`:`${value} / ${limit}`;
}
function usageClass(value:number,limit:number|null){
  if(limit===null)return 'usageBadge';
  if(limit===0||value>=limit)return 'usageBadge atLimit';
  if(value/limit>=0.8)return 'usageBadge nearLimit';
  return 'usageBadge';
}

export function App(){
  const [session,setSession]=useState<Session|null>(null);
  const [authReady,setAuthReady]=useState(false);
  const [bootstrap,setBootstrap]=useState<Bootstrap|null>(null);
  const [bootstrapError,setBootstrapError]=useState('');
  const [section,setSection]=useState<Section>('dashboard');
  const [menuOpen,setMenuOpen]=useState(false);

  useEffect(()=>{
    void supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthReady(true)});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,next)=>{setSession(next);setAuthReady(true);setBootstrap(null)});
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(!session){setBootstrap(null);return;}
    setBootstrapError('');
    void platformApi.bootstrap().then(setBootstrap).catch(e=>setBootstrapError(e instanceof Error?e.message:'Acceso no autorizado.'));
  },[session]);

  if(!authReady)return <FullLoader text="Cargando ZENVIA Platform…"/>;
  if(!session)return <Login/>;
  if(session.user.user_metadata?.platform_onboarding_pending===true)return <PlatformInviteSetup session={session}/>;
  if(bootstrapError)return <AccessDenied message={bootstrapError}/>;
  if(!bootstrap)return <FullLoader text="Comprobando acceso de plataforma…"/>;

  const can=(permission:string)=>bootstrap.actor.role==='super_admin'||bootstrap.actor.permissions.includes(permission);
  const nav:Array<{id:Section;label:string;icon:typeof BarChart3}>=[
    can('dashboard.view')&&{id:'dashboard',label:'Resumen',icon:BarChart3},
    can('clients.view')&&{id:'clients',label:'Clientes',icon:Building2},
    can('plans.view')&&{id:'plans',label:'Planes',icon:CircleDollarSign},
    can('tickets.view')&&{id:'tickets',label:'Tickets',icon:Headphones},
    can('users.view')&&{id:'users',label:'Usuarios',icon:Users},
    can('audit.view')&&{id:'audit',label:'Auditoría',icon:History},
  ].filter(Boolean) as Array<{id:Section;label:string;icon:typeof BarChart3}>;

  return <div className="platformShell">
    <aside className={menuOpen?'platformSidebar open':'platformSidebar'}>
      <div className="platformBrand">
        <div className="platformBrandMark">Z</div>
        <div><strong>ZENVIA</strong><span>Platform</span></div>
        <button className="closeSidebar" onClick={()=>setMenuOpen(false)}><X size={18}/></button>
      </div>
      <nav>{nav.map(item=>{
        const Icon=item.icon;
        return <button key={item.id} className={section===item.id?'active':''} onClick={()=>{setSection(item.id);setMenuOpen(false)}}>
          <Icon size={18}/><span>{item.label}</span>
        </button>;
      })}</nav>
      <div className="platformIdentity">
        <div className="avatar">{(bootstrap.actor.email||'Z').slice(0,2).toUpperCase()}</div>
        <div><strong>{bootstrap.actor.email}</strong><span>{platformRoleLabels[bootstrap.actor.role]}</span></div>
        <button onClick={()=>supabase.auth.signOut()} title="Cerrar sesión"><LogOut size={17}/></button>
      </div>
    </aside>
    {menuOpen&&<button className="sidebarBackdrop" onClick={()=>setMenuOpen(false)} aria-label="Cerrar menú"/>}
    <main className="platformMain">
      <header className="platformTopbar">
        <button className="menuButton" onClick={()=>setMenuOpen(true)}><Menu size={20}/></button>
        <div><span>Administración de plataforma</span><strong>soporte@zenviacommerce.com</strong></div>
        <div className="secureBadge"><ShieldCheck size={16}/> Acceso interno</div>
      </header>
      {section==='dashboard'&&<Dashboard bootstrap={bootstrap} onNavigate={setSection}/>}
      {section==='clients'&&<Clients role={bootstrap.actor.role}/>}
      {section==='plans'&&<Plans role={bootstrap.actor.role}/>}
      {section==='tickets'&&<Tickets/>}
      {section==='users'&&<PlatformUsers currentUserId={bootstrap.actor.id}/>}
      {section==='audit'&&<Audit/>}
    </main>
  </div>;
}

function Login(){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const submit=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setError('');
    const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(error)setError(error.message);
    setBusy(false);
  };
  return <div className="loginPage">
    <form className="loginCard" onSubmit={submit}>
      <div className="loginLogo">Z</div>
      <div className="eyebrow">ZENVIA COMMERCE</div>
      <h1>ZENVIA Platform</h1>
      <p>Panel interno para clientes, planes, suscripciones y soporte.</p>
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label>
      <label>Contraseña<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label>
      {error&&<div className="errorBox">{error}</div>}
      <button className="primary wide" disabled={busy}>{busy?'Accediendo…':'Acceder'}</button>
      <small>Solo usuarios autorizados como administradores de plataforma.</small>
    </form>
  </div>;
}

function AccessDenied({message}:{message:string}){
  return <div className="loginPage"><div className="loginCard denied">
    <ShieldCheck size={42}/><h1>Acceso restringido</h1><p>{message}</p>
    <button className="secondary wide" onClick={()=>supabase.auth.signOut()}>Cerrar sesión</button>
  </div></div>;
}
function FullLoader({text}:{text:string}){return <div className="fullLoader"><RefreshCcw className="spin"/>{text}</div>}

function PageHead({eyebrow,title,description,actions}:{eyebrow:string;title:string;description:string;actions?:React.ReactNode}){
  return <div className="pageHead"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{actions&&<div className="pageActions">{actions}</div>}</div>;
}

function Dashboard({bootstrap,onNavigate}:{bootstrap:Bootstrap;onNavigate:(s:Section)=>void}){
  const stats=[
    {label:'Clientes',value:bootstrap.stats.workspaces,icon:Building2,to:'clients' as Section},
    {label:'Suscripciones activas',value:bootstrap.stats.subscriptions,icon:CircleDollarSign,to:'plans' as Section},
    {label:'Tickets pendientes',value:bootstrap.stats.openTickets,icon:Headphones,to:'tickets' as Section},
    {label:'Planes activos',value:bootstrap.stats.activePlans,icon:TicketCheck,to:'plans' as Section},
  ];
  return <div className="page">
    <PageHead eyebrow="PLATAFORMA" title="Resumen" description="Estado general del SaaS y accesos rápidos de operación."/>
    <div className="statsGrid">{stats.map(s=>{const Icon=s.icon;return <button className="statCard" key={s.label} onClick={()=>onNavigate(s.to)}>
      <div className="statIcon"><Icon/></div><div><span>{s.label}</span><strong>{s.value}</strong></div>
    </button>})}</div>
    <div className="dashboardGrid">
      <section className="card">
        <div className="sectionTitle"><div><h2>Operación</h2><p>Flujo central del servicio.</p></div></div>
        <div className="operationSteps">
          <button onClick={()=>onNavigate('clients')}><Building2/><span><strong>Alta de clientes</strong><small>Workspace, propietario y plan</small></span></button>
          <button onClick={()=>onNavigate('tickets')}><Headphones/><span><strong>Soporte</strong><small>Tickets de todos los clientes</small></span></button>
          <button onClick={()=>onNavigate('plans')}><CircleDollarSign/><span><strong>Planes</strong><small>Precios, límites y capacidades</small></span></button>
        </div>
      </section>
      <section className="card platformInfo">
        <ShieldCheck/>
        <h2>Separación de seguridad</h2>
        <p>Este panel utiliza un Auth y una base de datos propios. Las operaciones sobre clientes pasan por un puente servidor-servidor y nunca reutilizan la sesión de ZENVIA Gestión.</p>
      </section>
    </div>
  </div>;
}

function Clients({role}:{role:string}){
  const [items,setItems]=useState<Workspace[]>([]);
  const [plans,setPlans]=useState<BillingPlan[]>([]);
  const [loading,setLoading]=useState(true);
  const [query,setQuery]=useState('');
  const [showCreate,setShowCreate]=useState(false);
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const [w,p]=await Promise.all([platformApi.listWorkspaces(),platformApi.listPlans()]);
      setItems(w.workspaces);setPlans(p.plans);
    }catch(e){setError(e instanceof Error?e.message:'No se pudieron cargar los clientes.')}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{void refresh()},[refresh]);

  const shown=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return q?items.filter(x=>`${x.name} ${x.legal_name||''} ${x.slug} ${x.subscription?.plan_key||''}`.toLowerCase().includes(q)):items;
  },[items,query]);

  const assign=async(workspace:Workspace,planKey:string)=>{
    try{await platformApi.assignPlan(workspace.id,planKey);await refresh();}
    catch(e){setError(e instanceof Error?e.message:'No se pudo cambiar el plan.')}
  };
  const changeStatus=async(workspace:Workspace,status:WorkspaceStatus)=>{
    if(status===workspace.status)return;
    if((status==='suspended'||status==='cancelled')&&!window.confirm(
      status==='suspended'
        ? `¿Suspender ${workspace.name}? Sus usuarios perderán acceso a los datos hasta que lo reactives.`
        : `¿Cancelar ${workspace.name}? Sus usuarios dejarán de tener acceso a ZENVIA Gestión.`
    ))return;
    try{await platformApi.updateWorkspaceStatus(workspace.id,status);await refresh();}
    catch(e){setError(e instanceof Error?e.message:'No se pudo cambiar el estado del cliente.')}
  };

  return <div className="page">
    <PageHead eyebrow="CLIENTES" title="Workspaces" description="Empresas que utilizan ZENVIA Gestión y su estado de servicio."
      actions={<><button className="secondary" onClick={()=>void refresh()} disabled={loading}><RefreshCcw size={16}/> Actualizar</button>{role==='super_admin'&&<button className="primary" onClick={()=>setShowCreate(true)}><Plus size={16}/> Nuevo cliente</button>}</>}/>
    <div className="toolbar"><div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar empresa, slug o plan…"/></div><span>{shown.length} clientes</span></div>
    {error&&<div className="errorBox">{error}</div>}
    <section className="card tableCard">
      <div className="dataTable">
        <div className="tableRow tableHead"><div>Empresa</div><div>Estado</div><div>Plan</div><div>Usuarios</div><div>Amazon</div><div>Pedidos/mes</div><div>Alta</div></div>
        {shown.map(w=><div className="tableRow" key={w.id}>
          <div className="entityCell"><strong>{w.name}</strong><span>{w.legal_name||w.slug}</span></div>
          <div>{role==='super_admin'
            ?<select value={w.status} onChange={e=>void changeStatus(w,e.target.value as WorkspaceStatus)}>
              <option value="active">Activo</option>
              <option value="trialing">Prueba</option>
              <option value="suspended">Suspendido</option>
              <option value="cancelled">Cancelado</option>
            </select>
            :<span className={`pill ${w.status}`}>{statusLabels[w.status]||w.status}</span>}</div>
          <div>{role==='super_admin'||role==='billing_admin'
            ?<select value={w.subscription?.plan_key||'internal'} onChange={e=>void assign(w,e.target.value)}>{plans.map(p=><option value={p.plan_key} key={p.plan_key}>{p.name}</option>)}</select>
            :<span>{plans.find(p=>p.plan_key===w.subscription?.plan_key)?.name||w.subscription?.plan_key||'—'}</span>}</div>
          <div><span className={usageClass(w.usage.users.value,w.usage.users.limit)}>{usageText(w.usage.users.value,w.usage.users.limit)}</span></div>
          <div><span className={usageClass(w.usage.amazonAccounts.value,w.usage.amazonAccounts.limit)}>{usageText(w.usage.amazonAccounts.value,w.usage.amazonAccounts.limit)}</span></div>
          <div><span className={usageClass(w.usage.monthlyOrders.value,w.usage.monthlyOrders.limit)}>{usageText(w.usage.monthlyOrders.value,w.usage.monthlyOrders.limit)}</span></div>
          <div>{formatDate(w.created_at)}</div>
        </div>)}
        {!loading&&!shown.length&&<div className="emptyState">No hay clientes para mostrar.</div>}
        {loading&&!items.length&&<div className="emptyState">Cargando clientes…</div>}
      </div>
    </section>
    {showCreate&&<CreateClient plans={plans.filter(p=>p.plan_key!=='internal')} onClose={()=>setShowCreate(false)} onCreated={async()=>{setShowCreate(false);await refresh()}}/>}
  </div>;
}

function CreateClient({plans,onClose,onCreated}:{plans:BillingPlan[];onClose:()=>void;onCreated:()=>Promise<void>}){
  const [name,setName]=useState('');const [legalName,setLegalName]=useState('');
  const [ownerFullName,setOwnerFullName]=useState('');const [ownerEmail,setOwnerEmail]=useState('');
  const [planKey,setPlanKey]=useState(plans.find(p=>p.active)?.plan_key||plans[0]?.plan_key||'starter');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');
    try{await platformApi.createWorkspace({name,legalName,ownerEmail,ownerFullName,planKey});await onCreated();}
    catch(err){setError(err instanceof Error?err.message:'No se pudo crear el cliente.')}finally{setBusy(false)}
  };
  return <Modal title="Nuevo cliente" subtitle="Se crea el workspace y se invita por email al propietario." onClose={onClose}>
    <form onSubmit={submit} className="formGrid">
      <label>Nombre comercial<input value={name} onChange={e=>setName(e.target.value)} required/></label>
      <label>Razón social<input value={legalName} onChange={e=>setLegalName(e.target.value)}/></label>
      <label>Propietario<input value={ownerFullName} onChange={e=>setOwnerFullName(e.target.value)} required/></label>
      <label>Email propietario<input type="email" value={ownerEmail} onChange={e=>setOwnerEmail(e.target.value)} required/></label>
      <label className="full">Plan<select value={planKey} onChange={e=>setPlanKey(e.target.value)}>{plans.map(p=><option key={p.plan_key} value={p.plan_key}>{p.name}{!p.active?' · inactivo':''}</option>)}</select></label>
      {error&&<div className="errorBox full">{error}</div>}
      <div className="modalActions full"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Creando…':'Crear e invitar'}</button></div>
    </form>
  </Modal>;
}

function Plans({role}:{role:string}){
  const [plans,setPlans]=useState<BillingPlan[]>([]);
  const [loading,setLoading]=useState(true);
  const [editing,setEditing]=useState<BillingPlan|null>(null);
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{setLoading(true);setError('');try{setPlans((await platformApi.listPlans()).plans)}catch(e){setError(e instanceof Error?e.message:'No se pudieron cargar los planes.')}finally{setLoading(false)}},[]);
  useEffect(()=>{void refresh()},[refresh]);
  const canEdit=role==='super_admin'||role==='billing_admin';
  return <div className="page">
    <PageHead eyebrow="BILLING" title="Planes" description="Precios, módulos y límites que controlan cada suscripción." actions={<button className="secondary" onClick={()=>void refresh()}><RefreshCcw size={16}/> Actualizar</button>}/>
    {error&&<div className="errorBox">{error}</div>}
    <div className="planGrid">{plans.map(plan=><article className={plan.plan_key==='internal'?'planCard internal':'planCard'} key={plan.plan_key}>
      <div className="planHead"><div><span>{plan.plan_key}</span><h2>{plan.name}</h2></div><span className={plan.active?'pill active':'pill cancelled'}>{plan.active?'Activo':'Inactivo'}</span></div>
      <p>{plan.description||'Sin descripción.'}</p>
      <div className="planPrice"><strong>{moneyFromCents(plan.monthly_price_cents)}</strong><span>/ mes</span></div>
      <div className="planMeta"><span><Users size={15}/>{plan.subscriptions} suscripciones</span><span>{plan.entitlements.filter(e=>e.enabled).length} capacidades</span></div>
      <div className="entitlementPreview">{plan.entitlements.slice(0,6).map(e=><span key={e.entitlement_key}>{e.entitlement_key.replace('module.','')}{e.limit_value!==null?` · ${e.limit_value}`:''}</span>)}</div>
      {canEdit&&<button className="secondary wide" onClick={()=>setEditing(plan)}>Configurar plan</button>}
    </article>)}</div>
    {loading&&!plans.length&&<div className="emptyState">Cargando planes…</div>}
    {editing&&<PlanEditor plan={editing} onClose={()=>setEditing(null)} onSaved={async()=>{setEditing(null);await refresh()}}/>}
  </div>;
}

function PlanEditor({plan,onClose,onSaved}:{plan:BillingPlan;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [name,setName]=useState(plan.name);const [description,setDescription]=useState(plan.description||'');
  const [active,setActive]=useState(plan.active);const [isPublic,setPublic]=useState(plan.is_public);
  const [monthly,setMonthly]=useState(plan.monthly_price_cents===null?'':String(plan.monthly_price_cents/100));
  const [yearly,setYearly]=useState(plan.yearly_price_cents===null?'':String(plan.yearly_price_cents/100));
  const [ents,setEnts]=useState(plan.entitlements.map(e=>({key:e.entitlement_key,enabled:e.enabled,limit:e.limit_value===null?'':String(e.limit_value)})));
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const save=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');
    try{await platformApi.updatePlan({planKey:plan.plan_key,name,description,active,isPublic,
      monthlyPriceCents:monthly===''?null:Math.round(Number(monthly)*100),
      yearlyPriceCents:yearly===''?null:Math.round(Number(yearly)*100),
      entitlements:ents.map(x=>({key:x.key,enabled:x.enabled,limit:x.limit===''?null:Number(x.limit)})),
    });await onSaved()}catch(err){setError(err instanceof Error?err.message:'No se pudo guardar el plan.')}finally{setBusy(false)}
  };
  return <Modal title={`Configurar ${plan.name}`} subtitle="Los límites se validan también en backend." onClose={onClose}>
    <form onSubmit={save} className="planEditor">
      <div className="formGrid">
        <label>Nombre<input value={name} onChange={e=>setName(e.target.value)} disabled={plan.plan_key==='internal'}/></label>
        <label>Precio mensual (€)<input type="number" min="0" step="0.01" value={monthly} onChange={e=>setMonthly(e.target.value)}/></label>
        <label>Precio anual (€)<input type="number" min="0" step="0.01" value={yearly} onChange={e=>setYearly(e.target.value)}/></label>
        <label className="toggleLabel"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} disabled={plan.plan_key==='internal'}/><span>Plan activo</span></label>
        <label className="toggleLabel"><input type="checkbox" checked={isPublic} onChange={e=>setPublic(e.target.checked)} disabled={plan.plan_key==='internal'}/><span>Visible comercialmente</span></label>
        <label className="full">Descripción<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3}/></label>
      </div>
      <h3>Capacidades y límites</h3>
      <div className="entitlementList">{ents.map((e,i)=><div className="entitlementRow" key={e.key}>
        <label><input type="checkbox" checked={e.enabled} onChange={ev=>setEnts(all=>all.map((x,j)=>j===i?{...x,enabled:ev.target.checked}:x))}/><span>{e.key}</span></label>
        <input type="number" min="0" placeholder="Sin límite" value={e.limit} onChange={ev=>setEnts(all=>all.map((x,j)=>j===i?{...x,limit:ev.target.value}:x))}/>
      </div>)}</div>
      {error&&<div className="errorBox">{error}</div>}
      <div className="modalActions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Guardando…':'Guardar plan'}</button></div>
    </form>
  </Modal>;
}

function Tickets(){
  const [items,setItems]=useState<Ticket[]>([]);const [loading,setLoading]=useState(true);
  const [query,setQuery]=useState('');const [status,setStatus]=useState('');const [selected,setSelected]=useState<string|null>(null);
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{setLoading(true);setError('');try{setItems((await platformApi.listTickets()).tickets)}catch(e){setError(e instanceof Error?e.message:'No se pudieron cargar los tickets.')}finally{setLoading(false)}},[]);
  useEffect(()=>{void refresh()},[refresh]);
  const shown=useMemo(()=>items.filter(t=>{
    if(status&&t.status!==status)return false;
    const q=query.trim().toLowerCase();return !q||`${t.ticket_number} ${t.subject} ${t.created_by_email} ${t.workspace_name}`.toLowerCase().includes(q);
  }),[items,query,status]);
  return <div className="page">
    <PageHead eyebrow="SOPORTE" title="Tickets" description="Bandeja global de soporte para todos los clientes." actions={<button className="secondary" onClick={()=>void refresh()}><RefreshCcw size={16}/> Actualizar</button>}/>
    <div className="toolbar"><div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar ticket, cliente o email…"/></div>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos los estados</option>{['open','in_progress','waiting_user','resolved','closed'].map(x=><option key={x} value={x}>{statusLabels[x]}</option>)}</select>
      <span>{shown.length} tickets</span>
    </div>
    {error&&<div className="errorBox">{error}</div>}
    <section className="card ticketList">{shown.map(t=><button className="ticketRow" key={t.id} onClick={()=>setSelected(t.id)}>
      <div><strong>{t.ticket_number}</strong><span>{t.workspace_name}</span></div>
      <div className="ticketSubject"><strong>{t.subject}</strong><span>{t.created_by_name||t.created_by_email}</span></div>
      <span className={`priority ${t.priority}`}>{priorityLabels[t.priority]}</span>
      <span className={`pill ${t.status}`}>{statusLabels[t.status]}</span>
      <time>{formatDate(t.last_activity_at)}</time>
    </button>)}
      {!loading&&!shown.length&&<div className="emptyState">No hay tickets para los filtros seleccionados.</div>}
      {loading&&!items.length&&<div className="emptyState">Cargando tickets…</div>}
    </section>
    {selected&&<TicketDetail ticketId={selected} onClose={()=>setSelected(null)} onChanged={refresh}/>}
  </div>;
}

function TicketDetail({ticketId,onClose,onChanged}:{ticketId:string;onClose:()=>void;onChanged:()=>Promise<void>}){
  const [ticket,setTicket]=useState<Ticket|null>(null);const [messages,setMessages]=useState<TicketMessage[]>([]);
  const [reply,setReply]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const load=useCallback(async()=>{setError('');try{const d=await platformApi.ticketDetail(ticketId);setTicket(d.ticket);setMessages(d.messages)}catch(e){setError(e instanceof Error?e.message:'No se pudo cargar el ticket.')}},[ticketId]);
  useEffect(()=>{void load()},[load]);
  const update=async(patch:{status?:Ticket['status'];priority?:Ticket['priority']})=>{setBusy(true);setError('');try{await platformApi.updateTicket(ticketId,patch);await load();await onChanged()}catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar.')}finally{setBusy(false)}};
  const send=async(e:FormEvent)=>{e.preventDefault();if(!reply.trim())return;setBusy(true);setError('');setNotice('');
    try{const r=await platformApi.replyTicket(ticketId,reply.trim());setReply('');setNotice(r.notified?'Respuesta enviada y cliente notificado por email.':`Respuesta guardada. Email no enviado${r.notificationReason?': '+r.notificationReason:''}.`);await load();await onChanged()}
    catch(err){setError(err instanceof Error?err.message:'No se pudo responder.')}finally{setBusy(false)}
  };
  return <Modal title={ticket?.ticket_number||'Ticket'} subtitle={ticket?`${ticket.workspace_name} · ${ticket.created_by_email}`:'Cargando…'} onClose={onClose} wide>
    {ticket&&<>
      <div className="ticketDetailHead">
        <div><span>Asunto</span><strong>{ticket.subject}</strong></div>
        <label>Estado<select value={ticket.status} onChange={e=>void update({status:e.target.value as Ticket['status']})} disabled={busy}>{['open','in_progress','waiting_user','resolved','closed'].map(x=><option key={x} value={x}>{statusLabels[x]}</option>)}</select></label>
        <label>Prioridad<select value={ticket.priority} onChange={e=>void update({priority:e.target.value as Ticket['priority']})} disabled={busy}>{['low','normal','high','urgent'].map(x=><option key={x} value={x}>{priorityLabels[x]}</option>)}</select></label>
      </div>
      {ticket.description&&<div className="originalMessage"><strong>Descripción inicial</strong><p>{ticket.description}</p></div>}
      <div className="conversation">{messages.map(m=><article className={m.author_role==='admin'?'message admin':'message'} key={m.id}>
        <div><strong>{m.author_name||m.author_email}</strong><span>{m.author_role==='admin'?'Soporte ZENVIA':'Cliente'} · {formatDate(m.created_at)}</span></div><p>{m.body}</p>
      </article>)}</div>
      <form className="replyBox" onSubmit={send}><textarea rows={4} value={reply} onChange={e=>setReply(e.target.value)} placeholder="Escribe una respuesta al cliente…"/><div><span>Se notificará al cliente por email.</span><button className="primary" disabled={busy||!reply.trim()}>{busy?'Enviando…':'Responder'}</button></div></form>
    </>}
    {notice&&<div className="successBox">{notice}</div>}
    {error&&<div className="errorBox">{error}</div>}
  </Modal>;
}

function Audit(){
  const [items,setItems]=useState<AuditEntry[]>([]);const [loading,setLoading]=useState(true);const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{setLoading(true);setError('');try{setItems((await platformApi.listAudit()).entries)}catch(e){setError(e instanceof Error?e.message:'No se pudo cargar la auditoría.')}finally{setLoading(false)}},[]);
  useEffect(()=>{void refresh()},[refresh]);
  const shown=useMemo(()=>{const q=query.trim().toLowerCase();return q?items.filter(x=>`${x.summary} ${x.action} ${x.entity_type}`.toLowerCase().includes(q)):items},[items,query]);
  return <div className="page">
    <PageHead eyebrow="CONTROL" title="Auditoría de plataforma" description="Acciones administrativas realizadas fuera de los workspaces." actions={<button className="secondary" onClick={()=>void refresh()}><RefreshCcw size={16}/> Actualizar</button>}/>
    <div className="toolbar"><div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar acción…"/></div><span>{shown.length} movimientos</span></div>
    {error&&<div className="errorBox">{error}</div>}
    <section className="card auditList">{shown.map(x=><article className="auditRow" key={x.id}><div className="auditIcon"><History size={16}/></div><div><strong>{x.summary}</strong><span>{x.action} · {x.entity_type} · {formatDate(x.created_at)}</span>{Object.keys(x.details||{}).length>0&&<details><summary>Detalles</summary><pre>{JSON.stringify(x.details,null,2)}</pre></details>}</div></article>)}
      {!loading&&!shown.length&&<div className="emptyState">No hay movimientos.</div>}
      {loading&&!items.length&&<div className="emptyState">Cargando auditoría…</div>}
    </section>
  </div>;
}

function Modal({title,subtitle,onClose,children,wide=false}:{title:string;subtitle?:string;onClose:()=>void;children:React.ReactNode;wide?:boolean}){
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className={wide?'modalPanel wide':'modalPanel'}>
    <div className="modalHead"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button onClick={onClose}><X size={20}/></button></div>
    <div className="modalBody">{children}</div>
  </div></div>;
}
