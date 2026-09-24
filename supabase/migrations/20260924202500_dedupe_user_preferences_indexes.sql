-- Keep one covering index for the user_preferences.owner_id foreign key.
-- (owner_id,user_id) also supports workspace-scoped preference lookups.

drop index if exists public.user_preferences_owner_id_idx;
