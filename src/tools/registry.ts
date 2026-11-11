import { z } from "zod"
import { esRegistro } from "../domain/texto.ts"
import { bitacora } from "./bitacora.ts"
import { fail, mensajeZod } from "./errores.ts"
import {
  armar_paquete,
  generar_formulario,
  leer_solicitud,
  mapear_campos,
  simular_envio,
  type ContextoHerramienta,
} from "./proveedor.ts"
import { casoDe, resumirResultado } from "./resumen.ts"

export interface DefinicionHerramienta {
  description: string
  args: z.ZodRawShape
  execute(args: unknown, ctx: ContextoHerramienta): Promise<string>
}

export interface Ejecucion {
  body: string
  ok: boolean
  resumen: string
}

const HERRAMIENTAS: Record<string, DefinicionHerramienta> = {
  proveedor_leer_solicitud: leer_solicitud,
  proveedor_mapear_campos: mapear_campos,
  proveedor_generar_formulario: generar_formulario,
  proveedor_armar_paquete: armar_paquete,
  proveedor_simular_envio: simular_envio,
}

export function listarHerramientas(): { name: string; def: DefinicionHerramienta }[] {
  return Object.entries(HERRAMIENTAS).map(([name, def]) => ({ name, def }))
}

export async function ejecutarHerramienta(
  nombre: string,
  argumentos: unknown,
  ctx: ContextoHerramienta,
): Promise<Ejecucion> {
  const def = HERRAMIENTAS[nombre]
  if (!def) {
    const error = `No existe la herramienta ${nombre}.`
    return { body: fail(error), ok: false, resumen: error }
  }
  const entrada = esRegistro(argumentos) ? argumentos : {}
  const parsed = z.object(def.args).safeParse(entrada)
  if (!parsed.success) {
    const error = mensajeZod(parsed.error)
    await bitacora(ctx.directory, casoDe(entrada), nombre, false, error)
    return { body: fail(error), ok: false, resumen: error }
  }
  try {
    const body = await def.execute(parsed.data, ctx)
    return interpretar(nombre, body)
  } catch {
    const error = "No se pudo completar la herramienta."
    await bitacora(ctx.directory, casoDe(entrada), nombre, false, error)
    return { body: fail(error), ok: false, resumen: error }
  }
}

function interpretar(nombre: string, body: string): Ejecucion {
  try {
    const valor = JSON.parse(body) as unknown
    if (!esRegistro(valor) || typeof valor.ok !== "boolean") {
      return { body, ok: false, resumen: "La herramienta devolvió una respuesta ilegible." }
    }
    if (!valor.ok) {
      const error = typeof valor.error === "string" ? valor.error : "La herramienta no pudo completarse."
      return { body, ok: false, resumen: error }
    }
    const data = esRegistro(valor.data) ? valor.data : undefined
    return { body, ok: true, resumen: resumirResultado(nombre, data) }
  } catch {
    return { body, ok: false, resumen: "La herramienta devolvió una respuesta ilegible." }
  }
}
