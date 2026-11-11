import { normalizar } from "../domain/texto.ts"

const CASOS = [
  { id: "co-industrias-delta", alias: ["industrias delta"] },
  { id: "ec-corp-andina", alias: ["corp andina", "corporacion andina", "ecuador"] },
  { id: "hn-agroexport-sula", alias: ["agroexport", "honduras", "sula"] },
  { id: "pa-logistica-istmo", alias: ["logistica del istmo", "istmo", "panama", "vendorhub"] },
]

export function extraerCaso(texto: string): string | null {
  const plano = normalizar(texto)
  let ganador: { id: string; index: number } | null = null
  for (const caso of CASOS) {
    for (const candidato of [caso.id, ...caso.alias]) {
      const index = plano.indexOf(normalizar(candidato))
      if (index >= 0 && (ganador === null || index < ganador.index)) ganador = { id: caso.id, index }
    }
  }
  return ganador?.id ?? null
}

export function textoPedirCaso(): string {
  return [
    "Indícame qué solicitud debo procesar. En esta bandeja están:",
    "- co-industrias-delta (Industrias Delta, Excel)",
    "- ec-corp-andina (Corporación Andina, PDF)",
    "- hn-agroexport-sula (Agroexport Sula, Excel)",
    "- pa-logistica-istmo (Logística del Istmo, portal)",
    "Puedes escribir, por ejemplo: Procesa el caso ec-corp-andina. No envíes nada todavía.",
  ].join("\n")
}
