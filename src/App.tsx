import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LoaderCircle, LockKeyhole, LogOut, Moon, Sun } from 'lucide-react';
import { Sidebar, type Page, type ThemeMode } from './components/Sidebar';
import { UploadInvoiceModal } from './components/UploadInvoiceModal';
import { ProductModal } from './components/ProductModal';
import { SupplierModal } from './components/SupplierModal';
import { AuthScreen } from './components/AuthScreen';
import { Dashboard } from './pages/Dashboard';
import { Invoices } from './pages/Invoices';
import { Products } from './pages/Products';
import { Suppliers } from './pages/Suppliers';
import { GmailPage } from './pages/Gmail';
import { AdminPage } from './pages/Admin';
import { supabase } from './services/supabase';
import { loadAccessProfile, type AccessProfile, type MenuPermission } from './services/access';
import { addSupplier, bootstrapUser, createInvoice, deleteProduct, deleteSupplier, getInvoiceFileUrl, loadAppData, updateInvoiceStatus, updateSupplier } from './services/repository';
import { addProduct, updateProduct, type ProductInput } from './services/productEditor';
import { deleteInvoiceWithGmailRecovery } from './services/invoiceLifecycle';
import type { AppData, Invoice, NewInvoiceInput, Product, Supplier } from './types';

const emptyData: AppData = { invoices: [], products: [], suppliers: [], categories: [] };
const THEME_KEY = 'zenvia-gastos-theme';
const regularPages: MenuPermission[] = ['dashboard','invoices','products','suppliers','gmail'];

type SupplierInput = {name:string;taxId?:string;email?:string;supplierType:'goods'|'service'|'both'};

