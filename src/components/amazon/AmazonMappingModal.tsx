import { useEffect, useState } from 'react';
import { ImageOff, Link2, X } from 'lucide-react';
import { AmazonMappingEditor } from './AmazonMappingEditor';
import { loadAmazonProductMetadata } from '../../services/amazon';

type Props={
  sellerSku:string;
  asin?:string|null;
  imageUrl?:string|null;
  productName?:string|null;
  initialFactor?:number;
  onChanged:()=>void;
  onClose:()=>void;
};

export function AmazonMappingModal({sellerSku,asin,imageUrl,productName,initialFactor=1,onChanged,onClose}:Props){
  const [resolvedName,setResolvedName]=useState(productName||null);
  const [resolvedImage,setResolvedImage]=useState(imageUrl||null);

  useEffect(()=>{
    setResolvedName(productName||null);
    setResolvedImage(imageUrl||null);
    if(!asin||(productName&&imageUrl))return;
    let active=true;
    void loadAmazonProductMetadata([asin]).then(metadata=>{
      if(!active)return;
      const product=metadata[asin];
      if(!product)return;
      if(!productName&&product.productName)setResolvedName(product.productName);
      if(!imageUrl&&product.imageUrl)setResolvedImage(product.imageUrl);
    }).catch(()=>undefined);
    return()=>{active=false};
  },[asin,productName,imageUrl]);

  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[onClose]);

  return <div className="amazonMappingModalBackdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="amazonMappingModal" role="dialog" aria-modal="true" aria-label="Gestionar productos vinculados de Amazon">
      <header className="amazonMappingModalHead">
        <div className="amazonMappingModalIdentity">
          {resolvedImage?<img className="amazonMappingModalThumb" src={resolvedImage} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="amazonMappingModalThumb amazonProductThumbPlaceholder"><ImageOff size={21}/></span>}
          <div><span className="amazonSectionLabel">VINCULAR PRODUCTOS</span><strong><Link2 size={16}/>{resolvedName||sellerSku}</strong><small>{sellerSku} · {asin||'ASIN no disponible'}</small></div>
        </div>
        <button className="amazonMappingModalClose" type="button" onClick={onClose} aria-label="Cerrar"><X size={19}/></button>
      </header>
      <div className="amazonMappingModalBody">
        <AmazonMappingEditor sellerSku={sellerSku} defaultFactor={initialFactor} onChanged={onChanged} onCancel={onClose}/>
      </div>
    </section>
  </div>;
}
