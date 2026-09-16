export type PostalPlace={city:string;region:string;countryCode:string;postalCode:string};

type ZippopotamPlace={'place name'?:string;state?:string;'state abbreviation'?:string};
type ZippopotamResponse={places?:ZippopotamPlace[]};

const postalCache=new Map<string,PostalPlace[]>();

const SPANISH_PROVINCES:Record<string,string>={
  '01':'Álava','02':'Albacete','03':'Alicante','04':'Almería','05':'Ávila','06':'Badajoz','07':'Illes Balears','08':'Barcelona','09':'Burgos','10':'Cáceres',
  '11':'Cádiz','12':'Castellón','13':'Ciudad Real','14':'Córdoba','15':'A Coruña','16':'Cuenca','17':'Girona','18':'Granada','19':'Guadalajara','20':'Gipuzkoa',
  '21':'Huelva','22':'Huesca','23':'Jaén','24':'León','25':'Lleida','26':'La Rioja','27':'Lugo','28':'Madrid','29':'Málaga','30':'Murcia',
  '31':'Navarra','32':'Ourense','33':'Asturias','34':'Palencia','35':'Las Palmas','36':'Pontevedra','37':'Salamanca','38':'Santa Cruz de Tenerife','39':'Cantabria','40':'Segovia',
  '41':'Sevilla','42':'Soria','43':'Tarragona','44':'Teruel','45':'Toledo','46':'Valencia','47':'Valladolid','48':'Bizkaia','49':'Zamora','50':'Zaragoza','51':'Ceuta','52':'Melilla',
};

export function postalLookupKey(country:string,postal:string){
  return `${country.trim().toUpperCase()}|${postal.trim().replace(/\s+/g,' ')}`;
}

export function postalRegion(countryCode:string,postalCode:string,fallback:string){
  if(countryCode==='ES')return SPANISH_PROVINCES[postalCode.slice(0,2)]||fallback;
  return fallback;
}

export async function lookupPostalCode(country:string,postal:string,signal?:AbortSignal):Promise<PostalPlace[]>{
  const [countryCode,postalCode]=postalLookupKey(country,postal).split('|');
  if(!countryCode||countryCode.length!==2||!postalCode)return [];
  const key=`${countryCode}|${postalCode}`;
  const cached=postalCache.get(key);
  if(cached)return cached.map(place=>({...place}));

  const response=await fetch(`https://api.zippopotam.us/${encodeURIComponent(countryCode)}/${encodeURIComponent(postalCode)}`,{signal});
  if(response.status===404){postalCache.set(key,[]);return []}
  if(!response.ok)throw new Error('No se pudo consultar el código postal.');

  const payload=await response.json() as ZippopotamResponse;
  const seen=new Set<string>();
  const result:PostalPlace[]=[];
  for(const place of payload.places??[]){
    const city=String(place['place name']||'').trim();
    const fallbackRegion=String(place.state||place['state abbreviation']||'').trim();
    const region=postalRegion(countryCode,postalCode,fallbackRegion);
    if(!city)continue;
    const identity=`${city.toLocaleLowerCase()}|${region.toLocaleLowerCase()}`;
    if(seen.has(identity))continue;
    seen.add(identity);
    result.push({city,region,countryCode,postalCode});
  }
  postalCache.set(key,result);
  return result.map(place=>({...place}));
}
