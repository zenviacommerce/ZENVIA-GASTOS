# Diseño — Módulo Amazon Analytics propio

Fecha: 2026-09-16  
Estado: aprobado en conversación; pendiente de revisión final del documento antes de implementación  
Base: `main` @ `312007e4e07357fc1b76b348378c85f5b9a07cbd`

## 1. Objetivo

Construir dentro de ZENVIA Gestión un módulo propio de analítica Amazon, sin depender de Sellerboard para sus cálculos, que consolide todos los marketplaces europeos activos y permita analizar rentabilidad desde el 01/01/2026.

La V1 integra:

- Amazon Selling Partner API (SP-API) para pedidos, líneas, transacciones financieras, devoluciones/ajustes e inventario.
- Amazon Ads API desde el inicio para gasto publicitario, ventas atribuidas y métricas de campañas/productos.
- Coste histórico de producto ya existente en ZENVIA Gestión para calcular COGS por fecha.
- Conversión de monedas a EUR para la vista consolidada, conservando importe y moneda originales.
- Sincronización automática cada hora, backfill reanudable y sincronización manual administrativa.
- Permiso configurable `amazon` en el sistema de usuarios.
- Accesos externos a Amazon Seller Central y Sellerboard desde el propio módulo.

El resultado debe sentirse como una sección nativa de la aplicación, no como una web externa incrustada.

## 2. Decisiones cerradas

1. El módulo se construye directamente sobre APIs de Amazon; Sellerboard no será fuente de datos.
2. Se consolidan todos los marketplaces europeos activos desde la primera versión.
3. El histórico inicial empieza el 01/01/2026.
4. Amazon Ads forma parte de la V1.
5. La sincronización ordinaria se ejecuta cada hora.
6. `amazon` será un permiso configurable, no una función exclusiva de administrador.
7. Seller Central y Sellerboard se mantienen como accesos externos en pestaña nueva.
8. No se almacenará PII de compradores (nombre, dirección, email, teléfono). El caso de uso analítico no la necesita.
9. Supabase será el centro de persistencia, sincronización y seguridad.
10. Vercel seguirá desplegando el frontend desde GitHub; no se usará despliegue manual para releases normales.

## 3. Alcance funcional de V1

### 3.1 Navegación y permisos

Añadir `amazon` al tipo `MenuPermission`, a `permissionOptions`, a la restricción efectiva de permisos de `app_users` y a las políticas RLS necesarias, conservando todos los permisos admitidos por migraciones posteriores.

El menú lateral incorporará una entrada `Amazon` con icono coherente con el resto de la aplicación. Solo será visible para administradores o usuarios con permiso `amazon`.

Al entrar en Amazon se mostrará el dashboard interno. En su cabecera habrá dos acciones secundarias:

- `Seller Central ↗`
- `Sellerboard ↗`

Ambas abrirán una pestaña nueva con `noopener noreferrer` y no formarán parte de la navegación interna.

### 3.2 Dashboard

Filtros comunes:

- Periodo.
- Marketplace: `Europa consolidado` o marketplace concreto.
- Producto: búsqueda por nombre, SKU o ASIN.

El periodo inicial por defecto será el año actual. Habrá accesos rápidos para hoy, mes, trimestre, año y rango personalizado.

KPIs mínimos:

- Ventas brutas.
- Ventas netas de IVA.
- Pedidos.
- Unidades.
- Reembolsos y ajustes.
- Fees Amazon.
- Costes FBA.
- Gasto Ads.
- Ventas atribuidas a Ads.
- ACOS.
- TACOS.
- ROAS.
- COGS.
- Beneficio Amazon.
- Margen de beneficio.

También incluirá:

- Serie temporal de ventas y beneficio.
- Comparativa por marketplace.
- Tabla de rentabilidad por producto/ASIN/SKU.
- Estado de calidad de datos: mappings pendientes, COGS pendiente y gasto Ads no asignable a producto.
- Estado de sincronización: última ejecución correcta, ejecución en curso y error más reciente si existe.

