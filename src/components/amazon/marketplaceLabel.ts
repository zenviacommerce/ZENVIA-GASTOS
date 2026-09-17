import type { AmazonMarketplaceStatus } from '../../services/amazon';

const countryNames:Record<string,string>={
  BE:'Bélgica',
  DE:'Alemania',
  ES:'España',
  FR:'Francia',
  IE:'Irlanda',
  IT:'Italia',
  NL:'Países Bajos',
  PL:'Polonia',
  SE:'Suecia',
};

export function formatAmazonMarketplace(marketplaceId:string,marketplaces:AmazonMarketplaceStatus[]){
  const marketplace=marketplaces.find(item=>item.id===marketplaceId);
  if(!marketplace)return marketplaceId;
  const code=marketplace.countryCode?.toUpperCase()||marketplaceId;
  const country=countryNames[code];
  if(country)return `${code} · ${country}`;
  return marketplace.name?`${code} · ${marketplace.name}`:code;
}
