# Diseño: importación robusta de facturas, importación masiva y mejoras de Productos/UI

Fecha: 2026-09-16

## Objetivo

Unificar y endurecer el flujo de importación de facturas de gasto para que una factura individual y una tanda de PDFs usen exactamente el mismo lector, validaciones y guardado; corregir el caso CABAPLAST; admitir temporalmente facturas emitidas a Cristian Jesús Pérez Garrido hasta el 30/06/2026 inclusive; representar correctamente el recargo de equivalencia; permitir corregir manualmente el proveedor de un producto sin crear compras ficticias; mostrar el margen como porcentaje sobre coste; sustituir los `title` nativos de textos recortados por un tooltip visual propio de ZENVIA; y establecer un sistema común de formularios, selectores buscables y direcciones internacionales reutilizable en toda la aplicación.

## Alcance funcional

### 1. Pipeline común de importación

Se extraerá la lógica actualmente acoplada a `UploadInvoiceModal` a un servicio común de preparación de candidatos de factura. Tanto la subida individual como la masiva llamarán al mismo pipeline.

Un candidato contendrá, como mínimo:

- archivo y huella SHA-256;
- proveedor detectado y sus datos de contacto;
- destinatario detectado;
- número y fecha de factura;
- categoría sugerida;
- base imponible, IVA, retención, recargo de equivalencia y total;
- líneas de producto;
- confianza de extracción;
- estado de validación y motivos de revisión.

Estados de candidato:

- `analyzing`: lectura en curso;
- `ready`: válido para importar;
- `needs_review`: faltan datos o alguna regla requiere intervención;
- `duplicate`: ya existe por huella o por proveedor + número;
- `error`: no se pudo preparar;
- `importing`: guardado en curso;
- `imported`: guardado correctamente.

La importación individual seguirá permitiendo revisar/editar los campos antes de guardar, pero consumirá el mismo candidato que la masiva.

### 2. Caso CABAPLAST y extracción de proveedor

El extractor de proveedor dejará de buscar únicamente desde la línea donde aparece la razón social hacia abajo. Construirá un contexto alrededor de la razón social, incluyendo líneas anteriores y posteriores, y puntuará candidatos por proximidad y marcadores de emisor/comprador.

Para `DISTRIBUCIONES CABAPLAST 99 S.L.` deberá poder recuperar los campos que el documento contenga y que el modelo de proveedores soporte: CIF, dirección, email, teléfono y web cuando exista.

Caso de regresión obligatorio:

- proveedor: `DISTRIBUCIONES CABAPLAST 99 S.L.`;
- CIF esperado: `B90163700`;
- dirección esperada: `C/ MAIRENA DEL ALCOR N 20, 41006 SEVILLA (SEVILLA)` o equivalente normalizado sin perder información;
- email esperado: `cabaplast99@hotmail.com`;
- clasificación: Mercancía cuando la factura contiene líneas de compra de mercancía.

El lector de líneas de producto aceptará códigos de proveedor cortos como `0170`, `0007` o `0257`; no exigirá códigos largos para reconocer una fila de producto.

### 3. Destinatario histórico permitido

Se introducirá una regla explícita de validación de destinatario por fecha de factura.

Identidad histórica permitida:

- nombre: `CRISTIAN JESUS PEREZ GARRIDO`;
- NIF: `15436385G`.

Regla:

- fecha de factura <= `2026-06-30`: el NIF anterior se acepta como destinatario válido y la factura puede entrar automáticamente si cumple el resto de validaciones;
- fecha de factura >= `2026-07-01`: una factura a ese NIF queda en `needs_review` con motivo `Destinatario no válido para esta fecha` y no se importa automáticamente.

La comparación primaria será por NIF normalizado. Si solo aparece el nombre pero no el NIF, no se aceptará automáticamente: quedará para revisión.

La fecha usada es la fecha de emisión de la factura, no la fecha de subida.

### 4. Recargo de equivalencia

Se añadirá a `invoices` un importe agregado de recargo de equivalencia, con valor por defecto 0. El lector detectará el recargo cuando aparezca separado del IVA y la reparación de importes usará:

`total = base + IVA + recargo_equivalencia - retención`

El detalle de factura mostrará el recargo cuando sea distinto de cero.

Caso CABAPLAST de regresión: el lector debe admitir un recargo del 5,20 % y conservar el importe detectado (100,58 € en la factura revisada), de forma que la cabecera cuadre con el total.

No se modelarán múltiples tramos de recargo en una tabla fiscal separada en esta iteración; se conserva el importe agregado y el texto/metadata de extracción para auditoría.

