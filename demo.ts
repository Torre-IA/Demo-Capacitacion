import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ExcelJS from "exceljs"
import { responderTurno } from "./src/agent/loop.ts"
import { fechaHoy, esRegistro } from "./src/domain/texto.ts"
import {
  DATO_BANCARIO,
  cargarGlosario,
  cargarMaestro,
  mapearCampos,
  mapearEtiqueta,
  motivosBloqueo,
  serializarMapeo,
  type CampoPlantilla,
  type SoporteEvaluado,
} from "./src/domain/registro.ts"
import { crearAdaptadorLocal } from "./src/llm/factory.ts"
import {
  armar_paquete,
  generar_formulario,
  leer_solicitud,
  mapear_campos,
  simular_envio,
  type ContextoHerramienta,
} from "./src/tools/proveedor.ts"

const directory = path.dirname(fileURLToPath(import.meta.url))
const hoy = fechaHoy()
let fallos = 0

const ctxBase: ContextoHerramienta = { directory, sessionId: "demo", confirmacionExplicita: false }

await fs.rm(path.join(directory, "out"), { recursive: true, force: true })
await verificarModulo()
await verificarReglas()

for (const caso of ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]) {
  if (caso === "ec-corp-andina") await casoInexistente()
  await procesar(caso)
}

await verificarEnvio()
await verificarArchivos()
await verificarCiclo()
await verificarBitacora()

if (fallos > 0) {
  console.error(`Demo con ${fallos} fallos.`)
  process.exit(1)
}
console.log("Demo correcta.")

async function procesar(caso: string): Promise<void> {
  const leido = sobre(await leer_solicitud.execute({ caso }, ctxBase))
  afirmar(leido.ok, `${caso}: leer solicitud`)
  if (!leido.ok || !leido.data) return
  const mapeoA = await mapear_campos.execute({ caso, campos: leido.data.campos }, ctxBase)
  const mapeoB = await mapear_campos.execute({ caso, campos: leido.data.campos }, ctxBase)
  afirmar(mapeoA === mapeoB, `${caso}: el mapeo es determinista`)
  const mapeado = sobre(mapeoA)
  afirmar(mapeado.ok, `${caso}: mapear`)
  if (!mapeado.ok || !mapeado.data) return
  const generado = sobre(await generar_formulario.execute({
    caso,
    mapeo: {
      llenos: mapeado.data.llenos,
      faltantes: mapeado.data.faltantes,
      requiere_confirmacion: mapeado.data.requiere_confirmacion,
    },
  }, ctxBase))
  afirmar(generado.ok, `${caso}: generar`)
  const armado = sobre(await armar_paquete.execute({ caso }, ctxBase))
  afirmar(armado.ok, `${caso}: armar`)
  if (!generado.ok || !generado.data || !armado.ok || !armado.data) return

  const llenos = contar(mapeado.data.llenos)
  const faltantes = contar(mapeado.data.faltantes)
  const confirmar = contar(mapeado.data.requiere_confirmacion)
  const checklist = registros(armado.data.checklist)
  const bloqueado = checklist.some((item) => item.estado === "vencido" || item.estado === "ausente")
  afirmar(armado.data.listo_para_firma === !bloqueado, `${caso}: listo_para_firma sigue la regla de soportes`)
  console.log(
    `${caso} | ${String(leido.data.formato)} | llenos ${llenos} | faltantes ${faltantes} | confirmar ${confirmar} | listo_para_firma ${String(armado.data.listo_para_firma)} | ${String(armado.data.ruta)}`,
  )

  if (caso === "co-industrias-delta") {
    afirmar(llenos === 17 && faltantes === 0 && confirmar === 0, "Colombia: 17 campos del maestro")
    afirmar(!JSON.stringify(mapeado.data).includes("03100012345"), "el mapeo no expone la cuenta")
    afirmar(JSON.stringify(mapeado.data).includes(DATO_BANCARIO), "el mapeo avisa que el dato bancario está en el formulario")
  }
  if (caso === "ec-corp-andina") {
    afirmar(llenos === 13 && faltantes === 1 && confirmar === 1, "Ecuador: faltante y RUC por confirmar")
    afirmar(textos(mapeado.data.faltantes, "etiqueta").includes("Número de contribuyente especial"), "falta el contribuyente especial")
    afirmar(registros(mapeado.data.requiere_confirmacion).some((item) => item.nota === "identificador extranjero"), "RUC es identificador extranjero")
  }
  if (caso === "hn-agroexport-sula") {
    afirmar(llenos === 9 && faltantes === 1 && confirmar === 1, "Honduras: falta referencias y RTN se confirma")
    afirmar(textos(mapeado.data.faltantes, "etiqueta").includes("Referencias comerciales"), "faltan referencias comerciales")
  }
  if (caso === "pa-logistica-istmo") {
    afirmar(llenos === 8 && faltantes === 0 && confirmar === 1, "Panamá: RUC por confirmar y el resto lleno")
    afirmar(generado.data.mensaje === "formato no soportado", "el portal responde formato no soportado")
    afirmar(!(await existe("out/pa-logistica-istmo/formulario.xlsx")), "el portal no genera Excel")
  }
  if (hoy > "2026-09-30") {
    afirmar(armado.data.listo_para_firma === false, `${caso}: la cámara vencida bloquea la firma`)
    afirmar(checklist.some((item) => item.tipo === "camara_comercio" && item.estado === "vencido"), `${caso}: cámara vencida`)
  }
}

