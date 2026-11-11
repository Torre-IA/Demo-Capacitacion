import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { construirChecklist, construirCorreo, construirEnvio, construirPortal } from "../domain/documentos.ts"
import {
  SIN_DATO,
  cargarCaso,
  cargarIndiceSoportes,
  clasificarCampo,
  esEtiquetaAmbigua,
  evaluarSoportes,
  equivalenteTributario,
  firmaDesdeMaestro,
  mapearCaso,
  motivosBloqueo,
  nombreArchivoFormulario,
  raizFixtures,
  serializarMapeo,
} from "../domain/registro.ts"
import { fechaHoy, idCasoValido, rutaRelativa } from "../domain/texto.ts"
import { bitacora } from "./bitacora.ts"
import { fail, mensajeZod, ok } from "./errores.ts"
import { escribirExcel, escribirPdf, type FilaExcel } from "./formatos.ts"
import { casoDe, resumirResultado } from "./resumen.ts"

export interface ContextoHerramienta {
  directory: string
  sessionId: string
  confirmacionExplicita?: boolean
}

const argsLeer = {
  caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/."),
}

const itemMapeo = z.object({ etiqueta: z.string() }).passthrough()

const argsMapear = {
  caso: z.string().describe("Nombre de la carpeta del caso."),
  campos: z.array(z.union([z.string(), z.object({ etiqueta: z.string() }).passthrough()])).describe(
    "Campos devueltos por proveedor_leer_solicitud.",
  ),
}

const argsGenerar = {
  caso: z.string().describe("Nombre de la carpeta del caso."),
  mapeo: z
    .object({
      llenos: z.array(itemMapeo),
      faltantes: z.array(itemMapeo),
      requiere_confirmacion: z.array(itemMapeo),
    })
    .describe("Resultado de proveedor_mapear_campos. Los valores se recalculan desde el maestro."),
}

const argsArmar = {
  caso: z.string().describe("Nombre de la carpeta del caso."),
}

const argsSimular = {
  caso: z.string().describe("Nombre de la carpeta del caso."),
  confirmado: z.boolean().describe("true solo si el usuario confirmó el envío en el mensaje anterior."),
}

export const leer_solicitud = {
  description: "Lee la solicitud, la plantilla y los soportes exigidos de un caso.",
  args: argsLeer,
  async execute(args: unknown, ctx: ContextoHerramienta): Promise<string> {
    const herramienta = "proveedor_leer_solicitud"
    try {
      const parsed = z.object(argsLeer).safeParse(args)
      if (!parsed.success) return await rechazar(ctx, herramienta, null, mensajeZod(parsed.error))
      const caso = parsed.data.caso.trim().toLowerCase()
      const cargado = await cargarCaso(ctx.directory, caso)
      if (!cargado.ok) return await rechazar(ctx, herramienta, idCasoValido(caso) ? caso : null, cargado.error)
      const datos = cargado.data
      const data = {
        caso: datos.id,
        pais: datos.pais,
        cliente: datos.cliente,
        formato: datos.formato,
        de: datos.de,
        asunto: datos.asunto,
        fecha: datos.fecha,
        campos: datos.campos.map((campo) => ({
          etiqueta: campo.etiqueta,
          obligatorio: campo.obligatorio,
          hoja: campo.hoja,
          celda_etiqueta: campo.celda_etiqueta,
          celda_valor: campo.celda_valor,
          ambiguo: esEtiquetaAmbigua(campo.etiqueta),
          equivalente_pais: esEtiquetaAmbigua(campo.etiqueta) ? equivalenteTributario(datos.pais) : null,
        })),
        soportes: datos.soportes,
        advertencias: datos.advertencias,
      }
      return await aceptar(ctx, herramienta, caso, data)
    } catch {
      return await rechazar(ctx, herramienta, casoDe(args), "No se pudo leer la solicitud.")
    }
  },
}

export const mapear_campos = {
  description: "Cruza los campos pedidos con el glosario y el maestro, sin inventar valores.",
  args: argsMapear,
  async execute(args: unknown, ctx: ContextoHerramienta): Promise<string> {
    const herramienta = "proveedor_mapear_campos"
    try {
      const parsed = z.object(argsMapear).safeParse(args)
      if (!parsed.success) return await rechazar(ctx, herramienta, null, mensajeZod(parsed.error))
      const caso = parsed.data.caso.trim().toLowerCase()
      const mapeado = await mapearCaso(ctx.directory, caso, parsed.data.campos)
      if (!mapeado.ok) return await rechazar(ctx, herramienta, idCasoValido(caso) ? caso : null, mapeado.error)
      const publico = serializarMapeo(mapeado.data.mapeo)
      return await aceptar(ctx, herramienta, mapeado.data.caso.id, { caso: mapeado.data.caso.id, ...publico })
    } catch {
      return await rechazar(ctx, herramienta, casoDe(args), "No se pudo mapear los campos.")
    }
  },
}