### 5. Guardado seguro y proveedores huérfanos

La preparación de una factura no debe persistir proveedores ni productos. La persistencia comienza únicamente al confirmar la importación.

El flujo de guardado mantendrá una lista de recursos creados durante la operación. Si falla después de crear alguno, realizará rollback compensatorio en orden inverso:

1. líneas/mapeos de producto creados por la operación;
2. factura;
3. archivo subido si la factura no llegó a guardarse;
4. proveedor recién creado, únicamente si sigue sin estar referenciado por ninguna factura.

Un proveedor ya existente nunca se elimina por un fallo de importación. Esto evita repetir el caso en el que se creó CABAPLAST pero la factura no terminó de guardarse.

### 6. Importación masiva

La UI principal de facturas añadirá `Importar facturas` con selección múltiple de PDFs (`multiple`). No se añade soporte ZIP en esta iteración: seleccionar varios PDFs cubre el caso de uso con menos complejidad y permite mostrar el estado de cada fichero.

La tanda se analizará con concurrencia limitada (máximo 2 documentos simultáneos) para evitar bloquear el navegador/OCR.

La vista de lote mostrará una fila/tarjeta por archivo con:

- nombre del archivo;
- estado;
- proveedor;
- número;
- fecha;
- base/IVA/recargo/total;
- líneas detectadas;
- motivo de revisión o error.

Cabecera de progreso de ejemplo: `7 de 10 analizadas · 6 listas · 1 requiere revisión · 3 pendientes`.

Acciones:

- abrir una factura para revisar/corregir sus datos;
- excluirla del lote;
- `Importar X facturas` para todas las que estén `ready`;
- las `needs_review`, `duplicate` o `error` no bloquean al resto.

Los duplicados se detectarán por:

1. SHA-256 del archivo cuando exista coincidencia previa;
2. proveedor + número de factura normalizados como segunda barrera.

La importación se ejecutará de forma secuencial al guardar para simplificar rollback y mensajes de error. Al final se mostrará un resumen de importadas, duplicadas, pendientes de revisión y fallidas.

### 7. Productos: corrección manual de proveedor

El usuario podrá editar el proveedor mostrado en un producto desde `Editar producto` mediante un selector de proveedores existentes, incluyendo opción `Sin proveedor`.

Este campo es una corrección administrativa del proveedor actual del producto (`last_supplier_id`), pensada para productos que quedaron sin proveedor o con proveedor incorrecto por una importación previa.

Cambiarlo manualmente:

- NO crea una fila en `product_price_history`;
- NO modifica coste ni `previous_cost`;
- NO inventa una compra;
- NO cambia facturas históricas;
- una compra real posterior podrá volver a actualizar `last_supplier_id` mediante el flujo normal.

No se introduce en esta iteración el concepto separado de `proveedor habitual`.

### 8. Productos: margen del 25 % sobre coste

El precio de venta por defecto ya sigue `coste * 1,25` y se mantiene.

La pantalla de Productos cambiará únicamente la definición del porcentaje mostrado:

`margen_pct = (precio_venta - coste) / coste * 100`

Ejemplo: coste 100 €, venta 125 € -> margen mostrado 25 %.

La cantidad en euros (`venta - coste`) no cambia.

Se aplicará la misma fórmula a:

- columna Margen;
- tarjeta móvil;
- drawer de producto;
- KPI `Margen medio`.

El subtítulo del KPI pasará de `Sobre precio de venta` a `Sobre coste`.

Si el coste es 0 o nulo, el porcentaje se mostrará como `—` para evitar división por cero.

### 9. Tooltip elegante global para textos recortados

Se implementará un único tooltip administrado desde `UnifiedListExperience` y reutilizado por todas las tablas/listas de la aplicación.

Solo se activa para contenido textual recortado de verdad. Antes de mostrarlo se comprobará overflow (`scrollWidth > clientWidth`, `scrollHeight > clientHeight` o equivalente según el elemento). Si el texto cabe completo, no aparecerá nada.

Comportamiento:

- hover de ratón con retardo corto;
- foco de teclado;
- ocultación al salir, perder foco, hacer scroll o cambiar la lista;
- posicionamiento automático arriba/abajo según espacio disponible;
- nunca sale del viewport;
- ancho máximo y salto de línea para textos largos.

Diseño:

- componente/elemento flotante propio de ZENVIA;
- bordes redondeados;
- sombra suave;
- fondo/contraste adaptado a claro y oscuro;
- pequeña flecha visual;
- animación breve de entrada/salida.

El sistema se limitará a celdas y textos de listas/tablas. No sustituirá `title` de botones de acción o controles accesibles que no estén relacionados con texto recortado.

