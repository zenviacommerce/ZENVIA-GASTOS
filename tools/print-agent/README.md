# ZENVIA Print Agent

Agente local para impresión directa desde ZENVIA Gestión sin depender de Sendcloud.

## Windows

La opción recomendada es ejecutar `install-windows.cmd`. Instala las dependencias, arranca el agente y lo añade al inicio de Windows.

Para quitar el arranque automático, ejecuta `uninstall-windows.cmd`.

También se puede arrancar manualmente con `start-windows.cmd` o con `npm start`.

El agente escucha únicamente en `127.0.0.1:17931` por defecto y acepta peticiones de
`https://gestion.zenviacommerce.com`, del entorno local de desarrollo y de previews de Vercel.

La aplicación web puede:

- comprobar el agente con `GET /health`;
- descubrir impresoras con `GET /printers`;
- enviar un PDF con `POST /print` y la cabecera `X-Printer-Id`.

La impresión utiliza la impresora instalada en Windows. El paquete `pdf-to-printer` se encarga
de enviar el PDF al spooler local.

### Configuración opcional

- `ZENVIA_PRINT_PORT`: cambia el puerto local.
- `ZENVIA_PRINT_HOST`: cambia la interfaz de escucha. Déjalo en `127.0.0.1` salvo que se
  implemente emparejamiento seguro para una red local.
- `ZENVIA_PRINT_ALLOWED_ORIGINS`: lista adicional de orígenes separados por comas.

## iPad

Un navegador de iPad no puede utilizar el `localhost` de un PC. En iPad el fallback seguirá
siendo abrir el PDF/AirPrint. Para impresión silenciosa desde iPad habrá que habilitar una futura
modalidad LAN del agente con emparejamiento y autenticación.


## Formatos de etiqueta

La aplicación envía al agente el formato configurado en **Configuración → Envíos** o elegido rápidamente en **Pedidos**:

- Automático / original: conserva el tamaño del PDF del transportista.
- A6.
- 10 × 15 cm: se envía al driver como 4×6, el formato térmico equivalente habitual.
- A5.
- A4.

El PDF se normaliza en la aplicación y, cuando existe un tamaño estándar, el agente también solicita ese tamaño al driver de Windows.
