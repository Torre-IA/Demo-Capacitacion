# Registro como proveedor

Agente conversacional que prepara el registro de Periferia IT Group como proveedor. Lee la solicitud, llena el formulario desde el repositorio maestro, arma el paquete para firma y solo simula el envío si una persona lo confirma.

No firma, no envía correos y no entra a portales. No hay clave de acceso.

## Arranque

Desde la raíz de este repositorio, con [Bun](https://bun.sh) o con Node.js 20+:

```bash
bun install
bun run dev
```

```bash
npm install
npm run dev
```

Abre http://localhost:3000. El código también corre en Node.js 18.

Sin `OPENAI_API_KEY` el chat usa un planificador local. Pasa por el mismo ciclo y las mismas herramientas, y no llama a ningún proveedor. Para usar un modelo, copia `.env.example` a `.env` y completa:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=tu-clave
OPENAI_MODEL=gpt-4o-mini
```

La clave solo la lee el backend. No entra al front, al repositorio, a los logs ni a las respuestas de la API.

## Demo sin modelo

```bash
bun install
bun run demo.ts
```

Equivalente: `npm run demo`. Limpia `out/`, procesa los cuatro casos y comprueba celdas, faltantes, soportes vencidos, la ausencia de datos bancarios en el correo y la confirmación del envío simulado.

## Probar el chat

En una sesión nueva:

```text
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles
faltan, si el paquete está listo para firma y qué soportes debo actualizar.
No envíes nada todavía.
```

El segundo mensaje `envía` escribe `out/ec-corp-andina/ENVIO-SIMULADO.md`. También valen `confirmo`, `sí` y `sí, envía`. `no envíes` no confirma.

Los botones de la izquierda disparan ese mismo pedido para cada caso.

## API

| Método | Ruta | Respuesta |
| --- | --- | --- |
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ sessionId, reply, toolCalls, needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model }` |
| `GET` | `/api/casos` | Casos de la bandeja, para el front |
| `GET` | `/descargas/...` | Archivos generados en `out/` |

`toolCalls` trae nombre, argumentos, un resumen y el JSON de la herramienta.

## Límites

`MAX_TOOL_ITERATIONS` (25), `MAX_SESSION_TOKENS` (24000), `MAX_OUTPUT_TOKENS` (2000) y `LLM_TIMEOUT_MS` (60000). Un error del modelo se explica en el chat y la sesión sigue.

## Link de prueba

No hay URL pública: este entorno no tiene cuenta de hosting ni clave de modelo. La aplicación se prueba en local con `npm run dev`. Publicarla en Render o Railway usa `npm install` como build, `npm start` como arranque y `/api/health` como health check. La clave va solo en las variables del servicio.

## Estructura

`agent/prompt.md` es el comportamiento. `src/knowledge/` es el conocimiento del proceso. `src/tools/proveedor.ts` ejecuta y es la única fuente de los valores. `modulo/` reexporta esas mismas piezas para llevarlas a otra plataforma.
