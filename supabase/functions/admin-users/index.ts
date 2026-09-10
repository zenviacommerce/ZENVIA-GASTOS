import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
const allowedPermissions = ['dashboard', 'invoices', 'products', 'suppliers', 'gmail'] as const;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

type Permission = typeof allowedPermissions[number];

function getAdminKey() {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed?.default) return parsed.default as string;
    } catch { /* legacy fallback below */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

function sanitizePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is Permission =>
    typeof item === 'string' && (allowedPermissions as readonly string[]).includes(item)
  ))];
}

function fail(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: jsonHeaders });
}

function validateIdentity(email: string, fullName: string) {
  if (!email || email.length > 254 || !emailRe.test(email)) return 'Indica un email válido, por ejemplo nombre@empresa.com.';
  if (fullName.length < 2) return 'El nombre debe tener al menos 2 caracteres.';
  if (fullName.length > 150) return 'El nombre es demasiado largo.';
  return '';
}

async function writeAudit(admin: any, caller: any, actorEmail: string | null | undefined, action: string, targetId: string, targetEmail: string, summary: string, details: Record<string, unknown> = {}) {
  const { error } = await admin.from('audit_logs').insert({
    workspace_owner_id: caller.data_owner_id,
    actor_user_id: caller.user_id,
    actor_email: actorEmail || null,
    module: 'admin',
    action,
    entity_type: 'app_user',
    entity_id: targetId,
    entity_label: targetEmail,
    summary,
    details,
  });
  if (error) console.error('No se pudo registrar la auditoría administrativa:', error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Método no permitido.', 405);

  try {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const adminKey = getAdminKey();
    if (!url || !adminKey) return fail('Configuración administrativa no disponible.', 500);

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return fail('Sesión no válida.', 401);

    const admin = createClient(url, adminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return fail('Sesión no válida.', 401);

    const callerId = userData.user.id;
    const { data: caller, error: callerError } = await admin
      .from('app_users')
      .select('user_id, data_owner_id, role, active')
      .eq('user_id', callerId)
      .maybeSingle();
    if (callerError) throw callerError;
    if (!caller?.active || caller.role !== 'admin') return fail('Solo un administrador puede gestionar usuarios.', 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'list');

    if (action === 'list') {
      const { data: rows, error } = await admin
        .from('app_users')
        .select('user_id,email,full_name,role,active,permissions,created_at,updated_at')
        .eq('data_owner_id', caller.data_owner_id)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const authById = new Map((authUsers?.users || []).map(u => [u.id, u]));
      return new Response(JSON.stringify({
        users: (rows || []).map(row => ({
          userId: row.user_id,
          email: row.email,
          fullName: row.full_name || '',
          role: row.role,
          active: row.active,
          permissions: row.role === 'admin' ? [...allowedPermissions] : (row.permissions || []),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastSignInAt: authById.get(row.user_id)?.last_sign_in_at || null,
        })),
      }), { headers: jsonHeaders });
    }

    if (action === 'create') {
      const email = String(body?.email || '').trim().toLowerCase();
      const fullName = String(body?.fullName || '').trim();
      const password = String(body?.password || '');
      const permissions = sanitizePermissions(body?.permissions);
      const identityError = validateIdentity(email, fullName);
      if (identityError) return fail(identityError);
      if (password.length < 8) return fail('La contraseña debe tener al menos 8 caracteres.');
      if (!permissions.length) return fail('Selecciona al menos un permiso.');

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { zenvia_managed: true },
      });
      if (createError || !created.user) return fail(createError?.message || 'No se pudo crear el usuario.');

      const { error: profileError } = await admin.from('app_users').insert({
        user_id: created.user.id,
        email,
        full_name: fullName || null,
        role: 'user',
        active: true,
        data_owner_id: caller.data_owner_id,
        permissions,
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
        throw profileError;
      }
      await writeAudit(admin, caller, userData.user.email, 'create_user', created.user.id, email, `Creó el usuario ${email}`, { full_name: fullName, permissions, active: true });
      return new Response(JSON.stringify({ ok: true, userId: created.user.id }), { headers: jsonHeaders });
    }

    const targetId = String(body?.userId || '');
    if (!targetId) return fail('Falta el usuario.');
    const { data: target, error: targetError } = await admin
      .from('app_users')
      .select('user_id,email,full_name,role,active,permissions,data_owner_id')
      .eq('user_id', targetId)
      .eq('data_owner_id', caller.data_owner_id)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return fail('Usuario no encontrado.', 404);

    if (action === 'update') {
      const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : target.full_name || '';
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : target.email;
      const password = typeof body?.password === 'string' ? body.password : '';
      const isAdmin = target.role === 'admin';
      const permissions = isAdmin ? [...allowedPermissions] : sanitizePermissions(body?.permissions ?? target.permissions);
      const active = isAdmin ? true : (typeof body?.active === 'boolean' ? body.active : target.active);
      const identityError = validateIdentity(email, fullName);
      if (identityError) return fail(identityError);
      if (!isAdmin && !permissions.length) return fail('Selecciona al menos un permiso.');
      if (password && password.length < 8) return fail('La nueva contraseña debe tener al menos 8 caracteres.');

      const authUpdate: Record<string, unknown> = {
        email,
        user_metadata: { full_name: fullName },
      };
      if (password) authUpdate.password = password;
      const { error: authError } = await admin.auth.admin.updateUserById(targetId, authUpdate);
      if (authError) return fail(authError.message);

      const { error: profileError } = await admin.from('app_users').update({
        email,
        full_name: fullName || null,
        active,
        permissions,
        updated_at: new Date().toISOString(),
      }).eq('user_id', targetId);
      if (profileError) throw profileError;

      const auditAction = target.active !== active ? (active ? 'activate_user' : 'deactivate_user') : 'update_user';
      const summary = target.active !== active ? `${active ? 'Activó' : 'Desactivó'} el usuario ${email}` : `Modificó el usuario ${email}`;
      await writeAudit(admin, caller, userData.user.email, auditAction, targetId, email, summary, {
        previous_email: target.email,
        email,
        previous_full_name: target.full_name,
        full_name: fullName,
        previous_active: target.active,
        active,
        previous_permissions: target.permissions,
        permissions,
        password_changed: Boolean(password),
      });
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    if (action === 'delete') {
      if (target.role === 'admin' || targetId === callerId) return fail('El administrador principal no se puede eliminar.');
      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) return fail(error.message);
      await writeAudit(admin, caller, userData.user.email, 'delete_user', targetId, target.email, `Eliminó el usuario ${target.email}`, { full_name: target.full_name, permissions: target.permissions, active: target.active });
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    return fail('Acción no válida.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String((error as any)?.message || 'Error interno.');
    return fail(message, 500);
  }
});