async function casoInexistente(): Promise<void> {
  const malo = sobre(await leer_solicitud.execute({ caso: "no-existe" }, ctxBase))
  afirmar(!malo.ok, "un caso inexistente no se presenta como éxito")
  afirmar(typeof malo.error === "string" && malo.error.includes("No existe el caso"), "el error dice que el caso no existe")
  afirmar(typeof malo.error === "string" && !malo.error.includes("node_modules") && !malo.error.includes("\\"), "el error no trae traza ni ruta absoluta")
}

async function verificarEnvio(): Promise<void> {
  const caso = "co-industrias-delta"
  const ruta = "out/co-industrias-delta/ENVIO-SIMULADO.md"
  const sinConfirmar = sobre(await simular_envio.execute({ caso, confirmado: false }, ctxBase))
  afirmar(sinConfirmar.ok === false && sinConfirmar.error === "requiere confirmación explícita", "sin confirmación no hay envío")
  const sinBandera = sobre(await simular_envio.execute({ caso, confirmado: true }, { ...ctxBase, confirmacionExplicita: false }))
  afirmar(sinBandera.ok === false && sinBandera.error === "requiere confirmación explícita", "el modelo no puede confirmar solo")
  afirmar(!(await existe(ruta)), "no se escribió la constancia")
  const enviado = sobre(await simular_envio.execute({ caso, confirmado: true }, { ...ctxBase, confirmacionExplicita: true }))
  afirmar(enviado.ok === true, "la confirmación explícita escribe la constancia")
  const texto = await fs.readFile(path.join(directory, ruta), "utf8")
  afirmar(texto.includes("Este archivo no representa un envío real al cliente."), "la constancia deja claro que no hubo envío")
  afirmar(!texto.includes("03100012345"), "la constancia no lleva la cuenta")
}

