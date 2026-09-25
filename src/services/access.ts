import { supabase } from './supabase';
import { emailError, nameError, normalizeEmail } from './validation';

export type MenuPermission = 'dashboard' | 'sales' | 'orders' | 'invoices' | 'clients' | 'products' | 'suppliers' | 'amazon' | 'support';
export type AppRole = 'admin' | 'user';

export interface WorkspaceEntitlement {
  enabled: boolean;
  limit: number | null;
  config: Record<string, unknown>;
}

export const permissionOptions: Array<{ id: MenuPermission; label: string; description: string }> = [
  { id: 'dashboard', label: 'Resumen', description: 'Ver el cuadro de mando, métricas, IVA, resultados y filtros por periodo.' },
  { id: 'sales', label: 'Facturación', description: 'Gestionar facturas de venta, borradores, cobros, series, datos fiscales y registros IVA.' },
  { id: 'orders', label: 'Pedidos', description: 'Gestionar pedidos de Amazon y Shopify, etiquetas, transportistas, impresión y seguimiento.' },
  { id: 'invoices', label: 'Gastos', description: 'Gestionar gastos, facturas recibidas, importación desde Gmail, filtros y exportaciones.' },
  { id: 'clients', label: 'Clientes', description: 'Consultar y mantener clientes, datos fiscales, contacto e histórico de facturación.' },
  { id: 'products', label: 'Productos', description: 'Consultar y mantener productos, precios de venta, costes e histórico.' },
  { id: 'suppliers', label: 'Proveedores', description: 'Consultar y mantener proveedores, clasificación, gasto e histórico de compras.' },
  { id: 'amazon', label: 'Amazon', description: 'Consultar Amazon Analytics, rentabilidad, marketplaces y estado de sincronización.' },
  { id: 'support', label: 'Soporte', description: 'Crear incidencias y peticiones, adjuntar archivos y hacer seguimiento de sus tickets.' },
];

export interface AccessProfile {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
  active: boolean;
  dataOwnerId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  workspaceStatus: string;
  planKey: string;
  planName: string;
  subscriptionStatus: string;
  isPlatformAdmin: boolean;
  entitlements: Record<string, WorkspaceEntitlement>;
  permissions: MenuPermission[];
}

export interface ManagedUser {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
  active: boolean;
  permissions: MenuPermission[];
  createdAt?: string | null;
  updatedAt?: string | null;
  lastSignInAt?: string | null;
}

function cleanPermissions(value: unknown): MenuPermission[] {
  const allowed = new Set(permissionOptions.map(option => option.id));
  return Array.isArray(value)
    ? value.filter((item): item is MenuPermission => typeof item === 'string' && allowed.has(item as MenuPermission))
    : [];
}

async function fetchAccessProfileRow(userId:string){
  return supabase
    .from('app_users')
    .select('user_id,email,full_name,role,active,data_owner_id,workspace_id,permissions')
    .eq('user_id', userId)
    .maybeSingle();
}

type WorkspaceContextRow = {
  workspace_id?: string | null;
  workspace_name?: string | null;
  workspace_slug?: string | null;
  workspace_status?: string | null;
  plan_key?: string | null;
  plan_name?: string | null;
  subscription_status?: string | null;
  is_platform_admin?: boolean | null;
  entitlements?: unknown;
};

function cleanEntitlements(value:unknown):Record<string,WorkspaceEntitlement>{
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result:Record<string,WorkspaceEntitlement>={};
  for(const [key,raw] of Object.entries(value as Record<string,unknown>)){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const item=raw as Record<string,unknown>;
    result[key]={
      enabled:item.enabled!==false,
      limit:typeof item.limit==='number'&&Number.isFinite(item.limit)?item.limit:null,
      config:item.config&&typeof item.config==='object'&&!Array.isArray(item.config)
        ? item.config as Record<string,unknown>
        : {},
    };
  }
  return result;
}

function isWorkspaceContextUnavailable(error:unknown){
  if(!error||typeof error!=='object')return false;
  const value=error as {code?:unknown;message?:unknown};
  const code=typeof value.code==='string'?value.code:'';
  const message=typeof value.message==='string'?value.message.toLowerCase():'';
  return code==='PGRST202'||code==='42883'||message.includes('get_workspace_context');
}

