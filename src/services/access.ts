import { supabase } from './supabase';
import { emailError, nameError, normalizeEmail } from './validation';

export type MenuPermission = 'dashboard' | 'invoices' | 'products' | 'suppliers' | 'gmail';
export type AppRole = 'admin' | 'user';

export const permissionOptions: Array<{ id: MenuPermission; label: string; description: string }> = [
  { id: 'dashboard', label: 'Resumen', description: 'Ver el resumen, métricas y filtros.' },
  { id: 'invoices', label: 'Facturas', description: 'Consultar, crear, editar, borrar y exportar facturas.' },
  { id: 'products', label: 'Productos', description: 'Consultar y mantener productos y costes.' },
  { id: 'suppliers', label: 'Proveedores', description: 'Consultar y mantener proveedores.' },
  { id: 'gmail', label: 'Gmail', description: 'Buscar, revisar e importar facturas desde Gmail.' },
];

export interface AccessProfile {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
  active: boolean;
  dataOwnerId: string;
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

export async function loadAccessProfile(userId: string): Promise<AccessProfile | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('user_id,email,full_name,role,active,data_owner_id,permissions')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    userId: data.user_id,
    email: data.email,
    fullName: data.full_name || '',
    role: data.role as AppRole,
    active: Boolean(data.active),
    dataOwnerId: data.data_owner_id,
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

export async function createManagedUser(input: { email: string; fullName: string; password: string; permissions: MenuPermission[] }) {
  validateManagedUser(input.email, input.fullName, input.password);
  return invokeAdmin<{ ok: true; userId: string }>({ action: 'create', ...input, email: normalizeEmail(input.email), fullName: input.fullName.trim() });
}

export async function updateManagedUser(input: { userId: string; email: string; fullName: string; password?: string; active: boolean; permissions: MenuPermission[] }) {
  validateManagedUser(input.email, input.fullName, input.password);
  return invokeAdmin<{ ok: true }>({ action: 'update', ...input, email: normalizeEmail(input.email), fullName: input.fullName.trim() });
}

export async function deleteManagedUser(userId: string) {
  return invokeAdmin<{ ok: true }>({ action: 'delete', userId });
}
