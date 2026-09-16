# Amazon Analytics Phase B Spec

Fecha: 2026-09-16
Estado: aprobado como continuación del diseño Amazon Analytics V1
Base de implementación: `main` @ `9d9cc5155c8e6f987767efe1f4ae2b333b84a7a2`

## Objetivo

Implementar el núcleo SP-API del módulo Amazon Analytics sin tocar todavía COGS/FX/Ads ni el dashboard final. La Fase B deja persistencia, seguridad, sincronización y backfill listos para pedidos, finanzas e inventario de todos los marketplaces europeos activos.

## Alcance

- Tablas: `amazon_accounts`, `amazon_marketplaces`, `amazon_orders`, `amazon_order_items`, `amazon_finance_transactions`, `amazon_inventory_current`, `amazon_inventory_daily`, `amazon_sync_runs`, `amazon_sync_state`, `amazon_sync_jobs`.
- RLS por workspace usando `private.app_workspace_owner_id()` y `private.app_has_permission('amazon')`.
- Lectura por usuarios con permiso `amazon`; escrituras de ledger/sync solo backend.
- Cliente SP-API server-side con LWA.
- Europe endpoint: `https://sellingpartnerapi-eu.amazon.com`.
- Orders API `v2026-01-01`.
- Finances API `v2024-06-19`.
- FBA Inventory API `v1`.
- Backfill desde `2026-01-01T00:00:00Z`, dividido en jobs reanudables e idempotentes.
- Sincronización ordinaria cada hora; worker en lotes cortos.
- No almacenar PII de comprador: nombre, dirección, email, teléfono ni datos de pago.
- La Fase B no modifica producción hasta aprobación explícita de integración.

## Autenticación Amazon

Credenciales en secreto server-side `AMAZON_SPAPI_CREDENTIALS` como JSON:

```json
{
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "...",
  "seller_id": "..."
}
```

La función obtiene un LWA access token mediante `POST https://api.amazon.com/auth/o2/token` con `grant_type=refresh_token`. El token se envía a SP-API como `x-amz-access-token`. Se incluye `user-agent` y `x-amz-date`. No se exponen credenciales ni tokens al navegador.

## Seguridad Supabase

- Todas las tablas públicas tienen RLS habilitado.
- SELECT: usuario activo del mismo workspace con permiso `amazon` o admin.
- INSERT/UPDATE/DELETE: no se conceden al cliente para ledger, órdenes, finanzas, inventario ni tablas de sincronización.
- Edge Functions internas usan clave secreta del backend y validan el `owner_id` del trabajo.
- Endpoint manual requiere sesión de usuario + `app_is_admin()`.
- No usar `user_metadata` para autorización.

## Sincronización

### Jobs

`amazon_sync_jobs` es la cola persistente. Cada job define `source`, marketplace/perfil cuando aplique, ventana temporal, intentos, estado y lock.

La toma de job debe ser atómica con una función SQL privada/RPC backend que haga `FOR UPDATE SKIP LOCKED`, marque `running` y devuelva un lote pequeño.

### Orquestador

- Modo `initial`: crea jobs de backfill desde 2026-01-01 por ventanas pequeñas.
- Modo `hourly`: crea jobs desde el high-water mark con solape de seguridad para absorber actualizaciones tardías.
- Modo `manual`: igual que hourly pero disparado por admin.
- Nunca crear duplicados equivalentes: índice único lógico por owner/source/marketplace/window/status activo o clave derivada.

### Worker

Consume pocos jobs por ejecución y delega al handler de source. Un error incrementa attempts, guarda error sanitizado y reprograma con backoff mientras no supere `max_attempts`.

## Pedidos

Usar Orders `v2026-01-01` y solicitar solo datos analíticos no PII mediante `includedData` apropiado (por ejemplo proceeds/expense/tax cuando sea necesario), excluyendo `BUYER` y `RECIPIENT`.

Persistir pedido + líneas con claves únicas estables por owner/marketplace/order y owner/marketplace/order/item. Upsert idempotente.

## Finanzas

Usar `GET /finances/2024-06-19/transactions`, paginando con `nextToken`. Persistir hasta 500 transacciones por página según la API. Normalizar categoría sin destruir el payload no sensible necesario para trazabilidad.

La clave de idempotencia se deriva de identificadores Amazon + marketplace + tipo/fecha/importe cuando la API no exponga un único ID universal.

## Inventario

Usar FBA Inventory API v1. `amazon_inventory_current` representa el estado vigente; `amazon_inventory_daily` guarda un snapshot máximo por día y SKU/marketplace.

## Programación

Supabase Cron/`pg_cron` + HTTP a Edge Functions será el mecanismo objetivo. La migración debe habilitar únicamente las extensiones necesarias y documentar la configuración. Los endpoints internos deben usar autenticación server-to-server y nunca aceptar llamadas anónimas.

## Fuera de alcance de esta fase

- Amazon Ads.
- FX y conversión EUR.
- Product mappings/COGS.
- KPIs finales de rentabilidad y dashboard completo.
- PII de compradores.

## Referencias verificadas 2026-09-16

- https://developer-docs.amazon.com/sp-api/docs/orders-api
- https://developer-docs.amazon.com/sp-api/docs/orders-api-migration-guide
- https://developer-docs.amazon.com/sp-api/lang-de_DE/docs/finances-api-v2024-06-19-use-case-guide
- https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api
- https://developer-docs.amazon.com/sp-api/lang-es_ES/docs/sp-api-endpoints
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/functions/limits
