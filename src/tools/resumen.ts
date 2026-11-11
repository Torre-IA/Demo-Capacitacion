import { esRegistro } from "../domain/texto.ts"

export function resumirResultado(nombre: string, data: Record<string, unknown> | undefined): string {
  if (!data) return "sin datos"
  if (nombre === "proveedor_leer_solicitud") {
    const campos = Array.isArray(data.campos) ? data.campos.length : 0
    return `${texto(data.cliente)} · ${texto(data.pais)} · ${texto(data.formato)} · ${campos} campos`
  }
  if (nombre === "proveedor_mapear_campos") {
    return `${contar(data.llenos)} llenos, ${contar(data.faltantes)} faltantes, ${contar(data.requiere_confirmacion)} por confirmar`
  }
  if (nombre === "proveedor_generar_formulario") {
    const aviso = typeof data.mensaje === "string" ? ` · ${data.mensaje}` : ""
    return `${texto(data.formato)} · ${texto(data.ruta)}${aviso}`
  }
  if (nombre === "proveedor_armar_paquete") {
    return `${texto(data.ruta)} · listo_para_firma ${data.listo_para_firma === true ? "sí" : "no"}`
  }
  if (nombre === "proveedor_simular_envio") return texto(data.ruta)
  return "listo"
}

function contar(valor: unknown): number {
  return Array.isArray(valor) ? valor.length : 0
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : ""
}

export function casoDe(argumentos: unknown): string | null {
  if (!esRegistro(argumentos) || typeof argumentos.caso !== "string") return null
  return argumentos.caso.trim().toLowerCase()
}
