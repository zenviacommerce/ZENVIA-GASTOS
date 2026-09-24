export const APP_SETTINGS_SCHEMA_VERSION = 1;
export const USER_PREFERENCES_SCHEMA_VERSION = 1;

export type SettingsWarning = {
  path: string;
  message: string;
};

export type DateFormat = 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'YYYY-MM-DD';
export type DocumentLanguage = 'es' | 'en' | 'fr' | 'it' | 'de' | 'pt';
export type LabelFilenameStrategy = 'order_number' | 'sku' | 'product' | 'customer_order' | 'custom';
export type ProductCostMethod = 'last_purchase' | 'average' | 'manual';
export type DefaultPeriod = 'today' | 'current_month' | 'current_quarter' | 'current_year' | 'all';
export type ThemePreference = 'system' | 'light' | 'dark';
export type DensityPreference = 'comfortable' | 'compact' | 'spacious';

export type PaymentMethodSetting = {
  id: string;
  label: string;
  active: boolean;
};

export type GeneralSettings = {
  currencyCode: string;
  countryCode: string;
  timezone: string;
  dateFormat: DateFormat;
  documentLanguage: DocumentLanguage;
  startPage: string;
};

export type SalesSettings = {
  defaultDueDays: number;
  defaultPaymentMethod: string;
  paymentMethods: PaymentMethodSetting[];
  defaultVatRate: number;
  defaultSeriesId: string | null;
  defaultTaxRegistrationId: string | null;
  defaultNotes: string;
  showIbanOnPdf: boolean;
  showFiscalDataOnPdf: boolean;
  showDueDateOnPdf: boolean;
  showPaymentMethodOnPdf: boolean;
  allowPartialPayments: boolean;
  autoMarkPaid: boolean;
  allowEditIssuedInvoices: boolean;
  autoCreateClients: boolean;
  fillMissingClientFiscalData: boolean;
};

export type ExpensesSettings = {
  initialStatus: 'pending' | 'reviewed' | 'accounted';
  autoCreateSuppliers: boolean;
  autoCreateProducts: boolean;
  fillMissingSupplierData: boolean;
  updateProductCosts: boolean;
  defaultCategoryId: string | null;
  defaultSupplierType: 'goods' | 'service' | 'both' | null;
  detectDuplicates: boolean;
  blockHighConfidenceDuplicates: boolean;
  warnAmbiguousMatches: boolean;
  confidenceThreshold: number;
  requiredReviewFields: string[];
  gmailPdfOnly: boolean;
  maxAttachmentMb: number;
  allowReimportDeleted: boolean;
  createSupplierProductRelation: boolean;
  updatePriceHistory: boolean;
};

export type OrdersSettings = {
  defaultManualStatus: string;
  defaultChannel: string;
  originCountryCode: string;
  defaultCarrier: string | null;
  generateLabelAutomatically: boolean;
  downloadLabelAfterCreation: boolean;
  labelFilenameStrategy: LabelFilenameStrategy;
  customLabelFilenameTemplate: string;
  bulkZipFilenameTemplate: string;
  bulkScope: 'pending' | 'selected';
  pushTrackingToMarketplace: boolean;
  markSentAfterLabel: boolean;
  retryTrackingConfirmation: boolean;
  refreshSeconds: number;
  overdueHours: number;
};

export type ShippingSettings = {
  senderName: string;
  senderAddress: string;
  senderPostalCode: string;
  senderCity: string;
  senderCountryCode: string;
  fallbackWeightKg: number;
  weightUnit: 'kg' | 'g';
  labelSize: 'A4' | 'A6' | '10x15';
  labelOrientation: 'portrait' | 'landscape';
  copies: number;
  autoDownload: boolean;
  enabledCarriers: string[];
  noValidMethodBehavior: 'manual_selection' | 'error';
  confirmShipmentAfterLabel: boolean;
  persistShippingCost: boolean;
};

export type AmazonSettings = {
  activeMarketplaceIds: string[];
  primaryMarketplaceId: string | null;
  consolidatedCurrency: string;
  defaultPeriod: DefaultPeriod;
  historyDays: number;
  autoSyncOrders: boolean;
  autoSyncInventory: boolean;
  autoSyncFinance: boolean;
  autoSyncImages: boolean;
  autoMapSkuToProduct: boolean;
  defaultConsumptionFactor: number;
  unmappedSkuBehavior: 'warn' | 'exclude' | 'include';
  defaultVatRate: number;
  fxMissingRatePolicy: 'last_known' | 'exclude';
  visibleKpis: string[];
};

export type ProductsSettings = {
  defaultVatRate: number;
  defaultUnit: string;
  targetMarginPct: number;
  minimumMarginPct: number;
  costMethod: ProductCostMethod;
  updateCostFromImports: boolean;
  autoCreateFromInvoice: boolean;
  defaultSupplierId: string | null;
  defaultCategoryId: string | null;
  costIncreaseAlertPct: number;
  marginAlertPct: number;
  priceRounding: number;
  costDecimals: number;
};

export type ClientsSettings = {
  defaultCountryCode: string;
  defaultVatRate: number;
  defaultPaymentTermsDays: number;
  defaultPaymentMethod: string;
  autoCreate: boolean;
  fillTaxId: boolean;
  fillAddress: boolean;
  fillCountry: boolean;
  overwriteReviewed: boolean;
  duplicateIdentity: Array<'tax_id' | 'email' | 'name'>;
};

export type SuppliersSettings = {
  defaultType: 'goods' | 'service' | 'both' | null;
  defaultCategoryId: string | null;
  autoCreate: boolean;
  enrichTaxId: boolean;
  enrichEmail: boolean;
  enrichPhone: boolean;
  enrichWebsite: boolean;
  enrichAddress: boolean;
  onlyFillEmpty: boolean;
  detectDuplicates: boolean;
  identityThreshold: number;
};

export type IntegrationsSettings = {
  gmailEnabled: boolean;
  amazonEnabled: boolean;
  sendcloudEnabled: boolean;
  shopifyEnabled: boolean;
};

export type NotificationSetting = {
  enabled: boolean;
  inApp: boolean;
  threshold: number | null;
};

