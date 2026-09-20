create index if not exists user_preferences_owner_idx
  on public.user_preferences(owner_id,user_id);
