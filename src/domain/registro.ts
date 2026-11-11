import fs from "node:fs/promises"
import path from "node:path"
import { esRegistro, fechaHoy, idCasoValido, normalizar } from "./texto.ts"

export const DATO_BANCARIO = "(dato bancario escrito solo en el formulario)"
export const SIN_DATO = "Sin dato en el maestro"

const ETIQUETAS_AMBIGUAS = new Set([
  "identificacion tributaria",
  "numero de identificacion fiscal",
  "identificacion fiscal",
  "id tributario",
])

const ID_POR_PAIS: Record<string, string> = {
  CO: "NIT",
  EC: "RUC",
  PE: "RUC",
  PA: "RUC",
  HN: "RTN",
}

const NOMBRES_SOPORTE: Record<string, string> = {
  camara_comercio: "Cámara de Comercio (existencia y representación legal)",
  rut: "RUT",
  certificacion_bancaria: "Certificación bancaria",
  parafiscales: "Parafiscales y seguridad social",
  estados_financieros: "Estados financieros",
  certificado_iso_9001: "Certificado ISO 9001",
  certificado_cumplimiento_tributario: "Certificado de cumplimiento tributario",
}

export interface CampoPlantilla {
  etiqueta: string
  obligatorio: boolean | null
  hoja: string | null
  celda_etiqueta: string | null
  celda_valor: string | null
}

export interface CasoCargado {
  id: string
  de: string
  asunto: string
  fecha: string
  pais: string
  cliente: string
  formato: "xlsx" | "pdf" | "portal"
  cuerpo: string
  campos: CampoPlantilla[]
  soportes: string[]
  advertencias: string[]
}

export interface EntradaGlosario {
  etiqueta: string
  norm: string
  clave: string
}

export interface IndiceGlosario {
  porNorma: Map<string, EntradaGlosario>
  entradas: EntradaGlosario[]
}

export interface SoporteIndice {
  tipo: string
  archivo: string
  vigencia_hasta: string | null
  pais_emisor: string
  descripcion: string
}

export type EstadoSoporte = "presente" | "vencido" | "ausente"

export interface SoporteEvaluado {
  tipo: string
  estado: EstadoSoporte
  vigencia_hasta: string | null
  archivo: string | null
  descripcion: string | null
}

export interface CampoLleno {
  etiqueta: string
  clave: string
  ruta: string
  valor: string
  confianza: number
}

export interface CampoFaltante {
  etiqueta: string
  motivo: string
}

export interface CampoConfirmacion {
  etiqueta: string
  clave: string
  ruta: string
  valor: string
  confianza: number
  nota: string
  equivalente: string | null
}

export interface MapeoInterno {
  llenos: CampoLleno[]
  faltantes: CampoFaltante[]
  requiere_confirmacion: CampoConfirmacion[]
}

export type ResultadoCampo =
  | { estado: "lleno"; etiqueta: string; clave: string; ruta: string; valor: string; confianza: number }
  | { estado: "faltante"; etiqueta: string; motivo: string }
  | {
      estado: "requiere_confirmacion"
      etiqueta: string
      clave: string
      ruta: string
      valor: string
      confianza: number
      nota: string
      equivalente: string | null
    }

export interface MapeoPublico {
  llenos: CampoLleno[]
  faltantes: CampoFaltante[]
  requiere_confirmacion: CampoConfirmacion[]
}

export interface ClasificacionCampo {
  estado: "lleno" | "faltante" | "requiere_confirmacion"
  valor: string
  nota: string
  ruta: string | null
  confianza: number | null
}

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export function raizFixtures(raiz: string): string {
  return path.join(raiz, "fixtures", "reto-01")
}

export function equivalenteTributario(pais: string): string {
  return ID_POR_PAIS[pais.toUpperCase()] ?? "NIT"
}

export function esEtiquetaAmbigua(etiqueta: string): boolean {
  return ETIQUETAS_AMBIGUAS.has(normalizar(etiqueta))
}

export function esRutaBancaria(ruta: string | null): boolean {
  return ruta === "banco" || (ruta?.startsWith("banco.") ?? false)
}

export function nombreSoporte(tipo: string): string {
  return NOMBRES_SOPORTE[tipo] ?? tipo.replaceAll("_", " ")
}

