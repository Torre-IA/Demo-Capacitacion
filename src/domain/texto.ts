import path from "node:path"

export function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function fechaHoy(ahora = new Date()): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, "0")
  const dia = String(ahora.getDate()).padStart(2, "0")
  return `${ahora.getFullYear()}-${mes}-${dia}`
}

export function rutaRelativa(raiz: string, absoluto: string): string {
  return path.relative(raiz, absoluto).split(path.sep).join("/")
}

export function idCasoValido(caso: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(caso)
}
