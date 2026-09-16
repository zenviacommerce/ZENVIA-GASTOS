# Configuración de Amazon SP-API para ZENVIA Gestión

## 1. Tipo de aplicación

Usar una **aplicación privada** de SP-API para la propia organización ZENVIA COMMERCE. Las aplicaciones privadas se autoautorizan desde Solution Provider Portal y generan un LWA refresh token.

## 2. Roles mínimos

Para esta Fase B la aplicación debe disponer de roles que permitan:

- Pedidos: `Inventory and Order Tracking` o un rol no restringido equivalente admitido por `searchOrders` de Orders API v2026-01-01.
- Finanzas: `Finance and Accounting` para Finances API v2024-06-19.
- Inventario FBA: `Amazon Fulfillment` o `Product Listing` para `getInventorySummaries` de FBA Inventory API v1.

No seleccionar roles restringidos de PII para este módulo. ZENVIA Analytics no solicita `BUYER` ni `RECIPIENT`.

## 3. Credenciales

Obtener de Amazon:

- LWA Client ID.
- LWA Client Secret.
- LWA Refresh Token de la autoautorización.
- Seller ID.

Guardar los cuatro valores exclusivamente en **Supabase Edge Function Secrets**, bajo un único secreto llamado `AMAZON_SPAPI_CREDENTIALS`:

```json
{
  "client_id": "<LWA client id>",
  "client_secret": "<LWA client secret>",
  "refresh_token": "<LWA refresh token>",
  "seller_id": "<seller id>"
}
```

No guardar estos valores en GitHub, tablas accesibles al navegador, archivos `.env` versionados ni variables frontend.

## 4. Región y autenticación

- Endpoint SP-API Europa: `https://sellingpartnerapi-eu.amazon.com`.
- Token LWA: `POST https://api.amazon.com/auth/o2/token` con `grant_type=refresh_token`.
- Cada llamada SP-API utiliza el token temporal en `x-amz-access-token`.
- El backend añade `x-amz-date` y `user-agent`.

## 5. Autenticación de las Edge Functions

Las funciones internas reciben llamadas de Cron/worker y validan el header `apikey` con `requireInternalSecret`. Deben desplegarse sin la comprobación JWT de la plataforma para permitir esta autenticación servidor-a-servidor:

- `amazon-sync-orchestrator`: `verify_jwt = false`
- `amazon-sync-worker`: `verify_jwt = false`
- `amazon-sync-orders`: `verify_jwt = false`
- `amazon-sync-finances`: `verify_jwt = false`
- `amazon-sync-inventory`: `verify_jwt = false`

Que `verify_jwt` sea `false` no hace públicas estas funciones: el propio código rechaza cualquier petición que no aporte la clave interna correcta en `apikey`.

Las funciones invocadas desde la aplicación web siguen autenticando al usuario con Supabase Auth:

- `amazon-status`: `verify_jwt = true`
- `amazon-sync-manual`: `verify_jwt = true`

`amazon-status` exige permiso `amazon` o rol admin, y `amazon-sync-manual` exige rol admin.

## 6. Programación automática con Cron y Vault

La migración de scheduler usa `pg_cron` y `pg_net`. No contiene ninguna clave real. Antes de activarla en producción deben existir estos secretos en **Supabase Vault**:

- `project_url`: URL base del proyecto, por ejemplo `https://<project-ref>.supabase.co`.
- `amazon_cron_secret_key`: la misma clave secreta de proyecto que el backend reconoce para las llamadas internas.

El scheduler llama al orquestador una vez por hora y al worker cada cinco minutos. El primer ciclo horario que encuentre una cuenta Amazon sin estado de sincronización encola automáticamente el backfill histórico desde `2026-01-01` en ventanas de siete días y, además, la ventana incremental actual. Los `job_key` únicos hacen que repetir el proceso sea idempotente.

El worker reclama como máximo tres trabajos por ejecución con `FOR UPDATE SKIP LOCKED`; ejecutarlo cada cinco minutos permite vaciar progresivamente el histórico sin una Edge Function gigante ni ejecuciones solapadas del mismo job.

## 7. Verificación previa a producción

1. Configurar `AMAZON_SPAPI_CREDENTIALS` en Supabase Edge Function Secrets.
2. Desplegar las Edge Functions de Fase B con el `verify_jwt` indicado arriba.
3. Ejecutar `amazon-status` y confirmar que el secreto se detecta sin devolver ningún valor sensible.
4. Hacer una sincronización manual pequeña y comprobar pedidos, finanzas e inventario.
5. Repetir la misma ventana para comprobar idempotencia.
6. Crear en Vault `project_url` y `amazon_cron_secret_key`.
7. Aplicar la migración del scheduler y confirmar que el orquestador y el worker responden correctamente.
8. Permitir que el primer ciclo horario inicie el backfill desde `2026-01-01` y supervisar la cola hasta completarlo.
