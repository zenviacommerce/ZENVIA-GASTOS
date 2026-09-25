import { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { deleteAmazonProductMappingItem, loadAmazonProductMappings, loadAmazonProductOptions, setAmazonProductMapping, type AmazonProductMapping, type AmazonProductOption } from '../../services/amazon';
import { errorMessage, showError, showSuccess } from '../../services/toast';
import { confirmAction } from '../../services/actionDialog';

type Props={sellerSku:string;defaultFactor?:number;onChanged:()=>void;onCancel?:()=>void};

export function AmazonMappingEditor({sellerSku,defaultFactor=1,onChanged,onCancel}:Props){
  const [query,setQuery]=useState('');
  const [options,setOptions]=useState<AmazonProductOption[]>([]);
  const [mappings,setMappings]=useState<AmazonProductMapping[]>([]);
  const [productId,setProductId]=useState('');
  const [factor,setFactor]=useState(String(defaultFactor||1));
  const [loading,setLoading]=useState(false);
  const [loadingMappings,setLoadingMappings]=useState(true);

  const refreshMappings=async()=>{
    setLoadingMappings(true);
    try{setMappings(await loadAmazonProductMappings(sellerSku));}
    catch(error){showError(errorMessage(error,'No se pudieron cargar los vínculos actuales.'));}
    finally{setLoadingMappings(false);}
  };

  useEffect(()=>{void refreshMappings();},[sellerSku]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{void loadAmazonProductOptions(query).then(setOptions).catch(()=>setOptions([]));},220);
    return()=>window.clearTimeout(timer);
  },[query]);

  const selected=useMemo(()=>options.find(option=>option.id===productId)||mappings.find(mapping=>mapping.productId===productId)||null,[options,mappings,productId]);
  const editingMapping=useMemo(()=>mappings.find(mapping=>mapping.productId===productId)||null,[mappings,productId]);
  const selectedName=selected?('name' in selected?selected.name:selected.productName):'';
  const selectedSupplier=selected?.supplierName||null;

  const choose=(option:AmazonProductOption)=>{
    setProductId(option.id);
    const current=mappings.find(mapping=>mapping.productId===option.id);
    setFactor(String(current?.consumptionFactor||defaultFactor||1));
  };

  const edit=(mapping:AmazonProductMapping)=>{
    setProductId(mapping.productId);
    setFactor(String(mapping.consumptionFactor||1));
    setQuery(mapping.productName);
  };

  const save=async()=>{
    const numeric=Number(factor);
    if(!productId){showError('Selecciona un producto interno.');return;}
    if(!Number.isFinite(numeric)||numeric<=0){showError('El factor debe ser mayor que 0.');return;}
    setLoading(true);
    try{
      const result=await setAmazonProductMapping({sellerSku,productId,consumptionFactor:numeric});
      if(result.skuAssigned)window.dispatchEvent(new CustomEvent('zenvia:products-changed'));
      showSuccess(editingMapping?'Vínculo actualizado.':result.skuAssigned?'Producto añadido y SKU interno asignado automáticamente.':'Producto añadido al coste de Amazon.');
      await refreshMappings();
      setProductId('');setQuery('');setFactor(String(defaultFactor||1));
      onChanged();
    }catch(error){showError(errorMessage(error,'No se pudo guardar el vínculo.'));}
    finally{setLoading(false);}
  };

  const remove=async(mapping:AmazonProductMapping)=>{
    const confirmed=await confirmAction({title:'Eliminar componente',message:`Se quitará “${mapping.productName}” del coste de ${sellerSku}.`,confirmLabel:'Eliminar componente',tone:'danger'});
    if(!confirmed)return;
    setLoading(true);
    try{
      await deleteAmazonProductMappingItem(sellerSku,mapping.productId);
      showSuccess('Componente eliminado del vínculo.');
      if(productId===mapping.productId){setProductId('');setQuery('');setFactor(String(defaultFactor||1));}
      await refreshMappings();
      onChanged();
    }catch(error){showError(errorMessage(error,'No se pudo eliminar el componente.'));}
    finally{setLoading(false);}
  };

  return <div className="amazonMappingEditor">
    <section className="amazonMappingCurrent">
      <div className="amazonMappingCurrentHead"><div><span className="amazonSectionLabel">COSTE DEL SKU</span><strong>Productos vinculados</strong></div><span className="amazonCountBadge">{mappings.length}</span></div>
      <p className="amazonMappingHint">El coste de Amazon suma todos los componentes vinculados multiplicados por su factor de consumo.</p>
      <div className="amazonMappingCurrentList">
        {mappings.map(mapping=><div className="amazonMappingCurrentRow" key={mapping.id||mapping.productId}>
          <div><strong>{mapping.productName}</strong><small>{mapping.productSku||'Sin SKU'} · {mapping.supplierName?`Proveedor: ${mapping.supplierName}`:'Sin proveedor'} · Factor ×{mapping.consumptionFactor}</small></div>
          <div className="amazonMappingRowActions"><button type="button" className="amazonInlineAction" disabled={loading} onClick={()=>edit(mapping)}><Pencil size={13}/>Editar</button><button type="button" className="amazonIconDanger" disabled={loading} onClick={()=>void remove(mapping)} aria-label={`Eliminar ${mapping.productName}`}><Trash2 size={14}/></button></div>
        </div>)}
        {!mappings.length&&!loadingMappings&&<span className="amazonMappingEmpty">Todavía no hay productos internos vinculados.</span>}
        {loadingMappings&&<span className="amazonMappingEmpty">Cargando vínculos…</span>}
      </div>
    </section>

    <section className="amazonMappingAdd">
      <div className="amazonMappingPicker">
        <label><span>{editingMapping?'Producto a actualizar':'Añadir producto interno'}</span><div className="amazonMappingSearch"><Search size={15}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por nombre o SKU"/></div></label>
        <div className="amazonMappingResults" role="listbox" aria-label="Productos internos">
          {options.slice(0,8).map(option=><button type="button" role="option" aria-selected={productId===option.id} className={productId===option.id?'isSelected':''} key={option.id} onClick={()=>choose(option)}><span><strong>{option.name}</strong><small>{option.sku||'Sin SKU'} · {option.supplierName?`Proveedor: ${option.supplierName}`:'Sin proveedor'}</small></span>{productId===option.id&&<Check size={15}/>}</button>)}
          {!options.length&&<span className="amazonMappingEmpty">No hay productos que coincidan.</span>}
        </div>
        {productId&&<div className="amazonMappingSelected">Seleccionado: <strong>{selectedName||'Producto actual'}</strong>{selectedSupplier?<span> · {selectedSupplier}</span>:null}</div>}
      </div>
      <label><span>Factor de consumo</span><input type="number" min="0.000001" step="0.01" value={factor} onChange={e=>setFactor(e.target.value)}/></label>
      <div className="amazonMappingActions"><button className="primary" disabled={loading||!productId} onClick={()=>void save()}>{loading?'Guardando…':editingMapping?'Actualizar vínculo':<><Plus size={15}/>Añadir producto</>}</button>{onCancel&&<button className="secondary" disabled={loading} onClick={onCancel}>Cerrar</button>}</div>
    </section>
  </div>;
}