export type NotificationsSettings = {
  overdueSalesInvoice: NotificationSetting;
  pendingExpenseReview: NotificationSetting;
  pendingOrder: NotificationSetting;
  missingTracking: NotificationSetting;
  amazonError: NotificationSetting;
  sendcloudError: NotificationSetting;
  gmailError: NotificationSetting;
  productWithoutCost: NotificationSetting;
  negativeMargin: NotificationSetting;
  costIncrease: NotificationSetting;
  clientMissingTaxId: NotificationSetting;
  supplierMissingTaxId: NotificationSetting;
};

export type MaintenanceSettings = {
  duplicateCandidateThreshold: number;
};

export type AppSettings = {
  general: GeneralSettings;
  sales: SalesSettings;
  expenses: ExpensesSettings;
  orders: OrdersSettings;
  shipping: ShippingSettings;
  amazon: AmazonSettings;
  products: ProductsSettings;
  clients: ClientsSettings;
  suppliers: SuppliersSettings;
  integrations: IntegrationsSettings;
  notifications: NotificationsSettings;
  maintenance: MaintenanceSettings;
};

export type UserPreferences = {
  theme: ThemePreference;
  density: DensityPreference;
  pageSize: 10 | 20 | 25 | 50 | 100;
  startPage: string | null;
  defaultPeriod: DefaultPeriod;
  rememberFilters: boolean;
  tableColumns: Record<string, string[]>;
  tableColumnOrder: Record<string, string[]>;
  dashboardKpis: string[];
  filters: Record<string, unknown>;
  labelPrinterId: string | null;
};

const notification = (threshold: number | null = null): NotificationSetting => ({
  enabled: true,
  inApp: true,
  threshold,
});

export const DEFAULT_APP_SETTINGS: AppSettings = {
  general: {
    currencyCode: 'EUR',
    countryCode: 'ES',
    timezone: 'Europe/Madrid',
    dateFormat: 'DD/MM/YYYY',
    documentLanguage: 'es',
    startPage: 'dashboard',
  },
  sales: {
    defaultDueDays: 30,
    defaultPaymentMethod: 'bank_transfer',
    paymentMethods: [
      { id: 'bank_transfer', label: 'Transferencia bancaria', active: true },
      { id: 'card', label: 'Tarjeta', active: true },
      { id: 'cash', label: 'Efectivo', active: true },
      { id: 'bizum', label: 'Bizum', active: true },
    ],
    defaultVatRate: 21,
    defaultSeriesId: null,
    defaultTaxRegistrationId: null,
    defaultNotes: '',
    showIbanOnPdf: true,
    showFiscalDataOnPdf: true,
    showDueDateOnPdf: true,
    showPaymentMethodOnPdf: true,
    allowPartialPayments: true,
    autoMarkPaid: true,
    allowEditIssuedInvoices: true,
    autoCreateClients: true,
    fillMissingClientFiscalData: true,
  },
  expenses: {
    initialStatus: 'pending',
    autoCreateSuppliers: true,
    autoCreateProducts: true,
    fillMissingSupplierData: true,
    updateProductCosts: true,
    defaultCategoryId: null,
    defaultSupplierType: null,
    detectDuplicates: true,
    blockHighConfidenceDuplicates: true,
    warnAmbiguousMatches: true,
    confidenceThreshold: 0.8,
    requiredReviewFields: ['invoiceNumber', 'issueDate', 'supplier', 'total'],
    gmailPdfOnly: true,
    maxAttachmentMb: 20,
    allowReimportDeleted: true,
    createSupplierProductRelation: true,
    updatePriceHistory: true,
  },
  orders: {
    defaultManualStatus: 'pending',
    defaultChannel: 'manual',
    originCountryCode: 'ES',
    defaultCarrier: null,
    generateLabelAutomatically: false,
    downloadLabelAfterCreation: true,
    labelFilenameStrategy: 'order_number',
    customLabelFilenameTemplate: '{order}',
    bulkZipFilenameTemplate: 'etiquetas_{scope}_{date}',
    bulkScope: 'pending',
    pushTrackingToMarketplace: true,
    markSentAfterLabel: true,
    retryTrackingConfirmation: true,
    refreshSeconds: 60,
    overdueHours: 24,
  },
  shipping: {
    senderName: '',
    senderAddress: '',
    senderPostalCode: '',
    senderCity: '',
    senderCountryCode: 'ES',
    fallbackWeightKg: 1,
    weightUnit: 'kg',
    labelSize: 'A6',
    labelOrientation: 'portrait',
    copies: 1,
    autoDownload: true,
    enabledCarriers: [],
    noValidMethodBehavior: 'manual_selection',
    confirmShipmentAfterLabel: true,
    persistShippingCost: true,
  },
  amazon: {
    activeMarketplaceIds: [],
    primaryMarketplaceId: null,
    consolidatedCurrency: 'EUR',
    defaultPeriod: 'current_quarter',
    historyDays: 90,
    autoSyncOrders: true,
    autoSyncInventory: true,
    autoSyncFinance: true,
    autoSyncImages: true,
    autoMapSkuToProduct: false,
    defaultConsumptionFactor: 1,
    unmappedSkuBehavior: 'warn',
    defaultVatRate: 21,
    fxMissingRatePolicy: 'last_known',
    visibleKpis: [],
  },
  products: {
    defaultVatRate: 21,
    defaultUnit: 'ud',
    targetMarginPct: 20,
    minimumMarginPct: 0,
    costMethod: 'last_purchase',
    updateCostFromImports: true,
    autoCreateFromInvoice: true,
    defaultSupplierId: null,
    defaultCategoryId: null,
    costIncreaseAlertPct: 10,
    marginAlertPct: 0,
    priceRounding: 0.01,
    costDecimals: 4,
  },
  clients: {
    defaultCountryCode: 'ES',
    defaultVatRate: 21,
    defaultPaymentTermsDays: 30,
    defaultPaymentMethod: 'bank_transfer',
    autoCreate: true,
    fillTaxId: true,
    fillAddress: true,
    fillCountry: true,
    overwriteReviewed: false,
    duplicateIdentity: ['tax_id', 'email', 'name'],
  },
  suppliers: {
    defaultType: null,
    defaultCategoryId: null,
    autoCreate: true,
    enrichTaxId: true,
    enrichEmail: true,
    enrichPhone: true,
    enrichWebsite: true,
    enrichAddress: true,
    onlyFillEmpty: true,
    detectDuplicates: true,
    identityThreshold: 80,
  },
  integrations: {
    gmailEnabled: true,
    amazonEnabled: true,
    sendcloudEnabled: true,
    shopifyEnabled: true,
  },
  notifications: {
    overdueSalesInvoice: notification(),
    pendingExpenseReview: notification(),
    pendingOrder: notification(24),
    missingTracking: notification(),
    amazonError: notification(),
    sendcloudError: notification(),
    gmailError: notification(),
    productWithoutCost: notification(),
    negativeMargin: notification(0),
    costIncrease: notification(10),
    clientMissingTaxId: notification(),
    supplierMissingTaxId: notification(),
  },
  maintenance: {
    duplicateCandidateThreshold: 80,
  },
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'system',
  density: 'comfortable',
  pageSize: 20,
  startPage: null,
  defaultPeriod: 'current_quarter',
  rememberFilters: true,
  tableColumns: {},
  tableColumnOrder: {},
  dashboardKpis: [],
  filters: {},
  labelPrinterId: null,
};

