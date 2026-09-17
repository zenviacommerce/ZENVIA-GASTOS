export type FinanceComponentCategory =
  | 'refund'
  | 'commission_fee'
  | 'fba_fee'
  | 'digital_services_fee'
  | 'storage_fee'
  | 'other_amazon_fee'
  | 'adjustment'
  | 'ads_payment_excluded'
  | 'sale_audit'
  | 'tax_audit';

type CurrencyAmount={currencyAmount?:string|number|null;currencyCode?:string|null}|null|undefined;
type Breakdown={breakdownType?:string|null;breakdownAmount?:CurrencyAmount;breakdowns?:Breakdown[]|null};
type EconomicNode={node:Breakdown;path:string[];category:FinanceComponentCategory;componentType:string;tax:number|null;taxCurrency:string|null};

export type FinanceComponentInput={
  owner_id:string;amazon_account_id:string;finance_transaction_id:string;marketplace_id:string|null;amazon_order_id:string|null;
  seller_sku:string|null;asin:string|null;posted_date:string|null;component_key:string;component_type:string;
  component_category:FinanceComponentCategory;amount_original:number;currency_code:string;tax_amount_original:number|null;
  amount_eur:null;tax_amount_eur:null;fx_rate:null;updated_at:string;
};

const BASE_TYPE='Base';
const TAX_TYPE='Tax';
function number(value:unknown){const n=Number(value);return Number.isFinite(n)?n:0;}
function amount(node:Breakdown){return number(node?.breakdownAmount?.currencyAmount);}
function currency(node:Breakdown){return String(node?.breakdownAmount?.currencyCode||'EUR').toUpperCase();}
function children(node:Breakdown){return Array.isArray(node?.breakdowns)?node.breakdowns:[];}
function type(node:Breakdown){return String(node?.breakdownType||'').trim();}
function lower(value:string){return value.trim().toLowerCase();}

function classify(name:string):FinanceComponentCategory|null{
  const text=lower(name);
  if(/productadspayment|advertis|sponsored/.test(text))return 'ads_payment_excluded';
  if(text==='refunded sales'||text==='refundedsales')return 'refund';
  if(/commission|referral/.test(text))return 'commission_fee';
  if(/fbaperunitfulfillmentfee|fulfil+l?ment.*fee|fba.*fee/.test(text))return 'fba_fee';
  if(/digitalservicesfee|digital services fee/.test(text))return 'digital_services_fee';
  if(/storage/.test(text))return 'storage_fee';
  if(/adjust|reimburse|correction/.test(text))return 'adjustment';
  if(text==='productcharges'||text==='product charges')return 'sale_audit';
  if(text===lower(TAX_TYPE))return 'tax_audit';
  if(/amazonfees|amazon fees|fee|expense|charge/.test(text))return 'other_amazon_fee';
  return null;
}

function refundedSalesNode(node:Breakdown,path:string[]):EconomicNode{
  const nested=children(node);const product=nested.find(child=>/product\s*charges/i.test(type(child)));const tax=nested.find(child=>lower(type(child))===lower(TAX_TYPE));const source=product||node;
  return {node:source,path,category:'refund',componentType:'Refunded Sales',tax:tax?amount(tax):null,taxCurrency:tax?currency(tax):null};
}

function economicNodes(nodes:Breakdown[],path:string[]=[]):EconomicNode[]{
  const out:EconomicNode[]=[];
  for(let index=0;index<nodes.length;index+=1){
    const node=nodes[index];const nodeType=type(node);const nodePath=[...path,`${index}:${nodeType}`];const nested=children(node);
    if(/refunded\s*sales/i.test(nodeType)){out.push(refundedSalesNode(node,nodePath));continue;}
    const base=nested.find(child=>lower(type(child))===lower(BASE_TYPE));const tax=nested.find(child=>lower(type(child))===lower(TAX_TYPE));const category=classify(nodeType);
    if(category&&base){out.push({node:base,path:nodePath,category,componentType:nodeType,tax:tax?amount(tax):null,taxCurrency:tax?currency(tax):null});continue;}
    if(category&&nested.length===0){out.push({node,path:nodePath,category,componentType:nodeType,tax:null,taxCurrency:null});continue;}
    out.push(...economicNodes(nested,nodePath));
  }
  return out;
}

