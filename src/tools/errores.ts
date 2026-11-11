import { z } from "zod"

export function ok(data: unknown): string {
  return JSON.stringify({ ok: true, data })
}

export function fail(error: string): string {
  return JSON.stringify({ ok: false, error })
}

export function mensajeZod(error: z.ZodError): string {
  const partes = error.issues.slice(0, 4).map((issue) => {
    const ruta = issue.path.length > 0 ? issue.path.join(".") : "argumento"
    return `${ruta}: ${issue.message}`
  })
  return `Argumentos inválidos (${partes.join("; ")}).`
}
