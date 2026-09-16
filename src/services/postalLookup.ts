export type PostalPlace={city:string;region:string;countryCode:string;postalCode:string};

type ZippopotamPlace={'place name'?:string;state?:string;'state abbreviation'?:string};
type ZippopotamResponse={places?:ZippopotamPlace[]};

const postalCache=new Map<string,PostalPlace[]>();

export function postalLookupKey(country:string,postal:string){
  return `${country.trim().toUpperCase()}|${postal.trim().replace(/\s+/g,' ')}`;
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
    const region=String(place.state||place['state abbreviation']||'').trim();
    if(!city)continue;
    const identity=`${city.toLocaleLowerCase()}|${region.toLocaleLowerCase()}`;
    if(seen.has(identity))continue;
    seen.add(identity);
    result.push({city,region,countryCode,postalCode});
  }
  postalCache.set(key,result);
  return result.map(place=>({...place}));
}
