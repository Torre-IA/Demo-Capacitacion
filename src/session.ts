import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { esRegistro } from "./domain/texto.ts"
import type { MensajeAgente, TurnoChat } from "./types.ts"

export interface Sesion {
  id: string
  createdAt: string
  tokensEstimados: number
  turns: TurnoChat[]
  mensajes: MensajeAgente[]
}

const sesiones = new Map<string, Sesion>()

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function crearSesion(id: string = crypto.randomUUID()): Sesion {
  const sesion: Sesion = {
    id,
    createdAt: new Date().toISOString(),
    tokensEstimados: 0,
    turns: [],
    mensajes: [],
  }
  sesiones.set(id, sesion)
  return sesion
}

export async function obtenerSesion(directorio: string, id: string): Promise<Sesion | null> {
  if (!UUID.test(id)) return null
  const memoria = sesiones.get(id)
  if (memoria) return memoria
  try {
    const texto = await fs.readFile(rutaSesion(directorio, id), "utf8")
    const datos = JSON.parse(texto) as unknown
    if (!esSesion(datos) || datos.id !== id) return null
    sesiones.set(id, datos)
    return datos
  } catch {
    return null
  }
}

export async function guardarSesion(directorio: string, sesion: Sesion): Promise<void> {
  sesiones.set(sesion.id, sesion)
  const archivo = rutaSesion(directorio, sesion.id)
  await fs.mkdir(path.dirname(archivo), { recursive: true })
  await fs.writeFile(archivo, JSON.stringify(sesion), "utf8")
}

function rutaSesion(directorio: string, id: string): string {
  return path.join(directorio, "out", "sessions", `${id}.json`)
}

function esSesion(valor: unknown): valor is Sesion {
  if (!esRegistro(valor)) return false
  return (
    typeof valor.id === "string" &&
    typeof valor.createdAt === "string" &&
    typeof valor.tokensEstimados === "number" &&
    Array.isArray(valor.turns) &&
    Array.isArray(valor.mensajes)
  )
}
