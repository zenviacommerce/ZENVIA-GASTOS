# ZENVIA Gestión — Centro de Configuración

Fecha: 2026-09-21  
Rama de diseño e implementación: `feature/configuration-center`  
Estado: diseño aprobado para especificación; pendiente de plan de implementación y desarrollo.

## 1. Objetivo

Crear un Centro de Configuración único para ZENVIA Gestión que elimine reglas de negocio dispersas y valores hardcodeados, permita administrar el comportamiento de los módulos sin tocar código y mantenga separadas:

- la **configuración global de empresa/workspace**, editable solo por administradores;
- las **preferencias personales**, editables por cada usuario para sí mismo.

La funcionalidad se desarrollará y validará completamente fuera de `main`. No se hará merge ni se aplicarán migraciones a producción hasta que el usuario valide el conjunto.

## 2. Criterios de éxito

El proyecto se considera terminado cuando:

1. Existe un apartado **Configuración** visible para todos los usuarios.
2. Un administrador puede gestionar todas las secciones globales.
3. Un usuario normal solo puede editar **Mis preferencias**.
4. Cada opción mostrada modifica realmente el comportamiento correspondiente; no habrá controles decorativos.
5. Las reglas hoy hardcodeadas migradas conservan inicialmente el comportamiento actual de producción.
6. Los módulos consumen configuración mediante un servicio central y no mediante constantes duplicadas.
7. Los cambios globales quedan auditados.
8. La configuración tolera valores faltantes, antiguos o inválidos sin dejar la aplicación en blanco.
9. Los secretos de integraciones nunca se devuelven completos al navegador.
10. El sistema se valida en escritorio, iPad y móvil, tema claro/oscuro y perfiles admin/usuario antes de plantear el merge.

## 3. Fuera de alcance inicial

- Un motor genérico tipo Zapier con disparadores arbitrarios y acciones componibles.
- Modificación retroactiva automática de documentos fiscales históricos.
- Exposición de credenciales completas de Gmail, Amazon, Sendcloud o futuras integraciones.
- Realtime obligatorio para propagar cambios instantáneamente a otras sesiones abiertas.
- Automatizaciones sin relación con flujos ya existentes en ZENVIA Gestión.

Las automatizaciones iniciales serán conocidas, tipadas y configurables mediante switches y parámetros.

## 4. Navegación y permisos

### 4.1 Menú principal

Se añadirá la página `settings` al tipo de navegación y al sidebar.

Orden propuesto:

- Resumen
- Facturación
- Pedidos
- Gastos
- Clientes
- Productos
- Proveedores
- Amazon
- **Configuración**
- Administración

Administración sigue reservada a administradores.

### 4.2 Visibilidad

**Administrador**

Ve todas las secciones:

- General
- Facturación
- Gastos e importación
- Pedidos
- Envíos
- Amazon
- Productos
- Clientes
- Proveedores
- Integraciones
- Alertas y automatizaciones
- Mis preferencias
- Mantenimiento

**Usuario normal**

Ve únicamente:

- Mis preferencias

El control no será solo visual. Supabase RLS y las funciones de escritura impedirán que un usuario normal modifique configuración global.

## 5. Arquitectura de datos

Se reutilizarán las tablas existentes siempre que expresen datos estructurados del dominio.

### 5.1 Tablas existentes que se conservan

#### `business_settings`

Seguirá siendo la fuente de verdad de:

- razón social;
- nombre comercial;
- CIF/VAT;
- dirección;
- país;
- email;
- teléfono;
- IBAN;
- pie de factura.

Se podrá extender con campos estructurados que pertenezcan claramente a la identidad fiscal de la empresa, por ejemplo `website`, `currency_code`, `timezone` o preferencias documentales si la revisión técnica demuestra que encajan mejor aquí que en configuración modular.

#### `company_branding`

Seguirá gestionando logo y branding documental.

#### `integration_secrets`

Seguirá alojando material sensible. `app_settings` nunca contendrá secretos.

