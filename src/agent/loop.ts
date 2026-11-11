import fs from "node:fs/promises"
import path from "node:path"
import { esConfirmacionExplicita, pideConfirmacion } from "../domain/confirmacion.ts"
import { cargarConfig } from "../config.ts"
import { huboHerramientaOk, ultimoCaso } from "./historial.ts"
import type { AdaptadorLlm } from "../llm/adapter.ts"
import { parametrosDe } from "../llm/esquema.ts"
import { crearAdaptador } from "../llm/factory.ts"
import { mensajeErrorProveedor } from "../llm/openai.ts"
import { crearSesion, guardarSesion, obtenerSesion, UUID } from "../session.ts"
import { ejecutarHerramienta, listarHerramientas } from "../tools/registry.ts"
import type { LlamadaHerramienta, MensajeAgente, RespuestaChat, TrazaHerramienta } from "../types.ts"

const ORDEN = [
  "proveedor_leer_solicitud",
  "proveedor_mapear_campos",
  "proveedor_generar_formulario",
  "proveedor_armar_paquete",
  "proveedor_simular_envio",
]

export async function responderTurno(opciones: {
  directory: string
  message: string
  sessionId?: string
  adaptador?: AdaptadorLlm
}): Promise<RespuestaChat> {
  const message = opciones.message.trim()
  const config = cargarConfig(opciones.directory)
  const adaptador = opciones.adaptador ?? crearAdaptador(config)
  const sesion = await asegurarSesion(opciones.directory, opciones.sessionId)
  const herramientas = listarHerramientas().map((item) => ({
    name: item.name,
    description: item.def.description,
    parameters: parametrosDe(item.def.args),
  }))

  let sistema: string
  try {
    sistema = await cargarInstrucciones(opciones.directory)
  } catch {
    return cerrar(opciones.directory, sesion, message, [], "No encuentro las instrucciones del agente.", false, [
      ...sesion.mensajes,
      { role: "user", content: message },
    ])
  }

  const trabajo: MensajeAgente[] = [{ role: "system", content: sistema }, ...sesion.mensajes, { role: "user", content: message }]
  const toolCalls: TrazaHerramienta[] = []
  const ctx = {
    directory: opciones.directory,
    sessionId: sesion.id,
    confirmacionExplicita: esConfirmacionExplicita(message),
  }

  for (let paso = 0; paso < config.maxIteraciones; paso += 1) {
    if (estimarTokens(trabajo) > config.maxTokensSesion) {
      return cerrar(
        opciones.directory,
        sesion,
        message,
        toolCalls,
        "Esta sesión llegó al tope de tokens configurado. Abre una sesión nueva para continuar.",
        false,
        trabajo,
      )
    }

    let modelo
    try {
      modelo = await adaptador.enviar(trabajo, herramientas, {
        timeoutMs: config.timeoutMs,
        maxSalida: config.maxSalida,
      })
    } catch (error) {
      return cerrar(opciones.directory, sesion, message, toolCalls, mensajeErrorProveedor(error), false, trabajo)
    }

    if (modelo.toolCalls.length > 0) {
      const ordenadas = ordenar(modelo.toolCalls)
      trabajo.push({ role: "assistant", content: modelo.content ?? "", toolCalls: ordenadas })
      for (const llamada of ordenadas) {
        const ejecutada = await ejecutarHerramienta(llamada.name, llamada.arguments, ctx)
        toolCalls.push({
          id: llamada.id,
          name: llamada.name,
          arguments: llamada.arguments,
          ok: ejecutada.ok,
          resumen: ejecutada.resumen,
          result: ejecutada.body,
        })
        trabajo.push({ role: "tool", toolCallId: llamada.id, name: llamada.name, content: ejecutada.body })
      }
      continue
    }

    const yaSimulo = toolCalls.some((llamada) => llamada.name === "proveedor_simular_envio")
    const casoPrevio = ultimoCaso(sesion.mensajes)
    if (
      !yaSimulo &&
      esConfirmacionExplicita(message) &&
      casoPrevio &&
      huboHerramientaOk(sesion.mensajes, "proveedor_armar_paquete")
    ) {
      const llamada: LlamadaHerramienta = {
        id: `call_forzada_simular_${paso}`,
        name: "proveedor_simular_envio",
        arguments: { caso: casoPrevio, confirmado: true },
      }
      trabajo.push({ role: "assistant", content: "", toolCalls: [llamada] })
      const ejecutada = await ejecutarHerramienta(llamada.name, llamada.arguments, ctx)
      toolCalls.push({
        id: llamada.id,
        name: llamada.name,
        arguments: llamada.arguments,
        ok: ejecutada.ok,
        resumen: ejecutada.resumen,
        result: ejecutada.body,
      })
      trabajo.push({ role: "tool", toolCallId: llamada.id, name: llamada.name, content: ejecutada.body })
      continue
    }

    const reply = (modelo.content ?? "").trim() || "No obtuve una respuesta útil. Puedes reformular la solicitud."
    const needsConfirmation = modelo.needsConfirmation === true || pideConfirmacion(reply)
    return cerrar(opciones.directory, sesion, message, toolCalls, reply, needsConfirmation, trabajo)
  }

  return cerrar(
    opciones.directory,
    sesion,
    message,
    toolCalls,
    "Alcancé el tope de pasos de esta consulta. Revisa las herramientas ejecutadas y dime si sigo con lo que falta.",
    false,
    trabajo,
  )
}