La tabla por producto mostrará al menos producto Zenvia, ASIN, SKU Amazon, marketplace, unidades, ventas netas, fees, Ads atribuibles, COGS, beneficio, margen y ACOS/TACOS cuando proceda.

### 3.3 Definición de rentabilidad

La V1 separará ingresos, costes Amazon y rentabilidad para evitar dobles contabilizaciones.

Métricas base:

- `gross_sales`: ingresos brutos antes de devoluciones.
- `vat_amount`: impuestos identificados en los datos Amazon cuando estén disponibles.
- `net_sales_ex_vat = gross_sales - vat_amount`.
- `refunds_ex_vat`: devoluciones/ajustes de ingresos normalizados sin IVA cuando sea posible.
- `non_fba_amazon_fees`: comisiones/cargos Amazon distintos de logística FBA, publicidad y COGS.
- `fba_costs`: cargos logísticos FBA.
- `ad_spend`: gasto Amazon Ads.
- `cogs`: unidades vendidas multiplicadas por el coste histórico aplicable en la fecha de referencia.

`total_amazon_costs = non_fba_amazon_fees + fba_costs`

`amazon_profit = net_sales_ex_vat - refunds_ex_vat - total_amazon_costs - ad_spend - cogs`

`profit_margin = amazon_profit / net_sales_ex_vat`

Este `amazon_profit` es beneficio de contribución del canal Amazon. No imputa automáticamente alquileres, nóminas u otros gastos generales de empresa. Una futura cuenta de resultados global tendrá una capa separada de asignación de overhead.

Métricas Ads:

- `ACOS = ad_spend / attributed_ad_sales`.
- `TACOS = ad_spend / gross_sales` del mismo ámbito temporal/producto/marketplace.
- `ROAS = attributed_ad_sales / ad_spend`.

Cuando el denominador sea cero la métrica será `null`.

Para el beneficio total de marketplace se incluirá todo el gasto Ads. Para rentabilidad por producto solo se imputará gasto cuando Amazon proporcione una relación verificable con ASIN/SKU. El gasto de campañas que no pueda asignarse sin arbitrariedad se conservará como `unallocated_ad_spend`: afectará al beneficio consolidado pero no se repartirá artificialmente entre productos. La UI mostrará esa diferencia para que la suma de filas pueda explicarse.

## 4. Arquitectura

### 4.1 Principio general

El navegador nunca hablará directamente con Amazon ni tendrá secretos de Amazon.

`Amazon SP-API / Amazon Ads -> Supabase Edge Functions -> Postgres -> servicios frontend -> Dashboard Amazon`

Las credenciales estarán en secretos de Supabase. Las tablas de negocio solo contendrán identificadores funcionales, estados de sincronización y datos no sensibles obtenidos de las APIs.

### 4.2 APIs Amazon

SP-API será una aplicación privada para la propia organización y autoautorizada. Se solicitarán únicamente los roles necesarios para analítica operativa y financiera.

Versiones verificadas al redactar el diseño:

- Orders API `v2026-01-01` para pedidos y líneas.
- Finances API `v2024-06-19` para transacciones financieras por fecha/marketplace.
- FBA Inventory API `v1` para inventario FBA.
- Reports API cuando sea más eficiente o necesario para backfill/reconciliación.
- Sellers API para descubrir/validar marketplaces asociados cuando aporte valor.

La región europea usará el endpoint SP-API de Europa. Todo se modelará por `marketplace_id`; no habrá lógica limitada a España.

Amazon Ads usa autorización y API separadas. Cada perfil publicitario se asociará a un marketplace mediante los identificadores/país/moneda devueltos por Amazon. Si un perfil no puede asociarse de forma inequívoca, quedará marcado `unmapped` y sus datos no se mezclarán silenciosamente con otro marketplace.

### 4.3 Seguridad de datos

No se solicitarán ni almacenarán datos restringidos de comprador si no son necesarios.

Fuera de alcance explícito:

- Nombre de comprador.
- Dirección postal.
- Email.
- Teléfono.
- Datos de pago del comprador.

