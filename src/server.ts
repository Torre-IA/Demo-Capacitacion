import fs from "node:fs/promises"
import { createReadStream } from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { responderTurno } from "./agent/loop.ts"
import { cargarConfig } from "./config.ts"
import { listarCasos } from "./domain/registro.ts"
import { esRegistro } from "./domain/texto.ts"
import { crearAdaptador } from "./llm/factory.ts"
import { obtenerSesion, UUID } from "./session.ts"

const directorio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const config = cargarConfig(directorio)
const adaptador = crearAdaptador(config)
const ocupadas = new Set<string>()

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    if (url.pathname === "/api/health" && req.method === "GET") {
      return enviarJson(res, 200, { ok: true, provider: adaptador.id, model: adaptador.model })
    }
    if (url.pathname === "/api/casos" && req.method === "GET") {
      return enviarJson(res, 200, { ok: true, casos: await listarCasos(directorio) })
    }
    if (url.pathname.startsWith("/api/sessions/") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length))
      if (!UUID.test(id)) return enviarJson(res, 400, { ok: false, error: "La sesión no es válida." })
      const sesion = await obtenerSesion(directorio, id)
      if (!sesion) return enviarJson(res, 404, { ok: false, error: "No existe esa sesión." })
      return enviarJson(res, 200, { id: sesion.id, createdAt: sesion.createdAt, turns: sesion.turns })
    }
    if (url.pathname === "/api/chat" && req.method === "POST") return chat(req, res)
    if (url.pathname.startsWith("/api/")) {
      return enviarJson(res, 404, { ok: false, error: "Ruta no encontrada." })
    }
    if (url.pathname.startsWith("/descargas/")) return descarga(res, url.pathname)
    if (req.method !== "GET" && req.method !== "HEAD") {
      return enviarJson(res, 405, { ok: false, error: "Método no permitido." })
    }
    return estatico(res, url.pathname)
  } catch (error) {
    console.error("solicitud", error instanceof Error ? error.stack : error)
    if (!res.headersSent) enviarJson(res, 500, { ok: false, error: "No pude completar la consulta. La sesión sigue activa." })
  }
})

servidor.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") console.error(`El puerto ${config.port} ya está en uso.`)
  else console.error("No se pudo iniciar el servidor.")
  process.exit(1)
})

servidor.listen(config.port, config.host, () => {
  console.log(`Registro de proveedor en http://localhost:${config.port} (proveedor ${adaptador.id}, modelo ${adaptador.model})`)
})

async function chat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let cuerpo: unknown
  try {
    cuerpo = await leerCuerpo(req)
  } catch {
    return enviarJson(res, 400, { ok: false, error: "No pude leer el mensaje." })
  }
  if (!esRegistro(cuerpo) || typeof cuerpo.message !== "string" || !cuerpo.message.trim()) {
    return enviarJson(res, 400, { ok: false, error: "El mensaje está vacío." })
  }
  if (cuerpo.message.length > 8000) return enviarJson(res, 400, { ok: false, error: "El mensaje es demasiado largo." })
  const sessionId = cuerpo.sessionId
  if (sessionId !== undefined && (typeof sessionId !== "string" || !UUID.test(sessionId))) {
    return enviarJson(res, 400, { ok: false, error: "La sesión no es válida." })
  }
  const clave = typeof sessionId === "string" ? sessionId : ""
  if (clave && ocupadas.has(clave)) {
    return enviarJson(res, 409, { ok: false, error: "Estoy terminando la respuesta anterior de esta sesión." })
  }
  if (clave) ocupadas.add(clave)
  try {
    const respuesta = await responderTurno({
      directory: directorio,
      message: cuerpo.message,
      sessionId: clave || undefined,
      adaptador,
    })
    enviarJson(res, 200, respuesta)
  } catch (error) {
    console.error("chat", error instanceof Error ? error.stack : error)
    enviarJson(res, 500, { ok: false, error: "No pude completar la consulta. La sesión sigue activa." })
  } finally {
    if (clave) ocupadas.delete(clave)
  }
}

async function descarga(res: http.ServerResponse, pathname: string): Promise<void> {
  let relativo = ""
  try {
    relativo = decodeURIComponent(pathname.slice("/descargas/".length))
  } catch {
    return texto(res, 400, "La ruta no es válida.")
  }
  if (!relativo || relativo.includes("..")) return texto(res, 403, "No puedo abrir esa ruta.")
  const raiz = path.resolve(directorio, "out")
  const destino = path.resolve(raiz, relativo)
  const comparacion = path.relative(raiz, destino)
  if (comparacion.startsWith("..") || path.isAbsolute(comparacion)) return texto(res, 403, "No puedo abrir esa ruta.")
  let stat
  try {
    stat = await fs.stat(destino)
  } catch {
    return texto(res, 404, "No encontré ese archivo.")
  }
  if (stat.isDirectory()) {
    const nombres = (await fs.readdir(destino)).filter((nombre) => nombre !== ".parcial" && !nombre.endsWith(".parcial"))
    const enlaces = nombres
      .map((nombre) => {
        const href = `/descargas/${[relativo, nombre].filter(Boolean).join("/")}`.replaceAll("\\", "/")
        return `<li><a href="${escapar(href)}">${escapar(nombre)}</a></li>`
      })
      .join("")
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
    res.end(`<!doctype html><meta charset="utf-8"><title>${escapar(relativo)}</title><ul>${enlaces}</ul>`)
    return
  }
  const tipo = TIPOS[path.extname(destino).toLowerCase()] ?? "application/octet-stream"
  res.writeHead(200, { "Content-Type": tipo, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
  createReadStream(destino).pipe(res)
}

async function estatico(res: http.ServerResponse, pathname: string): Promise<void> {
  const pedido = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
  if (pedido.includes("..")) return texto(res, 403, "No puedo abrir esa ruta.")
  const raiz = path.resolve(directorio, "web")
  const destino = path.resolve(raiz, pedido)
  const comparacion = path.relative(raiz, destino)
  if (comparacion.startsWith("..") || path.isAbsolute(comparacion)) return texto(res, 403, "No puedo abrir esa ruta.")
  try {
    const contenido = await fs.readFile(destino)
    const tipo = TIPOS[path.extname(destino).toLowerCase()] ?? "application/octet-stream"
    res.writeHead(200, { "Content-Type": tipo, "Cache-Control": "no-store" })
    res.end(contenido)
  } catch {
    texto(res, 404, "No encontré esa página.")
  }
}

async function leerCuerpo(req: http.IncomingMessage): Promise<unknown> {
  const trozos: Buffer[] = []
  let total = 0
  for await (const trozo of req) {
    const buffer = Buffer.isBuffer(trozo) ? trozo : Buffer.from(trozo)
    total += buffer.length
    if (total > 1_000_000) throw new Error("grande")
    trozos.push(buffer)
  }
  const textoCuerpo = Buffer.concat(trozos).toString("utf8")
  if (!textoCuerpo.trim()) return {}
  return JSON.parse(textoCuerpo) as unknown
}

function enviarJson(res: http.ServerResponse, status: number, cuerpo: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  res.end(JSON.stringify(cuerpo))
}

function texto(res: http.ServerResponse, status: number, mensaje: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" })
  res.end(mensaje)
}

function escapar(valor: string): string {
  return valor.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
