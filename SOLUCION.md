# Solución — agente de registro como proveedor

## 1. Problema

El área administrativa transcribe, una solicitud a la vez, datos que ya existen en un repositorio. Le duele a la analista: repite NIT, dirección y soportes en Excel, PDF o portales, y un error en la cuenta o un soporte vencido retrasa la facturación.

## 2. Arquitectura

```text
web/  chat, trazas y confirmación
  │  POST /api/chat
  ▼
src/server.ts
  └─ src/agent/loop.ts          ciclo, tope de pasos, tope de tokens
       ├─ agent/prompt.md       comportamiento
       ├─ src/knowledge/        reglas del proceso
       ├─ src/llm/              adaptador: local u OpenAI
       └─ src/tools/proveedor.ts
            ├─ fixtures/reto-01  solo lectura
            └─ out/<caso>/       formulario, paquete, bitácora
```

El servidor no decide si un NIT extranjero se confirma ni si un soporte está vencido. Eso vive en `src/domain/` y lo ejecutan las herramientas. Cambiar una regla no exige tocar `server.ts`.

`modulo/agent.md` y `modulo/skill/registro-proveedor/SKILL.md` tienen el mismo texto que el prompt y el conocimiento. `modulo/tools/proveedor.ts` reexporta las herramientas; `demo.ts` comprueba que la función sea la misma, no una copia.

## 3. Ciclo del agente

Cada turno arma el contexto con el prompt, el conocimiento y el historial, y llama a `adaptador.enviar`. Si el modelo pide herramientas, el servidor las valida con zod, las ejecuta en orden (leer, mapear, generar, armar, simular) y devuelve el JSON al modelo. El tope es 25 vueltas. Al llegar, el chat dice qué alcanzó a hacer.

La confirmación tiene dos cerraduras. La herramienta `proveedor_simular_envio` solo escribe `ENVIO-SIMULADO.md` si recibe `confirmado: true` y el mensaje de la persona es una frase explícita (`envía`, `confirmo`, `sí`). Si el modelo olvida la herramienta después de un `envía` y ya existe un paquete, el ciclo la ejecuta una vez y le pide al modelo que informe la ruta. El front marca ese turno cuando la respuesta pide confirmación.

Toda llamada queda en el historial y en `out/log.jsonl` y `out/<caso>/log.jsonl`, con `ts`, `herramienta`, `ok` y `resumen`. Un fallo del modelo o de una herramienta se cuenta en español y la sesión sigue.

## 4. Modelo

El adaptador de producción es la API de OpenAI, modelo `gpt-4o-mini`, temperatura 0. Se eligió porque llama herramientas, es barato y el archivo `src/llm/openai.ts` se puede apuntar a otro endpoint compatible con `OPENAI_BASE_URL` sin tocar el ciclo.

Un caso hace unas cuatro llamadas de herramienta y dos respuestas. Con la lista pública de `gpt-4o-mini` (cerca de 0,15 USD por millón de tokens de entrada y 0,60 de salida) el costo queda por debajo de 0,01 USD por caso. Hay que revisar el precio vigente antes de producción.

Sin clave, `LLM_PROVIDER` queda en `local`: un planificador determinista que usa la misma interfaz y las mismas herramientas. La demo y la defensa no dependen de red ni de saldo. No sustituye una conversación abierta; cubre el flujo del reto.

## 5. Portal web

No se automatiza el portal. La herramienta escribe `out/<caso>/valores-portal.md` y el agente responde `formato no soportado`.

Si hubiera que llenarlo más adelante, usaría un navegador controlado (Playwright) como herramienta aparte, con selectores versionados por cliente. El agente pegaría los valores del markdown y se detendría antes de enviar. Los límites son CAPTCHA, MFA, caducidad de sesión y cambios de layout: ante cualquiera de esos, el agente se detiene y la persona continúa.

Las credenciales no viven en el repositorio, ni en el prompt, ni en los logs, ni en el markdown. La persona las escribe en el navegador o en el almacén del sistema operativo. El agente nunca recibe la contraseña. El ingreso, el segundo factor y el clic en Enviar son humanos. El agente, como mucho, deja el formulario lleno y espera.

## 6. Decisiones

