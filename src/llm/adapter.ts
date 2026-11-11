import type { MensajeAgente } from "../types.ts"

export interface EsquemaHerramienta {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ResultadoModelo {
  content: string | null
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[]
  needsConfirmation?: boolean
}

export interface AdaptadorLlm {
  readonly id: string
  readonly model: string
  enviar(
    mensajes: MensajeAgente[],
    herramientas: EsquemaHerramienta[],
    opciones: { timeoutMs: number; maxSalida: number },
  ): Promise<ResultadoModelo>
}
