import { AlertCircle, LoaderCircle, Save, X } from 'lucide-react';
import { useState } from 'react';
import type { FulfillmentOrder, OrderUpdateInput } from '../services/orders';
import type { OrderValidationIssue } from '../services/orderShipping';

const text=(value:unknown)=>typeof value==='string'?value:'';

export function OrderEditModal({order,saving,issues=[],onClose,onSave}:{
  order:FulfillmentOrder; saving:boolean; issues?:OrderValidationIssue[]; onClose:()=>void; onSave:(value:OrderUpdateInput)=>void;
}){
  const address=order.shippingAddress||{};
  const [customerName,setCustomerName]=useState(order.customerName||text(address.name));
  const [email,setEmail]=useState(order.customerEmail||text(address.email));
  const [phone,setPhone]=useState(order.customerPhone||text(address.phone_number));
  const [street,setStreet]=useState(text(address.address_line_1));
  const [houseNumber,setHouseNumber]=useState(text(address.house_number));
  const [address2,setAddress2]=useState(text(address.address_line_2));
  const [postalCode,setPostalCode]=useState(text(address.postal_code));
  const [city,setCity]=useState(text(address.city));
  const [stateProvince,setStateProvince]=useState(text(address.state_province_code));
  const [countryCode,setCountryCode]=useState(text(address.country_code)||'ES');
  const [weightKg,setWeightKg]=useState(order.weightKg||1);

  const submit=()=>onSave({
    customerName:customerName.trim(),email:email.trim(),phone:phone.trim(),address:street.trim(),
    houseNumber:houseNumber.trim(),address2:address2.trim(),postalCode:postalCode.trim(),city:city.trim(),
    stateProvince:stateProvince.trim(),countryCode:countryCode.trim().toUpperCase(),weightKg:Number(weightKg)||0,
  });

  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="modal ordersEditModal">
      <div className="modalHead"><div><h3>Editar pedido · {order.orderNumber||order.orderId}</h3><p>Corrige los datos de envío antes de generar la etiqueta. Los cambios se guardan también en Sendcloud.</p></div><button onClick={onClose}><X size={18}/></button></div>
      <div className="ordersEditBody">
        <div className="ordersEditHint">MRW suele validar estrictamente nombre, teléfono, dirección, código postal, provincia y peso. Revisa estos campos si una etiqueta da error.</div>
        {issues.length>0&&<div className="ordersValidationPanel">{issues.map(item=><div className={`ordersValidationIssue ${item.severity}`} key={item.code}><AlertCircle size={16}/><span><strong>{item.label}</strong><small>{item.message}</small></span></div>)}</div>}
        <div className="ordersManualGrid">
          <label><span>Cliente *</span><input value={customerName} onChange={e=>setCustomerName(e.target.value)}/></label>
          <label><span>Teléfono</span><input value={phone} onChange={e=>setPhone(e.target.value)}/></label>
          <label className="wide"><span>Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
          <label className="wide"><span>Dirección *</span><input value={street} onChange={e=>setStreet(e.target.value)}/></label>
          <label><span>Número</span><input value={houseNumber} onChange={e=>setHouseNumber(e.target.value)}/></label>
          <label><span>Dirección 2</span><input value={address2} onChange={e=>setAddress2(e.target.value)}/></label>
          <label><span>Código postal *</span><input value={postalCode} onChange={e=>setPostalCode(e.target.value)}/></label>
          <label><span>Ciudad *</span><input value={city} onChange={e=>setCity(e.target.value)}/></label>
          <label><span>Provincia / Estado</span><input value={stateProvince} onChange={e=>setStateProvince(e.target.value)}/></label>
          <label><span>País *</span><input maxLength={2} value={countryCode} onChange={e=>setCountryCode(e.target.value.toUpperCase())}/></label>
          <label><span>Peso (kg) *</span><input type="number" min="0.01" step="0.01" value={weightKg} onChange={e=>setWeightKg(Number(e.target.value)||0)}/></label>
        </div>
      </div>
      <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving} onClick={submit}>{saving?<LoaderCircle className="spin" size={16}/>:<Save size={16}/>} Guardar cambios</button></div>
    </section>
  </div>;
}