async function loadWorkspaceContext():Promise<WorkspaceContextRow|null>{
  const {data,error}=await supabase.rpc('get_workspace_context');
  if(error){
    // Compatibility during a staggered DB/frontend rollout.
    if(isWorkspaceContextUnavailable(error))return null;
    throw new Error(accessErrorMessage(error));
  }
  if(Array.isArray(data))return (data[0] as WorkspaceContextRow|undefined)||null;
  return data&&typeof data==='object'?data as WorkspaceContextRow:null;
}

function accessErrorMessage(error:unknown){
  if(error&&typeof error==='object'){
    const value=error as {message?:unknown;code?:unknown;details?:unknown;hint?:unknown};
    const parts=[
      typeof value.message==='string'?value.message:'',
      typeof value.code==='string'&&value.code?('Código '+value.code):'',
      typeof value.details==='string'?value.details:'',
      typeof value.hint==='string'?value.hint:'',
    ].filter(Boolean);
    if(parts.length)return parts.join(' · ');
  }
  return error instanceof Error&&error.message?error.message:'No se pudo comprobar tu acceso.';
}

export async function loadAccessProfile(userId: string): Promise<AccessProfile | null> {
  let result=await fetchAccessProfileRow(userId);

  if(result.error){
    const {data:sessionData}=await supabase.auth.getSession();
    const session=sessionData.session;
    if(!session||session.user.id!==userId){
      const refreshed=await supabase.auth.refreshSession();
      if(refreshed.error)throw new Error(accessErrorMessage(refreshed.error));
    }else{
      const expiresAt=(session.expires_at||0)*1000;
      if(expiresAt&&expiresAt-Date.now()<60_000){
        const refreshed=await supabase.auth.refreshSession();
        if(refreshed.error)throw new Error(accessErrorMessage(refreshed.error));
      }
    }
    result=await fetchAccessProfileRow(userId);
  }

  if(result.error)throw new Error(accessErrorMessage(result.error));
  const data=result.data;
  if (!data) return null;
  const workspace=await loadWorkspaceContext();
  return {
    userId: data.user_id,
    email: data.email,
    fullName: data.full_name || '',
    role: data.role as AppRole,
    active: Boolean(data.active),
    dataOwnerId: data.data_owner_id,
    workspaceId: workspace?.workspace_id || data.workspace_id || data.data_owner_id,
    workspaceName: workspace?.workspace_name || '',
    workspaceSlug: workspace?.workspace_slug || '',
    workspaceStatus: workspace?.workspace_status || 'active',
    planKey: workspace?.plan_key || 'internal',
    planName: workspace?.plan_name || 'Interno',
    subscriptionStatus: workspace?.subscription_status || 'active',
    isPlatformAdmin: Boolean(workspace?.is_platform_admin),
    entitlements: cleanEntitlements(workspace?.entitlements),
    permissions: data.role === 'admin' ? permissionOptions.map(option => option.id) : cleanPermissions(data.permissions),
  };
}

async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) throw new Error(error.message || 'No se pudo completar la operación administrativa.');
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

function validateManagedUser(email: string, fullName: string, password?: string) {
  const emailMessage = emailError(email, true);
  if (emailMessage) throw new Error(emailMessage);
  const nameMessage = nameError(fullName, 'El nombre');
  if (nameMessage) throw new Error(nameMessage);
  if (password !== undefined && password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const result = await invokeAdmin<{ users: ManagedUser[] }>({ action: 'list' });
  return result.users || [];
}

export async function createManagedUser(input: { email: string; fullName: string; password: string; role: AppRole; permissions: MenuPermission[] }) {
  validateManagedUser(input.email, input.fullName, input.password);
  return invokeAdmin<{ ok: true; userId: string }>({ action: 'create', ...input, email: normalizeEmail(input.email), fullName: input.fullName.trim() });
}

export async function updateManagedUser(input: { userId: string; email: string; fullName: string; password?: string; active: boolean; role: AppRole; permissions: MenuPermission[] }) {
  validateManagedUser(input.email, input.fullName, input.password);
  return invokeAdmin<{ ok: true }>({ action: 'update', ...input, email: normalizeEmail(input.email), fullName: input.fullName.trim() });
}

export async function deleteManagedUser(userId: string) {
  return invokeAdmin<{ ok: true }>({ action: 'delete', userId });
}
