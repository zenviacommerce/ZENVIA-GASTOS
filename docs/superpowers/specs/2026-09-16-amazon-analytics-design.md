# Diseño — Módulo Amazon Analytics propio

Fecha: 2026-09-16  
Estado: aprobado en conversación; pendiente de revisión final del documento antes de implementación  
Base: `main` @ `312007e4e07357fc1b76b348378c85f5b9a07cbd`

## 1. Objetivo

Construir dentro de ZENVIA Gestión un módulo propio de analítica Amazon, sin depender de Sellerboard para sus cálculos, que consolide todos los marketplaces europeos activos y permita analizar rentabilidad real desde el 01/01/2026.

La V1 debe integrar:

- Amazon Selling Partner API (SP-API) para pedidos, líneas, transacciones financieras, devoluciones/ajustes e inventario.
- Amazon Ads API desde el inicio para gasto publicitario, ventas atribuidas y métricas de campañas/productos.
- Coste histórico de producto ya existente en ZENVIA Gestión para calcular COGS por fecha.
- Conversión de monedas a EUR para la vista consolidada, conservando siempre el importe y moneda originales.
- Sincronización automática cada hora, más sincronización manual administrativa.
- Permiso configurable `amazon` en el sistema de usuarios.
- Accesos externos a Amazon Seller Central y Sellerboard desde el propio módulo.

El resultado debe sentirse como una sección nativa de la aplicación, no como una web externa incrustada.

## 2. Decisiones ya cerradas

Estas decisiones no se reabren durante implementación salvo que aparezca una limitación técnica real:

1. El módulo se construye directamente sobre APIs de Amazon; Sellerboard no será fuente de datos.
2. Se consolidan todos los marketplaces europeos activos desde la primera versión.
3. El histórico inicial empieza el 01/01/2026.
4. Amazon Ads forma parte de la V1.
5. La sincronización ordinaria se ejecuta cada hora.
6. `amazon` será un permiso configurable, no una función exclusiva de administrador.
7. Seller Central y Sellerboard se mantienen como accesos externos en pestaña nueva.
8. No se almacenará PII de compradores (nombre, dirección, email, teléfono). El caso de uso analítico no la necesita.
9. Supabase será el centro de persistencia, sincronización y seguridad.

## 3. Alcance funcional de V1

### 3.1 Navegación y permisos

Añadir `amazon` al tipo `MenuPermission`, a `permissionOptions`, a la restricción de permisos de `app_users` y a las políticas RLS que correspondan.

El menú lateral incorporará una entrada `Amazon` con icono coherente con el resto de la aplicación. Solo será visible para administradores o usuarios a los que se haya concedido el permiso `amazon`.

Al entrar en Amazon se mostrará el dashboard interno. En la cabecera habrá dos acciones secundarias:

- `Seller Central ↗`
- `Sellerboard ↗`

Ambas abrirán una pestaña nueva con `noopener noreferrer` y no formarán parte de la navegación interna.

### 3.2 Dashboard

La V1 tendrá filtros comunes en la parte superior:

- Periodo.
- Marketplace: `Europa consolidado` o un marketplace concreto.
- Producto: búsqueda por nombre, SKU o ASIN.

El periodo inicial por defecto será el año actual, manteniendo opciones rápidas para hoy, mes, trimestre, año y rango personalizado.

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

El dashboard también incluirá:

- Serie temporal de ventas y beneficio.
- Distribución o comparativa por marketplace.
- Tabla de rentabilidad por producto/ASIN/SKU.
- Estado de sincronización: última ejecución correcta, ejecución en curso y error más reciente si existe.

La tabla por producto mostrará al menos:

- Producto Zenvia, si está vinculado.
- ASIN.
- SKU Amazon.
- Marketplace.
- Unidades.
- Ventas netas.
- Fees.
- Ads.
- COGS.
- Beneficio.
- Margen.
- ACOS/TACOS cuando proceda.

### 3.3 Definición de rentabilidad

La V1 distinguirá claramente entre facturación, costes Amazon y rentabilidad para evitar dobles contabilizaciones.

Métricas base:

- `gross_sales`: ingresos brutos del pedido antes de devoluciones, en moneda del marketplace.
- `vat_amount`: impuestos identificados en datos de pedido/transacción cuando estén disponibles.
- `net_sales_ex_vat = gross_sales - vat_amount`.
- `refunds_ex_vat`: devoluciones/ajustes de ingresos normalizados sin IVA cuando sea posible.
- `amazon_fees`: comisiones y cargos Amazon distintos de publicidad y COGS.
- `fba_costs`: subconjunto de fees de logística FBA, separado visualmente pero incluido en costes Amazon totales sin duplicarlo.
- `ad_spend`: gasto Amazon Ads.
- `cogs`: unidades vendidas multiplicadas por el coste histórico correspondiente a la fecha de la operación.

Para no duplicar FBA dentro de fees, el cálculo usará categorías internas de transacciones:

`total_amazon_costs = non_fba_amazon_fees + fba_costs`

Beneficio principal de la V1:

`amazon_profit = net_sales_ex_vat - refunds_ex_vat - total_amazon_costs - ad_spend - cogs`

Margen:

`profit_margin = amazon_profit / net_sales_ex_vat`

Este `amazon_profit` es beneficio de contribución del canal Amazon. No pretende imputar automáticamente alquileres, nóminas u otros gastos generales de la empresa. Si más adelante se desea una cuenta de resultados completa, se añadirá una capa separada de asignación de gastos generales para no mezclar conceptos.

Métricas Ads:

- `ACOS = ad_spend / attributed_ad_sales`.
- `TACOS = ad_spend / gross_sales` del mismo ámbito temporal/producto/marketplace.
- `ROAS = attributed_ad_sales / ad_spend`.

Cuando el denominador sea cero la métrica será `null`, no infinito ni cero artificial.

## 4. Arquitectura

### 4.1 Principio general

El navegador nunca hablará directamente con Amazon ni tendrá secretos de Amazon.

Flujo:

`Amazon SP-API / Amazon Ads -> Supabase Edge Functions -> Postgres -> servicios frontend -> Dashboard Amazon`

Las credenciales estarán en secretos de Supabase. Las tablas de negocio solo contendrán identificadores funcionales, estados de sincronización y datos obtenidos de las APIs.

### 4.2 APIs Amazon

SP-API será una aplicación privada/autorizada para la propia organización. Se solicitarán únicamente los roles necesarios para analítica operativa y financiera.

La implementación se basará en las versiones vigentes al comenzar el desarrollo, actualmente:

- Orders API `v2026-01-01` para pedidos y líneas.
- Finances API `v2024-06-19` para transacciones financieras por fecha/marketplace.
- FBA Inventory API `v1` para disponibilidad e inventario FBA.
- Reports API cuando un informe sea más eficiente o necesario para backfill/reconciliación.
- Sellers API para descubrir/validar marketplaces asociados cuando sea útil.

La región europea usará el endpoint SP-API de Europa. Todos los marketplaces se modelarán por `marketplace_id`; no se codificará lógica dependiente únicamente de España.

Amazon Ads usa autorización y API separadas. Se almacenarán perfiles publicitarios y se asociarán a marketplace/country cuando Amazon permita resolver esa relación.

### 4.3 Seguridad de datos

No se solicitarán ni almacenarán datos restringidos de comprador si no son necesarios para la analítica.

Expresamente fuera de alcance:

- Nombre de comprador.
- Dirección postal.
- Email.
- Teléfono.
- Datos de pago del comprador.

Esto evita convertir el módulo analítico en un repositorio de PII y reduce el alcance de seguridad.

Los secretos mínimos esperados incluyen credenciales LWA/SP-API, refresh token de la aplicación privada y credenciales/tokens de Amazon Ads. Se guardarán en Supabase Secrets/Vault según el uso; nunca en variables `VITE_*`, tablas accesibles al cliente ni código fuente.

### 4.4 Supabase Edge Functions

Separar responsabilidades para que cada función sea pequeña, idempotente y reintentable.

Funciones previstas:

- `amazon-sync-orchestrator`: decide qué sincronizaciones ejecutar y registra el run.
- `amazon-sync-orders`: pedidos y líneas.
- `amazon-sync-finances`: transacciones financieras, refunds y fees.
- `amazon-sync-inventory`: inventario actual por marketplace/SKU.
- `amazon-sync-ads`: reporting diario de Amazon Ads.
- `amazon-sync-fx`: tipos de cambio diarios necesarios para consolidación.
- `amazon-sync-manual`: entrada autenticada solo para administradores que solicita una sincronización manual sin exponer secretos.

Si una operación supera el tiempo razonable de una Edge Function, el orquestador dividirá el trabajo en ventanas y reanudará desde checkpoints. No se intentará procesar el histórico completo en una única invocación.

## 5. Modelo de datos

Todas las tablas de negocio incluirán `owner_id` y seguirán el patrón actual de workspace/RLS mediante `private.app_workspace_owner_id()` y `private.app_has_permission('amazon')`.

### 5.1 Configuración y catálogo

#### `amazon_accounts`

Representa la cuenta Seller conectada, sin guardar secretos reutilizables.

Campos principales:

- `id`
- `owner_id`
- `seller_id`
- `display_name`
- `region` (`EU` en la primera versión)
- `status`
- `initial_sync_from` = `2026-01-01`
- `last_successful_sync_at`
- timestamps

#### `amazon_marketplaces`

- `id`
- `owner_id`
- `amazon_account_id`
- `marketplace_id`
- `country_code`
- `name`
- `currency_code`
- `active`

Restricción única por cuenta + marketplace.

#### `amazon_product_mappings`

Enlace entre catálogo Amazon y producto Zenvia.

- `id`
- `owner_id`
- `marketplace_id`
- `seller_sku`
- `asin`
- `product_id` nullable
- `mapping_source` (`manual`, `sku_exact`, `asin_manual`)
- `confidence` nullable
- timestamps

El SKU de Amazon no se asumirá globalmente único entre marketplaces sin incluir el marketplace en la clave.

### 5.2 Pedidos

#### `amazon_orders`

Una fila por pedido y marketplace.

Campos relevantes:

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

No contiene PII.

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

Ledger normalizado e idempotente.

- `owner_id`
- identificador estable de transacción/evento Amazon
- `marketplace_id`
- `amazon_order_id` nullable
- `seller_sku`/`asin` nullable cuando Amazon los aporte
- `posted_date`
- `transaction_status`
- `transaction_type`
- `category` normalizada: `sale`, `refund`, `referral_fee`, `fba_fee`, `storage_fee`, `other_fee`, `tax`, `adjustment`, etc.
- `amount_original`
- `currency_code`
- `amount_eur`
- `fx_rate`
- JSON de metadatos no sensibles para trazabilidad cuando sea útil
- timestamps

Los upserts usarán una clave natural/compuesta estable derivada de los identificadores devueltos por Amazon. No se insertarán duplicados al repetir una ventana de sincronización.

### 5.4 Inventario

#### `amazon_inventory_current`

Estado actual por marketplace/SKU/ASIN:

- fulfillable
- inbound
- reserved
- unfulfillable
- researching
- `synced_at`

#### `amazon_inventory_daily`

Snapshot diario para poder mostrar evolución de stock sin guardar una copia completa cada hora.

Clave única por owner + marketplace + SKU + fecha.

### 5.5 Ads

#### `amazon_ad_profiles`

- perfil Amazon Ads
- marketplace/country asociado
- currency
- status

#### `amazon_ad_metrics_daily`

Grano diario, por perfil + campaña y, cuando el report lo permita, ASIN/SKU anunciado.

Campos mínimos:

- `date`
- `marketplace_id`
- `profile_id`
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

Los ratios se calculan al consultar; no se guardan como fuente de verdad.

### 5.6 Divisas

#### `fx_rates_daily`

- `date`
- `currency_code`
- `eur_rate`
- `source = ECB`

EUR tendrá tasa 1.

Para fines de consolidación se usará la tasa diaria del BCE disponible para la fecha. Si la fecha cae en fin de semana/festivo sin publicación, se usará la última tasa previa disponible. Se conservará siempre el importe original y la tasa usada para que el cálculo pueda auditarse.