function initialTheme(): ThemeMode {
  const stored=window.localStorage.getItem(THEME_KEY);
  if(stored==='dark'||stored==='light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';
}

export default function App(){
 const [session,setSession]=useState<Session|null>(null);
 const [authReady,setAuthReady]=useState(false);
 const [access,setAccess]=useState<AccessProfile|null>(null);
 const [accessReady,setAccessReady]=useState(false);
 const [data,setData]=useState<AppData>(emptyData);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [page,setPage]=useState<Page>('dashboard');
 const [upload,setUpload]=useState(false);
 const [productModal,setProductModal]=useState(false);
 const [productToEdit,setProductToEdit]=useState<Product|null>(null);
 const [supplierModal,setSupplierModal]=useState(false);
 const [supplierToEdit,setSupplierToEdit]=useState<Supplier|null>(null);
 const [theme,setTheme]=useState<ThemeMode>(initialTheme);

 const allowedPages=useMemo<Page[]>(()=>{
   if(!access?.active) return [];
   const visible=access.role==='admin'?regularPages:regularPages.filter(item=>access.permissions.includes(item));
   return access.role==='admin'?[...visible,'admin']:[...visible];
 },[access]);
 const can=(permission:MenuPermission)=>Boolean(access?.active&&(access.role==='admin'||access.permissions.includes(permission)));

 useEffect(()=>{
   document.documentElement.dataset.theme=theme;
   document.documentElement.style.colorScheme=theme;
   window.localStorage.setItem(THEME_KEY,theme);
 },[theme]);

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
   let cancelled=false;
   if(!session){setAccess(null);setAccessReady(false);setData(emptyData);return;}
   setAccessReady(false);setError('');
   loadAccessProfile(session.user.id)
     .then(profile=>{if(!cancelled){setAccess(profile);setAccessReady(true)}})
     .catch(e=>{if(!cancelled){setAccess(null);setAccessReady(true);setError(e instanceof Error?e.message:'No se pudo comprobar tu acceso.')}});
   return()=>{cancelled=true};
 },[session]);

 useEffect(()=>{
   if(!session||!access?.active){setData(emptyData);return;}
   (async()=>{try{await bootstrapUser();await refresh();}catch(e){setError(e instanceof Error?e.message:'Error al inicializar la cuenta.')}})();
 },[session,access,refresh]);

 useEffect(()=>{
   if(!accessReady||!access?.active||!allowedPages.length)return;
   if(!allowedPages.includes(page))setPage(allowedPages[0]);
 },[accessReady,access,allowedPages,page]);

 if(!authReady) return <div className="fullLoader"><LoaderCircle className="spin"/> Cargando…</div>;
 if(!session) return <AuthScreen/>;
 if(!accessReady) return <div className="fullLoader"><LoaderCircle className="spin"/> Comprobando acceso…</div>;
 if(!access||!access.active||!allowedPages.length) return <div className="authPage"><div className="authPanel accessDeniedPanel"><div className="authHeroIcon"><LockKeyhole/></div><h1>Acceso no autorizado</h1><p>{access&&!access.active?'Tu acceso a ZENVIA Gastos está desactivado.':'Esta cuenta no está autorizada para utilizar ZENVIA Gastos.'} Contacta con el administrador.</p><button className="secondary" onClick={()=>supabase.auth.signOut()}>Cerrar sesión</button></div></div>;

 const navigate=(next:Page)=>{if(allowedPages.includes(next))setPage(next)};
 const toggleTheme=()=>setTheme(current=>current==='dark'?'light':'dark');
 const saveInvoice=async(input:NewInvoiceInput)=>{if(!can('invoices')&&!can('gmail'))throw new Error('No tienes permiso para crear facturas.');await createInvoice(input);await refresh()};
 const changeStatus=async(id:string,status:'pending'|'reviewed'|'accounted')=>{if(!can('invoices'))throw new Error('No tienes permiso para modificar facturas.');await updateInvoiceStatus(id,status);await refresh()};
 const removeInvoice=async(invoice:Invoice)=>{if(!can('invoices'))throw new Error('No tienes permiso para eliminar facturas.');await deleteInvoiceWithGmailRecovery(invoice.id,invoice.filePath);await refresh()};
 const openInvoice=async(invoice:Invoice)=>{
   if(!invoice.filePath) throw new Error('Esta factura no tiene un documento asociado.');
   const url=await getInvoiceFileUrl(invoice.filePath);
   const a=document.createElement('a');
   a.href=url;a.target='_blank';a.rel='noopener noreferrer';
   document.body.appendChild(a);a.click();a.remove();
 };
 const openNewProduct=()=>{if(can('products')){setProductToEdit(null);setProductModal(true)}};
 const openEditProduct=(product:Product)=>{if(can('products')){setProductToEdit(product);setProductModal(true)}};
 const closeProductModal=()=>{setProductModal(false);setProductToEdit(null)};
 const saveProduct=async(input:ProductInput)=>{
   if(!can('products'))throw new Error('No tienes permiso para modificar productos.');
   if(productToEdit) await updateProduct(productToEdit.id,input);
   else await addProduct(input);
   await refresh();
 };
 const removeProduct=async(product:Product)=>{if(!can('products'))throw new Error('No tienes permiso para eliminar productos.');await deleteProduct(product.id);await refresh()};
 const openNewSupplier=()=>{if(can('suppliers')){setSupplierToEdit(null);setSupplierModal(true)}};
 const openEditSupplier=(supplier:Supplier)=>{if(can('suppliers')){setSupplierToEdit(supplier);setSupplierModal(true)}};
 const closeSupplierModal=()=>{setSupplierModal(false);setSupplierToEdit(null)};
 const saveSupplier=async(input:SupplierInput)=>{
   if(!can('suppliers'))throw new Error('No tienes permiso para modificar proveedores.');
   if(supplierToEdit) await updateSupplier(supplierToEdit.id,input);
   else await addSupplier(input);
   await refresh();
 };
 const removeSupplier=async(supplier:Supplier)=>{if(!can('suppliers'))throw new Error('No tienes permiso para eliminar proveedores.');await deleteSupplier(supplier.id);await refresh()};

 return <div className="app"><Sidebar page={page} onChange={navigate} onLogout={()=>supabase.auth.signOut()} theme={theme} onToggleTheme={toggleTheme} allowedPages={allowedPages} isAdmin={access.role==='admin'}/><main>
   <button className="mobileLogoutButton" onClick={()=>supabase.auth.signOut()} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={19}/></button>
   <button className="mobileThemeToggle" onClick={toggleTheme} title={theme==='dark'?'Cambiar a modo claro':'Cambiar a modo oscuro'} aria-label={theme==='dark'?'Cambiar a modo claro':'Cambiar a modo oscuro'}>{theme==='dark'?<Sun size={19}/>:<Moon size={19}/>}</button>
   {error&&<div className="globalError">{error}<button onClick={refresh}>Reintentar</button></div>}
   {loading&&<div className="syncBadge"><LoaderCircle className="spin" size={14}/> Sincronizando</div>}
   {page==='dashboard'&&can('dashboard')&&<Dashboard invoices={data.invoices} products={data.products} suppliers={data.suppliers} onUpload={can('invoices')?()=>setUpload(true):undefined} onProducts={can('products')?()=>navigate('products'):undefined}/>} 
   {page==='invoices'&&can('invoices')&&<Invoices invoices={data.invoices} suppliers={data.suppliers} onUpload={()=>setUpload(true)} onStatusChange={changeStatus} onOpenFile={openInvoice} onDelete={removeInvoice}/>} 
   {page==='products'&&can('products')&&<Products products={data.products} onAdd={openNewProduct} onEdit={openEditProduct} onDelete={removeProduct}/>} 
   {page==='suppliers'&&can('suppliers')&&<Suppliers suppliers={data.suppliers} onAdd={openNewSupplier} onEdit={openEditSupplier} onDelete={removeSupplier}/>} 
   {page==='gmail'&&can('gmail')&&<GmailPage categories={data.categories} onImported={refresh}/>} 
   {page==='admin'&&access.role==='admin'&&<AdminPage currentUserId={session.user.id}/>} 
 </main>
 {can('invoices')&&<UploadInvoiceModal open={upload} onClose={()=>setUpload(false)} onSave={saveInvoice} categories={data.categories}/>} 
 {can('products')&&<ProductModal open={productModal} product={productToEdit} onClose={closeProductModal} onSave={saveProduct}/>} 
 {can('suppliers')&&<SupplierModal open={supplierModal} supplier={supplierToEdit} onClose={closeSupplierModal} onSave={saveSupplier}/>} 
 </div>
}
