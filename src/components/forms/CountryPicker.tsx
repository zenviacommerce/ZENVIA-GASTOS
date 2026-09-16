import { COUNTRIES } from '../../services/countryCatalog';
import { SearchableSelect } from './SearchableSelect';

type Props={value:string;onChange:(code:string)=>void;disabled?:boolean;ariaLabel?:string};

export function CountryPicker({value,onChange,disabled=false,ariaLabel='País'}:Props){
  const options=COUNTRIES.map(option=>({
    value:option.code,
    label:option.nameEs,
    searchText:`${option.nameEs} ${option.nameEn} ${option.code}`,
    description:option.code,
  }));
  return <SearchableSelect value={value.toUpperCase()} options={options} onChange={onChange} disabled={disabled} placeholder="Selecciona país…" searchPlaceholder="Buscar país…" ariaLabel={ariaLabel}/>;
}