export function nombreArchivoFormulario(formato: "xlsx" | "pdf" | "portal"): string {
  if (formato === "xlsx") return "formulario.xlsx"
  if (formato === "pdf") return "formulario.pdf"
  return "valores-portal.md"
}

export function leerRuta(origen: unknown, ruta: string): unknown {
  let actual: unknown = origen
  for (const parte of ruta.split(".")) {
    if (!esRegistro(actual) || !Object.prototype.hasOwnProperty.call(actual, parte)) return undefined
    actual = actual[parte]
  }
  return actual
}

export function aTexto(valor: unknown): string | null {
  if (typeof valor === "string") return valor
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor)
  if (typeof valor === "boolean") return valor ? "sí" : "no"
  return null
}

export async function listarIdsCasos(raiz: string): Promise<string[]> {
  try {
    const entradas = await fs.readdir(path.join(raizFixtures(raiz), "casos"), { withFileTypes: true })
    return entradas.filter((entrada) => entrada.isDirectory()).map((entrada) => entrada.name).sort()
  } catch {
    return []
  }
}

export async function listarCasos(raiz: string): Promise<{ id: string; cliente: string; pais: string; formato: string }[]> {
  const ids = await listarIdsCasos(raiz)
  const salida: { id: string; cliente: string; pais: string; formato: string }[] = []
  for (const id of ids) {
    const cargado = await cargarCaso(raiz, id)
    if (cargado.ok) {
      salida.push({ id, cliente: cargado.data.cliente, pais: cargado.data.pais, formato: cargado.data.formato })
    } else {
      salida.push({ id, cliente: "No se pudo leer", pais: "", formato: "" })
    }
  }
  return salida
}

export function crearIndiceGlosario(datos: unknown): Resultado<IndiceGlosario> {
  if (!esRegistro(datos)) return { ok: false, error: "El glosario de campos está corrupto." }
  const entradas: EntradaGlosario[] = []
  const porNorma = new Map<string, EntradaGlosario>()
  for (const [etiqueta, clave] of Object.entries(datos)) {
    if (typeof clave !== "string" || !clave.trim() || !etiqueta.trim()) {
      return { ok: false, error: "El glosario de campos está corrupto." }
    }
    const entrada = { etiqueta, norm: normalizar(etiqueta), clave: clave.trim() }
    if (!porNorma.has(entrada.norm)) porNorma.set(entrada.norm, entrada)
    entradas.push(entrada)
  }
  if (entradas.length === 0) return { ok: false, error: "El glosario de campos está vacío." }
  return { ok: true, data: { porNorma, entradas } }
}

export async function cargarGlosario(raiz: string): Promise<Resultado<IndiceGlosario>> {
  const leido = await leerJson(path.join(raizFixtures(raiz), "glosario-campos.json"))
  if (!leido.ok) return leido
  return crearIndiceGlosario(leido.data)
}

export async function cargarMaestro(raiz: string): Promise<Resultado<unknown>> {
  const leido = await leerJson(path.join(raizFixtures(raiz), "repositorio", "maestro.json"))
  if (!leido.ok) return leido
  if (!esRegistro(leido.data) || typeof leido.data.razon_social !== "string" || typeof leido.data.nit !== "string") {
    return { ok: false, error: "El repositorio maestro no tiene los datos mínimos (razón social y NIT)." }
  }
  return { ok: true, data: leido.data }
}

export async function cargarIndiceSoportes(raiz: string): Promise<Resultado<SoporteIndice[]>> {
  const leido = await leerJson(path.join(raizFixtures(raiz), "repositorio", "soportes", "index.json"))
  if (!leido.ok) return leido
  if (!Array.isArray(leido.data)) return { ok: false, error: "El índice de soportes está corrupto." }
  const soportes: SoporteIndice[] = []
  for (const entrada of leido.data) {
    if (!esRegistro(entrada)) return { ok: false, error: "El índice de soportes tiene una entrada inválida." }
    const tipo = typeof entrada.tipo === "string" ? entrada.tipo.trim() : ""
    const archivo = typeof entrada.archivo === "string" ? entrada.archivo.trim() : ""
    const descripcion = typeof entrada.descripcion === "string" ? entrada.descripcion : ""
    const pais = typeof entrada.pais_emisor === "string" ? entrada.pais_emisor : ""
    const vigencia = vigenciaDe(entrada.vigencia_hasta)
    if (
      vigencia === undefined ||
      !/^[a-z0-9_]+$/.test(tipo) ||
      !/^[\w.-]+$/.test(archivo) ||
      archivo !== path.basename(archivo)
    ) {
      return { ok: false, error: "El índice de soportes tiene una entrada inválida." }
    }
    soportes.push({
      tipo,
      archivo,
      vigencia_hasta: vigencia,
      pais_emisor: pais,
      descripcion,
    })
  }
  return { ok: true, data: soportes }
}

