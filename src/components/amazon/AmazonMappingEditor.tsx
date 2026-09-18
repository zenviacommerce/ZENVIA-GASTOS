import { useEffect, useMemo, useState } from 'react';
import { Check, Search, Trash2 } from 'lucide-react';
import { deleteAmazonProductMapping, loadAmazonProductOptions, setAmazonProductMapping, type AmazonProductOption } from '../../services/amazon';
import { errorMessage, showError, showSuccess } from '../../services/toast';
import { confirmAction } from '../../services/actionDialog';

type Props={sellerSku:string;initialProductId?:string|null;initialFactor?:number;allowDelete?:boolean;onSaved:()=>void;onCancel?:()=>void};

export function AmazonMappingEditor({sellerSku,initialProductId=null,initialFactor=1,allowDelete=false,onSaved,onCancel}:Props){
  const [query,setQuery]=useState('');
  const [options,setOptions]=useState<AmazonProductOption[]>([]);
  const [productId,setProductId]=useState(initialProductId||'');
  const [factor,setFactor]=useState(String(initialFactor||1));
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void loadAmazonProductOptions(query).then(setOptions).catch(()=>setOptions([]));},220);
    return()=>window.clearTimeout(timer);
  },[query]);

  const selected=useMemo(()=>options.find(option=>option.id===productId)||null,[options,productId]);
  const save=async()=>{
    const numeric=Number(factor);
    if(!productId){showError('Selecciona un producto interno.');return;}
    if(!Number.isFinite(numeric)||numeric<=0){showError('El factor debe ser mayor que 0.');return;}
    setLoading(true);
    try{const result=await setAmazonProductMapping({sellerSku,productId,consumptionFactor:numeric});if(result.skuAssigned)window.dispatchEvent(new CustomEvent('zenvia:products-changed'));showSuccess(result.skuAssigned?'Producto vinculado y SKU interno asignado automáticamente.':'Producto de Amazon vinculado.');onSaved();}
    catch(error){showError(errorMessage(error,'No se pudo guardar el vínculo.'));}
    finally{setLoading(false);}
  };

  const remove=async()=>{
    const confirmed=await confirmAction({title:'Eliminar vínculo',message:`Se eliminará el vínculo de ${sellerSku}.`,confirmLabel:'Eliminar vínculo',tone:'danger'});
    if(!confirmed)return;
    setLoading(true);
    try{await deleteAmazonProductMapping(sellerSku);showSuccess('Vínculo eliminado.');onSaved();}
    catch(error){showError(errorMessage(error,'No se pudo eliminar el vínculo.'));}
    finally{setLoading(false);}
  };

  return <div className="amazonMappingEditor">
    <div className="amazonMappingPicker">
      <label><span>Producto interno</span><div className="amazonMappingSearch"><Search size={15}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por nombre o SKU"/></div></label>
      <div className="amazonMappingResults" role="listbox" aria-label="Productos internos">
        {options.slice(0,8).map(option=><button type="button" role="option" aria-selected={productId===option.id} className={productId===option.id?'isSelected':''} key={option.id} onClick={()=>setProductId(option.id)}><span><strong>{option.name}</strong><small>{option.sku||'Sin SKU'}</small></span>{productId===option.id&&<Check size={15}/>}</button>)}
        {!options.length&&<span className="amazonMappingEmpty">No hay productos que coincidan.</span>}
      </div>
      {productId&&<div className="amazonMappingSelected">Seleccionado: <strong>{selected?.name||'Producto actual'}</strong></div>}
    </div>
    <label><span>Factor de consumo</span><input type="number" min="0.000001" step="0.01" value={factor} onChange={e=>setFactor(e.target.value)}/></label>
    <div className="amazonMappingActions"><button className="primary" disabled={loading} onClick={()=>void save()}>{loading?'Guardando…':'Guardar vínculo'}</button>{allowDelete&&<button className="secondary amazonDangerLink" disabled={loading} onClick={()=>void remove()}><Trash2 size={15}/>Eliminar vínculo</button>}{onCancel&&<button className="secondary" disabled={loading} onClick={onCancel}>Cancelar</button>}</div>
  </div>;
}
