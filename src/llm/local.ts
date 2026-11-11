import { esConfirmacionExplicita } from "../domain/confirmacion.ts"
import { esRegistro } from "../domain/texto.ts"
import type { ResultadoModelo } from "../llm/adapter.ts"
import type { MensajeAgente } from "../types.ts"
import { extraerCaso, textoPedirCaso } from "../agent/casos.ts"
import { mensajesDelTurno, ultimoCaso, ultimoResultado, type Sobre } from "../agent/historial.ts"

export function planificar(mensajes: MensajeAgente[]): ResultadoModelo {
  const turno = mensajesDelTurno(mensajes)
  const usuario = [...turno].reverse().find((mensaje) => mensaje.role === "user")
  const texto = usuario && usuario.role === "user" ? usuario.content : ""
  const previos = mensajes.slice(0, Math.max(0, mensajes.length - turno.length))

  if (esConfirmacionExplicita(texto)) {
    const simulado = ultimoResultado(turno, "proveedor_simular_envio")
    if (simulado?.ok) return textoModelo(textoEnvio(simulado.data), false)
    if (simulado && !simulado.ok) return textoModelo(simulado.error ?? "No pude simular el envío.", false)
    if (ultimoResultado(previos, "proveedor_armar_paquete")?.ok !== true) {
      return textoModelo(
        "Aún no hay un paquete armado en esta sesión. Indícame el caso que debo procesar, por ejemplo ec-corp-andina.",
        false,
      )
    }
    const caso = ultimoCaso(previos)
    if (!caso) return textoModelo("No identifiqué el caso del paquete. Indica la carpeta, por ejemplo ec-corp-andina.", false)
    return herramienta(mensajes, "proveedor_simular_envio", { caso, confirmado: true })
  }

  const caso = extraerCaso(texto) ?? ultimoCaso(previos)
  if (!caso) return textoModelo(textoPedirCaso(), false)

  const leido = ultimoResultado(turno, "proveedor_leer_solicitud")
  if (!leido) return herramienta(mensajes, "proveedor_leer_solicitud", { caso })
  if (!leido.ok) return textoModelo(leido.error ?? "No pude leer la solicitud.", false)

  const mapeado = ultimoResultado(turno, "proveedor_mapear_campos")
  if (!mapeado) {
    const campos = Array.isArray(leido.data?.campos) ? leido.data.campos : []
    return herramienta(mensajes, "proveedor_mapear_campos", { caso, campos })
  }
  if (!mapeado.ok) return textoModelo(mapeado.error ?? "No pude mapear los campos.", false)

  const generado = ultimoResultado(turno, "proveedor_generar_formulario")
  if (!generado) {
    return herramienta(mensajes, "proveedor_generar_formulario", {
      caso,
      mapeo: {
        llenos: Array.isArray(mapeado.data?.llenos) ? mapeado.data.llenos : [],
        faltantes: Array.isArray(mapeado.data?.faltantes) ? mapeado.data.faltantes : [],
        requiere_confirmacion: Array.isArray(mapeado.data?.requiere_confirmacion)
          ? mapeado.data.requiere_confirmacion
          : [],
      },
    })
  }
  if (!generado.ok) return textoModelo(generado.error ?? "No pude generar el formulario.", false)

  const armado = ultimoResultado(turno, "proveedor_armar_paquete")
  if (!armado) return herramienta(mensajes, "proveedor_armar_paquete", { caso })
  if (!armado.ok) return textoModelo(armado.error ?? "No pude armar el paquete.", false)

  return textoModelo(redactarResumen(leido, mapeado, generado, armado), true)
}

