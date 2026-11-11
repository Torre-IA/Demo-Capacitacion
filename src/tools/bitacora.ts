import fs from "node:fs/promises"
import path from "node:path"
import { idCasoValido } from "../domain/texto.ts"

export async function bitacora(
  directorio: string,
  caso: string | null,
  herramienta: string,
  ok: boolean,
  resumen: string,
): Promise<void> {
  const limpio = resumen.replace(/\s+/g, " ").slice(0, 240)
  const linea = `${JSON.stringify({ ts: new Date().toISOString(), herramienta, ok, resumen: limpio })}\n`
  try {
    const salida = path.join(directorio, "out")
    await fs.mkdir(salida, { recursive: true })
    await fs.appendFile(path.join(salida, "log.jsonl"), linea, "utf8")
    if (caso && idCasoValido(caso)) {
      const carpeta = path.join(salida, caso)
      await fs.mkdir(carpeta, { recursive: true })
      await fs.appendFile(path.join(carpeta, "log.jsonl"), linea, "utf8")
    }
  } catch {
    // La bitácora no puede tumbar la herramienta.
  }
}
