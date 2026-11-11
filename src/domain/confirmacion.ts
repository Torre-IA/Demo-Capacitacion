import { normalizar } from "./texto.ts"

const FRASES = new Set([
  "si",
  "ok",
  "dale",
  "adelante",
  "confirma",
  "confirmo",
  "confirmar",
  "confirmado",
  "envia",
  "enviar",
  "envialo",
  "envia ahora",
  "envia el paquete",
  "enviar el paquete",
  "procede",
  "de acuerdo",
  "autorizo",
  "hazlo",
  "simula",
  "simular",
  "simula el envio",
  "si envia",
  "si confirmo",
  "si envialo",
  "confirmo el envio",
  "si confirmo el envio",
  "autorizo el envio",
  "puedes enviar",
])

export function esConfirmacionExplicita(texto: string): boolean {
  const plano = normalizar(texto)
  if (!plano) return false
  if (/\bno\b/.test(plano)) return false
  if (/\b(todavia|aun)\b/.test(plano)) return false
  return FRASES.has(plano)
}

export function pideConfirmacion(texto: string): boolean {
  return /confirm/i.test(texto) && texto.includes("?")
}