export async function cargarCaso(raiz: string, caso: string): Promise<Resultado<CasoCargado>> {
  const id = caso.trim().toLowerCase()
  if (!idCasoValido(id)) {
    return { ok: false, error: "El identificador del caso no es válido. Usa el nombre de la carpeta, por ejemplo ec-corp-andina." }
  }
  const disponibles = await listarIdsCasos(raiz)
  if (!disponibles.includes(id)) {
    const lista = disponibles.length > 0 ? disponibles.join(", ") : "ninguno"
    return { ok: false, error: `No existe el caso "${id}". Casos disponibles: ${lista}.` }
  }

  const carpeta = path.join(raizFixtures(raiz), "casos", id)
  const solicitud = await leerJson(path.join(carpeta, "solicitud.json"))
  if (!solicitud.ok) return { ok: false, error: "La solicitud está corrupta o no se pudo leer." }
  if (!esRegistro(solicitud.data)) return { ok: false, error: "La solicitud está corrupta." }

  const de = texto(solicitud.data.de)
  const asunto = texto(solicitud.data.asunto)
  const fecha = texto(solicitud.data.fecha)
  const pais = texto(solicitud.data.pais)?.toUpperCase() ?? ""
  const cliente = texto(solicitud.data.cliente)
  const formato = texto(solicitud.data.formato)?.toLowerCase() ?? ""
  const cuerpo = typeof solicitud.data.cuerpo === "string" ? solicitud.data.cuerpo : ""
  if (!de || !asunto || !fecha || !cliente || !/^[A-Z]{2,3}$/.test(pais)) {
    return { ok: false, error: "La solicitud está corrupta: faltan remitente, asunto, fecha, país o cliente." }
  }
  if (formato !== "xlsx" && formato !== "pdf" && formato !== "portal") {
    return { ok: false, error: "formato no soportado" }
  }

  const plantilla = await leerPlantilla(carpeta, formato)
  if (!plantilla.ok) return plantilla
  const exigidos = await leerSoportes(path.join(carpeta, "soportes-exigidos.json"))
  if (!exigidos.ok) return exigidos

  const advertencias = [...plantilla.advertencias]
  const idArchivo = texto(solicitud.data.id)
  if (idArchivo && idArchivo !== id) {
    advertencias.push(`El id del archivo (${idArchivo}) no coincide con la carpeta ${id}. Se usa la carpeta.`)
  }

  return {
    ok: true,
    data: {
      id,
      de,
      asunto,
      fecha,
      pais,
      cliente,
      formato,
      cuerpo,
      campos: plantilla.campos,
      soportes: exigidos.data,
      advertencias,
    },
  }
}

export function mapearEtiqueta(etiqueta: string, pais: string, maestro: unknown, indice: IndiceGlosario): ResultadoCampo {
  const norm = normalizar(etiqueta)
  const paisNormal = pais.toUpperCase()
  const exacto = indice.porNorma.get(norm)
  let clave: string | null = null
  let confianza = 0
  if (exacto) {
    clave = exacto.clave
    confianza = 1
  } else {
    const parcial = mejorParcial(norm, indice)
    if (parcial) {
      clave = parcial.clave
      confianza = parcial.confianza
    }
  }

  if (!clave) {
    return {
      estado: "faltante",
      etiqueta,
      motivo: "No existe una clave en el glosario ni en el maestro para esta etiqueta.",
    }
  }

  const crudo = leerRuta(maestro, clave)
  if (crudo === undefined) {
    return { estado: "faltante", etiqueta, motivo: `La clave ${clave} no existe en el maestro.` }
  }
  const valor = aTexto(crudo)
  if (valor === null) {
    return { estado: "faltante", etiqueta, motivo: `La clave ${clave} no tiene un valor simple en el maestro.` }
  }

  const ambiguo = esEtiquetaAmbigua(etiqueta)
  const extranjero = clave === "nit" && paisNormal !== "CO"
  const otraEtiqueta = clave === "nit" && etiquetaImplicaOtroPais(etiqueta, paisNormal)
  const baja = confianza < 0.8
  if (extranjero || ambiguo || otraEtiqueta || baja) {
    const equivalentePais = equivalenteTributario(paisNormal)
    let nota = "La confianza del mapeo es menor a 0.8."
    if (extranjero) nota = "identificador extranjero"
    else if (ambiguo) nota = `etiqueta ambigua; equivalente del país: ${equivalentePais}`
    else if (otraEtiqueta) nota = `la etiqueta no corresponde al identificador de ${paisNormal}; equivalente: ${equivalentePais}`
    return {
      estado: "requiere_confirmacion",
      etiqueta,
      clave,
      ruta: clave,
      valor,
      confianza,
      nota,
      equivalente: clave === "nit" ? equivalentePais : null,
    }
  }

  return { estado: "lleno", etiqueta, clave, ruta: clave, valor, confianza }
}

