import fs from "node:fs"
import path from "node:path"

export interface Configuracion {
  directorio: string
  proveedor: "openai" | "local"
  modelo: string
  maxIteraciones: number
  maxTokensSesion: number
  maxSalida: number
  timeoutMs: number
  port: number
  host: string
}

export function cargarConfig(directorio: string): Configuracion {
  cargarEnv(directorio)
  const proveedor = resolverProveedor()
  return {
    directorio,
    proveedor,
    modelo: proveedor === "openai" ? texto("OPENAI_MODEL", "gpt-4o-mini") : "planificador-local",
    maxIteraciones: entero("MAX_TOOL_ITERATIONS", 25, 1, 50),
    maxTokensSesion: entero("MAX_SESSION_TOKENS", 24000, 1000, 200000),
    maxSalida: entero("MAX_OUTPUT_TOKENS", 2000, 200, 8000),
    timeoutMs: entero("LLM_TIMEOUT_MS", 60000, 1000, 180000),
    port: entero("PORT", 3000, 1, 65535),
    host: texto("HOST", "0.0.0.0"),
  }
}

export function resolverProveedor(): "openai" | "local" {
  const pedido = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase()
  if (pedido === "local") return "local"
  if (pedido === "openai") return "openai"
  if (process.env.OPENAI_API_KEY?.trim()) return "openai"
  return "local"
}

function cargarEnv(directorio: string): void {
  const archivo = path.join(directorio, ".env")
  if (!fs.existsSync(archivo)) return
  const lineas = fs.readFileSync(archivo, "utf8").split(/\r?\n/)
  for (const linea of lineas) {
    const limpia = linea.trim()
    if (!limpia || limpia.startsWith("#")) continue
    const separador = limpia.indexOf("=")
    if (separador < 1) continue
    const clave = limpia.slice(0, separador).trim()
    let valor = limpia.slice(separador + 1).trim()
    if ((valor.startsWith("\"") && valor.endsWith("\"")) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1)
    }
    if (process.env[clave] === undefined) process.env[clave] = valor
  }
}

function entero(nombre: string, defecto: number, minimo: number, maximo: number): number {
  const crudo = process.env[nombre]
  if (!crudo) return defecto
  const valor = Number(crudo)
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) return defecto
  return valor
}

function texto(nombre: string, defecto: string): string {
  const valor = process.env[nombre]?.trim()
  return valor ? valor : defecto
}