async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function rawBreakdowns(transaction:any):Breakdown[]{return Array.isArray(transaction?.breakdowns)?transaction.breakdowns:[];}

function syntheticAdsNode(transaction:any):EconomicNode|null{
  const transactionType=String(transaction?.transactionType||'');if(!/productadspayment|advertis|sponsored/i.test(transactionType))return null;const total=transaction?.totalAmount||null;
  return {node:{breakdownType:transactionType,breakdownAmount:total},path:[`transaction:${transactionType}`],category:'ads_payment_excluded',componentType:transactionType,tax:null,taxCurrency:null};
}

function persistedCategory(value:unknown):FinanceComponentCategory|null{
  const category=lower(String(value||''));
  if(category==='refund')return 'refund';
  if(category==='referral_fee')return 'commission_fee';
  if(category==='fba_fee')return 'fba_fee';
  if(category==='storage_fee')return 'storage_fee';
  if(category==='adjustment')return 'adjustment';
  if(category==='other_fee')return 'other_amazon_fee';
  if(category==='sale')return 'sale_audit';
  if(category==='tax')return 'tax_audit';
  return null;
}

function syntheticFallbackNode(transaction:any,persistedTransaction:any):EconomicNode|null{
  const totalAmount=number(transaction?.totalAmount?.currencyAmount??persistedTransaction?.amount_original);
  if(totalAmount===0)return null;
  const fallbackCategory=persistedCategory(persistedTransaction?.category);
  if(!fallbackCategory)return null;
  const transactionType=String(persistedTransaction?.transaction_type||transaction?.transactionType||'Transaction');
  const currencyCode=String(transaction?.totalAmount?.currencyCode||persistedTransaction?.currency_code||'EUR').toUpperCase();
  return {
    node:{breakdownType:transactionType,breakdownAmount:{currencyAmount:totalAmount,currencyCode}},
    path:[`transaction-fallback:${transactionType}`],
    category:fallbackCategory,
    componentType:`${transactionType} (fallback)`,
    tax:null,
    taxCurrency:null,
  };
}

export async function normalizeFinanceComponents(transaction:any,persistedTransaction:any,_job:any):Promise<FinanceComponentInput[]>{
  const nodes=economicNodes(rawBreakdowns(transaction));
  if(!nodes.length){const synthetic=syntheticAdsNode(transaction);if(synthetic)nodes.push(synthetic);}
  if(!nodes.length){const fallback=syntheticFallbackNode(transaction,persistedTransaction);if(fallback)nodes.push(fallback);}

  const now=new Date().toISOString();const result:FinanceComponentInput[]=[];
  for(const entry of nodes){
    const componentKey=await sha256(JSON.stringify({transactionKey:persistedTransaction.transaction_key||persistedTransaction.id,path:entry.path,category:entry.category,componentType:entry.componentType}));
    result.push({
      owner_id:String(persistedTransaction.owner_id),amazon_account_id:String(persistedTransaction.amazon_account_id),finance_transaction_id:String(persistedTransaction.id),
      marketplace_id:persistedTransaction.marketplace_id?String(persistedTransaction.marketplace_id):null,amazon_order_id:persistedTransaction.amazon_order_id?String(persistedTransaction.amazon_order_id):null,
      seller_sku:persistedTransaction.seller_sku?String(persistedTransaction.seller_sku):null,asin:persistedTransaction.asin?String(persistedTransaction.asin):null,
      posted_date:persistedTransaction.posted_date?String(persistedTransaction.posted_date):null,component_key:componentKey,component_type:entry.componentType,
      component_category:entry.category,amount_original:amount(entry.node),currency_code:currency(entry.node),tax_amount_original:entry.tax,
      amount_eur:null,tax_amount_eur:null,fx_rate:null,updated_at:now,
    });
  }
  return result;
}