Los secretos mínimos esperados incluyen credenciales LWA/SP-API, refresh token de la aplicación privada y credenciales/tokens de Amazon Ads. Se guardarán en Supabase Secrets/Vault según el uso; nunca en variables `VITE_*`, tablas accesibles al cliente ni código fuente.

### 4.4 Edge Functions y trabajos de sincronización

Las unidades de trabajo deben ser pequeñas, idempotentes y reintentables.

Funciones previstas:

- `amazon-sync-orchestrator`: crea trabajos para cada fuente/marketplace/ventana y registra el run.
- `amazon-sync-worker`: consume trabajos pendientes de forma acotada.
- `amazon-sync-orders`: lógica de pedidos y líneas para una ventana.
- `amazon-sync-finances`: transacciones, refunds y fees para una ventana.
- `amazon-sync-inventory`: inventario actual por marketplace/SKU.
- `amazon-sync-ads`: reporting de Ads para una ventana/perfil.
- `amazon-sync-fx`: tipos de cambio diarios necesarios.
- `amazon-sync-manual`: endpoint autenticado solo para admin que solicita una sincronización manual.

La cola se implementará en Postgres mediante `amazon_sync_jobs`, de forma que sea auditable y no dependa de mantener una Edge Function abierta. El orquestador horario encola; un worker programado con frecuencia corta consume lotes pequeños. El requisito de producto sigue siendo “actualizar Amazon cada hora”; la frecuencia interna del worker es un detalle técnico para completar trabajos y backfills sin exceder límites de ejecución.

El backfill completo nunca se procesará en una única invocación.

## 5. Modelo de datos

Todas las tablas de negocio incluirán `owner_id` y seguirán el patrón actual de workspace/RLS con `private.app_workspace_owner_id()` y `private.app_has_permission('amazon')`.

### 5.1 Configuración y catálogo

#### `amazon_accounts`

- `id`
- `owner_id`
- `seller_id`
- `display_name`
- `region` (`EU` en V1)
- `status`
- `initial_sync_from` = `2026-01-01`
- `last_successful_sync_at`
- timestamps

No guarda secretos reutilizables.

#### `amazon_marketplaces`

- `id`
- `owner_id`
- `amazon_account_id`
- `marketplace_id`
- `country_code`
- `name`
- `currency_code`
- `active`

Único por cuenta + marketplace.

#### `amazon_product_mappings`

- `id`
- `owner_id`
- `marketplace_id`
- `seller_sku`
- `asin`
- `product_id` nullable
- `mapping_source` (`manual`, `sku_exact`, `asin_manual`)
- timestamps

El SKU no se considerará globalmente único sin marketplace.

### 5.2 Pedidos

#### `amazon_orders`

Una fila por pedido + marketplace:

- `owner_id`
- `amazon_order_id`
- `marketplace_id`
- `purchase_date`
- `last_update_date`
- `order_status`
- `fulfillment_channel`
- `currency_code`
- importes no sensibles disponibles
- timestamps de sincronización

Sin PII.

#### `amazon_order_items`

- `owner_id`
- `amazon_order_id`
- `marketplace_id`
- `order_item_id`
- `asin`
- `seller_sku`
- `quantity_ordered`
- `quantity_shipped`
- componentes de precio/impuesto/descuento relevantes
- `currency_code`
- `product_id` nullable resuelto mediante mapping

### 5.3 Finanzas

#### `amazon_finance_transactions`

Ledger normalizado e idempotente:

- `owner_id`
- identificador estable de transacción/evento Amazon
- `marketplace_id`
- `amazon_order_id` nullable
- `seller_sku`/`asin` nullable cuando Amazon los aporte
- `posted_date`
- `transaction_status`
- `transaction_type`
- `category` normalizada (`sale`, `refund`, `referral_fee`, `fba_fee`, `storage_fee`, `other_fee`, `tax`, `adjustment`, etc.)
- `amount_original`
- `currency_code`
- `amount_eur`
- `fx_rate`
- metadatos JSON no sensibles para trazabilidad cuando sean útiles
- timestamps

Los upserts usarán una clave estable derivada de identificadores Amazon. Repetir una ventana no insertará duplicados.

### 5.4 Inventario

#### `amazon_inventory_current`