async function asegurarSesion(directorio: string, sessionId?: string) {
  if (!sessionId) return crearSesion()
  if (!UUID.test(sessionId)) throw new Error("sesión inválida")
  return (await obtenerSesion(directorio, sessionId)) ?? crearSesion(sessionId)
}

async function cerrar(
  directorio: string,
  sesion: Awaited<ReturnType<typeof asegurarSesion>>,
  message: string,
  toolCalls: TrazaHerramienta[],
  reply: string,
  needsConfirmation: boolean,
  trabajo: MensajeAgente[],
): Promise<RespuestaChat> {
  const historial = trabajo.some((item) => item.role === "user") ? trabajo : [...trabajo, { role: "user" as const, content: message }]
  if (historial[historial.length - 1]?.role !== "assistant") {
    historial.push({ role: "assistant", content: reply })
  }
  sesion.turns.push({ role: "user", content: message })
  sesion.turns.push({ role: "assistant", content: reply, toolCalls, needsConfirmation })
  sesion.mensajes = historial.filter((item) => item.role !== "system")
  sesion.tokensEstimados = estimarTokens(sesion.mensajes)
  try {
    await guardarSesion(directorio, sesion)
  } catch {
    // La sesión sigue en memoria si el disco no acepta la escritura.
  }
  return { sessionId: sesion.id, reply, toolCalls, needsConfirmation }
}

async function cargarInstrucciones(directorio: string): Promise<string> {
  const prompt = await fs.readFile(path.join(directorio, "agent", "prompt.md"), "utf8")
  const conocimiento = await fs.readFile(path.join(directorio, "src", "knowledge", "registro-proveedor.md"), "utf8")
  return `${prompt.trim()}\n\n${conocimiento.trim()}\n`
}

function estimarTokens(mensajes: MensajeAgente[]): number {
  let caracteres = 0
  for (const mensaje of mensajes) {
    caracteres += mensaje.content.length
    if (mensaje.role === "assistant" && mensaje.toolCalls) caracteres += JSON.stringify(mensaje.toolCalls).length
  }
  return Math.ceil(caracteres / 4)
}

function ordenar(llamadas: LlamadaHerramienta[]): LlamadaHerramienta[] {
  return [...llamadas].sort((a, b) => indice(a.name) - indice(b.name))
}

function indice(nombre: string): number {
  const posicion = ORDEN.indexOf(nombre)
  return posicion < 0 ? ORDEN.length : posicion
}