### 5.7 Sincronización

#### `amazon_sync_runs`

- `id`
- `owner_id`
- `source` (`orders`, `finances`, `inventory`, `ads`, `fx`, `orchestrator`)
- `mode` (`initial`, `hourly`, `manual`, `reconcile`)
- `started_at`
- `finished_at`
- `status` (`running`, `success`, `partial`, `failed`)
- `window_from`
- `window_to`
- filas procesadas
- error sanitizado
- metadatos de checkpoint

#### `amazon_sync_state`

Una fila por source/marketplace/perfil con high-water mark y checkpoint del último procesamiento exitoso.

## 6. Sincronización

### 6.1 Backfill inicial

El primer arranque cargará datos desde `2026-01-01T00:00:00`.

Orden recomendado:

1. Cuenta y marketplaces.
2. FX desde 2026-01-01.
3. Pedidos + líneas por ventanas temporales.
4. Finanzas por ventanas y marketplace.
5. Inventario actual + primer snapshot.
6. Ads por ventanas de reporting.
7. Resolución automática de mappings por SKU exacto cuando sea inequívoca.
8. Reconciliación y construcción de métricas.

El backfill será reanudable. Un error en una ventana no invalida lo ya confirmado.

### 6.2 Sincronización horaria

Supabase Cron invocará el orquestador cada hora.

Estrategia:

- Pedidos: high-water mark de última actualización con solape suficiente para absorber cambios tardíos.
- Finanzas: sincronización incremental con solape y upsert; Amazon puede retrasar eventos financieros, por lo que no se asumirá que las últimas horas están cerradas.
- Ads: reconsultar días recientes porque la atribución puede modificarse después de la impresión/clic.
- Inventario: refrescar estado actual cada hora; escribir como máximo un snapshot histórico por día.
- FX: actualizar una vez al día o cuando falte una tasa necesaria; el orquestador horario puede comprobarlo sin descargar de nuevo datos ya existentes.

La sincronización usará ventanas superpuestas e idempotencia como mecanismo de corrección, no una dependencia frágil de “última fila exacta”.

### 6.3 Reconciliación

Además del flujo horario habrá una reconciliación automática de ventana más amplia para absorber:

- refunds posteriores.
- ajustes de fees.
- cambios en atribución Ads.
- eventos financieros publicados con retraso.

La reconciliación será idempotente y no duplicará movimientos.

## 7. Vinculación Amazon ↔ Productos Zenvia

El objetivo es usar el coste histórico real de Zenvia Gestión.

Orden de resolución:

1. Mapping manual existente.
2. Coincidencia exacta y única entre `seller_sku` Amazon y un identificador SKU disponible en producto Zenvia.
3. Sin mapping: se mantiene el ASIN/SKU como “No vinculado” y el COGS queda pendiente, sin inventar un coste.

No se hará fuzzy matching automático que pueda vincular un producto erróneo.

La pantalla Amazon incluirá un pequeño estado de calidad de datos:

- Productos vinculados.
- Productos sin vincular.
- Ventas cuyo COGS no puede calcularse.

El administrador podrá crear/cambiar manualmente el mapping.

### 7.1 Coste histórico

Para cada unidad vendida se buscará el coste confirmado más reciente con fecha menor o igual a la fecha de referencia de la venta/envío.

Si no existe coste anterior pero sí un primer coste posterior cercano, no se aplicará silenciosamente. La fila se marcará como COGS pendiente hasta que el usuario confirme el coste o se defina una regla explícita posterior.

Esto evita presentar como “beneficio real” un importe construido con costes futuros.

## 8. Backend de consulta

El frontend no descargará tablas completas para calcular meses de datos en memoria.

Se expondrán consultas agregadas mediante SQL views/RPC o funciones de repositorio que devuelvan:

- resumen KPI por filtros.
- serie temporal diaria/mensual.
- breakdown por marketplace.
- rentabilidad por producto paginada.
- salud/calidad de mappings.
- estado de sync.

Las agregaciones se harán en Postgres y respetarán `owner_id` + permiso `amazon`.