export type SettingsSection = keyof AppSettings;

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function warn(warnings: SettingsWarning[], path: string, message: string) {
  warnings.push({ path, message });
}

function unknownKeys(input: AnyRecord, allowed: readonly string[], prefix: string, warnings: SettingsWarning[]) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) warn(warnings, prefix ? `${prefix}.${key}` : key, 'Ajuste desconocido ignorado.');
  }
}

function stringValue(
  input: AnyRecord,
  key: string,
  fallback: string,
  path: string,
  warnings: SettingsWarning[],
  options: { min?: number; max?: number; upper?: boolean; pattern?: RegExp } = {},
) {
  if (!(key in input)) return fallback;
  const raw = input[key];
  if (typeof raw !== 'string') {
    warn(warnings, path, 'Se esperaba texto.');
    return fallback;
  }
  const value = raw.trim();
  if ((options.min != null && value.length < options.min) ||
      (options.max != null && value.length > options.max) ||
      (options.pattern && !options.pattern.test(value))) {
    warn(warnings, path, 'Valor de texto no válido.');
    return fallback;
  }
  return options.upper ? value.toUpperCase() : value;
}

function nullableStringValue(
  input: AnyRecord,
  key: string,
  fallback: string | null,
  path: string,
  warnings: SettingsWarning[],
) {
  if (!(key in input)) return fallback;
  const raw = input[key];
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    warn(warnings, path, 'Se esperaba texto o vacío.');
    return fallback;
  }
  const value = raw.trim();
  return value || null;
}

function booleanValue(input: AnyRecord, key: string, fallback: boolean, path: string, warnings: SettingsWarning[]) {
  if (!(key in input)) return fallback;
  if (typeof input[key] !== 'boolean') {
    warn(warnings, path, 'Se esperaba verdadero/falso.');
    return fallback;
  }
  return input[key] as boolean;
}

function numberValue(
  input: AnyRecord,
  key: string,
  fallback: number,
  path: string,
  warnings: SettingsWarning[],
  min: number,
  max: number,
  integer = false,
) {
  if (!(key in input)) return fallback;
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    warn(warnings, path, `Se esperaba un número entre ${min} y ${max}.`);
    return fallback;
  }
  return value;
}

function enumValue<T extends string>(
  input: AnyRecord,
  key: string,
  fallback: T,
  path: string,
  warnings: SettingsWarning[],
  allowed: readonly T[],
): T {
  if (!(key in input)) return fallback;
  const value = input[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    warn(warnings, path, 'Valor no permitido.');
    return fallback;
  }
  return value as T;
}

function nullableEnumValue<T extends string>(
  input: AnyRecord,
  key: string,
  fallback: T | null,
  path: string,
  warnings: SettingsWarning[],
  allowed: readonly T[],
): T | null {
  if (!(key in input)) return fallback;
  if (input[key] === null) return null;
  return enumValue(input, key, fallback ?? allowed[0], path, warnings, allowed);
}

function stringArrayValue(
  input: AnyRecord,
  key: string,
  fallback: string[],
  path: string,
  warnings: SettingsWarning[],
) {
  if (!(key in input)) return clone(fallback);
  const raw = input[key];
  if (!Array.isArray(raw) || raw.some(item => typeof item !== 'string')) {
    warn(warnings, path, 'Se esperaba una lista de textos.');
    return clone(fallback);
  }
  return [...new Set(raw.map(item => item.trim()).filter(Boolean))];
}

function recordOfStringArraysValue(
  input: AnyRecord,
  key: string,
  fallback: Record<string, string[]>,
  path: string,
  warnings: SettingsWarning[],
) {
  if (!(key in input)) return clone(fallback);
  const raw = input[key];
  if (!isRecord(raw)) {
    warn(warnings, path, 'Se esperaba un objeto.');
    return clone(fallback);
  }
  const result: Record<string, string[]> = {};
  for (const [recordKey, value] of Object.entries(raw)) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      warn(warnings, `${path}.${recordKey}`, 'Se esperaba una lista de textos.');
      continue;
    }
    result[recordKey] = [...new Set(value.map(item => item.trim()).filter(Boolean))];
  }
  return result;
}

function freeRecordValue(
  input: AnyRecord,
  key: string,
  fallback: Record<string, unknown>,
  path: string,
  warnings: SettingsWarning[],
) {
  if (!(key in input)) return clone(fallback);
  if (!isRecord(input[key])) {
    warn(warnings, path, 'Se esperaba un objeto.');
    return clone(fallback);
  }
  return clone(input[key] as Record<string, unknown>);
}

function sectionRecord(
  root: AnyRecord,
  section: SettingsSection,
  warnings: SettingsWarning[],
): AnyRecord | null {
  if (!(section in root)) return null;
  const value = root[section];
  if (!isRecord(value)) {
    warn(warnings, section, 'La sección debe ser un objeto.');
    return null;
  }
  return value;
}

