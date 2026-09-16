import { useEffect, useMemo, useRef, useState } from 'react';
import { lookupPostalCode, postalLookupKey, type PostalPlace } from '../../services/postalLookup';
import { CountryPicker } from './CountryPicker';
import { SearchableSelect } from './SearchableSelect';

export const LOOKUP_DEBOUNCE_MS=450;

type Props={
  countryCode:string;
  postalCode:string;
  city:string;
  province:string;
  onCountryCodeChange:(value:string)=>void;
  onPostalCodeChange:(value:string)=>void;
  onCityChange:(value:string)=>void;
  onProvinceChange:(value:string)=>void;
  requiredPostalCode?:boolean;
  requiredCity?:boolean;
};

export function PostalAddressFields({countryCode,postalCode,city,province,onCountryCodeChange,onPostalCodeChange,onCityChange,onProvinceChange,requiredPostalCode=false,requiredCity=false}:Props){
  const [places,setPlaces]=useState<PostalPlace[]>([]);
  const [placeValue,setPlaceValue]=useState('');
  const [lookupState,setLookupState]=useState<'idle'|'loading'|'empty'|'error'>('idle');
  const [cityManual,setCityManual]=useState(false);
  const [provinceManual,setProvinceManual]=useState(false);
  const cityManualRef=useRef(false);
  const provinceManualRef=useRef(false);
  const currentQueryRef=useRef('');
  const previousQueryRef=useRef('');

  useEffect(()=>{
    const queryKey=postalLookupKey(countryCode,postalCode);
    currentQueryRef.current=queryKey;
    if(previousQueryRef.current!==queryKey){
      previousQueryRef.current=queryKey;
      cityManualRef.current=false;provinceManualRef.current=false;
      setCityManual(false);setProvinceManual(false);
      setPlaces([]);setPlaceValue('');
    }
    const normalizedCountry=countryCode.trim().toUpperCase();
    const normalizedPostal=postalCode.trim();
    if(normalizedCountry.length!==2||normalizedPostal.length<2){setLookupState('idle');return;}

    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setLookupState('loading');
      try{
        const result=await lookupPostalCode(normalizedCountry,normalizedPostal,controller.signal);
        if(controller.signal.aborted||currentQueryRef.current!==queryKey)return;
        setPlaces(result);
        if(result.length===0){setLookupState('empty');return;}
        setLookupState('idle');
        if(result.length===1){
          const place=result[0];
          if(!cityManualRef.current)onCityChange(place.city);
          if(!provinceManualRef.current&&place.region)onProvinceChange(place.region);
          setPlaceValue(`${place.city}|${place.region}`);
        }
      }catch(error){
        if(controller.signal.aborted||currentQueryRef.current!==queryKey)return;
        setLookupState('error');
      }
    },LOOKUP_DEBOUNCE_MS);
    return()=>{window.clearTimeout(timer);controller.abort()};
  },[countryCode,postalCode,onCityChange,onProvinceChange]);

  const placeOptions=useMemo(()=>places.map(place=>({
    value:`${place.city}|${place.region}`,
    label:place.city,
    description:place.region||undefined,
    searchText:`${place.city} ${place.region}`,
  })),[places]);

  const choosePlace=(value:string)=>{
    setPlaceValue(value);
    const place=places.find(item=>`${item.city}|${item.region}`===value);
    if(!place)return;
    cityManualRef.current=false;provinceManualRef.current=false;
    setCityManual(false);setProvinceManual(false);
    onCityChange(place.city);onProvinceChange(place.region);
  };
  const changeCountry=(value:string)=>{onCountryCodeChange(value);};
  const changePostal=(value:string)=>{onPostalCodeChange(value);};
  const changeCity=(value:string)=>{cityManualRef.current=true;setCityManual(true);onCityChange(value);};
  const changeProvince=(value:string)=>{provinceManualRef.current=true;setProvinceManual(true);onProvinceChange(value);};

  return <>
    <label>País<CountryPicker value={countryCode} onChange={changeCountry}/></label>
    <label>Código postal{requiredPostalCode?' *':''}<input value={postalCode} onChange={e=>changePostal(e.target.value)} autoComplete="postal-code"/></label>
    {places.length>1&&<label className="formSpan2">Poblaciones encontradas<SearchableSelect value={placeValue} options={placeOptions} onChange={choosePlace} placeholder="Selecciona población…" searchPlaceholder="Buscar población…" ariaLabel="Poblaciones del código postal"/></label>}
    <label>Población{requiredCity?' *':''}<input value={city} onChange={e=>changeCity(e.target.value)} autoComplete="address-level2" data-manual={cityManual?'true':'false'}/></label>
    <label>Provincia / región<input value={province} onChange={e=>changeProvince(e.target.value)} autoComplete="address-level1" data-manual={provinceManual?'true':'false'}/></label>
    {lookupState==='loading'&&<div className="formSpan2 fieldHint">Buscando población por código postal…</div>}
    {(lookupState==='empty'||lookupState==='error')&&<div className="formSpan2 fieldHint">No encontramos el CP; completa población y provincia manualmente.</div>}
  </>;
}
