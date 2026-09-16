export type AmazonSpApiCredentials={
  clientId:string;
  clientSecret:string;
  refreshToken:string;
  sellerId:string;
};

function required(value:unknown,name:string){
  const text=String(value??'').trim();
  if(!text)throw new Error(`Falta ${name} en AMAZON_SPAPI_CREDENTIALS.`);
  return text;
}

export function readAmazonSpApiCredentials():AmazonSpApiCredentials{
  const raw=Deno.env.get('AMAZON_SPAPI_CREDENTIALS')||'';
  if(!raw)throw new Error('Amazon SP-API no está configurado en el backend.');
  let parsed:any;
  try{parsed=JSON.parse(raw)}catch{throw new Error('AMAZON_SPAPI_CREDENTIALS no contiene JSON válido.');}
  return {
    clientId:required(parsed?.client_id,'client_id'),
    clientSecret:required(parsed?.client_secret,'client_secret'),
    refreshToken:required(parsed?.refresh_token,'refresh_token'),
    sellerId:required(parsed?.seller_id,'seller_id'),
  };
}