export function mapearCampos(
  campos: CampoPlantilla[],
  extras: string[],
  pais: string,
  maestro: unknown,
  indice: IndiceGlosario,
): MapeoInterno {
  const vistos = new Set(campos.map((campo) => normalizar(campo.etiqueta)))
  const filas = [...campos]
  for (const extra of extras) {
    const limpio = extra.trim()
    const norm = normalizar(limpio)
    if (!norm || vistos.has(norm)) continue
    vistos.add(norm)
    filas.push({ etiqueta: limpio, obligatorio: null, hoja: null, celda_etiqueta: null, celda_valor: null })
  }

  const llenos: CampoLleno[] = []
  const faltantes: CampoFaltante[] = []
  const requiere_confirmacion: CampoConfirmacion[] = []
  for (const fila of filas) {
    const resultado = mapearEtiqueta(fila.etiqueta, pais, maestro, indice)
    if (resultado.estado === "lleno") {
      llenos.push({
        etiqueta: resultado.etiqueta,
        clave: resultado.clave,
        ruta: resultado.ruta,
        valor: resultado.valor,
        confianza: resultado.confianza,
      })
    } else if (resultado.estado === "faltante") {
      faltantes.push({ etiqueta: resultado.etiqueta, motivo: resultado.motivo })
    } else {
      requiere_confirmacion.push({
        etiqueta: resultado.etiqueta,
        clave: resultado.clave,
        ruta: resultado.ruta,
        valor: resultado.valor,
        confianza: resultado.confianza,
        nota: resultado.nota,
        equivalente: resultado.equivalente,
      })
    }
  }
  return { llenos, faltantes, requiere_confirmacion }
}

export function serializarMapeo(mapeo: MapeoInterno): MapeoPublico {
  return {
    llenos: mapeo.llenos.map((campo) => ({ ...campo, valor: valorVisible(campo.ruta, campo.valor) })),
    faltantes: mapeo.faltantes.map((campo) => ({ etiqueta: campo.etiqueta, motivo: campo.motivo })),
    requiere_confirmacion: mapeo.requiere_confirmacion.map((campo) => ({
      ...campo,
      valor: valorVisible(campo.ruta, campo.valor),
    })),
  }
}

export function clasificarCampo(etiqueta: string, mapeo: MapeoInterno): ClasificacionCampo {
  const norm = normalizar(etiqueta)
  const lleno = mapeo.llenos.find((campo) => normalizar(campo.etiqueta) === norm)
  if (lleno) {
    return { estado: "lleno", valor: lleno.valor, nota: "", ruta: lleno.ruta, confianza: lleno.confianza }
  }
  const confirmacion = mapeo.requiere_confirmacion.find((campo) => normalizar(campo.etiqueta) === norm)
  if (confirmacion) {
    return {
      estado: "requiere_confirmacion",
      valor: confirmacion.valor,
      nota: confirmacion.nota,
      ruta: confirmacion.ruta,
      confianza: confirmacion.confianza,
    }
  }
  const faltante = mapeo.faltantes.find((campo) => normalizar(campo.etiqueta) === norm)
  return {
    estado: "faltante",
    valor: "",
    nota: faltante?.motivo ?? SIN_DATO,
    ruta: null,
    confianza: null,
  }
}