Estado actual por marketplace/SKU/ASIN: fulfillable, inbound, reserved, unfulfillable, researching y `synced_at`.

#### `amazon_inventory_daily`

Snapshot diario. Clave única por owner + marketplace + SKU + fecha. No se guardará una copia histórica completa cada hora.

### 5.5 Ads

#### `amazon_ad_profiles`

Perfil, marketplace/country asociado, currency y status.

#### `amazon_ad_metrics_daily`

Grano diario con `scope_type` (`campaign`, `product`) para conservar tanto gasto total como atribución de producto.

Campos mínimos:

- `date`
- `marketplace_id`
- `profile_id`
- `scope_type`
- `campaign_id`
- `campaign_name`
- `asin` nullable
- `seller_sku` nullable
- `impressions`
- `clicks`
- `spend_original`
- `spend_eur`
- `attributed_sales_original`
- `attributed_sales_eur`
- `attributed_orders`
- `attributed_units`

Los ratios se calculan al consultar; no se guardan como fuente de verdad. La agregación total usará el grano de campaña para no duplicar gasto; la tabla por producto usará solo filas `product` atribuibles.

### 5.6 Divisas

#### `fx_rates_daily`

- `date`
- `currency_code`
- `eur_rate`
- `source = ECB`

EUR = 1. Para consolidación se usará la tasa diaria del BCE disponible para la fecha. En fin de semana/festivo se aplicará la última tasa previa disponible. Se conservarán importe original y tasa aplicada.

### 5.7 Sincronización

#### `amazon_sync_runs`

- `id`, `owner_id`
- `source` (`orders`, `finances`, `inventory`, `ads`, `fx`, `orchestrator`)
- `mode` (`initial`, `hourly`, `manual`, `reconcile`)
- `started_at`, `finished_at`
- `status` (`running`, `success`, `partial`, `failed`)
- `window_from`, `window_to`
- filas procesadas
- error sanitizado
- metadatos de checkpoint

#### `amazon_sync_state`

Una fila por source + marketplace/perfil con high-water mark/checkpoint del último procesamiento exitoso.

#### `amazon_sync_jobs`

Cola persistente:

- `id`, `owner_id`
- `source`
- marketplace/perfil nullable según source
- `window_from`, `window_to`
- `status` (`queued`, `running`, `success`, `failed`)
- `attempts`, `max_attempts`
- `available_at`
- `locked_at`
- `last_error`
- timestamps

La toma de trabajos debe ser atómica para evitar que dos workers procesen la misma fila simultáneamente.

## 6. Sincronización

### 6.1 Backfill inicial

Desde `2026-01-01T00:00:00`:

1. Cuenta y marketplaces.
2. FX.
3. Pedidos + líneas por ventanas.
4. Finanzas por ventanas y marketplace.
5. Inventario actual + primer snapshot.
6. Ads por ventanas/perfiles.
7. Mappings automáticos por SKU exacto cuando sean inequívocos.
8. Reconciliación y agregados.

Será reanudable. Un fallo de una ventana no invalida otras ya confirmadas.

### 6.2 Sincronización horaria

Supabase Cron ejecutará el orquestador cada hora.

- Pedidos: high-water mark de última actualización + solape.
- Finanzas: incremental + solape + upsert; no se considerarán cerradas las últimas horas.
- Ads: reconsulta de días recientes porque la atribución puede cambiar.
- Inventario: refresco actual cada hora; máximo un snapshot histórico diario.
- FX: solo cuando falten fechas/monedas necesarias.

El worker ejecutará lotes pequeños y reintentará errores transitorios con `available_at` creciente, sin reintentos infinitos.

### 6.3 Reconciliación

Habrá una reconciliación automática de ventana más amplia para absorber refunds posteriores, ajustes de fees, cambios de atribución Ads y eventos financieros tardíos. Será idempotente.

## 7. Vinculación Amazon ↔ Productos Zenvia

Orden de resolución:

1. Mapping manual existente.
2. Coincidencia exacta y única entre `seller_sku` Amazon y un SKU existente de Zenvia.
3. Sin mapping: queda `No vinculado`; el COGS no se inventa.