Los periodos largos podrán usar vistas/materialized views si las mediciones reales muestran que hace falta; no se introduce materialización prematura en la primera iteración.

## 9. UX y estados

### 9.1 Primera conexión

Mientras no existan credenciales/configuración válidas, el módulo mostrará un estado de configuración para administradores y un estado informativo para usuarios normales.

No se expondrán secretos ni campos de token en el frontend regular. La configuración sensible se hará mediante secretos de Supabase y proceso de autorización controlado.

### 9.2 Carga inicial

Durante el backfill se mostrará progreso por fuente, por ejemplo:

- Pedidos: completado hasta fecha X.
- Finanzas: sincronizando.
- Ads: pendiente de autorización / sincronizando / listo.
- Inventario: listo.

El dashboard puede mostrar datos parciales, pero debe identificar claramente qué fuentes aún no están completas para no presentar un beneficio aparentemente definitivo cuando faltan fees o Ads.

### 9.3 Errores

Un fallo en Ads no debe bloquear pedidos/finanzas. Cada fuente tendrá estado independiente.

Errores visibles al usuario serán sanitizados. Detalles técnicos y respuesta externa no sensible pueden mantenerse en `amazon_sync_runs` para depuración; tokens y cabeceras de autorización nunca se guardan en logs.

## 10. RLS y autorización interna

Añadir `amazon` a la lista permitida por el check constraint de `app_users.permissions` sin retirar los permisos existentes actualmente admitidos por migraciones posteriores.

Política general para tablas Amazon:

- `SELECT`: usuarios activos del workspace con permiso `amazon` o rol admin.
- Escrituras de sincronización: service role/Edge Functions, no cliente autenticado.
- Escrituras manuales de mappings: usuarios con permiso `amazon`, con decisión de restringir a admin para cambios sensibles si la implementación actual de administración lo aconseja; para V1 los mappings los podrá modificar únicamente un admin para evitar que un usuario cambie COGS de toda la organización.
- Configuración/conexión/sync manual: admin.

El hecho de que un usuario tenga `amazon` permite consultar analítica, no acceder a credenciales ni reautorizar la cuenta.

## 11. Pruebas

La implementación seguirá TDD para lógica de negocio.

Pruebas mínimas:

### Frontend/permisos

- `amazon` aparece como permiso configurable.
- Usuario sin permiso no puede navegar al módulo.
- Admin sí puede acceder.
- Enlaces externos usan nueva pestaña y atributos seguros.
- Filtros actualizan todos los bloques del dashboard de forma coherente.

### Cálculos

- Beneficio con todos los componentes.
- Separación FBA/non-FBA sin doble conteo.
- Refunds.
- IVA.
- ACOS/TACOS/ROAS y división por cero.
- Conversión EUR.
- COGS histórico por fecha.
- COGS ausente no inventa coste.

### Sincronización

- Reprocesar una misma ventana no duplica pedidos, líneas, finanzas ni Ads.
- Checkpoint avanza solo cuando la ventana termina correctamente.
- Un source puede fallar sin invalidar otros.
- Refresh de Ads actualiza métricas atribuidas existentes.
- Finanzas con eventos tardíos corrigen el ledger existente.

### Seguridad

- Tablas Amazon no son visibles para un usuario sin `amazon`.
- Cliente no puede escribir ledger ni sync state.
- No hay secretos en bundle Vite.
- Fixtures y logs no contienen PII/tokens.

### Regresión

- `npm test` / `node --test scripts/*.test.mjs` según el CI actual.
- `npm run build`.
- Comprobación de CI GitHub antes de merge.

## 12. Entrega por fases técnicas

Aunque el objetivo funcional sea una V1 única, la implementación se dividirá en PRs revisables para reducir riesgo.

### Fase A — Shell + permiso Amazon

- permiso `amazon` completo.
- entrada de menú.
- página Amazon vacía/estado de conexión.
- enlaces Seller Central/Sellerboard.
- tests de acceso.

### Fase B — Esquema y núcleo de sincronización SP-API

