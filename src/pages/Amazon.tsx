import { ExternalLink, Link2, Megaphone, ShoppingBag, Store } from 'lucide-react';

const externalLinks = [
  { label: 'Seller Central', href: 'https://sellercentral.amazon.es/', Icon: ShoppingBag },
  { label: 'Sellerboard', href: 'https://sellerboard.com/', Icon: Megaphone },
] as const;

export function AmazonPage({ isAdmin }: { isAdmin: boolean }) {
  return <div className="page amazonPage">
    <header className="pageHead amazonPageHead">
      <div>
        <div className="eyebrow">AMAZON ANALYTICS</div>
        <h1>Amazon</h1>
        <p>Ventas, costes y rentabilidad de los marketplaces europeos en un único lugar.</p>
      </div>
      <div className="actions amazonExternalLinks">
        {externalLinks.map(({ label, href, Icon }) => <a
          key={label}
          className="secondary amazonExternalLink"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon size={17}/><span>{label}</span><ExternalLink size={14}/>
        </a>)}
      </div>
    </header>

    <section className="card amazonConnectionCard" aria-labelledby="amazon-connection-title">
      <div className="amazonConnectionIcon"><Link2 size={23}/></div>
      <div className="amazonConnectionBody">
        <span className="amazonSectionLabel">Estado de conexión</span>
        <div className="amazonStatusRow" id="amazon-connection-title">
          <span className="amazonStatusDot" aria-hidden="true"/>
          <strong>Pendiente de configurar</strong>
        </div>
        <p>{isAdmin
          ? 'La conexión segura con Amazon SP-API y Amazon Ads se configurará en el backend en la siguiente fase. Las credenciales nunca se mostrarán ni almacenarán en el navegador.'
          : 'Amazon Analytics todavía no está conectado. El administrador está preparando la conexión segura con Amazon.'}</p>
      </div>
    </section>

    <div className="amazonPreviewGrid" aria-label="Fuentes previstas para Amazon Analytics">
      <article className="card amazonPreviewCard">
        <div className="amazonPreviewIcon"><ShoppingBag size={20}/></div>
        <span>SP-API</span>
        <strong>Pedidos, finanzas e inventario</strong>
        <p>La siguiente fase conectará los datos operativos y financieros directamente con Amazon.</p>
      </article>
      <article className="card amazonPreviewCard">
        <div className="amazonPreviewIcon"><Megaphone size={20}/></div>
        <span>AMAZON ADS</span>
        <strong>Publicidad y atribución</strong>
        <p>El gasto publicitario y las ventas atribuidas formarán parte del cálculo de rentabilidad.</p>
      </article>
      <article className="card amazonPreviewCard">
        <div className="amazonPreviewIcon"><Store size={20}/></div>
        <span>EUROPA</span>
        <strong>Vista consolidada</strong>
        <p>Los marketplaces europeos se podrán consultar juntos o de forma independiente.</p>
      </article>
    </div>
  </div>;
}
