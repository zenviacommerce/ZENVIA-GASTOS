export type ExpenseImportPolicy={
  initialStatus:'pending'|'reviewed'|'accounted';
  autoCreateSuppliers:boolean;
  autoCreateProducts:boolean;
  fillMissingSupplierData:boolean;
  updateProductCosts:boolean;
  defaultCategoryId:string|null;
  defaultSupplierType:'goods'|'service'|'both'|null;
  detectDuplicates:boolean;
  blockHighConfidenceDuplicates:boolean;
  warnAmbiguousMatches:boolean;
  confidenceThreshold:number;
  requiredReviewFields:string[];
  gmailPdfOnly:boolean;
  maxAttachmentMb:number;
  allowReimportDeleted:boolean;
  createSupplierProductRelation:boolean;
  updatePriceHistory:boolean;
};

const DEFAULT_EXPENSE_IMPORT_POLICY:ExpenseImportPolicy={
  initialStatus:'pending',
  autoCreateSuppliers:true,
  autoCreateProducts:true,
  fillMissingSupplierData:true,
  updateProductCosts:true,
  defaultCategoryId:null,
  defaultSupplierType:null,
  detectDuplicates:true,
  blockHighConfidenceDuplicates:true,
  warnAmbiguousMatches:true,
  confidenceThreshold:.8,
  requiredReviewFields:['invoiceNumber','issueDate','supplier','total'],
  gmailPdfOnly:true,
  maxAttachmentMb:20,
  allowReimportDeleted:true,
  createSupplierProductRelation:true,
  updatePriceHistory:true,
};

export function expenseImportPolicyFromSettings(
  input?:Partial<ExpenseImportPolicy>|null,
):ExpenseImportPolicy{
  const source=input||{};
  const initialStatus=['pending','reviewed','accounted'].includes(String(source.initialStatus))
    ?source.initialStatus as ExpenseImportPolicy['initialStatus']
    :DEFAULT_EXPENSE_IMPORT_POLICY.initialStatus;
  const supplierType=['goods','service','both'].includes(String(source.defaultSupplierType))
    ?source.defaultSupplierType as ExpenseImportPolicy['defaultSupplierType']
    :source.defaultSupplierType===null?null:DEFAULT_EXPENSE_IMPORT_POLICY.defaultSupplierType;
  const confidence=typeof source.confidenceThreshold==='number'&&Number.isFinite(source.confidenceThreshold)&&source.confidenceThreshold>=0&&source.confidenceThreshold<=1
    ?source.confidenceThreshold
    :DEFAULT_EXPENSE_IMPORT_POLICY.confidenceThreshold;
  const maxMb=typeof source.maxAttachmentMb==='number'&&Number.isInteger(source.maxAttachmentMb)&&source.maxAttachmentMb>=1&&source.maxAttachmentMb<=100
    ?source.maxAttachmentMb
    :DEFAULT_EXPENSE_IMPORT_POLICY.maxAttachmentMb;
  const required=Array.isArray(source.requiredReviewFields)
    ?source.requiredReviewFields.filter((item):item is string=>typeof item==='string'&&Boolean(item.trim())).map(item=>item.trim())
    :DEFAULT_EXPENSE_IMPORT_POLICY.requiredReviewFields;

  const bool=<K extends keyof ExpenseImportPolicy>(key:K):boolean=>{
    const value=source[key];
    return typeof value==='boolean'?value:DEFAULT_EXPENSE_IMPORT_POLICY[key] as boolean;
  };

  return {
    initialStatus,
    autoCreateSuppliers:bool('autoCreateSuppliers'),
    autoCreateProducts:bool('autoCreateProducts'),
    fillMissingSupplierData:bool('fillMissingSupplierData'),
    updateProductCosts:bool('updateProductCosts'),
    defaultCategoryId:typeof source.defaultCategoryId==='string'&&source.defaultCategoryId.trim()?source.defaultCategoryId.trim():source.defaultCategoryId===null?null:DEFAULT_EXPENSE_IMPORT_POLICY.defaultCategoryId,
    defaultSupplierType:supplierType,
    detectDuplicates:bool('detectDuplicates'),
    blockHighConfidenceDuplicates:bool('blockHighConfidenceDuplicates'),
    warnAmbiguousMatches:bool('warnAmbiguousMatches'),
    confidenceThreshold:confidence,
    requiredReviewFields:required,
    gmailPdfOnly:bool('gmailPdfOnly'),
    maxAttachmentMb:maxMb,
    allowReimportDeleted:bool('allowReimportDeleted'),
    createSupplierProductRelation:bool('createSupplierProductRelation'),
    updatePriceHistory:bool('updatePriceHistory'),
  };
}

export function expenseRequiresReview(
  policy:ExpenseImportPolicy,
  values:{invoiceNumber?:string;supplierName?:string;invoiceDate?:string;total?:number;confidence?:number},
){
  const missing=policy.requiredReviewFields.filter(field=>{
    if(field==='invoiceNumber')return !String(values.invoiceNumber||'').trim();
    if(field==='supplier')return !String(values.supplierName||'').trim();
    if(field==='issueDate')return !String(values.invoiceDate||'').trim();
    if(field==='total')return !(typeof values.total==='number'&&Number.isFinite(values.total)&&values.total>0);
    return false;
  });
  const lowConfidence=typeof values.confidence==='number'&&values.confidence<policy.confidenceThreshold;
  return {required:missing.length>0||lowConfidence,missing,lowConfidence};
}
