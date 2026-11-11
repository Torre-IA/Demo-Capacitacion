import { esRegistro } from "../domain/texto.ts"
import type { MensajeAgente } from "../types.ts"
import type { AdaptadorLlm, EsquemaHerramienta, ResultadoModelo } from "./adapter.ts"

export function crearAdaptadorOpenAI(modelo: string): AdaptadorLlm {
  return {
    id: "openai",
    model: modelo,
    async enviar(mensajes, herramientas, opciones) {
      const apiKey = process.env.OPENAI_API_KEY?.trim() ?? ""
      if (!apiKey) throw new Error("Falta OPENAI_API_KEY en el servidor.")
      const base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")
      const respuesta = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelo,
          temperature: 0,
          max_tokens: opciones.maxSalida,
          messages: mensajes.map(aProveedor),
          tools: herramientas.map(aFuncion),
        }),
        signal: AbortSignal.timeout(opciones.timeoutMs),
      })
      if (!respuesta.ok) throw new Error(`proveedor ${respuesta.status}`)
      const cuerpo = (await respuesta.json()) as unknown
      return interpretar(cuerpo)
    },
  }
}

export function mensajeErrorProveedor(error: unknown): string {
  const nombre = error instanceof Error ? error.name : ""
  if (nombre === "TimeoutError" || nombre === "AbortError") {
    return "El modelo tardó demasiado en responder. La sesión sigue activa: intenta de nuevo."
  }
  const texto = error instanceof Error ? error.message : ""
  if (texto.startsWith("Falta OPENAI_API_KEY")) {
    return "Falta la clave del modelo en el servidor. Define OPENAI_API_KEY o usa LLM_PROVIDER=local. La sesión sigue activa."
  }
  if (/401|403|invalid api key|incorrect api key/i.test(texto)) {
    return "La clave del modelo fue rechazada. Revisa la configuración del servidor. La sesión sigue activa."
  }
  if (/429|rate limit|quota/i.test(texto)) {
    return "El proveedor del modelo limitó las solicitudes por ahora. Espera un momento e intenta de nuevo. La sesión sigue activa."
  }
  return "No pude consultar el modelo en este momento. La sesión sigue activa: intenta de nuevo."
}

function aProveedor(mensaje: MensajeAgente): Record<string, unknown> {
  if (mensaje.role === "tool") {
    return { role: "tool", tool_call_id: mensaje.toolCallId, content: mensaje.content }
  }
  if (mensaje.role === "assistant" && mensaje.toolCalls && mensaje.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: mensaje.content || null,
      tool_calls: mensaje.toolCalls.map((llamada) => ({
        id: llamada.id,
        type: "function",
        function: { name: llamada.name, arguments: JSON.stringify(llamada.arguments) },
      })),
    }
  }
  return { role: mensaje.role, content: mensaje.content }
}

function aFuncion(herramienta: EsquemaHerramienta): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: herramienta.name,
      description: herramienta.description,
      parameters: herramienta.parameters,
    },
  }
}

function interpretar(cuerpo: unknown): ResultadoModelo {
  if (!esRegistro(cuerpo) || !Array.isArray(cuerpo.choices)) {
    throw new Error("respuesta ilegible")
  }
  const primera = cuerpo.choices[0]
  if (!esRegistro(primera) || !esRegistro(primera.message)) return { content: null, toolCalls: [] }
  const mensaje = primera.message
  const toolCalls: ResultadoModelo["toolCalls"] = []
  if (Array.isArray(mensaje.tool_calls)) {
    mensaje.tool_calls.forEach((llamada: unknown, indice: number) => {
      if (!esRegistro(llamada) || !esRegistro(llamada.function)) return
      const name = llamada.function.name
      if (typeof name !== "string" || !name) return
      const crudo = typeof llamada.function.arguments === "string" ? llamada.function.arguments : "{}"
      toolCalls.push({
        id: typeof llamada.id === "string" && llamada.id ? llamada.id : `call_${indice}`,
        name,
        arguments: argumentos(crudo),
      })
    })
  }
  return { content: textoContenido(mensaje.content), toolCalls }
}

function argumentos(crudo: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(crudo) as unknown
    return esRegistro(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function textoContenido(content: unknown): string | null {
  if (typeof content === "string") return content
  if (content == null) return null
  if (!Array.isArray(content)) return null
  const partes = content.map((parte) => {
    if (typeof parte === "string") return parte
    if (esRegistro(parte) && typeof parte.text === "string") return parte.text
    return ""
  })
  const unido = partes.join("").trim()
  return unido || null
}