export const generar_formulario = {
  description: "Genera el formulario del caso en Excel o PDF, o un markdown si el formato es un portal.",
  args: argsGenerar,
  async execute(args: unknown, ctx: ContextoHerramienta): Promise<string> {
    const herramienta = "proveedor_generar_formulario"
    try {
      const parsed = z.object(argsGenerar).safeParse(args)
      if (!parsed.success) return await rechazar(ctx, herramienta, null, mensajeZod(parsed.error))
      const caso = parsed.data.caso.trim().toLowerCase()
      const mapeado = await mapearCaso(ctx.directory, caso, [])
      if (!mapeado.ok) return await rechazar(ctx, herramienta, idCasoValido(caso) ? caso : null, mapeado.error)
      const datos = mapeado.data.caso
      const mapeo = mapeado.data.mapeo
      const carpeta = path.join(ctx.directory, "out", datos.id)
      await fs.mkdir(carpeta, { recursive: true })
      const nombre = nombreArchivoFormulario(datos.formato)
      const destino = path.join(carpeta, nombre)
      if (datos.formato === "xlsx") {
        const filas: FilaExcel[] = []
        for (const campo of datos.campos) {
          if (!campo.hoja || !campo.celda_etiqueta || !campo.celda_valor) continue
          filas.push({
            hoja: campo.hoja,
            celda_etiqueta: campo.celda_etiqueta,
            celda_valor: campo.celda_valor,
            etiqueta: campo.etiqueta,
            valor: clasificarCampo(campo.etiqueta, mapeo).valor,
          })
        }
        await escribirExcel(destino, filas)
      } else if (datos.formato === "pdf") {
        await escribirPdf(destino, {
          cliente: datos.cliente,
          caso: datos.id,
          pais: datos.pais,
          filas: datos.campos.map((campo) => {
            const clase = clasificarCampo(campo.etiqueta, mapeo)
            return { etiqueta: campo.etiqueta, valor: clase.valor || SIN_DATO }
          }),
        })
      } else {
        const markdown = construirPortal({
          caso: datos.id,
          cliente: datos.cliente,
          pais: datos.pais,
          campos: datos.campos,
          mapeo,
        })
        await escribirTexto(destino, markdown)
      }
      const data: Record<string, unknown> = {
        caso: datos.id,
        ruta: rutaRelativa(ctx.directory, destino),
        formato: datos.formato,
      }
      if (datos.formato === "portal") data.mensaje = "formato no soportado"
      if (datos.advertencias.length > 0) data.advertencias = datos.advertencias
      return await aceptar(ctx, herramienta, datos.id, data)
    } catch {
      return await rechazar(ctx, herramienta, casoDe(args), "No se pudo generar el formulario.")
    }
  },
}

export const armar_paquete = {
  description: "Arma la carpeta del paquete para firma con formulario, soportes, checklist y borrador.",
  args: argsArmar,
  async execute(args: unknown, ctx: ContextoHerramienta): Promise<string> {
    const herramienta = "proveedor_armar_paquete"
    try {
      const parsed = z.object(argsArmar).safeParse(args)
      if (!parsed.success) return await rechazar(ctx, herramienta, null, mensajeZod(parsed.error))
      const caso = parsed.data.caso.trim().toLowerCase()
      const mapeado = await mapearCaso(ctx.directory, caso, [])
      if (!mapeado.ok) return await rechazar(ctx, herramienta, idCasoValido(caso) ? caso : null, mapeado.error)
      const indice = await cargarIndiceSoportes(ctx.directory)
      if (!indice.ok) return await rechazar(ctx, herramienta, mapeado.data.caso.id, indice.error)

      const datos = mapeado.data.caso
      const fecha = fechaHoy()
      const soportes = await evaluarSoportes(ctx.directory, datos.soportes, indice.data, fecha)
      const nombre = nombreArchivoFormulario(datos.formato)
      const origen = path.join(ctx.directory, "out", datos.id, nombre)
      const formularioPresente = await existe(origen)
      const paquete = path.join(ctx.directory, "out", datos.id, "paquete")
      await fs.rm(paquete, { recursive: true, force: true })
      await fs.mkdir(path.join(paquete, "soportes"), { recursive: true })
      if (formularioPresente) await fs.copyFile(origen, path.join(paquete, nombre))

      const copiados = []
      for (const soporte of soportes) {
        if ((soporte.estado === "presente" || soporte.estado === "vencido") && soporte.archivo) {
          try {
            await fs.copyFile(
              path.join(raizFixtures(ctx.directory), "repositorio", "soportes", soporte.archivo),
              path.join(paquete, "soportes", soporte.archivo),
            )
            copiados.push(soporte)
          } catch {
            copiados.push({ ...soporte, estado: "ausente" as const, archivo: null })
          }
        } else {
          copiados.push(soporte)
        }
      }

      const motivos = motivosBloqueo(copiados, formularioPresente)
      const listo = motivos.length === 0
      const firma = firmaDesdeMaestro(mapeado.data.maestro)
      await escribirTexto(
        path.join(paquete, "checklist.md"),
        construirChecklist({
          caso: datos.id,
          cliente: datos.cliente,
          pais: datos.pais,
          formato: datos.formato,
          fecha,
          listo,
          motivos,
          mapeo: mapeado.data.mapeo,
          soportes: copiados,
        }),
      )
      await escribirTexto(
        path.join(paquete, "borrador-correo.md"),
        construirCorreo({
          de: datos.de,
          asunto: datos.asunto,
          cliente: datos.cliente,
          empresa: firma.empresa,
          firma,
          soportes: copiados,
          faltantes: mapeado.data.mapeo.faltantes.map((campo) => campo.etiqueta),
          confirmaciones: mapeado.data.mapeo.requiere_confirmacion.map((campo) => ({
            etiqueta: campo.etiqueta,
            nota: campo.nota,
          })),
          listo,
          motivos,
        }),
      )

      const data = {
        caso: datos.id,
        ruta: rutaRelativa(ctx.directory, paquete),
        listo_para_firma: listo,
        motivos,
        faltantes: mapeado.data.mapeo.faltantes.map((campo) => campo.etiqueta),
        checklist: copiados.map((soporte) => ({
          tipo: soporte.tipo,
          estado: soporte.estado,
          vigencia_hasta: soporte.vigencia_hasta,
          archivo: soporte.archivo,
        })),
      }
      return await aceptar(ctx, herramienta, datos.id, data)
    } catch {
      return await rechazar(ctx, herramienta, casoDe(args), "No se pudo armar el paquete.")
    }
  },
}