Se retirarán los `title` nativos usados solo para mostrar nombres completos, empezando por Productos, para que no aparezca el tooltip genérico del navegador/Windows.

Cobertura esperada: Productos, Proveedores, Clientes, Facturas, Ventas, Pedidos, Gmail y futuras tablas/listas que entren en `UnifiedListExperience`.

### 10. Selector común buscable (`SearchableSelect`)

Se creará un componente común para selecciones cuyo catálogo pueda ser largo o crecer con datos del usuario.

Características:

- buscador integrado siempre que se use este componente;
- búsqueda por etiqueta visible, términos alternativos y código cuando exista;
- navegación por teclado, foco visible y atributos ARIA apropiados;
- selección con ratón/touch y teclado;
- cierre con Escape y clic fuera;
- estados de vacío y deshabilitado;
- comportamiento consistente en modo claro/oscuro y móvil/escritorio.

Se usará de forma general para catálogos largos o potencialmente largos, entre ellos:

- países;
- proveedores;
- clientes;
- productos;
- registros/configuraciones que puedan crecer y donde buscar aporte valor.

No sustituirá selects pequeños y cerrados donde el buscador empeore la interacción, por ejemplo IVA `21/10/4/0`, tipo de factura, estado o plazos de pago con pocas opciones.

Los formularios nuevos deberán preferir `SearchableSelect` para catálogos de entidades en vez de implementar un selector propio.

### 11. Países y direcciones internacionales reutilizables

Se crearán dos piezas comunes: `CountryPicker` y `PostalAddressFields`.

#### `CountryPicker`

- mostrará el nombre legible del país en pantalla, no el código ISO desnudo;
- guardará internamente ISO 3166-1 alpha-2 (`ES`, `FR`, `DE`, `IT`, etc.) para mantener compatibilidad con IVA, OSS y lógica existente;
- usará `SearchableSelect`;
- permitirá buscar por nombre español, nombre inglés y código ISO cuando estén disponibles;
- incluirá el catálogo completo de países soportados por ISO, no una lista limitada a mercados actuales.

Los códigos ISO seguirán siendo el valor persistido; no habrá migración de datos por este cambio visual.

#### `PostalAddressFields`

Agrupará país, código postal, ciudad/población y provincia/región en una unidad reutilizable.

Flujo:

1. el usuario elige país;
2. introduce código postal;
3. tras un debounce corto se consulta un servicio de código postal con `countryCode + postalCode`;
4. si existe una sola población, se rellenan ciudad y provincia/región;
5. si existen varias poblaciones, se muestra un selector buscable para elegir;
6. si no hay resultados, la API no cubre el país o hay un error de red, ciudad y provincia permanecen editables manualmente y el formulario sigue funcionando.

El servicio inicial será Zippopotam.us encapsulado detrás de `postalLookup.ts` (o nombre equivalente) para que el proveedor externo pueda cambiarse sin reescribir los formularios.

Reglas de robustez:

- debounce aproximado de 400–500 ms;
- cancelación/ignorancia de respuestas obsoletas cuando cambien país o CP;
- caché en memoria de consultas repetidas durante la sesión;
- la consulta externa enviará únicamente país y código postal, nunca nombre, CIF, email, dirección completa ni otros datos del cliente;
- un fallo externo nunca bloqueará `Guardar`;
- ciudad y provincia/región serán siempre editables manualmente;
- si el usuario modifica manualmente ciudad/provincia, la misma consulta no vuelve a pisarlos;
- cambiar país o código postal habilita un nuevo autocompletado y puede reemplazar los valores automáticos anteriores;
- los datos manuales tendrán prioridad cuando exista conflicto.

Cobertura inicial del bloque común:

- Nuevo/Editar Cliente;
- Datos fiscales principales de ZENVIA;
- futuros formularios que capturen una dirección estructurada.

Los proveedores actuales almacenan `address` como texto libre, por lo que no se forzará su migración a dirección estructurada en esta iteración.

`Registros IVA` usará `CountryPicker`, pero seguirá conservando su campo de dirección fiscal alternativa como texto libre porque su modelo actual no separa CP/ciudad/provincia.

### 12. Sistema visual común para formularios y modales

Se establecerá un patrón reutilizable tomando como referencia el modal actual de Clientes.

Primitivas previstas (nombres orientativos):

- `FormModal` — contenedor, cabecera, ancho, scroll y acciones;
- `FormSection` — icono, título, subtítulo y contenido;
- `FormGrid` — rejilla responsive;
- utilidades de campo para ocupar una o dos columnas;
- `SearchableSelect`, `CountryPicker` y `PostalAddressFields` como controles comunes.

