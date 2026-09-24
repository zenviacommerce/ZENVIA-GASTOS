# ZENVIA Gestión

Repositorio: `zenviacommerce/ZENVIA-GESTION`.

Aplicación interna de **ZENVIA COMMERCE** para centralizar la operativa administrativa y de ecommerce en una única interfaz.

## Qué incluye

- **Resumen**: KPIs operativos y financieros.
- **Gastos**: importación de facturas PDF, lectura automática, revisión, categorías, IVA, duplicados e histórico.
- **Facturación**: clientes, series, emisión y gestión de facturas de venta.
- **Pedidos**: sincronización de pedidos, preparación, validación de datos, etiquetas, tracking y acciones masivas.
- **Envíos**: Sendcloud, reglas de transportista, tarifas, formatos de etiqueta e impresión directa mediante ZENVIA Print Agent.
- **Productos**: catálogo, costes, proveedores, márgenes, EAN/SKU e histórico de precios.
- **Proveedores y clientes**: maestros, alias, deduplicación y mantenimiento.
- **Amazon**: cuentas, marketplaces, inventario, pedidos, mapeos, sincronización y analítica de rentabilidad.
- **Integraciones**: Amazon, Sendcloud, Shopify y Gmail con soporte multicuenta.
- **Alertas y automatizaciones**: avisos operativos configurables.
- **Configuración y administración**: preferencias globales, preferencias por usuario, mantenimiento y usuarios.

## Stack

- React 19 + TypeScript + Vite
- Supabase: Auth, PostgreSQL, Storage, RPCs, Edge Functions y Cron
- Vercel
- GitHub Actions para tests y build

## Desarrollo local

Requisitos: Node.js 22.

```bash
npm install
npm run dev
```

Build de producción:

```bash
npm run build
```

La suite de regresión se ejecuta con:

```bash
node --test scripts/*.test.mjs
```

## Variables de entorno

Usa `.env.example` como referencia. No deben versionarse secretos de Amazon, Sendcloud, Gmail, Supabase service-role ni credenciales de terceros.

Variables frontend principales:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_GOOGLE_CLIENT_ID`

## Estructura

- `src/`: aplicación React, componentes y servicios.
- `supabase/migrations/`: evolución de esquema y RPCs.
- `supabase/functions/`: Edge Functions.
- `scripts/`: pruebas de regresión y utilidades de proyecto.
- `docs/`: documentación funcional y técnica relevante.
- `tools/print-agent/`: agente local de impresión para Windows.

## Despliegue

La rama `main` es la referencia de producción. Los cambios relevantes deben validarse en una rama de trabajo y pasar tests + build antes de integrarse.

La integración de Git con Vercel despliega producción desde `main`. El frontend está preparado para Vercel y el backend operativo reside en Supabase.

## Convenciones

- Evitar lógica hardcodeada cuando exista una opción razonable de configuración.
- Reutilizar componentes, estilos y motores compartidos antes de introducir variantes específicas por módulo.
- Los laterales, formularios, listados y acciones masivas deben seguir los patrones globales de interfaz.
- Las migraciones existentes son histórico inmutable: los cambios de esquema nuevos se añaden mediante nuevas migraciones.