No habrá fuzzy matching automático.

La pantalla mostrará productos vinculados, productos sin vincular y ventas cuyo COGS no puede calcularse. Los mappings los podrá modificar solo un admin en V1, aunque cualquier usuario con permiso `amazon` podrá ver el resultado analítico.

### 7.1 Coste histórico

Para cada unidad vendida se buscará el coste confirmado más reciente con fecha menor o igual a la fecha de referencia de la venta/envío.

Si no existe coste anterior, un coste posterior no se aplicará silenciosamente. La fila quedará con COGS pendiente hasta resolverla explícitamente.

## 8. Backend de consulta

El frontend no descargará tablas completas para calcular meses de datos en memoria.

Se expondrán consultas agregadas mediante SQL views/RPC o servicios de repositorio para:

- resumen KPI por filtros.
- serie temporal.
- breakdown por marketplace.
- rentabilidad por producto paginada.
- calidad de mappings/COGS/Ads no asignado.
- estado de sync.

Las agregaciones se ejecutarán en Postgres y respetarán `owner_id` + permiso `amazon`. Se introducirán materialized views solo si las mediciones reales de rendimiento lo justifican.

## 9. UX y estados

### 9.1 Sin conexión

Sin configuración válida, el módulo mostrará estado de configuración a admin y estado informativo al usuario normal. No se mostrarán tokens en frontend.

### 9.2 Backfill en curso

Se mostrará progreso por fuente: pedidos, finanzas, Ads, inventario y FX. El dashboard puede mostrar datos parciales, pero cualquier KPI que dependa de una fuente aún incompleta se marcará como `Datos incompletos` y no se presentará como definitivo.

### 9.3 Errores

Un fallo en Ads no bloquea pedidos/finanzas. Cada fuente tiene estado independiente. Los errores visibles serán sanitizados; tokens y cabeceras de autorización nunca se guardan en logs.

## 10. RLS y autorización interna

Añadir `amazon` al check constraint efectivo de `app_users.permissions` conservando el resto de permisos admitidos actualmente.

- `SELECT` de datos Amazon: usuario activo del workspace con permiso `amazon` o admin.
- Escrituras de ledger/sync: service role/Edge Functions; no cliente autenticado.
- Mapping manual: admin.
- Configuración, autorización y sync manual: admin.

Tener permiso `amazon` permite consultar analítica, no acceder a credenciales ni reautorizar la cuenta.

## 11. Pruebas

La implementación seguirá TDD para lógica de negocio.

### Frontend/permisos

- `amazon` aparece como permiso configurable.
- Usuario sin permiso no puede navegar al módulo ni leer sus datos.
- Admin y usuario autorizado sí pueden acceder.
- Enlaces externos abren pestaña nueva de forma segura.
- Filtros afectan coherentemente a todos los bloques.

### Cálculos

- Beneficio con todos sus componentes.
- Separación FBA/non-FBA sin doble conteo.
- Refunds e IVA.
- ACOS/TACOS/ROAS y división por cero.
- Gasto Ads no asignable no se reparte a productos.
- Conversión EUR.
- COGS histórico por fecha.
- COGS ausente no inventa coste.

### Sincronización

- Reprocesar una ventana no duplica pedidos, líneas, finanzas ni Ads.
- Checkpoint avanza solo tras éxito.
- Lock de jobs evita doble procesamiento concurrente.
- Un source puede fallar sin invalidar otros.
- Refresh Ads actualiza atribución previa.
- Eventos financieros tardíos corrigen el ledger.

### Seguridad

- RLS bloquea usuarios sin permiso.
- Cliente no puede escribir ledger/sync state/jobs.
- No hay secretos en bundle Vite.
- Fixtures y logs no contienen PII/tokens.

### Regresión

- `node --test scripts/*.test.mjs` según CI actual.
- `npm run build`.
- CI GitHub verde antes de merge.

## 12. Entrega por fases técnicas

### Fase A — Shell + permiso Amazon

- permiso `amazon` completo.
- entrada de menú.
- página Amazon/estado de conexión.
- enlaces Seller Central/Sellerboard.
- tests de acceso.