Reglas visuales generales:

- escritorio: normalmente dos columnas para formularios medianos; tres solo cuando el contexto lo justifique;
- móvil: una columna sin overflow horizontal;
- campos de texto largo (nombre principal, dirección, descripción, notas) pueden ocupar ancho completo;
- acciones principales pegadas al pie cuando el modal tenga scroll;
- ayudas y mensajes compactos junto al campo o sección correspondiente;
- mismo espaciado, jerarquía tipográfica, radios, estados de foco/error y comportamiento responsive en todos los formularios que usen estas primitivas.

Los cambios visuales/interactivos comunes deben implementarse en estas primitivas por defecto. Una pantalla solo tendrá estilos/comportamiento propios cuando exista una razón funcional específica.

#### Rediseño de `ProductModal`

Dejará de usar un `stackForm` de una fila por campo y pasará al patrón común:

- sección `Identificación`: nombre a ancho completo, SKU + EAN, categoría + unidad;
- sección `Compra y proveedor`: proveedor buscable + coste actual;
- sección `Venta`: precio de venta + IVA, con indicador del porcentaje sobre coste cuando sea calculable;
- sección `Facturación`: descripción comercial para factura a ancho completo;
- histórico/margen como bloques informativos compactos.

La corrección manual de proveedor descrita en la sección 7 se integrará en este rediseño.

#### Migración de formularios existentes en esta iteración

Se migrarán al patrón común al menos:

- Cliente;
- Producto;
- Datos fiscales de ZENVIA;
- editor de Registros IVA en las partes que correspondan;
- selectores largos tocados por este trabajo (por ejemplo cliente/proveedor) pasarán a `SearchableSelect` en vez de añadir una implementación paralela.

No se reescribirán de forma indiscriminada todos los modales de la aplicación que no necesiten cambios funcionales en esta iteración. Sin embargo, las nuevas pantallas y los formularios que se modifiquen posteriormente deberán reutilizar las primitivas comunes salvo excepción justificada.

## Componentes y servicios previstos

- `src/services/invoiceImportPipeline.ts` — preparación, validación y estado de candidatos.
- `src/services/invoiceRecipientRules.ts` — reglas puras de destinatarios y corte histórico.
- `src/services/supplierContactExtractor.ts` / `supplierInvoiceDetails.ts` — extracción contextual mejorada.
- `src/services/invoiceProductLine.ts` — códigos cortos y recargo/ajuste fiscal cuando corresponda.
- `src/components/UploadInvoiceModal.tsx` — pasa a consumir candidato común.
- `src/components/BulkInvoiceImportModal.tsx` — cola masiva y revisión.
- `src/components/InvoiceCandidateForm.tsx` o equivalente — formulario reutilizable entre individual y lote para evitar dos implementaciones.
- `src/services/repository.ts` — persistencia con rollback compensatorio y soporte del recargo.
- `src/components/ProductModal.tsx` / `src/services/productEditor.ts` — selector y guardado manual de proveedor sin histórico de coste.
- `src/pages/Products.tsx` — margen porcentual sobre coste.
- `src/components/UnifiedListExperience.tsx` + CSS dedicado — tooltip global.
- `src/components/forms/SearchableSelect.tsx` o ubicación equivalente — selector buscable común.
- `src/components/forms/CountryPicker.tsx` — selector de país por nombre con persistencia ISO.
- `src/components/forms/PostalAddressFields.tsx` — bloque internacional de dirección.
- `src/components/forms/FormModal.tsx`, `FormSection.tsx`, `FormGrid.tsx` o primitivas equivalentes — patrón visual común.
- `src/services/postalLookup.ts` — adaptador de consulta postal externa con debounce/caché gestionados por el consumidor o helper común.
- catálogo ISO local (`countryCatalog.ts` o equivalente) para nombres/códigos de países sin depender de la red para pintar el selector.
- migración Supabase para el importe de recargo de equivalencia si la columna no existe.

Los nombres exactos pueden ajustarse durante la implementación si el código existente ofrece una separación más limpia, manteniendo estas responsabilidades.

## Compatibilidad y datos existentes

