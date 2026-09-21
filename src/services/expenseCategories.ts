import { supabase } from './supabase';
import type { ExpenseCategory } from '../types';

export async function loadExpenseCategories():Promise<ExpenseCategory[]>{
  const {data,error}=await supabase
    .from('expense_categories')
    .select('id,name,icon')
    .eq('active',true)
    .order('sort_order');
  if(error)throw error;
  return (data??[]).map((row:any)=>({id:row.id,name:row.name,icon:row.icon}));
}