async function verificarArchivos(): Promise<void> {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.readFile(path.join(directory, "out", "co-industrias-delta", "formulario.xlsx"))
  const datos = libro.getWorksheet("Datos Proveedor")
  const banco = libro.getWorksheet("Datos Bancarios")
  afirmar(textoCelda(datos, "B3") === "Razón social", "Excel escribe la etiqueta")
  afirmar(textoCelda(datos, "C3") === "Periferia IT Group S.A.S.", "Excel escribe la razón social")
  afirmar(textoCelda(datos, "C4") === "900123456", "Excel escribe el NIT")
  afirmar(textoCelda(datos, "C10") === "lgomez@periferia-ficticia.com", "Excel escribe el correo del glosario")
  afirmar(textoCelda(banco, "C5") === "03100012345", "Excel escribe la cuenta solo en el formulario")

  const hn = new ExcelJS.Workbook()
  await hn.xlsx.readFile(path.join(directory, "out", "hn-agroexport-sula", "formulario.xlsx"))
  const registro = hn.getWorksheet("Registro")
  afirmar(textoCelda(registro, "B3") === "900123456", "el RTN se llena con el NIT")
  afirmar(textoCelda(registro, "B12") === "", "referencias comerciales queda vacía")
  afirmar(textoCelda(registro, "A12") === "Referencias comerciales", "la etiqueta faltante sí se escribe")

  const pdf = textoPdf(await fs.readFile(path.join(directory, "out", "ec-corp-andina", "formulario.pdf")))
  afirmar(pdf.includes("Periferia IT Group") && pdf.includes("900123456"), "el PDF lleva la empresa y el NIT")
  afirmar(pdf.includes("Sin dato en el maestro") && pdf.includes("03100012345"), "el PDF marca el faltante y escribe el banco")

  const portal = await fs.readFile(path.join(directory, "out", "pa-logistica-istmo", "valores-portal.md"), "utf8")
  afirmar(portal.includes("formato no soportado"), "el markdown del portal lo dice")
  afirmar(portal.includes("900123456") && portal.includes("03100012345"), "el portal deja los valores listos para copiar")

  for (const caso of ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]) {
    const borrador = await fs.readFile(path.join(directory, "out", caso, "paquete", "borrador-correo.md"), "utf8")
    const checklist = await fs.readFile(path.join(directory, "out", caso, "paquete", "checklist.md"), "utf8")
    afirmar(!borrador.includes("03100012345") && !borrador.includes("COLOCOBM") && !borrador.includes("Bancolombia"), `${caso}: el correo no lleva datos bancarios`)
    afirmar(!checklist.includes("03100012345"), `${caso}: el checklist no lleva la cuenta`)
    afirmar(checklist.includes("listo_para_firma:"), `${caso}: el checklist publica el estado`)
  }
  const ecuador = await fs.readFile(path.join(directory, "out", "ec-corp-andina", "paquete", "checklist.md"), "utf8")
  afirmar(ecuador.includes("Número de contribuyente especial"), "el faltante aparece en el checklist")
  afirmar(ecuador.includes("certificado_cumplimiento_tributario") && ecuador.includes("ausente"), "el soporte ausente aparece en el checklist")
  afirmar(await existe("out/co-industrias-delta/paquete/soportes/rut-2026.txt"), "copia el RUT")
  afirmar(await existe("out/co-industrias-delta/paquete/soportes/camara-comercio-2026-08.txt"), "copia la cámara aunque esté vencida")
  afirmar(!(await existe("out/co-industrias-delta/paquete/soportes/iso-9001-2025.txt")), "no copia un soporte que el cliente no pidió")
  afirmar(!(await existe("out/ec-corp-andina/ENVIO-SIMULADO.md")), "procesar no envía")
}