export function etiquetasExtra(campos: unknown): string[] {
  if (!Array.isArray(campos)) return []
  const salida: string[] = []
  for (const campo of campos) {
    if (typeof campo === "string" && campo.trim()) salida.push(campo.trim())
    else if (esRegistro(campo) && typeof campo.etiqueta === "string" && campo.etiqueta.trim()) salida.push(campo.etiqueta.trim())
  }
  return salida
}

export async function mapearCaso(
  raiz: string,
  caso: string,
  camposArgumento: unknown,
): Promise<Resultado<{ caso: CasoCargado; mapeo: MapeoInterno; maestro: unknown }>> {
  const cargado = await cargarCaso(raiz, caso)
  if (!cargado.ok) return cargado
  const maestro = await cargarMaestro(raiz)
  if (!maestro.ok) return maestro
  const glosario = await cargarGlosario(raiz)
  if (!glosario.ok) return glosario
  const mapeo = mapearCampos(
    cargado.data.campos,
    etiquetasExtra(camposArgumento),
    cargado.data.pais,
    maestro.data,
    glosario.data,
  )
  return { ok: true, data: { caso: cargado.data, mapeo, maestro: maestro.data } }
}

export async function evaluarSoportes(
  raiz: string,
  exigidos: string[],
  indice: SoporteIndice[],
  hoy = fechaHoy(),
): Promise<SoporteEvaluado[]> {
  const dir = path.join(raizFixtures(raiz), "repositorio", "soportes")
  const porTipo = new Map(indice.map((item) => [item.tipo, item]))
  const salida: SoporteEvaluado[] = []
  for (const tipo of exigidos) {
    const item = porTipo.get(tipo)
    if (!item) {
      salida.push({ tipo, estado: "ausente", vigencia_hasta: null, archivo: null, descripcion: null })
      continue
    }
    let existe = false
    try {
      await fs.access(path.join(dir, item.archivo))
      existe = true
    } catch {
      existe = false
    }
    if (!existe) {
      salida.push({
        tipo,
        estado: "ausente",
        vigencia_hasta: item.vigencia_hasta,
        archivo: null,
        descripcion: item.descripcion,
      })
      continue
    }
    const vencido = item.vigencia_hasta !== null && item.vigencia_hasta < hoy
    salida.push({
      tipo,
      estado: vencido ? "vencido" : "presente",
      vigencia_hasta: item.vigencia_hasta,
      archivo: item.archivo,
      descripcion: item.descripcion,
    })
  }
  return salida
}

// RN3: un campo faltante no bloquea la firma. Solo un soporte vencido, uno ausente o la falta del formulario.
export function motivosBloqueo(soportes: SoporteEvaluado[], formularioPresente: boolean): string[] {
  const motivos: string[] = []
  if (!formularioPresente) motivos.push("formulario no generado")
  for (const soporte of soportes) {
    if (soporte.estado === "vencido") motivos.push(`soporte vencido: ${soporte.tipo}`)
    if (soporte.estado === "ausente") motivos.push(`soporte ausente: ${soporte.tipo}`)
  }
  return motivos
}

export function firmaDesdeMaestro(maestro: unknown): { nombre: string; cargo: string; email: string; empresa: string } {
  return {
    nombre: aTexto(leerRuta(maestro, "contacto_financiero.nombre")) ?? "Analista administrativa",
    cargo: aTexto(leerRuta(maestro, "contacto_financiero.cargo")) ?? "Analista administrativa",
    email: aTexto(leerRuta(maestro, "contacto_financiero.email")) ?? "",
    empresa: aTexto(leerRuta(maestro, "razon_social")) ?? "Periferia IT Group",
  }
}

function valorVisible(ruta: string, valor: string): string {
  return esRutaBancaria(ruta) ? DATO_BANCARIO : valor
}

function mejorParcial(norm: string, indice: IndiceGlosario): { clave: string; confianza: number } | null {
  let mejor: { clave: string; confianza: number } | null = null
  for (const entrada of indice.entradas) {
    if (entrada.norm.length < 5 || norm.length < 5) continue
    if (!norm.includes(entrada.norm) && !entrada.norm.includes(norm)) continue
    const confianza = redondear(Math.min(norm.length, entrada.norm.length) / Math.max(norm.length, entrada.norm.length))
    if (!mejor || confianza > mejor.confianza) mejor = { clave: entrada.clave, confianza }
  }
  if (!mejor || mejor.confianza < 0.6) return null
  return mejor
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100
}