1. **Las herramientas recalculan desde el maestro.** La alternativa era escribir el JSON que devolviera el modelo. Se descartó porque un modelo puede cambiar un NIT y la respuesta seguiría pareciendo válida. El argumento `mapeo` se valida, y el archivo se llena con una lectura nueva.

2. **Dos adaptadores, un ciclo.** La alternativa era exigir OpenAI para abrir el chat. Sin clave el reto no se podría mostrar. El planificador local entra por la misma interfaz; cambiar de proveedor no toca el bucle.

3. **HTML servido por el mismo proceso.** La alternativa era Vite y un segundo puerto. Un solo comando (`npm run dev` o `bun run dev`) levanta chat y API, y no hay paso de build.

4. **El número de cuenta solo queda en el formulario.** La respuesta de la herramienta, el checklist, el borrador y la bitácora lo sustituyen por un aviso. La alternativa era mostrarlo en el chat para que la analista no abriera el archivo. Se descartó porque ese texto viaja al proveedor, al historial y, si el modelo lo copia, al correo.

## 7. Supuestos

- La fecha de corte es la fecha local del servidor. Una vigencia igual a hoy sigue vigente; `null` no vence.
- Los valores se copian como están en el maestro: el país queda `CO` y los ingresos quedan en el número, sin moneda, porque el glosario apunta solo a `ingresos_ultimo_ano.valor`.
- En Excel una celda faltante queda vacía. En PDF y en el markdown del portal se escribe "Sin dato en el maestro" para que el hueco no parezca un olvido.
- La confirmación es el mensaje completo, no una frase enterrada en un párrafo. `no` y `todavía` anulan la confirmación.
- Se procesa un caso por turno. La bandeja del reto son las cuatro carpetas del fixture.
- Además de la regla de soportes, la falta del archivo del formulario también deja `listo_para_firma` en no.
- Los fixtures no se modifican. Se copiaron a `fixtures/reto-01/`.

## 8. Cobertura

| Historia | Estado | Qué falta para producción |
| --- | --- | --- |
| HU-1 Leer la solicitud | Hecho | Bandeja real de correo y plantillas peor formadas |
| HU-2 Mapear campos | Hecho | Dueño del maestro y glosario mantenido |
| HU-3 Excel, PDF y portal | Hecho | AcroForm real si el cliente entrega un PDF rellenable; el portal sigue siendo diseño |
| HU-4 Paquete para firma | Hecho | Firma electrónica y envío real, ambos con una persona en el medio |
| HU-5 Errores | Hecho | Alertas y reintentos del proveedor en un entorno compartido |

La demo cubre los cuatro casos, un caso inexistente, la negación del envío y el ciclo de chat del ejemplo de Ecuador.

## 9. Uso de IA

Construí la aplicación en Cursor con Grok. Le pedí que leyera el PRD y los fixtures y que implementara el agente, las herramientas, el chat, la demo y esta memoria. Revisé las reglas contra los casos: RUC y RTN no se inventan, "Número de contribuyente especial" y "Referencias comerciales" quedan faltantes, la cámara y los parafiscales vencen con la fecha de esta sesión, y el certificado de cumplimiento tributario de Ecuador no está en el índice.

Descarté cuatro ideas que habrían dejado el reto mal cerrado: inventar los campos ausentes, automatizar VendorHub, poner la clave en el front y fiarme del JSON del modelo para escribir el Excel.

## 10. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El modelo completa un dato que no está | El prompt lo prohíbe y la herramienta relee el maestro |
| La cuenta bancaria sale del formulario | No viaja en la respuesta de la herramienta, el correo, el checklist ni el log |
| Plantillas reales rotas | La fila inválida se omite y se informa; si no queda ninguna, la herramienta devuelve error y el chat sigue |
| Soportes vencidos | Bloquean `listo_para_firma` y el borrador los lista |
| Portal con CAPTCHA o MFA | La persona opera el portal; el agente solo prepara valores |
| Costo de la clave | Tope de iteraciones, de tokens de sesión y de salida |
| Maestro desactualizado | Hace falta un dueño del dato; el agente no puede saber si el NIT cambió |
| El planificador local no conversa fuera del flujo | Con clave, el mismo ciclo usa el modelo. Sin clave, el flujo del reto queda cubierto |
