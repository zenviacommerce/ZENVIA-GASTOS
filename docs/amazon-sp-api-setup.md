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

## 5. Verificación previa a producción

1. Configurar `AMAZON_SPAPI_CREDENTIALS` en Supabase Secrets.
2. Desplegar primero las Edge Functions de Fase B.
3. Ejecutar `amazon-status` y confirmar que el secreto se detecta sin devolver ningún valor sensible.
4. Hacer una sincronización manual pequeña de un marketplace/ventana reciente.
5. Comprobar idempotencia repitiendo la misma ventana.
6. Iniciar el backfill desde 2026-01-01 solo después de validar pedidos, finanzas e inventario.