function normalizeGeneral(input: AnyRecord | null, warnings: SettingsWarning[]): GeneralSettings {
  const d = DEFAULT_APP_SETTINGS.general;
  if (!input) return clone(d);
  const keys = ['currencyCode','countryCode','timezone','dateFormat','documentLanguage','startPage'];
  unknownKeys(input, keys, 'general', warnings);
  return {
    currencyCode: stringValue(input,'currencyCode',d.currencyCode,'general.currencyCode',warnings,{min:3,max:3,upper:true,pattern:/^[A-Za-z]{3}$/}),
    countryCode: stringValue(input,'countryCode',d.countryCode,'general.countryCode',warnings,{min:2,max:2,upper:true,pattern:/^[A-Za-z]{2}$/}),
    timezone: stringValue(input,'timezone',d.timezone,'general.timezone',warnings,{min:1,max:80}),
    dateFormat: enumValue(input,'dateFormat',d.dateFormat,'general.dateFormat',warnings,['DD/MM/YYYY','DD-MM-YYYY','YYYY-MM-DD']),
    documentLanguage: enumValue(input,'documentLanguage',d.documentLanguage,'general.documentLanguage',warnings,['es','en','fr','it','de','pt']),
    startPage: stringValue(input,'startPage',d.startPage,'general.startPage',warnings,{min:1,max:80}),
  };
}

function normalizePaymentMethods(raw: unknown, fallback: PaymentMethodSetting[], warnings: SettingsWarning[]) {
  if (raw === undefined) return clone(fallback);
  if (!Array.isArray(raw)) {
    warn(warnings,'sales.paymentMethods','Se esperaba una lista de métodos de pago.');
    return clone(fallback);
  }
  const result: PaymentMethodSetting[] = [];
  const seen = new Set<string>();
  for (let index=0; index<raw.length; index+=1) {
    const row = raw[index];
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.label !== 'string' || typeof row.active !== 'boolean') {
      warn(warnings,`sales.paymentMethods.${index}`,'Método de pago no válido.');
      continue;
    }
    const id = row.id.trim();
    const label = row.label.trim();
    if (!id || !label || seen.has(id)) {
      warn(warnings,`sales.paymentMethods.${index}`,'Método de pago vacío o duplicado.');
      continue;
    }
    seen.add(id);
    result.push({ id, label, active: row.active });
  }
  return result.length ? result : clone(fallback);
}

function normalizeSales(input: AnyRecord | null, warnings: SettingsWarning[]): SalesSettings {
  const d=DEFAULT_APP_SETTINGS.sales;
  if(!input)return clone(d);
  const keys=['defaultDueDays','defaultPaymentMethod','paymentMethods','defaultVatRate','defaultSeriesId','defaultTaxRegistrationId','defaultNotes','showIbanOnPdf','showFiscalDataOnPdf','showDueDateOnPdf','showPaymentMethodOnPdf','allowPartialPayments','autoMarkPaid','allowEditIssuedInvoices','autoCreateClients','fillMissingClientFiscalData'];
  unknownKeys(input,keys,'sales',warnings);
  return {
    defaultDueDays:numberValue(input,'defaultDueDays',d.defaultDueDays,'sales.defaultDueDays',warnings,0,365,true),
    defaultPaymentMethod:stringValue(input,'defaultPaymentMethod',d.defaultPaymentMethod,'sales.defaultPaymentMethod',warnings,{min:1,max:80}),
    paymentMethods:normalizePaymentMethods(input.paymentMethods,d.paymentMethods,warnings),
    defaultVatRate:numberValue(input,'defaultVatRate',d.defaultVatRate,'sales.defaultVatRate',warnings,0,100),
    defaultSeriesId:nullableStringValue(input,'defaultSeriesId',d.defaultSeriesId,'sales.defaultSeriesId',warnings),
    defaultTaxRegistrationId:nullableStringValue(input,'defaultTaxRegistrationId',d.defaultTaxRegistrationId,'sales.defaultTaxRegistrationId',warnings),
    defaultNotes:stringValue(input,'defaultNotes',d.defaultNotes,'sales.defaultNotes',warnings,{max:2000}),
    showIbanOnPdf:booleanValue(input,'showIbanOnPdf',d.showIbanOnPdf,'sales.showIbanOnPdf',warnings),
    showFiscalDataOnPdf:booleanValue(input,'showFiscalDataOnPdf',d.showFiscalDataOnPdf,'sales.showFiscalDataOnPdf',warnings),
    showDueDateOnPdf:booleanValue(input,'showDueDateOnPdf',d.showDueDateOnPdf,'sales.showDueDateOnPdf',warnings),
    showPaymentMethodOnPdf:booleanValue(input,'showPaymentMethodOnPdf',d.showPaymentMethodOnPdf,'sales.showPaymentMethodOnPdf',warnings),
    allowPartialPayments:booleanValue(input,'allowPartialPayments',d.allowPartialPayments,'sales.allowPartialPayments',warnings),
    autoMarkPaid:booleanValue(input,'autoMarkPaid',d.autoMarkPaid,'sales.autoMarkPaid',warnings),
    allowEditIssuedInvoices:booleanValue(input,'allowEditIssuedInvoices',d.allowEditIssuedInvoices,'sales.allowEditIssuedInvoices',warnings),
    autoCreateClients:booleanValue(input,'autoCreateClients',d.autoCreateClients,'sales.autoCreateClients',warnings),
    fillMissingClientFiscalData:booleanValue(input,'fillMissingClientFiscalData',d.fillMissingClientFiscalData,'sales.fillMissingClientFiscalData',warnings),
  };
}