async function verificarCiclo(): Promise<void> {
  const adaptador = crearAdaptadorLocal()
  const suelto = await responderTurno({
    directory,
    adaptador,
    sessionId: crypto.randomUUID(),
    message: "envía",
  })
  afirmar(suelto.toolCalls.length === 0, "un envío sin paquete no llama herramientas")
  afirmar(!suelto.reply.includes("Dejé la constancia"), "un envío sin paquete no finge la constancia")

  const sesion = crypto.randomUUID()
  const primero = await responderTurno({
    directory,
    adaptador,
    sessionId: sesion,
    message: "Procesa el caso \"ec-corp-andina\". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.",
  })
  afirmar(primero.toolCalls.map((llamada) => llamada.name).join(",") === [
    "proveedor_leer_solicitud",
    "proveedor_mapear_campos",
    "proveedor_generar_formulario",
    "proveedor_armar_paquete",
  ].join(","), "el ciclo llama las cuatro herramientas en orden")
  afirmar(primero.needsConfirmation, "el ciclo pide confirmación")
  afirmar(primero.reply.includes("listo_para_firma"), "el ciclo informa si está listo para firma")
  afirmar(primero.reply.includes("Número de contribuyente especial"), "el ciclo lista el faltante")
  afirmar(primero.reply.includes("certificado_cumplimiento_tributario"), "el ciclo lista el soporte ausente")
  afirmar(!primero.reply.includes("formato no soportado"), "Ecuador no es un portal")
  afirmar(!(await existe("out/ec-corp-andina/ENVIO-SIMULADO.md")), "el primer turno no envía")

  const segundo = await responderTurno({ directory, adaptador, sessionId: sesion, message: "envía" })
  afirmar(segundo.toolCalls.some((llamada) => llamada.name === "proveedor_simular_envio" && llamada.ok), "envía escribe la constancia")
  afirmar(await existe("out/ec-corp-andina/ENVIO-SIMULADO.md"), "existe ENVIO-SIMULADO.md")
  afirmar(!segundo.needsConfirmation, "después de simular no vuelve a pedir confirmación")

  const panama = await responderTurno({
    directory,
    adaptador,
    sessionId: crypto.randomUUID(),
    message: "Procesa el caso pa-logistica-istmo y no envíes.",
  })
  afirmar(panama.reply.includes("formato no soportado"), "el chat dice formato no soportado")
  afirmar(!panama.toolCalls.some((llamada) => llamada.name === "proveedor_simular_envio"), "no envíes no dispara el envío")
}

async function verificarReglas(): Promise<void> {
  const maestro = await cargarMaestro(directory)
  const glosario = await cargarGlosario(directory)
  afirmar(maestro.ok && glosario.ok, "maestro y glosario legibles")
  if (!maestro.ok || !glosario.ok) return
  const ruc = mapearEtiqueta("RUC", "EC", maestro.data, glosario.data)
  afirmar(ruc.estado === "requiere_confirmacion" && ruc.nota === "identificador extranjero" && ruc.valor === "900123456" && ruc.equivalente === "RUC", "RN1 Ecuador")
  const nit = mapearEtiqueta("NIT", "CO", maestro.data, glosario.data)
  afirmar(nit.estado === "lleno" && nit.valor === "900123456", "el NIT colombiano se llena directo")
  const ambiguo = mapearEtiqueta("Identificación tributaria", "CO", maestro.data, glosario.data)
  afirmar(ambiguo.estado === "requiere_confirmacion" && ambiguo.valor === "900123456" && ambiguo.nota.includes("NIT"), "la etiqueta ambigua propone el NIT")
  const faltante = mapearEtiqueta("Número de contribuyente especial", "EC", maestro.data, glosario.data)
  afirmar(faltante.estado === "faltante", "lo que no está en el glosario no se inventa")
  const parcial = mapearEtiqueta("Correo electrónico principal", "CO", maestro.data, glosario.data)
  afirmar(parcial.estado === "requiere_confirmacion" && parcial.confianza < 0.8 && parcial.valor.includes("@"), "la confianza baja pide confirmación")
  const cuenta = campo("Número de cuenta")
  const mapeo = mapearCampos([cuenta], [], "CO", maestro.data, glosario.data)
  const publico = serializarMapeo(mapeo)
  afirmar(mapeo.llenos[0]?.valor === "03100012345", "el formulario conserva la cuenta")
  afirmar(publico.llenos[0]?.valor === DATO_BANCARIO, "la respuesta de la herramienta oculta la cuenta")
  const presente = soporte("rut", "presente")
  afirmar(motivosBloqueo([presente], true).length === 0, "un soporte vigente no bloquea")
  afirmar(motivosBloqueo([soporte("camara_comercio", "vencido")], true)[0] === "soporte vencido: camara_comercio", "un soporte vencido bloquea")
  afirmar(motivosBloqueo([soporte("rut", "ausente")], true).some((motivo) => motivo.includes("ausente")), "un soporte ausente bloquea")
  afirmar(motivosBloqueo([presente], false).includes("formulario no generado"), "sin formulario no está listo")
}