### Fase B — Esquema + núcleo SP-API

- migraciones Amazon.
- secretos/documentación de configuración.
- cliente LWA/SP-API server-side.
- sync runs/state/jobs + worker.
- marketplaces.
- pedidos/líneas.
- finanzas.
- inventario.
- backfill desde 01/01/2026.

### Fase C — Producto/COGS/FX

- mapping Amazon ↔ Zenvia.
- FX diario.
- coste histórico.
- agregaciones/rentabilidad sin Ads.

### Fase D — Amazon Ads

- autorización Ads.
- perfiles.
- reporting campaña/producto.
- ACOS/TACOS/ROAS.
- gasto Ads no asignable.
- Ads incorporado a beneficio consolidado.

### Fase E — Dashboard + automatización final

- KPIs, gráficos y tabla producto.
- filtros.
- estados de calidad.
- Cron horario.
- sync manual admin.
- reconciliación.

No se mostrará un KPI de beneficio como definitivo si falta una fuente necesaria.

## 13. Despliegue

1. Trabajo en rama.
2. Tests y build.
3. Pull request.
4. CI verde.
5. Merge a `main`.
6. Vercel despliega por la integración GitHub existente.

Las migraciones y Edge Functions de Supabase se desplegarán de forma controlada antes o junto con el frontend que dependa de ellas. Las migraciones serán aditivas y compatibles con el frontend anterior durante la ventana de despliegue siempre que sea posible.

## 14. Criterios de aceptación

La V1 se considera funcional cuando:

- Un admin puede completar la configuración/autorización sin exponer secretos al cliente.
- El backfill desde 01/01/2026 termina para todos los marketplaces europeos activos.
- La ejecución horaria actualiza fuentes sin duplicados.
- Dashboard consolidado y por marketplace coincide razonablemente con muestras verificadas contra Amazon, explicando desfases temporales conocidos.
- Ads está integrado en rentabilidad.
- Una muestra de producto permite explicar ventas, fees, Ads atribuible, COGS y beneficio.
- El gasto Ads no asignable queda visible y no se reparte arbitrariamente.
- SKUs no mapeados quedan visibles y no reciben COGS inventado.
- Usuarios sin `amazon` no pueden leer tablas ni abrir módulo.
- No se almacena PII de comprador.
- CI y build están verdes antes del merge final.

## 15. Fuera de alcance de V1

- Automatizar pujas o modificar campañas Ads.
- Crear/modificar listings.
- Gestionar mensajes de compradores.
- Descargar/almacenar PII de compradores.
- Sustituir Seller Central como herramienta operativa.
- Asignar automáticamente gastos generales de empresa al canal Amazon.
- Integrar marketplaces no Amazon.
- Predicción de demanda/IA de reposición.

## 16. Referencias técnicas verificadas

- Amazon SP-API Registration Overview: las private seller applications son para la propia organización y se autoautorizan; requieren cuenta Professional.
- Amazon Orders API: versión vigente `v2026-01-01`.
- Amazon Finances API: versión vigente `v2024-06-19`; permite transacciones por tiempo/marketplace y existen eventos que pueden publicarse con retraso.
- Amazon FBA Inventory API: `v1`, inventario FBA por marketplace.
- Amazon Ads API: requiere registro/aprobación de acceso independiente para anunciantes directos.
- Supabase: Cron puede invocar Edge Functions programadamente; las funciones deben mantenerse acotadas e idempotentes y los secretos fuera del cliente.

Documentación consultada:

- https://developer-docs.amazon.com/sp-api/docs/sp-api-registration-overview
- https://developer-docs.amazon.com/sp-api/docs/register-as-a-private-developer
- https://developer-docs.amazon.com/sp-api/docs/orders-api
- https://developer-docs.amazon.com/sp-api/lang-zh_CN/docs/finances-api
- https://developer-docs.amazon.com/sp-api/lang-en_EN/docs/fba-inventory-api
- https://advertising.amazon.com/about-api
- https://supabase.com/docs/guides/functions/schedule-functions
