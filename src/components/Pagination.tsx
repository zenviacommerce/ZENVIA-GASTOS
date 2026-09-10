import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({page,totalItems,pageSize,onPageChange}:{page:number;totalItems:number;pageSize:number;onPageChange:(page:number)=>void}) {
  if (!totalItems) return null;
  const totalPages=Math.max(1,Math.ceil(totalItems/pageSize));
  const safePage=Math.min(Math.max(1,page),totalPages);
  const from=(safePage-1)*pageSize+1;
  const to=Math.min(safePage*pageSize,totalItems);
  return <div className="listPagination">
    <span>Mostrando <strong>{from}-{to}</strong> de <strong>{totalItems}</strong></span>
    <div>
      <button className="secondary" disabled={safePage<=1} onClick={()=>onPageChange(safePage-1)}><ChevronLeft size={15}/> Anterior</button>
      <span>Página {safePage} de {totalPages}</span>
      <button className="secondary" disabled={safePage>=totalPages} onClick={()=>onPageChange(safePage+1)}>Siguiente <ChevronRight size={15}/></button>
    </div>
  </div>;
}