function normalizeExpenses(input: AnyRecord | null,warnings:SettingsWarning[]):ExpensesSettings{
  const d=DEFAULT_APP_SETTINGS.expenses;if(!input)return clone(d);
  const keys=['initialStatus','autoCreateSuppliers','autoCreateProducts','fillMissingSupplierData','updateProductCosts','defaultCategoryId','defaultSupplierType','detectDuplicates','blockHighConfidenceDuplicates','warnAmbiguousMatches','confidenceThreshold','requiredReviewFields','gmailPdfOnly','maxAttachmentMb','allowReimportDeleted','createSupplierProductRelation','updatePriceHistory'];
  unknownKeys(input,keys,'expenses',warnings);
  return {
    initialStatus:enumValue(input,'initialStatus',d.initialStatus,'expenses.initialStatus',warnings,['pending','reviewed','accounted']),
    autoCreateSuppliers:booleanValue(input,'autoCreateSuppliers',d.autoCreateSuppliers,'expenses.autoCreateSuppliers',warnings),
    autoCreateProducts:booleanValue(input,'autoCreateProducts',d.autoCreateProducts,'expenses.autoCreateProducts',warnings),
    fillMissingSupplierData:booleanValue(input,'fillMissingSupplierData',d.fillMissingSupplierData,'expenses.fillMissingSupplierData',warnings),
    updateProductCosts:booleanValue(input,'updateProductCosts',d.updateProductCosts,'expenses.updateProductCosts',warnings),
    defaultCategoryId:nullableStringValue(input,'defaultCategoryId',d.defaultCategoryId,'expenses.defaultCategoryId',warnings),
    defaultSupplierType:nullableEnumValue(input,'defaultSupplierType',d.defaultSupplierType,'expenses.defaultSupplierType',warnings,['goods','service','both']),
    detectDuplicates:booleanValue(input,'detectDuplicates',d.detectDuplicates,'expenses.detectDuplicates',warnings),
    blockHighConfidenceDuplicates:booleanValue(input,'blockHighConfidenceDuplicates',d.blockHighConfidenceDuplicates,'expenses.blockHighConfidenceDuplicates',warnings),
    warnAmbiguousMatches:booleanValue(input,'warnAmbiguousMatches',d.warnAmbiguousMatches,'expenses.warnAmbiguousMatches',warnings),
    confidenceThreshold:numberValue(input,'confidenceThreshold',d.confidenceThreshold,'expenses.confidenceThreshold',warnings,0,1),
    requiredReviewFields:stringArrayValue(input,'requiredReviewFields',d.requiredReviewFields,'expenses.requiredReviewFields',warnings),
    gmailPdfOnly:booleanValue(input,'gmailPdfOnly',d.gmailPdfOnly,'expenses.gmailPdfOnly',warnings),
    maxAttachmentMb:numberValue(input,'maxAttachmentMb',d.maxAttachmentMb,'expenses.maxAttachmentMb',warnings,1,100,true),
    allowReimportDeleted:booleanValue(input,'allowReimportDeleted',d.allowReimportDeleted,'expenses.allowReimportDeleted',warnings),
    createSupplierProductRelation:booleanValue(input,'createSupplierProductRelation',d.createSupplierProductRelation,'expenses.createSupplierProductRelation',warnings),
    updatePriceHistory:booleanValue(input,'updatePriceHistory',d.updatePriceHistory,'expenses.updatePriceHistory',warnings),
  };
}

function normalizeOrders(input:AnyRecord|null,warnings:SettingsWarning[]):OrdersSettings{
  const d=DEFAULT_APP_SETTINGS.orders;if(!input)return clone(d);
  const keys=['defaultManualStatus','defaultChannel','originCountryCode','defaultCarrier','generateLabelAutomatically','downloadLabelAfterCreation','labelFilenameStrategy','customLabelFilenameTemplate','bulkZipFilenameTemplate','bulkScope','pushTrackingToMarketplace','markSentAfterLabel','retryTrackingConfirmation','refreshSeconds','overdueHours'];
  unknownKeys(input,keys,'orders',warnings);
  return {
    defaultManualStatus:stringValue(input,'defaultManualStatus',d.defaultManualStatus,'orders.defaultManualStatus',warnings,{min:1,max:80}),
    defaultChannel:stringValue(input,'defaultChannel',d.defaultChannel,'orders.defaultChannel',warnings,{min:1,max:80}),
    originCountryCode:stringValue(input,'originCountryCode',d.originCountryCode,'orders.originCountryCode',warnings,{min:2,max:2,upper:true,pattern:/^[A-Za-z]{2}$/}),
    defaultCarrier:nullableStringValue(input,'defaultCarrier',d.defaultCarrier,'orders.defaultCarrier',warnings),
    generateLabelAutomatically:booleanValue(input,'generateLabelAutomatically',d.generateLabelAutomatically,'orders.generateLabelAutomatically',warnings),
    downloadLabelAfterCreation:booleanValue(input,'downloadLabelAfterCreation',d.downloadLabelAfterCreation,'orders.downloadLabelAfterCreation',warnings),
    labelFilenameStrategy:enumValue(input,'labelFilenameStrategy',d.labelFilenameStrategy,'orders.labelFilenameStrategy',warnings,['order_number','sku','product','customer_order','custom']),
    customLabelFilenameTemplate:stringValue(input,'customLabelFilenameTemplate',d.customLabelFilenameTemplate,'orders.customLabelFilenameTemplate',warnings,{min:1,max:160}),
    bulkZipFilenameTemplate:stringValue(input,'bulkZipFilenameTemplate',d.bulkZipFilenameTemplate,'orders.bulkZipFilenameTemplate',warnings,{min:1,max:160}),
    bulkScope:enumValue(input,'bulkScope',d.bulkScope,'orders.bulkScope',warnings,['pending','selected']),
    pushTrackingToMarketplace:booleanValue(input,'pushTrackingToMarketplace',d.pushTrackingToMarketplace,'orders.pushTrackingToMarketplace',warnings),
    markSentAfterLabel:booleanValue(input,'markSentAfterLabel',d.markSentAfterLabel,'orders.markSentAfterLabel',warnings),
    retryTrackingConfirmation:booleanValue(input,'retryTrackingConfirmation',d.retryTrackingConfirmation,'orders.retryTrackingConfirmation',warnings),
    refreshSeconds:numberValue(input,'refreshSeconds',d.refreshSeconds,'orders.refreshSeconds',warnings,30,3600,true),
    overdueHours:numberValue(input,'overdueHours',d.overdueHours,'orders.overdueHours',warnings,1,720,true),
  };
}