### 5.2 Nueva tabla `app_settings`

Una fila por workspace/owner.

Campos propuestos:

- `owner_id uuid primary key`
- `schema_version integer not null`
- `config jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

El JSON se agrupará por módulos:

- `general`
- `sales`
- `expenses`
- `orders`
- `shipping`
- `amazon`
- `products`
- `clients`
- `suppliers`
- `integrations`
- `notifications`
- `maintenance`

El JSON no será libre. En TypeScript existirá un esquema central versionado con tipos, defaults, normalización y validación.

### 5.3 Nueva tabla `user_preferences`

Una fila por usuario y workspace.

Campos propuestos:

- `user_id uuid`
- `owner_id uuid`
- `schema_version integer not null`
- `preferences jsonb not null default '{}'`
- `created_at timestamptz`
- `updated_at timestamptz`
- PK o unique: `(user_id, owner_id)`

Preferencias:

- tema: `system | light | dark`
- densidad: `comfortable | compact`
- pageSize
- página inicial
- periodo inicial
- recordar filtros
- columnas visibles por pantalla
- orden de columnas cuando se implemente
- KPI visibles del resumen
- otras preferencias exclusivamente visuales o de navegación

### 5.4 Nueva tabla `entity_alias_rules`

Para resolver entidades detectadas por importadores antes de crear duplicados.

Campos conceptuales:

- `id uuid`
- `owner_id uuid`
- `entity_type text` — inicialmente `supplier | client`
- `alias text`
- `normalized_alias text`
- `target_entity_id uuid`
- `priority integer`
- `active boolean`
- timestamps

Caso inicial:

`Compost and Paper S.L.` → `Sierra Nevada Compost and Paper S.L.`

El importador consultará alias explícitos antes de recurrir a heurísticas de nombre.

### 5.5 Nueva tabla `shipping_rules`

Las reglas de selección automática de transporte dejarán de estar embebidas en `orderLabelFiles.ts`.

Campos conceptuales:

- `id uuid`
- `owner_id uuid`
- `name text`
- `priority integer`
- `active boolean`
- `conditions jsonb`
- `action jsonb`
- timestamps

Ejemplo inicial 1:

- país = ES
- CP empieza por 07
- seleccionar transportista/método Correos

Ejemplo inicial 2:

- fallback España
- seleccionar MRW Urgent 19:00 Expedition

Las reglas se evalúan por prioridad; la primera coincidencia válida gana. La selección manual siempre tiene prioridad.

### 5.6 Nueva tabla `automation_rules`

Automatizaciones conocidas y tipadas.

Campos conceptuales:

- `id uuid`
- `owner_id uuid`
- `rule_key text`
- `enabled boolean`
- `config jsonb`
- timestamps
- unique `(owner_id, rule_key)`

Ejemplos:

- `order_label_created`
- `expense_invoice_imported`
- `amazon_sync_failed`

No se implementará un DSL genérico en esta fase.

## 6. Servicio central de configuración

Se creará un módulo de servicio con una interfaz estable. Los consumidores no conocerán la forma física de las tablas.

Operaciones mínimas:

- `loadAppSettings()`
- `saveSettingsSection(section, value)`
- `resetSettingsSection(section)`
- `loadUserPreferences()`
- `saveUserPreferences()`
- `loadAliasRules()`
- CRUD de alias
- `loadShippingRules()`
- CRUD/reordenación de reglas
- `loadAutomationRules()`
- actualización de automatizaciones

También habrá un provider/contexto React para evitar lecturas repetidas y permitir invalidar la caché local después de guardar.

No se requiere Supabase Realtime en v1.

## 7. Esquema, defaults y precedencia

### 7.1 Principio

La precedencia general será:

1. valor explícito de la entidad o documento;
2. configuración global;
3. fallback técnico del esquema.

Ejemplo de vencimiento:

- cliente: 60 días;
- global: 30;
- fallback: 30;
- resultado: 60.

### 7.2 Defaults iniciales equivalentes al comportamiento actual

La migración inicial debe reproducir producción. Entre los valores ya identificados:

- `sales.defaultDueDays = 30`
- `general.currency = EUR`
- `general.countryCode = ES`
- periodo inicial actual: trimestre en los módulos que hoy usan `defaultDateFilter()`
- page size actual en maestros: 20 donde hoy está fijado así
- `orders.labelFilenameStrategy = order_number`
- refresco del resumen de pedidos: 60 segundos
- Baleares ES `07xxx` → Correos
- resto de flujo actual → MRW Urgent 19:00 Expedition cuando corresponda
- defaults de creación/enriquecimiento del importador equivalentes al comportamiento actual
- comportamiento actual de actualización de costes e histórico
- moneda EUR y país ES donde hoy existen fallbacks equivalentes

Antes de sustituir cada constante, se añadirá un test que demuestre el comportamiento vigente.

### 7.3 Valores inválidos o ausentes

El parser de configuración:

- ignora únicamente la propiedad inválida;
- aplica el fallback conocido;
- no lanza un error que impida montar la app;
- expone warnings para Configuración;
- permite restaurar el valor correcto.

La configuración llevará `schemaVersion` para poder evolucionar defaults y forma de datos.

## 8. Secciones funcionales

### 8.1 General

- razón social
- nombre comercial
- CIF/VAT
- dirección
- país
- email
- teléfono
- web
- IBAN
- logo
- moneda principal
- zona horaria
- formato de fecha
- idioma documental
- pie legal de factura
- página inicial empresarial cuando proceda

### 8.2 Facturación

- vencimiento por defecto
- método de pago por defecto
- métodos disponibles
- serie por defecto
- IVA por defecto
- país/registro fiscal por defecto
- estado inicial de borrador
- notas por defecto
- mostrar/ocultar IBAN
- mostrar/ocultar datos fiscales
- mostrar/ocultar vencimiento
- mostrar/ocultar método de pago
- texto/pie documental
- completar datos fiscales vacíos
- creación de clientes desde importación
- cobro total → estado pagado
- permitir cobros parciales
- reglas actuales de edición/borrado/reutilización coherentes con el modelo fiscal existente

Cambios de defaults solo afectan a documentos futuros salvo herramienta explícita de mantenimiento.

### 8.3 Gastos e importación

- estado inicial importado
- crear proveedores
- crear productos
- completar datos vacíos
- actualizar costes
- categoría fallback
- tipo de proveedor fallback
- detectar duplicados
- bloquear duplicados de alta confianza
- advertir coincidencias dudosas
- umbral de confianza
- campos obligatorios para revisión
- prioridad de identidad: fiscal → alias → nombre normalizado
- reglas de Gmail
- reprocesado de eliminadas
- relación producto-proveedor
- histórico de precios
- gestión de alias

### 8.4 Pedidos

- estado inicial manual
- canal por defecto
- país de origen
- transportista/método por defecto
- generación de etiqueta
- descarga tras generar
- estrategia de nombre del PDF
- nombre del ZIP
- alcance de generación masiva
- push de tracking a marketplace
- marcar enviado
- reintentos
- frecuencia de refresco
- umbral de pedido atrasado
- acceso a reglas de envío

### 8.5 Envíos

- remitente
- dirección de expedición
- peso fallback
- unidad
- formato/tamaño de etiqueta
- copias
- orientación
- descarga/impresión
- servicio Sendcloud predeterminado
- transportistas habilitados
- fallback de servicio
- comportamiento si no existe método válido
- confirmación de envío
- persistencia de coste real cuando esté disponible

### 8.6 Amazon

- marketplaces activos
- marketplace principal
- moneda consolidada
- periodo inicial
- frecuencia de sincronización
- sincronización de pedidos
- inventario
- finanzas
- imágenes
- automapeo SKU → producto
- factor de consumo
- manejo de SKU sin mapear
- IVA fallback
- política FX
- alertas de sync
- KPI visibles por defecto
- histórico por defecto

### 8.7 Productos

- IVA de venta
- unidad
- margen objetivo
- margen mínimo
- método de coste: última compra / medio / manual
- actualizar coste desde importaciones
- crear desde factura
- proveedor/categoría fallback
- alerta de subida de coste
- alerta de margen
- redondeo
- decimales de coste

### 8.8 Clientes

- país
- IVA
- días de pago
- método de pago
- creación automática
- completar CIF
- completar dirección
- completar país
- no sobrescribir datos revisados
- detección de duplicados
- criterios de identidad

### 8.9 Proveedores

- tipo fallback
- categoría habitual fallback
- creación automática
- completar datos
- campos permitidos para enriquecimiento
- solo completar vacíos
- duplicados
- umbral de coincidencia
- alias
- reglas proveedor → categoría
- reglas proveedor → tipo

### 8.10 Integraciones

Para Gmail, Amazon, Sendcloud, Shopify y futuras:

- activo/inactivo
- conectado/no conectado
- última sincronización correcta
- último intento
- último error
- probar conexión
- sincronizar ahora

Nunca se mostrará el secreto completo.

### 8.11 Alertas y automatizaciones

Alertas iniciales configurables:

- factura de venta vencida
- gasto pendiente de revisión
- pedido pendiente X horas
- pedido sin tracking
- error Amazon
- error Sendcloud
- error Gmail
- producto sin coste
- margen negativo
- subida de coste > X
- cliente sin datos fiscales
- proveedor sin CIF

Canal inicial: aplicación. El email se deja preparado como evolución, no como requisito de v1 salvo que ya exista infraestructura reutilizable.

Automatizaciones iniciales:

**Al crear etiqueta**
- guardar tracking
- enviar tracking a Amazon
- marcar enviado
- descargar PDF

**Al importar gasto**
- buscar entidad existente
- aplicar alias
- crear proveedor si procede
- vincular/crear producto si procede
- actualizar coste
- actualizar histórico

### 8.12 Mis preferencias

- tema
- densidad
- page size
- página inicial
- periodo inicial
- recordar filtros
- columnas visibles
- orden de columnas cuando se implemente
- KPI visibles
- preferencias de tablas

### 8.13 Mantenimiento

Solo administradores.

- detectar proveedores duplicados
- detectar clientes duplicados
- detectar productos duplicados
- detectar facturas duplicadas
- fusionar proveedores
- fusionar clientes
- reprocesar factura
- recalcular costes
- recalcular asociaciones
- reconstruir histórico
- sincronizar pedidos
- sincronizar Amazon
- revisar entidades sin CIF
- revisar productos sin coste
- exportar configuración sin secretos
- restaurar defaults

Toda acción destructiva requiere confirmación fuerte y auditoría.

## 9. Flujo de importación con configuración

Orden objetivo:

1. extracción del PDF;
2. identificación fiscal;
3. alias explícitos;
4. coincidencia exacta/segura existente;
5. heurísticas de nombre;
6. reglas específicas de proveedor/cliente;
7. defaults globales;
8. revisión cuando corresponda.

Un alias válido impide crear una nueva entidad para ese alias.

## 10. Guardado y UX

Cada sección guarda de forma independiente.

Ejemplo:

`Facturación` actualiza únicamente `sales`.

Requisitos:

- indicador de cambios sin guardar;
- confirmación al abandonar una sección con cambios;
- toast solo después de persistencia real;
- formularios conservan valores ante error;
- botón restaurar sección;
- restauración individual donde aporte valor;
- advertencias en opciones de alto impacto;
- helper que indique el valor de sistema cuando proceda.

No se permitirá guardar una sección inválida.

## 11. Validación

Habrá validación en:

1. UI;
2. servicio central;
3. constraints SQL para invariantes apropiados.

Ejemplos:

- vencimiento: 0–365 días
- IVA: 0–100
- pageSize: lista permitida
- frecuencia: mínimos razonables
- códigos de país/moneda normalizados
- reglas de transporte estructuralmente válidas
- plantillas de nombre válidas

## 12. Auditoría

Los cambios globales se registran en `audit_logs`.

Ejemplo:

`Configuración > Facturación: defaultDueDays 30 → 45`

También se auditan:

- alias
- shipping rules
- automatizaciones
- restauraciones
- mantenimiento

No se auditan preferencias personales puramente visuales como tema o densidad.

## 13. Seguridad y RLS

### `app_settings`

- lectura: usuarios activos del workspace;
- escritura: solo admins del workspace.

### `user_preferences`

- lectura/escritura: el usuario sobre su propia fila;
- admins no necesitan editar preferencias ajenas en v1.

### reglas globales

`entity_alias_rules`, `shipping_rules`, `automation_rules`:

- lectura: usuarios activos cuando el flujo funcional lo necesite;
- escritura: solo admins.

Las políticas deben usar ownership real del workspace y no confiar únicamente en `TO authenticated`.

## 14. Migración gradual de hardcodes

Cada hardcode se migra con esta secuencia:

1. test que documenta el comportamiento actual;
2. añadir default equivalente al esquema;
3. conectar el consumidor al servicio central;
4. demostrar que el test sigue pasando;
5. eliminar la constante duplicada;
6. commit pequeño y trazable.

No se migrará un valor si todavía no existe una opción funcional y validada que lo represente.

## 15. Orden de implementación

1. infraestructura de configuración, esquema, RLS, defaults y servicios;
2. shell UI de Configuración y permisos;
3. General + Facturación;
4. Gastos + Proveedores + Productos + alias;
5. Pedidos + Envíos + reglas;
6. Clientes;
7. Amazon + Integraciones;
8. Alertas + automatizaciones;
9. Mis preferencias;
10. Mantenimiento;
11. pasada global de hardcodes restantes;
12. validación integral.

## 16. Entorno de desarrollo aislado

El código vive en:

`feature/configuration-center`

No se mergea automáticamente a `main`.

Para cambios de base de datos se usará un entorno Supabase aislado antes de producción. El objetivo es disponer de:

`rama Git → preview de aplicación → Supabase de desarrollo`

No se aplicarán migraciones del Centro de Configuración al proyecto Supabase de producción durante el desarrollo.

Antes de crear una rama Supabase, se deberá consultar el coste correspondiente y obtener confirmación explícita del usuario, conforme al flujo de la herramienta.

## 17. Pruebas y verificación

### Unitarias / contratos

- parser/defaults del SettingsSchema
- precedencia de valores
- validadores
- alias
- reglas de transporte
- automatizaciones
- serialización/export
- fallback ante valores corruptos

### Integración

- RLS admin vs usuario
- persistencia por sección
- preferencias propias
- auditoría
- aplicación real de defaults a módulos
- cambios no retroactivos
- importadores con alias
- etiqueta/tracking
- Amazon
- mantenimiento

### UI

Validar:

- escritorio
- iPad/Safari
- móvil
- claro
- oscuro
- admin
- usuario normal
- cambios sin guardar
- errores de red
- valores inválidos

## 18. Criterios de aceptación antes del merge

Antes de plantear merge a `main`:

- build limpio;
- pruebas nuevas y existentes relevantes en verde;
- ningún ajuste mostrado sin efecto real;
- ningún acceso global permitido a usuario normal;
- ningún secreto expuesto al navegador;
- comportamiento inicial equivalente a producción;
- auditoría verificada;
- importación de gastos verificada;
- facturación verificada;
- pedidos/etiquetas/tracking verificados;
- Amazon verificado;
- preferencias verificadas;
- iPad/Safari verificado;
- revisión manual del usuario completada.

El merge y las migraciones de producción serán acciones separadas y requerirán aprobación explícita.
