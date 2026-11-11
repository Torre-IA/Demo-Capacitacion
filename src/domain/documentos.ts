import {
  DATO_BANCARIO,
  SIN_DATO,
  clasificarCampo,
  esRutaBancaria,
  nombreSoporte,
  type CampoPlantilla,
  type MapeoInterno,
  type SoporteEvaluado,
} from "./registro.ts"

export function construirChecklist(entrada: {
  caso: string
  cliente: string
  pais: string
  formato: string
  fecha: string
  listo: boolean
  motivos: string[]
  mapeo: MapeoInterno
  soportes: SoporteEvaluado[]
}): string {
  const lineas = [
    "# Checklist del paquete",
    "",
    `Caso: ${entrada.caso}`,
    `Cliente: ${entrada.cliente}`,
    `País del cliente: ${entrada.pais}`,
    `Formato: ${entrada.formato}`,
    `Fecha de corte: ${entrada.fecha}`,
    `listo_para_firma: ${entrada.listo ? "sí" : "no"}`,
    "",
    "La firma y el envío no ocurren en este paquete. Los decide una persona.",
    "",
    "## Motivos de bloqueo",
    "",
  ]
  if (entrada.motivos.length === 0) lineas.push("- Ninguno.")
  for (const motivo of entrada.motivos) lineas.push(`- ${motivo}`)

  lineas.push("", "## Campos", "")
  const grupos = [...entrada.mapeo.llenos, ...entrada.mapeo.requiere_confirmacion, ...entrada.mapeo.faltantes]
  if (grupos.length === 0) lineas.push("- La plantilla no tenía campos legibles.")
  for (const campo of entrada.mapeo.llenos) {
    lineas.push(`- lleno · ${campo.etiqueta} · ${valorChecklist(campo.ruta, campo.valor)} · ruta \`${campo.ruta}\``)
  }
  for (const campo of entrada.mapeo.requiere_confirmacion) {
    lineas.push(
      `- requiere_confirmacion · ${campo.etiqueta} · ${valorChecklist(campo.ruta, campo.valor)} · ${campo.nota} · ruta \`${campo.ruta}\``,
    )
  }
  for (const campo of entrada.mapeo.faltantes) {
    lineas.push(`- faltante · ${campo.etiqueta} · ${campo.motivo}`)
  }

  lineas.push("", "## Soportes", "")
  if (entrada.soportes.length === 0) lineas.push("- El cliente no exigió soportes.")
  for (const soporte of entrada.soportes) {
    const vigencia = soporte.vigencia_hasta ? `vigencia hasta ${soporte.vigencia_hasta}` : "sin vencimiento"
    const archivo = soporte.archivo ?? "no está en el repositorio"
    lineas.push(`- ${soporte.tipo} · ${soporte.estado} · ${vigencia} · ${archivo}`)
  }
  lineas.push("")
  return lineas.join("\n")
}

