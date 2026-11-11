import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const prompt = fs.readFileSync(path.join(raiz, "agent", "prompt.md"), "utf8").trim()
const conocimiento = fs.readFileSync(path.join(raiz, "src", "knowledge", "registro-proveedor.md"), "utf8").trim()

const agente = `---
description: Prepara el registro como proveedor desde el repositorio maestro y deja la firma y el envío a una persona.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}
`

const skill = `---
name: registro-proveedor
description: Reglas para llenar el registro de proveedor sin inventar datos, sin firmar y sin enviar.
---

${conocimiento}
`

fs.mkdirSync(path.join(raiz, "modulo", "skill", "registro-proveedor"), { recursive: true })
fs.writeFileSync(path.join(raiz, "modulo", "agent.md"), agente)
fs.writeFileSync(path.join(raiz, "modulo", "skill", "registro-proveedor", "SKILL.md"), skill)