async function verificarModulo(): Promise<void> {
  const prompt = (await fs.readFile(path.join(directory, "agent", "prompt.md"), "utf8")).trim()
  const conocimiento = (await fs.readFile(path.join(directory, "src", "knowledge", "registro-proveedor.md"), "utf8")).trim()
  const agente = cuerpo(await fs.readFile(path.join(directory, "modulo", "agent.md"), "utf8"))
  const skill = cuerpo(await fs.readFile(path.join(directory, "modulo", "skill", "registro-proveedor", "SKILL.md"), "utf8"))
  afirmar(agente === prompt, "modulo/agent.md es el mismo prompt")
  afirmar(skill === conocimiento, "la skill es el mismo conocimiento")
  const modulo = await import("./modulo/tools/proveedor.ts")
  afirmar(modulo.leer_solicitud.execute === leer_solicitud.execute, "las herramientas del módulo son las de la aplicación")
}

async function verificarBitacora(): Promise<void> {
  const log = await fs.readFile(path.join(directory, "out", "log.jsonl"), "utf8")
  afirmar(!log.includes("03100012345") && !log.includes("COLOCOBM"), "la bitácora no guarda la cuenta ni el SWIFT")
  for (const linea of log.split(/\n/).filter(Boolean)) {
    const item = JSON.parse(linea) as unknown
    afirmar(esRegistro(item) && typeof item.ts === "string" && typeof item.herramienta === "string" && typeof item.ok === "boolean" && typeof item.resumen === "string", "cada línea de log tiene el contrato")
  }
}

function sobre(body: string): { ok: boolean; error?: string; data?: Record<string, unknown> } {
  const valor = JSON.parse(body) as unknown
  if (!esRegistro(valor) || typeof valor.ok !== "boolean") return { ok: false, error: "respuesta ilegible" }
  return {
    ok: valor.ok,
    error: typeof valor.error === "string" ? valor.error : undefined,
    data: esRegistro(valor.data) ? valor.data : undefined,
  }
}

function afirmar(condicion: boolean, mensaje: string): void {
  if (!condicion) {
    fallos += 1
    console.error(`FALLO: ${mensaje}`)
  }
}

function contar(valor: unknown): number {
  return Array.isArray(valor) ? valor.length : 0
}

function registros(valor: unknown): Record<string, unknown>[] {
  if (!Array.isArray(valor)) return []
  return valor.filter(esRegistro)
}

function textos(valor: unknown, clave: string): string[] {
  return registros(valor).map((item) => item[clave]).filter((item) => typeof item === "string")
}

function textoCelda(hoja: ExcelJS.Worksheet | undefined, direccion: string): string {
  const valor = hoja?.getCell(direccion).value
  if (valor == null) return ""
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") return String(valor)
  if (typeof valor === "object" && "text" in valor && typeof valor.text === "string") return valor.text
  return ""
}

function textoPdf(buffer: Buffer): string {
  const crudo = buffer.toString("latin1")
  const partes: string[] = []
  for (const coincidencia of crudo.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
    const hex = (coincidencia[1] ?? "").replace(/\s+/g, "")
    if (hex.length < 2 || hex.length % 2 !== 0) continue
    partes.push(Buffer.from(hex, "hex").toString("latin1"))
  }
  return partes.join("")
}

function cuerpo(markdown: string): string {
  const texto = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim()
  if (!texto.startsWith("---\n")) return texto
  const fin = texto.indexOf("\n---\n", 4)
  return fin < 0 ? texto : texto.slice(fin + "\n---\n".length).trim()
}

function campo(etiqueta: string): CampoPlantilla {
  return { etiqueta, obligatorio: true, hoja: null, celda_etiqueta: null, celda_valor: null }
}

function soporte(tipo: string, estado: SoporteEvaluado["estado"]): SoporteEvaluado {
  return { tipo, estado, vigencia_hasta: null, archivo: null, descripcion: null }
}

async function existe(relativo: string): Promise<boolean> {
  try {
    await fs.access(path.join(directory, relativo))
    return true
  } catch {
    return false
  }
}