function etiquetaImplicaOtroPais(etiqueta: string, pais: string): boolean {
  const norm = normalizar(etiqueta)
  if (norm === "nit") return pais !== "CO"
  if (norm === "ruc") return pais !== "EC" && pais !== "PE" && pais !== "PA"
  if (norm === "rtn") return pais !== "HN"
  return false
}

function vigenciaDe(valor: unknown): string | null | undefined {
  if (valor === null) return null
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor
  return undefined
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null
}

async function leerJson(archivo: string): Promise<Resultado<unknown>> {
  try {
    const contenido = await fs.readFile(archivo, "utf8")
    return { ok: true, data: JSON.parse(contenido.replace(/^\uFEFF/, "")) as unknown }
  } catch (error) {
    const codigo = esRegistro(error) && typeof error.code === "string" ? error.code : ""
    const nombre = path.basename(archivo)
    if (codigo === "ENOENT") return { ok: false, error: `No se encontró ${nombre}.` }
    return { ok: false, error: `No se pudo leer ${nombre}: el archivo está corrupto o no es JSON válido.` }
  }
}

async function leerSoportes(archivo: string): Promise<Resultado<string[]>> {
  const leido = await leerJson(archivo)
  if (!leido.ok) return { ok: false, error: "La lista de soportes exigidos está corrupta o no se pudo leer." }
  if (!Array.isArray(leido.data)) return { ok: false, error: "La lista de soportes exigidos está corrupta." }
  const soportes: string[] = []
  for (const item of leido.data) {
    if (typeof item !== "string" || !/^[a-z0-9_]+$/.test(item)) {
      return { ok: false, error: "La lista de soportes exigidos está corrupta." }
    }
    soportes.push(item)
  }
  return { ok: true, data: soportes }
}

async function leerPlantilla(
  carpeta: string,
  formato: "xlsx" | "pdf" | "portal",
): Promise<{ ok: true; campos: CampoPlantilla[]; advertencias: string[] } | { ok: false; error: string }> {
  const archivo = path.join(carpeta, formato === "xlsx" ? "plantilla-celdas.json" : "plantilla-campos.json")
  const leido = await leerJson(archivo)
  if (!leido.ok) {
    return { ok: false, error: "La plantilla está corrupta o no se pudo leer. No se llenaron campos." }
  }
  if (!Array.isArray(leido.data)) {
    return { ok: false, error: "La plantilla está corrupta: se esperaba una lista de campos." }
  }

  const campos: CampoPlantilla[] = []
  const advertencias: string[] = []
  leido.data.forEach((fila, indice) => {
    const campo = formato === "xlsx" ? leerFilaExcel(fila) : leerFilaCampo(fila)
    if (!campo) advertencias.push(`La plantilla tiene una fila inválida en la posición ${indice + 1}. Esa fila se omitió.`)
    else campos.push(campo)
  })
  if (campos.length === 0) {
    return { ok: false, error: "La plantilla está corrupta: no hay campos legibles." }
  }
  return { ok: true, campos, advertencias }
}

function leerFilaExcel(fila: unknown): CampoPlantilla | null {
  if (!esRegistro(fila)) return null
  const hoja = texto(fila.hoja)
  const etiqueta = texto(fila.etiqueta)
  const celdaEtiqueta = texto(fila.celda_etiqueta)?.toUpperCase() ?? null
  const celdaValor = texto(fila.celda_valor)?.toUpperCase() ?? null
  if (!hoja || !etiqueta || !celdaEtiqueta || !celdaValor || hoja.length > 31) return null
  if (!celdaValida(celdaEtiqueta) || !celdaValida(celdaValor)) return null
  return { etiqueta, obligatorio: null, hoja, celda_etiqueta: celdaEtiqueta, celda_valor: celdaValor }
}

function leerFilaCampo(fila: unknown): CampoPlantilla | null {
  if (!esRegistro(fila)) return null
  const etiqueta = texto(fila.etiqueta)
  if (!etiqueta) return null
  const obligatorio = typeof fila.obligatorio === "boolean" ? fila.obligatorio : null
  return { etiqueta, obligatorio, hoja: null, celda_etiqueta: null, celda_valor: null }
}

function celdaValida(celda: string): boolean {
  return /^[A-Z]{1,3}[1-9][0-9]{0,4}$/.test(celda)
}