function normalizeShipping(input:AnyRecord|null,warnings:SettingsWarning[]):ShippingSettings{
  const d=DEFAULT_APP_SETTINGS.shipping;if(!input)return clone(d);
  const keys=['senderName','senderAddress','senderPostalCode','senderCity','senderCountryCode','fallbackWeightKg','weightUnit','labelSize','labelOrientation','copies','autoDownload','enabledCarriers','noValidMethodBehavior','confirmShipmentAfterLabel','persistShippingCost'];
  unknownKeys(input,keys,'shipping',warnings);
  return {
    senderName:stringValue(input,'senderName',d.senderName,'shipping.senderName',warnings,{max:160}),
    senderAddress:stringValue(input,'senderAddress',d.senderAddress,'shipping.senderAddress',warnings,{max:240}),
    senderPostalCode:stringValue(input,'senderPostalCode',d.senderPostalCode,'shipping.senderPostalCode',warnings,{max:30}),
    senderCity:stringValue(input,'senderCity',d.senderCity,'shipping.senderCity',warnings,{max:120}),
    senderCountryCode:stringValue(input,'senderCountryCode',d.senderCountryCode,'shipping.senderCountryCode',warnings,{min:2,max:2,upper:true,pattern:/^[A-Za-z]{2}$/}),
    fallbackWeightKg:numberValue(input,'fallbackWeightKg',d.fallbackWeightKg,'shipping.fallbackWeightKg',warnings,0.001,1000),
    weightUnit:enumValue(input,'weightUnit',d.weightUnit,'shipping.weightUnit',warnings,['kg','g']),
    labelSize:enumValue(input,'labelSize',d.labelSize,'shipping.labelSize',warnings,['A4','A6','10x15']),
    labelOrientation:enumValue(input,'labelOrientation',d.labelOrientation,'shipping.labelOrientation',warnings,['portrait','landscape']),
    copies:numberValue(input,'copies',d.copies,'shipping.copies',warnings,1,20,true),
    autoDownload:booleanValue(input,'autoDownload',d.autoDownload,'shipping.autoDownload',warnings),
    enabledCarriers:stringArrayValue(input,'enabledCarriers',d.enabledCarriers,'shipping.enabledCarriers',warnings),
    noValidMethodBehavior:enumValue(input,'noValidMethodBehavior',d.noValidMethodBehavior,'shipping.noValidMethodBehavior',warnings,['manual_selection','error']),
    confirmShipmentAfterLabel:booleanValue(input,'confirmShipmentAfterLabel',d.confirmShipmentAfterLabel,'shipping.confirmShipmentAfterLabel',warnings),
    persistShippingCost:booleanValue(input,'persistShippingCost',d.persistShippingCost,'shipping.persistShippingCost',warnings),
  };
}

function normalizeAmazon(input:AnyRecord|null,warnings:SettingsWarning[]):AmazonSettings{
  const d=DEFAULT_APP_SETTINGS.amazon;if(!input)return clone(d);
  const keys=['activeMarketplaceIds','primaryMarketplaceId','consolidatedCurrency','defaultPeriod','historyDays','autoSyncOrders','autoSyncInventory','autoSyncFinance','autoSyncImages','autoMapSkuToProduct','defaultConsumptionFactor','unmappedSkuBehavior','defaultVatRate','fxMissingRatePolicy','visibleKpis'];
  unknownKeys(input,keys,'amazon',warnings);
  return {
    activeMarketplaceIds:stringArrayValue(input,'activeMarketplaceIds',d.activeMarketplaceIds,'amazon.activeMarketplaceIds',warnings),
    primaryMarketplaceId:nullableStringValue(input,'primaryMarketplaceId',d.primaryMarketplaceId,'amazon.primaryMarketplaceId',warnings),
    consolidatedCurrency:stringValue(input,'consolidatedCurrency',d.consolidatedCurrency,'amazon.consolidatedCurrency',warnings,{min:3,max:3,upper:true,pattern:/^[A-Za-z]{3}$/}),
    defaultPeriod:enumValue(input,'defaultPeriod',d.defaultPeriod,'amazon.defaultPeriod',warnings,['today','current_month','current_quarter','current_year','all']),
    historyDays:numberValue(input,'historyDays',d.historyDays,'amazon.historyDays',warnings,1,3650,true),
    autoSyncOrders:booleanValue(input,'autoSyncOrders',d.autoSyncOrders,'amazon.autoSyncOrders',warnings),
    autoSyncInventory:booleanValue(input,'autoSyncInventory',d.autoSyncInventory,'amazon.autoSyncInventory',warnings),
    autoSyncFinance:booleanValue(input,'autoSyncFinance',d.autoSyncFinance,'amazon.autoSyncFinance',warnings),
    autoSyncImages:booleanValue(input,'autoSyncImages',d.autoSyncImages,'amazon.autoSyncImages',warnings),
    autoMapSkuToProduct:booleanValue(input,'autoMapSkuToProduct',d.autoMapSkuToProduct,'amazon.autoMapSkuToProduct',warnings),
    defaultConsumptionFactor:numberValue(input,'defaultConsumptionFactor',d.defaultConsumptionFactor,'amazon.defaultConsumptionFactor',warnings,0.0001,100000),
    unmappedSkuBehavior:enumValue(input,'unmappedSkuBehavior',d.unmappedSkuBehavior,'amazon.unmappedSkuBehavior',warnings,['warn','exclude','include']),
    defaultVatRate:numberValue(input,'defaultVatRate',d.defaultVatRate,'amazon.defaultVatRate',warnings,0,100),
    fxMissingRatePolicy:enumValue(input,'fxMissingRatePolicy',d.fxMissingRatePolicy,'amazon.fxMissingRatePolicy',warnings,['last_known','exclude']),
    visibleKpis:stringArrayValue(input,'visibleKpis',d.visibleKpis,'amazon.visibleKpis',warnings),
  };
}

function normalizeProducts(input:AnyRecord|null,warnings:SettingsWarning[]):ProductsSettings{
  const d=DEFAULT_APP_SETTINGS.products;if(!input)return clone(d);
  const keys=['defaultVatRate','defaultUnit','targetMarginPct','minimumMarginPct','costMethod','updateCostFromImports','autoCreateFromInvoice','defaultSupplierId','defaultCategoryId','costIncreaseAlertPct','marginAlertPct','priceRounding','costDecimals'];
  unknownKeys(input,keys,'products',warnings);
  return {
    defaultVatRate:numberValue(input,'defaultVatRate',d.defaultVatRate,'products.defaultVatRate',warnings,0,100),
    defaultUnit:stringValue(input,'defaultUnit',d.defaultUnit,'products.defaultUnit',warnings,{min:1,max:30}),
    targetMarginPct:numberValue(input,'targetMarginPct',d.targetMarginPct,'products.targetMarginPct',warnings,-100,10000),
    minimumMarginPct:numberValue(input,'minimumMarginPct',d.minimumMarginPct,'products.minimumMarginPct',warnings,-100,10000),
    costMethod:enumValue(input,'costMethod',d.costMethod,'products.costMethod',warnings,['last_purchase','average','manual']),
    updateCostFromImports:booleanValue(input,'updateCostFromImports',d.updateCostFromImports,'products.updateCostFromImports',warnings),
    autoCreateFromInvoice:booleanValue(input,'autoCreateFromInvoice',d.autoCreateFromInvoice,'products.autoCreateFromInvoice',warnings),
    defaultSupplierId:nullableStringValue(input,'defaultSupplierId',d.defaultSupplierId,'products.defaultSupplierId',warnings),
    defaultCategoryId:nullableStringValue(input,'defaultCategoryId',d.defaultCategoryId,'products.defaultCategoryId',warnings),
    costIncreaseAlertPct:numberValue(input,'costIncreaseAlertPct',d.costIncreaseAlertPct,'products.costIncreaseAlertPct',warnings,0,10000),
    marginAlertPct:numberValue(input,'marginAlertPct',d.marginAlertPct,'products.marginAlertPct',warnings,-100,10000),
    priceRounding:numberValue(input,'priceRounding',d.priceRounding,'products.priceRounding',warnings,0.0001,1000),
    costDecimals:numberValue(input,'costDecimals',d.costDecimals,'products.costDecimals',warnings,0,8,true),
  };
}

