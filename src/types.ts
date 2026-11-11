export type RolMensaje = "system" | "user" | "assistant" | "tool"

export interface LlamadaHerramienta {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type MensajeAgente =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LlamadaHerramienta[] }
  | { role: "tool"; toolCallId: string; name: string; content: string }

export interface TrazaHerramienta {
  id: string
  name: string
  arguments: Record<string, unknown>
  ok: boolean
  resumen: string
  result: string
}

export interface TurnoChat {
  role: "user" | "assistant"
  content: string
  toolCalls?: TrazaHerramienta[]
  needsConfirmation?: boolean
}

export interface RespuestaChat {
  sessionId: string
  reply: string
  toolCalls: TrazaHerramienta[]
  needsConfirmation: boolean
}