- No se reescriben automáticamente facturas históricas salvo reparaciones explícitas acordadas.
- El proveedor CABAPLAST existente podrá completarse con los datos extraídos sin duplicarlo.
- La factura CABAPLAST que no llegó a guardarse se podrá reimportar con el nuevo pipeline; no se inventará un registro sin disponer del PDF en el flujo de importación.
- La corrección manual de proveedor de un producto no modifica el histórico de precios.
- El cambio de fórmula de margen es de presentación/cálculo; no cambia precios almacenados.
- Los países continúan persistidos como códigos ISO alpha-2; solo cambia el control visual.
- Un fallo de Zippopotam.us no impide crear/editar un cliente o guardar datos fiscales.
- No se envían datos personales completos al servicio postal externo: únicamente país y código postal.
- Los clientes existentes con ciudad/provincia escritos manualmente conservan sus datos hasta que el usuario modifique país/CP y acepte o provoque un nuevo autocompletado.

## Pruebas obligatorias

### Extracción e importación

- fixture textual CABAPLAST: CIF, dirección, email y líneas con códigos cortos;
- recargo de equivalencia detectado y total cuadrado;
- destinatario `15436385G` aceptado el `2026-06-30`;
- destinatario `15436385G` bloqueado para autoimportación el `2026-07-01`;
- nombre sin NIF -> revisión, no autoaceptación;
- duplicado por hash;
- duplicado por proveedor + número;
- fallo tras crear proveedor -> rollback del proveedor nuevo si queda sin referencias;
- un fallo en una factura del lote no impide importar las restantes listas.

### Productos

- coste 100 / venta 125 -> 25 %;
- coste 0 -> porcentaje nulo/`—`;
- cambiar proveedor no inserta `product_price_history` ni cambia `last_cost`/`previous_cost`;
- compra posterior real puede actualizar de nuevo el proveedor actual;
- `ProductModal` usa la rejilla común y no vuelve a un campo por fila en escritorio.

### Tooltip

- no aparece cuando no hay overflow;
- aparece con el texto completo cuando sí hay overflow;
- no depende de `title` nativo;
- se oculta al salir/perder foco/scroll;
- contrato fuente que garantice integración en `UnifiedListExperience`.

### Países, selectores y direcciones

- `CountryPicker` muestra nombres pero emite/persiste códigos ISO;
- búsqueda de país por `España`, `Spain` y `ES` encuentra España;
- búsqueda equivalente para al menos un país no español;
- selector navegable con teclado y cierre con Escape;
- CP con una población rellena ciudad/provincia;
- CP con varias poblaciones ofrece selección buscable;
- respuesta 404/error/red no bloquea el formulario y mantiene edición manual;
- una respuesta obsoleta no pisa una búsqueda más reciente;
- el mismo país+CP puede servirse desde caché durante la sesión;
- edición manual de ciudad/provincia no es sobrescrita por la misma respuesta automática;
- cambiar país/CP permite un nuevo autocompletado;
- no se envía al servicio postal ningún dato distinto de país y CP.

### Formularios comunes

- Cliente, Producto y Datos fiscales reutilizan las primitivas comunes acordadas;
- Registros IVA reutiliza `CountryPicker`;
- selects pequeños cerrados continúan sin buscador;
- rejilla pasa a una columna en móvil y no genera overflow horizontal;
- acciones del modal siguen accesibles con contenido largo;
- modo claro y oscuro conservan contraste y estados de foco/error.

### Verificación final

- suite Node completa;
- TypeScript + build Vite;
- revisión de diff;
- migración aplicada y verificada en Supabase;
- CI de PR verde;
- merge a `main`;
- CI de `main` verde;
- Vercel `success`.

## Orden de implementación

Para mantener checkpoints pequeños y evitar mezclar regresiones:

1. terminar pipeline individual y masivo de facturas;
2. completar Productos: proveedor manual, margen sobre coste y modal común;
3. tooltip global;
4. introducir primitivas comunes de formularios y `SearchableSelect`;
5. introducir `CountryPicker` + `PostalAddressFields` + `postalLookup`;
6. migrar Cliente, Datos fiscales de ZENVIA, Registros IVA y selectores largos incluidos en este trabajo;
7. aplicar/verificar migraciones de Supabase y reparaciones explícitas de datos;
8. revisión completa, PR, CI, merge a `main` y verificación Vercel.

No se desplegarán checkpoints parciales a `main`.

## Fuera de alcance

- importación desde ZIP;
- OCR/parseo en servidor o nueva Edge Function solo para lotes;
- modelo fiscal detallado con múltiples tramos de IVA/recargo por línea;
- proveedor habitual separado del último proveedor real;
- tooltips en controles que no tengan texto truncado;
- modificación retroactiva masiva de facturas antiguas no revisadas expresamente;
- convertir proveedores a un modelo estructurado de dirección en esta iteración;
- hacer obligatorio un servicio postal externo para guardar direcciones;
- reescribir todos los modales existentes que no participen en cambios funcionales de esta iteración.
