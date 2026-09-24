import { AlertCircle, LoaderCircle, Save, X } from 'lucide-react';
import { useState } from 'react';
import type { FulfillmentOrder, OrderUpdateInput } from '../services/orders';
import { validateOrderForCarrier, type OrderValidationIssue } from '../services/orderShipping';

const text=(value:unknown)=>typeof value==='string'?value:'';

export function OrderEditModal({order,fallbackWeightKg,saving,validationIssues=[],onClose,onSave}:{
  order:FulfillmentOrder; fallbackWeightKg:number; saving:boolean; validationIssues?:OrderValidationIssue[]; onClose:()=>void; onSave:(value:OrderUpdateInput)=>void;
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
  const [weightKg,setWeightKg]=useState(order.weightKg||fallbackWeightKg||1);

  const liveOrder:FulfillmentOrder={
    ...order,
    customerName:customerName.trim()||null,
    customerEmail:email.trim()||null,
    customerPhone:phone.trim()||null,
    weightKg:Number(weightKg)||0,
    shippingAddress:{
      ...address,
      name:customerName.trim(),
      email:email.trim(),
      phone_number:phone.trim(),
      address_line_1:street.trim(),
      house_number:houseNumber.trim(),
      address_line_2:address2.trim(),
      postal_code:postalCode.trim(),
      city:city.trim(),
      state_province_code:stateProvince.trim(),
      country_code:countryCode.trim().toUpperCase(),
    },
  };
  const liveValidation=validateOrderForCarrier(liveOrder);
  const fieldIssue=(field:string)=>liveValidation.issues.find(issue=>issue.field===field);
  const fieldError=(field:string)=>fieldIssue(field)?.message||'';

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
        {liveValidation.issues.length>0&&<div className="errorBox ordersValidationBox"><AlertCircle size={17}/><div><strong>Revisar antes de generar la etiqueta</strong>{liveValidation.issues.map((issue,index)=><span key={`${issue.field}-${index}`}>{issue.message}</span>)}</div></div>}
        <div className="ordersManualGrid">
          <label className={fieldIssue('name')?'ordersFieldInvalid':''}><span>Cliente *</span><input aria-invalid={Boolean(fieldIssue('name'))} value={customerName} onChange={e=>setCustomerName(e.target.value)}/>{fieldError('name')&&<small className="ordersFieldError">{fieldError('name')}</small>}</label>
          <label className={fieldIssue('phone')?'ordersFieldInvalid':''}><span>Teléfono</span><input aria-invalid={Boolean(fieldIssue('phone'))} value={phone} onChange={e=>setPhone(e.target.value)}/>{fieldError('phone')&&<small className="ordersFieldError">{fieldError('phone')}</small>}</label>
          <label className={`wide ${fieldIssue('email')?'ordersFieldInvalid':''}`}><span>Email</span><input aria-invalid={Boolean(fieldIssue('email'))} type="email" value={email} onChange={e=>setEmail(e.target.value)}/>{fieldError('email')&&<small className="ordersFieldError">{fieldError('email')}</small>}</label>
          <label className={`wide ${fieldIssue('address_line_1')?'ordersFieldInvalid':''}`}><span>Dirección *</span><input aria-invalid={Boolean(fieldIssue('address_line_1'))} value={street} onChange={e=>setStreet(e.target.value)}/>{fieldError('address_line_1')&&<small className="ordersFieldError">{fieldError('address_line_1')}</small>}</label>
          <label className={fieldIssue('house_number')?'ordersFieldInvalid':''}><span>Número</span><input aria-invalid={Boolean(fieldIssue('house_number'))} value={houseNumber} onChange={e=>setHouseNumber(e.target.value)}/>{fieldError('house_number')&&<small className="ordersFieldError">{fieldError('house_number')}</small>}</label>
          <label className={fieldIssue('address_line_2')?'ordersFieldInvalid':''}><span>Dirección 2</span><input aria-invalid={Boolean(fieldIssue('address_line_2'))} value={address2} onChange={e=>setAddress2(e.target.value)}/>{fieldError('address_line_2')&&<small className="ordersFieldError">{fieldError('address_line_2')}</small>}</label>
          <label className={fieldIssue('postal_code')?'ordersFieldInvalid':''}><span>Código postal *</span><input aria-invalid={Boolean(fieldIssue('postal_code'))} value={postalCode} onChange={e=>setPostalCode(e.target.value)}/>{fieldError('postal_code')&&<small className="ordersFieldError">{fieldError('postal_code')}</small>}</label>
          <label className={fieldIssue('city')?'ordersFieldInvalid':''}><span>Ciudad *</span><input aria-invalid={Boolean(fieldIssue('city'))} value={city} onChange={e=>setCity(e.target.value)}/>{fieldError('city')&&<small className="ordersFieldError">{fieldError('city')}</small>}</label>
          <label><span>Provincia / Estado</span><input value={stateProvince} onChange={e=>setStateProvince(e.target.value)}/></label>
          <label className={fieldIssue('country_code')?'ordersFieldInvalid':''}><span>País *</span><input aria-invalid={Boolean(fieldIssue('country_code'))} maxLength={2} value={countryCode} onChange={e=>setCountryCode(e.target.value.toUpperCase())}/>{fieldError('country_code')&&<small className="ordersFieldError">{fieldError('country_code')}</small>}</label>
          <label className={fieldIssue('weight')?'ordersFieldInvalid':''}><span>Peso (kg) *</span><input aria-invalid={Boolean(fieldIssue('weight'))} type="number" min="0.01" step="0.01" value={weightKg} onChange={e=>setWeightKg(Number(e.target.value)||0)}/>{fieldError('weight')&&<small className="ordersFieldError">{fieldError('weight')}</small>}</label>
        </div>
      </div>
      <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving} onClick={submit}>{saving?<LoaderCircle className="spin" size={16}/>:<Save size={16}/>} Guardar cambios</button></div>
    </section>
  </div>;
}
