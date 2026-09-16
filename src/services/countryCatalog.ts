export type CountryOption={code:string;nameEs:string;nameEn:string;searchText:string};

const ISO_ALPHA2=`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/);

const fallbackEs:Record<string,string>={ES:'España',DE:'Alemania',FR:'Francia',IT:'Italia',PT:'Portugal',IE:'Irlanda',GB:'Reino Unido',US:'Estados Unidos',NL:'Países Bajos',BE:'Bélgica',AT:'Austria',PL:'Polonia',CZ:'Chequia',SE:'Suecia',DK:'Dinamarca',FI:'Finlandia',GR:'Grecia',RO:'Rumanía',BG:'Bulgaria',HR:'Croacia',HU:'Hungría',SK:'Eslovaquia',SI:'Eslovenia',LT:'Lituania',LV:'Letonia',EE:'Estonia',LU:'Luxemburgo',MT:'Malta',CY:'Chipre'};
const fallbackEn:Record<string,string>={ES:'Spain',DE:'Germany',FR:'France',IT:'Italy',PT:'Portugal',IE:'Ireland',GB:'United Kingdom',US:'United States',NL:'Netherlands',BE:'Belgium',AT:'Austria',PL:'Poland',CZ:'Czechia',SE:'Sweden'};

function displayName(code:string,locale:'es'|'en'){
  try{
    const DisplayNames=(Intl as typeof Intl & {DisplayNames?:new(locales:string[],options:{type:'region'})=>{of:(code:string)=>string|undefined}}).DisplayNames;
    const value=DisplayNames?new DisplayNames([locale],{type:'region'}).of(code):undefined;
    if(value&&value!==code)return value;
  }catch{/* fallback below */}
  return (locale==='es'?fallbackEs:fallbackEn)[code]||code;
}

const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export const COUNTRIES:CountryOption[]=ISO_ALPHA2.map(code=>{
  const nameEs=displayName(code,'es');
  const nameEn=displayName(code,'en');
  return {code,nameEs,nameEn,searchText:`${nameEs} ${nameEn} ${code}`};
}).sort((a,b)=>a.nameEs.localeCompare(b.nameEs,'es'));

export function searchCountries(query:string){
  const needle=normalize(query);
  if(!needle)return COUNTRIES;
  return COUNTRIES
    .filter(country=>normalize(country.searchText).includes(needle))
    .sort((a,b)=>{
      const aExact=a.code.toLowerCase()===needle||normalize(a.nameEs)===needle||normalize(a.nameEn)===needle;
      const bExact=b.code.toLowerCase()===needle||normalize(b.nameEs)===needle||normalize(b.nameEn)===needle;
      return Number(bExact)-Number(aExact)||a.nameEs.localeCompare(b.nameEs,'es');
    });
}

export function countryName(code:string,locale:'es'|'en'='es'){
  const normalized=code.trim().toUpperCase();
  const country=COUNTRIES.find(item=>item.code===normalized);
  return country?(locale==='es'?country.nameEs:country.nameEn):normalized;
}
