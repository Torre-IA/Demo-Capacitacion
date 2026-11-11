import { esRegistro, idCasoValido } from "../domain/texto.ts"
import type { MensajeAgente } from "../types.ts"
import { extraerCaso } from "./casos.ts"

export interface Sobre {
  ok: boolean
  error?: string
  data?: Record<string, unknown>
}

export function parsearSobre(content: string): Sobre | null {
  try {
    const valor = JSON.parse(content) as unknown
    if (!esRegistro(valor) || typeof valor.ok !== "boolean") return null
    return {
      ok: valor.ok,
      error: typeof valor.error === "string" ? valor.error : undefined,
      data: esRegistro(valor.data) ? valor.data : undefined,
    }
  } catch {
    return null
  }
}

export function mensajesDelTurno(mensajes: MensajeAgente[]): MensajeAgente[] {
  let inicio = 0
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    if (mensajes[i]?.role === "user") {
      inicio = i
      break
    }
  }
  return mensajes.slice(inicio)
}

export function ultimoResultado(mensajes: MensajeAgente[], nombre: string): Sobre | null {
  let encontrado: Sobre | null = null
  for (const mensaje of mensajes) {
    if (mensaje.role === "tool" && mensaje.name === nombre) {
      const sobre = parsearSobre(mensaje.content)
      if (sobre) encontrado = sobre
    }
  }
  return encontrado
}

export function huboHerramientaOk(mensajes: MensajeAgente[], nombre: string): boolean {
  return ultimoResultado(mensajes, nombre)?.ok === true
}

export function ultimoCaso(mensajes: MensajeAgente[]): string | null {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    const mensaje = mensajes[i]
    if (!mensaje) continue
    if (mensaje.role === "assistant" && mensaje.toolCalls) {
      for (let j = mensaje.toolCalls.length - 1; j >= 0; j -= 1) {
        const caso = mensaje.toolCalls[j]?.arguments.caso
        if (typeof caso === "string" && idCasoValido(caso.trim().toLowerCase())) return caso.trim().toLowerCase()
      }
    }
    if (mensaje.role === "tool") {
      const caso = parsearSobre(mensaje.content)?.data?.caso
      if (typeof caso === "string" && idCasoValido(caso)) return caso
    }
    if (mensaje.role === "user") {
      const caso = extraerCaso(mensaje.content)
      if (caso) return caso
    }
  }
  return null
}
