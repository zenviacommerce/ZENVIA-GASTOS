import { useEffect } from 'react';
import { ImageOff, Link2, X } from 'lucide-react';
import { AmazonMappingEditor } from './AmazonMappingEditor';

type Props={
  sellerSku:string;
  asin?:string|null;
  imageUrl?:string|null;
  initialProductId?:string|null;
  initialFactor?:number;
  allowDelete?:boolean;
  onSaved:()=>void;
  onClose:()=>void;
};

export function AmazonMappingModal({sellerSku,asin,imageUrl,initialProductId=null,initialFactor=1,allowDelete=false,onSaved,onClose}:Props){
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[onClose]);

  return <div className="amazonMappingModalBackdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="amazonMappingModal" role="dialog" aria-modal="true" aria-label={allowDelete?'Cambiar vínculo Amazon':'Vincular producto Amazon'}>
      <header className="amazonMappingModalHead">
        <div className="amazonMappingModalIdentity">
          {imageUrl?<img className="amazonMappingModalThumb" src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="amazonMappingModalThumb amazonProductThumbPlaceholder"><ImageOff size={21}/></span>}
          <div><span className="amazonSectionLabel">{allowDelete?'CAMBIAR VÍNCULO':'VINCULAR PRODUCTO'}</span><strong><Link2 size={16}/>{sellerSku}</strong><small>{asin||'ASIN no disponible'}</small></div>
        </div>
        <button className="amazonMappingModalClose" type="button" onClick={onClose} aria-label="Cerrar"><X size={19}/></button>
      </header>
      <div className="amazonMappingModalBody">
        <AmazonMappingEditor sellerSku={sellerSku} initialProductId={initialProductId} initialFactor={initialFactor} allowDelete={allowDelete} onSaved={onSaved} onCancel={onClose}/>
      </div>
    </section>
  </div>;
}
