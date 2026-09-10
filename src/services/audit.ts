import { supabase } from './supabase';

export interface AuditEntry {
  id: number;
  actorUserId?: string | null;
  actorEmail?: string | null;
  module: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export async function listAuditLogs(limit = 500): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id,actor_user_id,actor_email,module,action,entity_type,entity_id,entity_label,summary,details,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: Number(row.id),
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    module: row.module,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    summary: row.summary,
    details: row.details ?? {},
    createdAt: row.created_at,
  }));
}
