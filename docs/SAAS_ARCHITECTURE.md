# Arquitectura SaaS de ZENVIA Gestión

## Objetivo

Evolucionar la aplicación actual a un SaaS multiempresa para vendedores de Amazon sin introducir excepciones específicas para ZENVIA COMMERCE.

ZENVIA COMMERCE debe comportarse como el primer workspace de la plataforma, con un plan interno sin límites.

## Separación de responsabilidades

### Aplicación del cliente

Cada vendedor trabaja dentro de un `workspace` aislado. El workspace contiene sus usuarios, productos, proveedores, facturas, pedidos, integraciones y configuración.

Roles del workspace:

- `admin`: administra su empresa, usuarios y permisos.
- `user`: accede únicamente a los módulos autorizados.

El menú Soporte de esta aplicación será la vista del cliente: creación de tickets, respuestas, adjuntos y seguimiento.

### Administración de plataforma

La administración global no debe confundirse con el rol `admin` de un workspace.

`platform_admins` identifica operadores de la plataforma y será la base de un panel separado para:

- workspaces/clientes;
- suscripciones y planes;
- consumo y límites;
- integraciones;
- incidencias globales;
- auditoría de plataforma;
- soporte y tickets de todos los clientes.

El panel global deberá acceder a datos cross-tenant únicamente mediante APIs/Edge Functions de servidor con autorización explícita. No se habilitará lectura cross-tenant directa desde el navegador.

## Modelo de tenancy

`workspaces.id` es la identidad canónica del tenant.

La aplicación histórica utiliza `owner_id` en las tablas de negocio y `app_users.data_owner_id`. Durante la transición:

- los workspaces existentes conservan el mismo UUID que su `data_owner_id` actual;
- `app_users.workspace_id` pasa a ser la referencia canónica;
- `data_owner_id` se mantiene temporalmente como alias compatible;
- `private.app_workspace_owner_id()` sigue existiendo, pero resuelve el nuevo `workspace_id`.

Esto permite migrar progresivamente sin reescribir de golpe las políticas RLS ni los datos existentes.

## Planes y entitlements

Las tablas base son:

- `billing_plans`: catálogo de planes;
- `plan_entitlements`: módulos, capacidades y límites de cada plan;
- `workspace_subscriptions`: plan y estado de suscripción de cada workspace.

Los módulos se identifican con claves como `module.amazon`, `module.orders` o `module.sales`.

Los límites cuantitativos usan entitlements como `users`, `amazon_accounts` y `monthly_orders`.

El plan `internal` mantiene el comportamiento actual de ZENVIA. Los planes comerciales Starter, Pro y Business permanecen desactivados hasta definir precios y límites.

## Fases

1. **Fundación multiempresa**: workspaces, membresía, plataforma, planes y entitlements.
2. **Onboarding SaaS**: alta de workspace, propietario inicial, prueba y configuración guiada.
3. **Billing**: Stripe Billing, checkout, webhooks, renovaciones, cambios de plan e impagos.
4. **Panel de plataforma**: aplicación separada para clientes, billing, soporte y operaciones.
5. **Soporte SaaS**: el cliente conserva “Mis tickets”; los agentes los gestionan desde el panel global.
6. **Límites de uso**: cuentas Amazon, usuarios, pedidos mensuales y capacidades por plan.
7. **Beta externa**: incorporación controlada de los primeros vendedores antes del lanzamiento público.

## Principios de seguridad

- RLS activa en todas las tablas expuestas.
- Un usuario solo resuelve un `workspace_id` activo.
- Los admins de un workspace nunca obtienen privilegios de plataforma.
- Los secretos de integraciones permanecen únicamente del lado servidor.
- Las operaciones cross-tenant se realizan mediante endpoints de plataforma autenticados y auditados.
- Los límites de plan importantes se validan también en backend, no únicamente ocultando controles en la interfaz.