export const simular_envio = {
  description: "Escribe la constancia de envío simulado solo si el usuario confirmó de forma explícita.",
  args: argsSimular,
  async execute(args: unknown, ctx: ContextoHerramienta): Promise<string> {
    const herramienta = "proveedor_simular_envio"
    try {
      const parsed = z.object(argsSimular).safeParse(args)
      if (!parsed.success) return await rechazar(ctx, herramienta, null, mensajeZod(parsed.error))
      const caso = parsed.data.caso.trim().toLowerCase()
      if (parsed.data.confirmado !== true || ctx.confirmacionExplicita !== true) {
        return await rechazar(ctx, herramienta, idCasoValido(caso) ? caso : null, "requiere confirmación explícita")
      }
      const cargado = await cargarCaso(ctx.directory, caso)
      if (!cargado.ok) return await rechazar(ctx, herramienta, idCasoValido(caso) ? caso : null, cargado.error)
      const indice = await cargarIndiceSoportes(ctx.directory)
      if (!indice.ok) return await rechazar(ctx, herramienta, cargado.data.id, indice.error)
      const soportes = await evaluarSoportes(ctx.directory, cargado.data.soportes, indice.data)
      const nombre = nombreArchivoFormulario(cargado.data.formato)
      const formulario = path.join(ctx.directory, "out", cargado.data.id, nombre)
      const motivos = motivosBloqueo(soportes, await existe(formulario))
      const paquete = path.join(ctx.directory, "out", cargado.data.id, "paquete")
      const destino = path.join(ctx.directory, "out", cargado.data.id, "ENVIO-SIMULADO.md")
      await fs.mkdir(path.dirname(destino), { recursive: true })
      await escribirTexto(
        destino,
        construirEnvio({
          caso: cargado.data.id,
          fecha: fechaHoy(),
          rutaPaquete: rutaRelativa(ctx.directory, paquete),
          listo: motivos.length === 0,
          motivos,
        }),
      )
      return await aceptar(ctx, herramienta, cargado.data.id, {
        caso: cargado.data.id,
        ruta: rutaRelativa(ctx.directory, destino),
        listo_para_firma: motivos.length === 0,
        motivos,
      })
    } catch {
      return await rechazar(ctx, herramienta, casoDe(args), "No se pudo simular el envío.")
    }
  },
}

async function aceptar(
  ctx: ContextoHerramienta,
  herramienta: string,
  caso: string,
  data: Record<string, unknown>,
): Promise<string> {
  const resumen = resumirResultado(herramienta, data)
  await bitacora(ctx.directory, caso, herramienta, true, resumen)
  return ok(data)
}

async function rechazar(
  ctx: ContextoHerramienta,
  herramienta: string,
  caso: string | null,
  error: string,
): Promise<string> {
  await bitacora(ctx.directory, caso, herramienta, false, error)
  return fail(error)
}

async function existe(archivo: string): Promise<boolean> {
  try {
    await fs.access(archivo)
    return true
  } catch {
    return false
  }
}

async function escribirTexto(archivo: string, contenido: string): Promise<void> {
  const temporal = `${archivo}.parcial`
  await fs.mkdir(path.dirname(archivo), { recursive: true })
  await fs.writeFile(temporal, contenido, "utf8")
  await fs.rm(archivo, { force: true })
  await fs.rename(temporal, archivo)
}
