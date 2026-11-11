const historial = document.querySelector("#historial")
const formulario = document.querySelector("#formulario")
const mensaje = document.querySelector("#mensaje")
const aviso = document.querySelector("#aviso")
const casos = document.querySelector("#casos")
const estado = document.querySelector("#estado-modelo")
const botonEnviar = formulario.querySelector("button")
const CLAVE = "registro-proveedor-sesion"
let sessionId = sessionStorage.getItem(CLAVE) || ""
let ocupado = false

formulario.addEventListener("submit", (evento) => {
  evento.preventDefault()
  enviar(mensaje.value)
})

mensaje.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault()
    formulario.requestSubmit()
  }
})

document.querySelector("#nueva").addEventListener("click", () => {
  sessionId = ""
  sessionStorage.removeItem(CLAVE)
  historial.replaceChildren()
  aviso.hidden = true
  mensaje.focus()
})

document.querySelector("#simular").addEventListener("click", () => enviar("envía"))

iniciar()

async function iniciar() {
  try {
    const salud = await fetch("/api/health")
    const datos = await salud.json()
    estado.textContent = datos.provider === "local"
      ? "Modelo: planificador local. Sin clave no se llama a un proveedor; las herramientas son las mismas."
      : `Modelo: ${datos.model} (${datos.provider}).`
  } catch {
    estado.textContent = "No pude consultar el estado del servidor."
  }
  try {
    const respuesta = await fetch("/api/casos")
    const datos = await respuesta.json()
    for (const caso of datos.casos ?? []) {
      const boton = document.createElement("button")
      boton.type = "button"
      boton.textContent = `${caso.cliente || caso.id} · ${caso.formato || "caso"}`
      boton.addEventListener("click", () => {
        enviar(`Procesa el caso "${caso.id}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`)
      })
      casos.append(boton)
    }
  } catch {
    casos.textContent = "No pude cargar los casos."
  }
  if (!sessionId) return
  const respuesta = await fetch(`/api/sessions/${sessionId}`)
  if (!respuesta.ok) {
    sessionId = ""
    sessionStorage.removeItem(CLAVE)
    return
  }
  const sesion = await respuesta.json()
  for (const turno of sesion.turns ?? []) pintarTurno(turno)
  aviso.hidden = !ultimoPideConfirmacion()
}

async function enviar(texto) {
  const limpio = texto.trim()
  if (!limpio || ocupado) return
  ocupado = true
  botonEnviar.disabled = true
  mensaje.value = ""
  pintarTurno({ role: "user", content: limpio })
  const pensando = document.createElement("div")
  pensando.className = "pensando"
  pensando.textContent = "Pensando…"
  historial.append(pensando)
  historial.scrollTop = historial.scrollHeight
  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: limpio, sessionId: sessionId || undefined }),
    })
    const datos = await respuesta.json()
    pensando.remove()
    if (!respuesta.ok) {
      pintarError(datos.error || "No pude completar la consulta.")
      return
    }
    sessionId = datos.sessionId
    sessionStorage.setItem(CLAVE, sessionId)
    pintarTurno({
      role: "assistant",
      content: datos.reply,
      toolCalls: datos.toolCalls,
      needsConfirmation: datos.needsConfirmation,
    })
    aviso.hidden = !datos.needsConfirmation
  } catch {
    pensando.remove()
    pintarError("No hay conexión con el servidor. La sesión sigue abierta si recargas.")
  } finally {
    ocupado = false
    botonEnviar.disabled = false
    mensaje.focus()
  }
}

function pintarTurno(turno) {
  if (turno.role === "assistant" && Array.isArray(turno.toolCalls)) {
    for (const llamada of turno.toolCalls) historial.append(pintarTraza(llamada))
  }
  const burbuja = document.createElement("article")
  burbuja.className = turno.role === "user" ? "burbuja usuario" : "burbuja asistente"
  if (turno.needsConfirmation) burbuja.classList.add("confirmacion")
  burbuja.innerHTML = linkear(turno.content || "")
  historial.append(burbuja)
  historial.scrollTop = historial.scrollHeight
}

function pintarTraza(llamada) {
  const detalle = document.createElement("details")
  detalle.className = "traza"
  const marca = llamada.ok ? "ok" : "malo"
  detalle.innerHTML = `
    <summary>${escapar(llamada.name)}</summary>
    <p class="${marca}">${escapar(llamada.resumen || "")}</p>
    <pre>${escapar(bonito(llamada.arguments))}</pre>
    <pre>${escapar(bonito(llamada.result))}</pre>
  `
  return detalle
}

function pintarError(texto) {
  const nodo = document.createElement("div")
  nodo.className = "error"
  nodo.textContent = texto
  historial.append(nodo)
}

function ultimoPideConfirmacion() {
  const burbujas = historial.querySelectorAll(".asistente")
  return burbujas.length > 0 && burbujas[burbujas.length - 1].classList.contains("confirmacion")
}

function linkear(texto) {
  return escapar(texto).replace(/out\/[a-zA-Z0-9_./-]+/g, (ruta) => {
    const limpia = ruta.replace(/[.,;:)]+$/g, "")
    const resto = ruta.slice(limpia.length)
    return `<a href="/descargas/${limpia.slice(4)}" target="_blank" rel="noopener">${limpia}</a>${resto}`
  })
}

function escapar(valor) {
  return String(valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function bonito(valor) {
  if (typeof valor === "string") {
    try {
      return JSON.stringify(JSON.parse(valor), null, 2)
    } catch {
      return valor
    }
  }
  return JSON.stringify(valor, null, 2)
}
