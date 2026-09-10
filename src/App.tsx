import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LoaderCircle } from 'lucide-react';
import { Sidebar, type Page } from './components/Sidebar';
import { UploadInvoiceModal } from './components/UploadInvoiceModal';
import { ProductModal } from './components/ProductModal';
import { SupplierModal } from './components/SupplierModal';
import { AuthScreen } from './components/AuthScreen';
import { Dashboard } from './pages/Dashboard';
import { Invoices } from './pages/Invoices';
import { Products } from './pages/Products';
import { Suppliers } from './pages/Suppliers';
import { GmailPage } from './pages/Gmail';
import { supabase } from './services/supabase';
import { addProduct, addSupplier, bootstrapUser, createInvoice, loadAppData, updateInvoiceStatus } from './services/repository';
import type { AppData, NewInvoiceInput } from './types';

const emptyData: AppData = { invoices: [], products: [], suppliers: [], categories: [] };

export default function App(){
 const [session,setSession]=useState<Session|null>(null);
 const [authReady,setAuthReady]=useState(false);
 const [data,setData]=useState<AppData>(emptyData);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [page,setPage]=useState<Page>('dashboard');
 const [upload,setUpload]=useState(false);
 const [productModal,setProductModal]=useState(false);
 const [supplierModal,setSupplierModal]=useState(false);

 const refresh=useCallback(async()=>{
   setLoading(true); setError('');
   try { setData(await loadAppData()); }
   catch(e){ setError(e instanceof Error?e.message:'No se pudieron cargar los datos.'); }
   finally{ setLoading(false); }
 },[]);

 useEffect(()=>{
   supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthReady(true)});
   const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);setAuthReady(true)});
   return ()=>subscription.unsubscribe();
 },[]);

 useEffect(()=>{
   if(!session){setData(emptyData);return;}
   (async()=>{try{await bootstrapUser();await refresh();}catch(e){setError(e instanceof Error?e.message:'Error al inicializar la cuenta.')}})();
 },[session,refresh]);

 if(!authReady) return <div className="fullLoader"><LoaderCircle className="spin"/> Cargando…</div>;
 if(!session) return <AuthScreen/>;

 const saveInvoice=async(input:NewInvoiceInput)=>{await createInvoice(input);await refresh()};
 const changeStatus=async(id:string,status:'pending'|'reviewed'|'accounted')=>{await updateInvoiceStatus(id,status);await refresh()};
 const saveProduct=async(input:{name:string;sku?:string;category?:string;unit:string})=>{await addProduct(input);await refresh()};
 const saveSupplier=async(input:{name:string;taxId?:string;email?:string;supplierType:'goods'|'service'|'both'})=>{await addSupplier(input);await refresh()};

 return <div className="app"><Sidebar page={page} onChange={setPage} onLogout={()=>supabase.auth.signOut()}/><main>
   {error&&<div className="globalError">{error}<button onClick={refresh}>Reintentar</button></div>}
   {loading&&<div className="syncBadge"><LoaderCircle className="spin" size={14}/> Sincronizando</div>}
   {page==='dashboard'&&<Dashboard invoices={data.invoices} products={data.products} onUpload={()=>setUpload(true)} onProducts={()=>setPage('products')}/>} 
   {page==='invoices'&&<Invoices invoices={data.invoices} onUpload={()=>setUpload(true)} onStatusChange={changeStatus}/>} 
   {page==='products'&&<Products products={data.products} onAdd={()=>setProductModal(true)}/>} 
   {page==='suppliers'&&<Suppliers suppliers={data.suppliers} onAdd={()=>setSupplierModal(true)}/>} 
   {page==='gmail'&&<GmailPage/>}
 </main>
 <UploadInvoiceModal open={upload} onClose={()=>setUpload(false)} onSave={saveInvoice} categories={data.categories}/>
 <ProductModal open={productModal} onClose={()=>setProductModal(false)} onSave={saveProduct}/>
 <SupplierModal open={supplierModal} onClose={()=>setSupplierModal(false)} onSave={saveSupplier}/>
 </div>
}