function redactarResumen(leido: Sobre, mapeado: Sobre, generado: Sobre, armado: Sobre): string {
  const cliente = texto(leido.data?.cliente, "el cliente")
  const pais = texto(leido.data?.pais, "")
  const caso = texto(leido.data?.caso, "")
  const formato = texto(generado.data?.formato, texto(leido.data?.formato, ""))
  const portal = formato === "portal" || generado.data?.mensaje === "formato no soportado"
  const llenos = camposDe(mapeado.data?.llenos)
  const faltantes = camposDe(mapeado.data?.faltantes)
  const confirmaciones = camposDe(mapeado.data?.requiere_confirmacion)
  const soportes = soportesDe(armado.data)
  const listo = armado.data?.listo_para_firma === true
  const lineas = [
    `Caso ${caso} — ${cliente} (${pais}).`,
    `Formato de salida: ${formato}.`,
  ]
  if (portal) lineas.push("formato no soportado. No entré al portal. Dejé los valores en un archivo para copiar.")
  lineas.push("", "Campos llenos:")
  if (llenos.length === 0) lineas.push("- Ninguno.")
  for (const campo of llenos) lineas.push(`- ${campo.etiqueta}: ${campo.valor}`)
  lineas.push("", "Campos faltantes:")
  if (faltantes.length === 0) lineas.push("- Ninguno.")
  for (const campo of faltantes) lineas.push(`- ${campo.etiqueta}: ${campo.nota || "sin dato en el maestro"}`)
  lineas.push("", "Requieren confirmación:")
  if (confirmaciones.length === 0) lineas.push("- Ninguno.")
  for (const campo of confirmaciones) lineas.push(`- ${campo.etiqueta}: ${campo.valor}. ${campo.nota}`)
  lineas.push("", "Soportes:")
  if (soportes.length === 0) lineas.push("- Ninguno.")
  for (const soporte of soportes) {
    const vigencia = soporte.vigencia_hasta ? `, vigencia hasta ${soporte.vigencia_hasta}` : ""
    lineas.push(`- ${soporte.tipo}: ${soporte.estado}${vigencia}`)
  }
  lineas.push("", `listo_para_firma: ${listo ? "sí" : "no"}`)
  const pendientes = soportes.filter((soporte) => soporte.estado !== "presente")
  if (pendientes.length > 0) {
    lineas.push("Soportes por actualizar:")
    for (const soporte of pendientes) lineas.push(`- ${soporte.tipo} (${soporte.estado})`)
  }
  if (typeof generado.data?.ruta === "string") lineas.push(`Formulario: ${generado.data.ruta}`)
  if (typeof armado.data?.ruta === "string") lineas.push(`Paquete: ${armado.data.ruta}`)
  lineas.push(
    "",
    "¿Confirmas que simule el envío del paquete? No se envía nada al cliente y nadie firma. Solo escribiré la constancia si tu siguiente mensaje lo pide, por ejemplo: envía.",
  )
  return lineas.join("\n")
}

function textoEnvio(data: Record<string, unknown> | undefined): string {
  const ruta = typeof data?.ruta === "string" ? data.ruta : "out"
  const listo = data?.listo_para_firma === true
  const motivos = Array.isArray(data?.motivos) ? data.motivos.filter((motivo) => typeof motivo === "string") : []
  const lineas = [
    `Dejé la constancia de envío simulado en ${ruta}.`,
    "No se contactó al cliente y nadie firmó el formulario.",
    `listo_para_firma: ${listo ? "sí" : "no"}`,
  ]
  if (!listo && motivos.length > 0) {
    lineas.push("El paquete sigue bloqueado:")
    for (const motivo of motivos) lineas.push(`- ${motivo}`)
  }
  return lineas.join("\n")
}

function camposDe(valor: unknown): { etiqueta: string; valor: string; nota: string }[] {
  if (!Array.isArray(valor)) return []
  const salida: { etiqueta: string; valor: string; nota: string }[] = []
  for (const item of valor) {
    if (!esRegistro(item) || typeof item.etiqueta !== "string") continue
    salida.push({
      etiqueta: item.etiqueta,
      valor: typeof item.valor === "string" ? item.valor : "",
      nota: typeof item.nota === "string" ? item.nota : typeof item.motivo === "string" ? item.motivo : "",
    })
  }
  return salida
}

function soportesDe(data: Record<string, unknown> | undefined): { tipo: string; estado: string; vigencia_hasta: string | null }[] {
  if (!data || !Array.isArray(data.checklist)) return []
  const salida: { tipo: string; estado: string; vigencia_hasta: string | null }[] = []
  for (const item of data.checklist) {
    if (!esRegistro(item) || typeof item.tipo !== "string" || typeof item.estado !== "string") continue
    salida.push({
      tipo: item.tipo,
      estado: item.estado,
      vigencia_hasta: typeof item.vigencia_hasta === "string" ? item.vigencia_hasta : null,
    })
  }
  return salida
}

function texto(valor: unknown, respaldo: string): string {
  return typeof valor === "string" && valor ? valor : respaldo
}

function textoModelo(content: string, needsConfirmation: boolean): ResultadoModelo {
  return { content, toolCalls: [], needsConfirmation }
}

function herramienta(mensajes: MensajeAgente[], name: string, argumentos: Record<string, unknown>): ResultadoModelo {
  return {
    content: null,
    toolCalls: [{ id: `call_${name}_${mensajes.length}`, name, arguments: argumentos }],
  }
}