function normalizeClients(input:AnyRecord|null,warnings:SettingsWarning[]):ClientsSettings{
  const d=DEFAULT_APP_SETTINGS.clients;if(!input)return clone(d);
  const keys=['defaultCountryCode','defaultVatRate','defaultPaymentTermsDays','defaultPaymentMethod','autoCreate','fillTaxId','fillAddress','fillCountry','overwriteReviewed','duplicateIdentity'];
  unknownKeys(input,keys,'clients',warnings);
  const allowedIdentity=['tax_id','email','name'] as const;
  const rawIdentity=stringArrayValue(input,'duplicateIdentity',d.duplicateIdentity,'clients.duplicateIdentity',warnings)
    .filter((value):value is 'tax_id'|'email'|'name'=>allowedIdentity.includes(value as 'tax_id'|'email'|'name'));
  if(('duplicateIdentity' in input)&&rawIdentity.length===0){
    warn(warnings,'clients.duplicateIdentity','Debe existir al menos un criterio de identidad.');
  }
  return {
    defaultCountryCode:stringValue(input,'defaultCountryCode',d.defaultCountryCode,'clients.defaultCountryCode',warnings,{min:2,max:2,upper:true,pattern:/^[A-Za-z]{2}$/}),
    defaultVatRate:numberValue(input,'defaultVatRate',d.defaultVatRate,'clients.defaultVatRate',warnings,0,100),
    defaultPaymentTermsDays:numberValue(input,'defaultPaymentTermsDays',d.defaultPaymentTermsDays,'clients.defaultPaymentTermsDays',warnings,0,365,true),
    defaultPaymentMethod:stringValue(input,'defaultPaymentMethod',d.defaultPaymentMethod,'clients.defaultPaymentMethod',warnings,{min:1,max:80}),
    autoCreate:booleanValue(input,'autoCreate',d.autoCreate,'clients.autoCreate',warnings),
    fillTaxId:booleanValue(input,'fillTaxId',d.fillTaxId,'clients.fillTaxId',warnings),
    fillAddress:booleanValue(input,'fillAddress',d.fillAddress,'clients.fillAddress',warnings),
    fillCountry:booleanValue(input,'fillCountry',d.fillCountry,'clients.fillCountry',warnings),
    overwriteReviewed:booleanValue(input,'overwriteReviewed',d.overwriteReviewed,'clients.overwriteReviewed',warnings),
    duplicateIdentity:rawIdentity.length?rawIdentity:clone(d.duplicateIdentity),
  };
}

function normalizeSuppliers(input:AnyRecord|null,warnings:SettingsWarning[]):SuppliersSettings{
  const d=DEFAULT_APP_SETTINGS.suppliers;if(!input)return clone(d);
  const keys=['defaultType','defaultCategoryId','autoCreate','enrichTaxId','enrichEmail','enrichPhone','enrichWebsite','enrichAddress','onlyFillEmpty','detectDuplicates','identityThreshold'];
  unknownKeys(input,keys,'suppliers',warnings);
  return {
    defaultType:nullableEnumValue(input,'defaultType',d.defaultType,'suppliers.defaultType',warnings,['goods','service','both']),
    defaultCategoryId:nullableStringValue(input,'defaultCategoryId',d.defaultCategoryId,'suppliers.defaultCategoryId',warnings),
    autoCreate:booleanValue(input,'autoCreate',d.autoCreate,'suppliers.autoCreate',warnings),
    enrichTaxId:booleanValue(input,'enrichTaxId',d.enrichTaxId,'suppliers.enrichTaxId',warnings),
    enrichEmail:booleanValue(input,'enrichEmail',d.enrichEmail,'suppliers.enrichEmail',warnings),
    enrichPhone:booleanValue(input,'enrichPhone',d.enrichPhone,'suppliers.enrichPhone',warnings),
    enrichWebsite:booleanValue(input,'enrichWebsite',d.enrichWebsite,'suppliers.enrichWebsite',warnings),
    enrichAddress:booleanValue(input,'enrichAddress',d.enrichAddress,'suppliers.enrichAddress',warnings),
    onlyFillEmpty:booleanValue(input,'onlyFillEmpty',d.onlyFillEmpty,'suppliers.onlyFillEmpty',warnings),
    detectDuplicates:booleanValue(input,'detectDuplicates',d.detectDuplicates,'suppliers.detectDuplicates',warnings),
    identityThreshold:numberValue(input,'identityThreshold',d.identityThreshold,'suppliers.identityThreshold',warnings,0,100),
  };
}

function normalizeIntegrations(input:AnyRecord|null,warnings:SettingsWarning[]):IntegrationsSettings{
  const d=DEFAULT_APP_SETTINGS.integrations;if(!input)return clone(d);
  const keys=['gmailEnabled','amazonEnabled','sendcloudEnabled','shopifyEnabled'];
  unknownKeys(input,keys,'integrations',warnings);
  return {
    gmailEnabled:booleanValue(input,'gmailEnabled',d.gmailEnabled,'integrations.gmailEnabled',warnings),
    amazonEnabled:booleanValue(input,'amazonEnabled',d.amazonEnabled,'integrations.amazonEnabled',warnings),
    sendcloudEnabled:booleanValue(input,'sendcloudEnabled',d.sendcloudEnabled,'integrations.sendcloudEnabled',warnings),
    shopifyEnabled:booleanValue(input,'shopifyEnabled',d.shopifyEnabled,'integrations.shopifyEnabled',warnings),
  };
}

