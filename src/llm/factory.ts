import { cargarConfig, type Configuracion } from "../config.ts"
import type { AdaptadorLlm } from "./adapter.ts"
import { crearAdaptadorOpenAI } from "./openai.ts"
import { planificar } from "./local.ts"

export function crearAdaptador(config: Configuracion): AdaptadorLlm {
  if (config.proveedor === "openai") return crearAdaptadorOpenAI(config.modelo)
  return crearAdaptadorLocal()
}

export function crearAdaptadorLocal(): AdaptadorLlm {
  return {
    id: "local",
    model: "planificador-local",
    async enviar(mensajes) {
      return planificar(mensajes)
    },
  }
}

export function adaptadorPorDefecto(directorio: string): AdaptadorLlm {
  return crearAdaptador(cargarConfig(directorio))
}
