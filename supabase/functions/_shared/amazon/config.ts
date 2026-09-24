export type AmazonSpApiCredentials={
  clientId:string;
  clientSecret:string;
  refreshToken:string;
  sellerId:string;
};

function clean(value:unknown){return String(value??'').trim();}
function required(value:unknown,name:string){
  const text=clean(value);
  if(!text)throw new Error(`Falta ${name} en la configuración de Amazon SP-API.`);
  return text;
}
function parseEnv(){
  const raw=clean(Deno.env.get('AMAZON_SPAPI_CREDENTIALS'));
  if(!raw)return {} as any;
  try{return JSON.parse(raw)}catch{throw new Error('AMAZON_SPAPI_CREDENTIALS no contiene JSON válido.');}
}
function normalize(stored:any,env:any,fallbackSellerId=''):AmazonSpApiCredentials{
  return {
    clientId:required(stored?.clientId||stored?.client_id||env?.clientId||env?.client_id,'client_id'),
    clientSecret:required(stored?.clientSecret||stored?.client_secret||env?.clientSecret||env?.client_secret,'client_secret'),
    refreshToken:required(stored?.refreshToken||stored?.refresh_token||env?.refreshToken||env?.refresh_token,'refresh_token'),
    sellerId:required(stored?.sellerId||stored?.seller_id||fallbackSellerId||env?.sellerId||env?.seller_id,'seller_id'),
  };
}

export function readAmazonSpApiCredentials():AmazonSpApiCredentials{
  const env=parseEnv();
  if(!Object.keys(env).length)throw new Error('Amazon SP-API no está configurado en el backend.');
  return normalize({},env);
}

async function readIntegrationSecret(admin:any,integrationAccountId:string){
  const {data:integration,error}=await admin.from('integration_accounts')
    .select('id,external_account_id,secret_id,credential_source,status,enabled')
    .eq('id',integrationAccountId).eq('provider','amazon').maybeSingle();
  if(error)throw error;
  if(!integration)throw new Error('La cuenta de integración de Amazon no existe.');
  if(integration.status==='disabled'||integration.enabled===false)throw new Error('La cuenta de Amazon está deshabilitada.');
  let stored:any={};
  if(integration.secret_id){
    const {data:secret,error:secretError}=await admin.rpc('integration_read_secret',{p_secret_id:integration.secret_id});
    if(secretError)throw secretError;
    try{stored=JSON.parse(String(secret||'{}'))}catch{throw new Error('Las credenciales cifradas de Amazon no tienen un formato válido.');}
  }
  return {integration,stored};
}

export async function loadAmazonSpApiCredentials(
  admin:any,
  options:{amazonAccountId?:string|null;integrationAccountId?:string|null}={},
):Promise<AmazonSpApiCredentials>{
  const env=parseEnv();
  let integrationAccountId=clean(options.integrationAccountId);
  let fallbackSellerId='';

  if(options.amazonAccountId){
    const {data:account,error}=await admin.from('amazon_accounts')
      .select('seller_id,integration_account_id').eq('id',options.amazonAccountId).maybeSingle();
    if(error)throw error;
    if(!account)throw new Error('La cuenta Amazon asociada al trabajo ya no existe.');
    fallbackSellerId=clean(account.seller_id);
    integrationAccountId=integrationAccountId||clean(account.integration_account_id);
  }

  if(integrationAccountId){
    const {integration,stored}=await readIntegrationSecret(admin,integrationAccountId);
    return normalize(stored,env,clean(integration.external_account_id)||fallbackSellerId);
  }

  if(!Object.keys(env).length)throw new Error('Amazon SP-API no está configurado para esta cuenta.');
  return normalize({},env,fallbackSellerId);
}