function normalizeNotification(raw:unknown,d:NotificationSetting,path:string,warnings:SettingsWarning[]):NotificationSetting{
  if(raw===undefined)return clone(d);
  if(!isRecord(raw)){warn(warnings,path,'La alerta debe ser un objeto.');return clone(d);}
  unknownKeys(raw,['enabled','inApp','threshold'],path,warnings);
  let threshold=d.threshold;
  if('threshold' in raw){
    if(raw.threshold===null)threshold=null;
    else if(typeof raw.threshold==='number'&&Number.isFinite(raw.threshold)&&raw.threshold>=-100&&raw.threshold<=100000)threshold=raw.threshold;
    else warn(warnings,`${path}.threshold`,'Umbral no válido.');
  }
  return {
    enabled:booleanValue(raw,'enabled',d.enabled,`${path}.enabled`,warnings),
    inApp:booleanValue(raw,'inApp',d.inApp,`${path}.inApp`,warnings),
    threshold,
  };
}

function normalizeNotifications(input:AnyRecord|null,warnings:SettingsWarning[]):NotificationsSettings{
  const d=DEFAULT_APP_SETTINGS.notifications;if(!input)return clone(d);
  const keys=Object.keys(d) as Array<keyof NotificationsSettings>;
  unknownKeys(input,keys as string[],'notifications',warnings);
  const result={} as NotificationsSettings;
  for(const key of keys)result[key]=normalizeNotification(input[key],d[key],`notifications.${key}`,warnings);
  return result;
}

function normalizeMaintenance(input:AnyRecord|null,warnings:SettingsWarning[]):MaintenanceSettings{
  const d=DEFAULT_APP_SETTINGS.maintenance;if(!input)return clone(d);
  unknownKeys(input,['duplicateCandidateThreshold'],'maintenance',warnings);
  return {duplicateCandidateThreshold:numberValue(input,'duplicateCandidateThreshold',d.duplicateCandidateThreshold,'maintenance.duplicateCandidateThreshold',warnings,0,100)};
}

const SECTION_NAMES: SettingsSection[]=['general','sales','expenses','orders','shipping','amazon','products','clients','suppliers','integrations','notifications','maintenance'];

export function normalizeAppSettings(input:unknown):{value:AppSettings;warnings:SettingsWarning[]}{
  const warnings:SettingsWarning[]=[];
  if(!isRecord(input)){
    warn(warnings,'$','La configuración debe ser un objeto. Se han aplicado los valores predeterminados.');
    return {value:clone(DEFAULT_APP_SETTINGS),warnings};
  }
  unknownKeys(input,SECTION_NAMES,'',warnings);
  const value:AppSettings={
    general:normalizeGeneral(sectionRecord(input,'general',warnings),warnings),
    sales:normalizeSales(sectionRecord(input,'sales',warnings),warnings),
    expenses:normalizeExpenses(sectionRecord(input,'expenses',warnings),warnings),
    orders:normalizeOrders(sectionRecord(input,'orders',warnings),warnings),
    shipping:normalizeShipping(sectionRecord(input,'shipping',warnings),warnings),
    amazon:normalizeAmazon(sectionRecord(input,'amazon',warnings),warnings),
    products:normalizeProducts(sectionRecord(input,'products',warnings),warnings),
    clients:normalizeClients(sectionRecord(input,'clients',warnings),warnings),
    suppliers:normalizeSuppliers(sectionRecord(input,'suppliers',warnings),warnings),
    integrations:normalizeIntegrations(sectionRecord(input,'integrations',warnings),warnings),
    notifications:normalizeNotifications(sectionRecord(input,'notifications',warnings),warnings),
    maintenance:normalizeMaintenance(sectionRecord(input,'maintenance',warnings),warnings),
  };
  return {value,warnings};
}

export function normalizeUserPreferences(input:unknown):{value:UserPreferences;warnings:SettingsWarning[]}{
  const warnings:SettingsWarning[]=[];
  const d=DEFAULT_USER_PREFERENCES;
  if(!isRecord(input)){
    if(input!==undefined)warn(warnings,'$','Las preferencias deben ser un objeto. Se han aplicado los valores predeterminados.');
    return {value:clone(d),warnings};
  }
  const keys=['theme','density','pageSize','startPage','defaultPeriod','rememberFilters','tableColumns','tableColumnOrder','dashboardKpis','filters','labelPrinterId'];
  unknownKeys(input,keys,'',warnings);

  let pageSize=d.pageSize;
  if('pageSize' in input){
    const allowed=[10,20,25,50,100] as const;
    if(typeof input.pageSize==='number'&&allowed.includes(input.pageSize as typeof allowed[number]))pageSize=input.pageSize as UserPreferences['pageSize'];
    else warn(warnings,'pageSize','Tamaño de página no permitido.');
  }

  let startPage=d.startPage;
  if('startPage' in input){
    if(input.startPage===null)startPage=null;
    else if(typeof input.startPage==='string'&&input.startPage.trim())startPage=input.startPage.trim();
    else warn(warnings,'startPage','Página inicial no válida.');
  }

  return {
    value:{
      theme:enumValue(input,'theme',d.theme,'theme',warnings,['system','light','dark']),
      density:enumValue(input,'density',d.density,'density',warnings,['comfortable','compact','spacious']),
      pageSize,
      startPage,
      defaultPeriod:enumValue(input,'defaultPeriod',d.defaultPeriod,'defaultPeriod',warnings,['today','current_month','current_quarter','current_year','all']),
      rememberFilters:booleanValue(input,'rememberFilters',d.rememberFilters,'rememberFilters',warnings),
      tableColumns:recordOfStringArraysValue(input,'tableColumns',d.tableColumns,'tableColumns',warnings),
      tableColumnOrder:recordOfStringArraysValue(input,'tableColumnOrder',d.tableColumnOrder,'tableColumnOrder',warnings),
      dashboardKpis:stringArrayValue(input,'dashboardKpis',d.dashboardKpis,'dashboardKpis',warnings),
      filters:freeRecordValue(input,'filters',d.filters,'filters',warnings),
      labelPrinterId:nullableStringValue(input,'labelPrinterId',d.labelPrinterId,'labelPrinterId',warnings),
    },
    warnings,
  };
}

export function validateSettingsSection<K extends SettingsSection>(section:K,value:AppSettings[K]):string[]{
  const normalized=normalizeAppSettings({[section]:value});
  return normalized.warnings
    .filter(item=>item.path===section||item.path.startsWith(`${section}.`))
    .map(item=>`${item.path}: ${item.message}`);
}