- migraciones Amazon.
- secretos/documentación de configuración.
- cliente LWA/SP-API server-side.
- sync runs/state.
- marketplaces.
- pedidos/líneas.
- finanzas.
- inventario.
- backfill desde 01/01/2026.

### Fase C — Producto/COGS/FX

- mapping Amazon ↔ Zenvia.
- FX diario.
- resolución de coste histórico.
- agregaciones y métricas de rentabilidad sin Ads.

### Fase D — Amazon Ads

- autorización Ads.
- perfiles.
- reporting diario.
- ACOS/TACOS/ROAS.
- incorporación de Ads al beneficio.

### Fase E — Dashboard completo + automatización

- KPI y gráficos.
- tabla de producto.
- filtros.
- estados de calidad de datos.
- Cron horario.
- sincronización manual admin.
- reconciliación.

No se desplegará una fase que muestre un KPI de “beneficio” como definitivo si falta una fuente necesaria; hasta entonces se etiquetará el estado como incompleto o se ocultará la métrica.

## 13. Despliegue

El flujo de entrega seguirá el existente:

1. Trabajo en rama.
2. Tests y build.
3. Pull request.
4. CI verde.
5. Merge a `main`.
6. Vercel despliega por su integración GitHub existente.

No se realizará un despliegue manual de Vercel para una release normal.

Las migraciones y Edge Functions de Supabase deben desplegarse de forma controlada antes o junto con el frontend que dependa de ellas. Las migraciones deben ser aditivas y compatibles con el frontend anterior durante la ventana de despliegue siempre que sea posible.

## 14. Observabilidad y aceptación

La V1 se considera funcional cuando:

- Un admin puede configurar/autorizar las integraciones necesarias sin exponer secretos al cliente.
- El backfill desde 01/01/2026 termina para todos los marketplaces europeos activos.
- La ejecución horaria actualiza fuentes sin duplicados.
- El dashboard consolidado y por marketplace devuelve cifras coherentes con Amazon para muestras verificadas.
- Ads aparece integrado en rentabilidad.
- La tabla por producto puede explicar de dónde sale el beneficio de una muestra concreta.
- Los SKUs no mapeados se ven claramente y no reciben COGS inventado.
- Los usuarios sin permiso `amazon` no pueden leer las tablas ni abrir el módulo.
- No se almacena PII de comprador.
- CI y build están verdes antes del merge final.

## 15. Fuera de alcance de V1

- Automatizar pujas o modificar campañas Ads.
- Crear/modificar listings de Amazon.
- Gestionar mensajes de compradores.
- Descargar o almacenar PII de compradores.
- Sustituir Seller Central como herramienta operativa.
- Asignación automática de todos los gastos generales de la empresa al canal Amazon.
- Integración de otros marketplaces no Amazon.
- Predicciones de demanda/IA de reposición.

Estos puntos pueden añadirse después sin cambiar el núcleo de datos definido aquí.

## 16. Referencias técnicas verificadas

- Amazon SP-API Registration Overview: las private seller applications son para la propia organización y se autoautorizan; requieren cuenta Professional.
- Amazon Orders API: versión vigente v2026-01-01.
- Amazon Finances API: versión vigente v2024-06-19; permite recuperar transacciones por tiempo y marketplace y los eventos pueden publicarse con retraso.
- Amazon FBA Inventory API: v1, inventario FBA por marketplace.
- Amazon Ads API: requiere registro/aprobación de acceso independiente para anunciantes directos.
- Supabase: `pg_cron` + `pg_net` puede invocar Edge Functions programadamente; secretos deben mantenerse fuera del cliente.

Documentación pública consultada durante el diseño:

- https://developer-docs.amazon.com/sp-api/docs/sp-api-registration-overview
- https://developer-docs.amazon.com/sp-api/docs/register-as-a-private-developer
- https://developer-docs.amazon.com/sp-api/docs/orders-api
- https://developer-docs.amazon.com/sp-api/lang-zh_CN/docs/finances-api
- https://developer-docs.amazon.com/sp-api/lang-en_EN/docs/fba-inventory-api
- https://advertising.amazon.com/about-api
- https://supabase.com/docs/guides/functions/schedule-functions
