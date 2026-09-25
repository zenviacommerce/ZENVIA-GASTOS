import { createClient } from '@supabase/supabase-js';

const url=import.meta.env.VITE_SUPABASE_URL||'https://ucokhtztxozxcikrmidv.supabase.co';
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_7KW1QyBGfFKB1FLaelFfAQ_DO8yGju0';

export const supabase=createClient(url,key,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},
});
