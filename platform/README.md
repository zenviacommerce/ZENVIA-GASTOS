# ZENVIA Platform

Panel interno de administración del SaaS ZENVIA Gestión.

## Alcance

- Resumen de plataforma
- Clientes / workspaces
- Planes y entitlements
- Suscripciones manuales
- Tickets globales
- Auditoría de plataforma

La aplicación utiliza Supabase Auth para iniciar sesión, pero **no** usa el rol de administrador de un workspace. Todo acceso global se realiza a través de la Edge Function `platform-admin`, que valida la tabla `platform_admins`.

## Despliegue

Es una aplicación independiente. En Vercel debe configurarse como un proyecto separado con root directory `platform`.

Dominio previsto:

`admin.zenviacommerce.com`

Correo operativo:

`soporte@zenviacommerce.com`

## Variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Solo se usan claves publicables en el navegador. Las operaciones privilegiadas permanecen en Supabase Edge Functions.
