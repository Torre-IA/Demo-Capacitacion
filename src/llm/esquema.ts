import { z } from "zod"
import type { EsquemaHerramienta } from "./adapter.ts"

export function parametrosDe(shape: z.ZodRawShape): Record<string, unknown> {
  return esquemaObjeto(shape, false)
}

function esquemaObjeto(shape: z.ZodRawShape, adicionales: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [clave, esquema] of Object.entries(shape)) {
    const convertido = convertir(esquema)
    properties[clave] = convertido.nodo
    if (convertido.obligatorio) required.push(clave)
  }
  return { type: "object", properties, required, additionalProperties: adicionales }
}

function convertir(esquema: z.ZodTypeAny): { nodo: Record<string, unknown>; obligatorio: boolean } {
  if (esquema instanceof z.ZodOptional) {
    const interno = convertir(esquema.unwrap())
    return { nodo: describir(interno.nodo, esquema), obligatorio: false }
  }
  if (esquema instanceof z.ZodNullable) {
    const interno = convertir(esquema.unwrap())
    return { nodo: describir({ anyOf: [interno.nodo, { type: "null" }] }, esquema), obligatorio: true }
  }
  if (esquema instanceof z.ZodString) return { nodo: describir({ type: "string" }, esquema), obligatorio: true }
  if (esquema instanceof z.ZodBoolean) return { nodo: describir({ type: "boolean" }, esquema), obligatorio: true }
  if (esquema instanceof z.ZodNumber) return { nodo: describir({ type: "number" }, esquema), obligatorio: true }
  if (esquema instanceof z.ZodArray) {
    return {
      nodo: describir({ type: "array", items: convertir(esquema.element).nodo }, esquema),
      obligatorio: true,
    }
  }
  if (esquema instanceof z.ZodObject) {
    return { nodo: describir(esquemaObjeto(esquema.shape, true), esquema), obligatorio: true }
  }
  if (esquema instanceof z.ZodUnion) {
    const opciones = esquema.options.map((opcion: z.ZodTypeAny) => convertir(opcion).nodo)
    return { nodo: describir({ anyOf: opciones }, esquema), obligatorio: true }
  }
  return { nodo: describir({}, esquema), obligatorio: true }
}

function describir(nodo: Record<string, unknown>, esquema: z.ZodTypeAny): Record<string, unknown> {
  if (esquema.description) nodo.description = esquema.description
  return nodo
}

export function esquemasHerramientas(
  herramientas: { name: string; description: string; parameters: Record<string, unknown> }[],
): EsquemaHerramienta[] {
  return herramientas
}