export function construirCorreo(entrada: {
  de: string
  asunto: string
  cliente: string
  empresa: string
  firma: { nombre: string; cargo: string; email: string }
  soportes: SoporteEvaluado[]
  faltantes: string[]
  confirmaciones: { etiqueta: string; nota: string }[]
  listo: boolean
  motivos: string[]
}): string {
  const presentes = entrada.soportes.filter((soporte) => soporte.estado === "presente")
  const problematicos = entrada.soportes.filter((soporte) => soporte.estado !== "presente")
  const lineas = [
    `Para: ${entrada.de}`,
    `Asunto: Re: ${entrada.asunto}`,
    "",
    `Estimados ${entrada.cliente}:`,
    "",
    `Preparamos el registro como proveedor de ${entrada.empresa}. Este mensaje es un borrador para revisión interna. No se ha firmado ni se ha enviado.`,
    "",
    "Soportes vigentes que acompañan el formulario:",
  ]
  if (presentes.length === 0) lineas.push("- Ninguno.")
  for (const soporte of presentes) lineas.push(`- ${nombreSoporte(soporte.tipo)}`)

  lineas.push("", "Soportes que deben actualizarse antes del envío:")
  if (problematicos.length === 0) lineas.push("- Ninguno.")
  for (const soporte of problematicos) {
    if (soporte.estado === "vencido") {
      lineas.push(`- ${nombreSoporte(soporte.tipo)} — vencido, vigencia hasta ${soporte.vigencia_hasta ?? "sin fecha"}`)
    } else {
      lineas.push(`- ${nombreSoporte(soporte.tipo)} — no está en el repositorio`)
    }
  }

  lineas.push("", "Campos sin dato en el repositorio maestro:")
  if (entrada.faltantes.length === 0) lineas.push("- Ninguno.")
  for (const etiqueta of entrada.faltantes) lineas.push(`- ${etiqueta}`)

  lineas.push("", "Campos que requieren confirmación de la analista:")
  if (entrada.confirmaciones.length === 0) lineas.push("- Ninguno.")
  for (const campo of entrada.confirmaciones) lineas.push(`- ${campo.etiqueta} — ${campo.nota}`)

  lineas.push(
    "",
    entrada.listo
      ? "Estado del paquete: listo para firma."
      : "Estado del paquete: no está listo para firma.",
  )
  if (entrada.motivos.length > 0) {
    lineas.push("Motivos:")
    for (const motivo of entrada.motivos) lineas.push(`- ${motivo}`)
  }
  lineas.push(
    "",
    "Quedamos atentos a la firma del representante legal.",
    "",
    "Cordial saludo,",
    entrada.firma.nombre,
    entrada.firma.cargo,
    entrada.empresa,
  )
  if (entrada.firma.email) lineas.push(entrada.firma.email)
  lineas.push("")
  return lineas.join("\n")
}

export function construirPortal(entrada: {
  caso: string
  cliente: string
  pais: string
  campos: CampoPlantilla[]
  mapeo: MapeoInterno
}): string {
  const lineas = [
    "# Valores para copiar en el portal",
    "",
    "formato no soportado",
    "",
    "Este archivo no carga datos a ningún portal. Una persona inicia sesión, pega los valores y decide si envía. La contraseña no se guarda aquí.",
    "",
    `Caso: ${entrada.caso}`,
    `Cliente: ${entrada.cliente}`,
    `País del cliente: ${entrada.pais}`,
    "",
    "| Etiqueta | Estado | Valor | Nota |",
    "| --- | --- | --- | --- |",
  ]
  for (const campo of entrada.campos) {
    const clase = clasificarCampo(campo.etiqueta, entrada.mapeo)
    const valor = clase.valor || SIN_DATO
    lineas.push(`| ${celda(campo.etiqueta)} | ${clase.estado} | ${celda(valor)} | ${celda(clase.nota)} |`)
  }
  lineas.push("")
  return lineas.join("\n")
}

export function construirEnvio(entrada: {
  caso: string
  fecha: string
  rutaPaquete: string
  listo: boolean
  motivos: string[]
}): string {
  const lineas = [
    "# Envío simulado",
    "",
    "Este archivo no representa un envío real al cliente.",
    "No se contactó al cliente y nadie firmó el formulario.",
    "",
    `Caso: ${entrada.caso}`,
    `Fecha: ${entrada.fecha}`,
    "Confirmación humana: sí",
    `Paquete: ${entrada.rutaPaquete}`,
    `listo_para_firma: ${entrada.listo ? "sí" : "no"}`,
    "",
  ]
  if (entrada.motivos.length === 0) {
    lineas.push("Sin motivos de bloqueo.")
  } else {
    lineas.push("Motivos:")
    for (const motivo of entrada.motivos) lineas.push(`- ${motivo}`)
  }
  lineas.push("")
  return lineas.join("\n")
}

function valorChecklist(ruta: string, valor: string): string {
  return esRutaBancaria(ruta) ? DATO_BANCARIO : valor
}

function celda(valor: string): string {
  return valor.replaceAll("|", "/").replaceAll("\n", " ")
}
