import { BarChart3, ExternalLink, Store } from 'lucide-react';
import '../amazon.css';

const SELLER_CENTRAL_URL='https://sellercentral.amazon.es/';
const SELLERBOARD_URL='https://app.sellerboard.com/';

export function AmazonPage(){
  return <div className="page amazonPage">
    <div className="pageHead amazonPageHead">
      <div>
        <div className="eyebrow">AMAZON</div>
        <h1>Amazon Analytics</h1>
        <p>Rentabilidad, publicidad, inventario y rendimiento por marketplace.</p>
      </div>
      <div className="actions amazonExternalLinks">
        <a className="secondary" href={SELLER_CENTRAL_URL} target="_blank" rel="noopener noreferrer"><Store size={16}/> Seller Central <ExternalLink size={14}/></a>
        <a className="secondary" href={SELLERBOARD_URL} target="_blank" rel="noopener noreferrer"><BarChart3 size={16}/> Sellerboard <ExternalLink size={14}/></a>
      </div>
    </div>
    <section className="card amazonConnectionPlaceholder">
      <div className="amazonConnectionIcon"><Store/></div>
      <div><h3>Conexión Amazon pendiente</h3><p>La siguiente fase conectará SP-API y preparará la sincronización desde el 01/01/2026.</p></div>
    </section>
  </div>;
}
