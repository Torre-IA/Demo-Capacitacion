import fs from "node:fs"
import { finished } from "node:stream/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import PDFDocument from "pdfkit"

export interface FilaExcel {
  hoja: string
  celda_etiqueta: string
  celda_valor: string
  etiqueta: string
  valor: string
}

export async function escribirExcel(archivo: string, filas: FilaExcel[]): Promise<void> {
  const libro = new ExcelJS.Workbook()
  libro.creator = "Agente de registro de proveedor"
  libro.lastModifiedBy = "Agente de registro de proveedor"
  const grupos = new Map<string, FilaExcel[]>()
  const orden: string[] = []
  for (const fila of filas) {
    const grupo = grupos.get(fila.hoja)
    if (!grupo) {
      grupos.set(fila.hoja, [fila])
      orden.push(fila.hoja)
    } else {
      grupo.push(fila)
    }
  }
  for (const hoja of orden) {
    const ws = libro.addWorksheet(hoja)
    ws.getColumn("A").width = 42
    ws.getColumn("B").width = 64
    ws.getColumn("C").width = 64
    for (const fila of grupos.get(hoja) ?? []) {
      const etiqueta = ws.getCell(fila.celda_etiqueta)
      etiqueta.value = fila.etiqueta
      etiqueta.alignment = { vertical: "top", wrapText: true }
      if (fila.valor) {
        const valor = ws.getCell(fila.celda_valor)
        valor.value = fila.valor
        valor.numFmt = "@"
        valor.alignment = { vertical: "top", wrapText: true }
      }
    }
  }
  await reemplazar(archivo, async (temporal) => {
    await libro.xlsx.writeFile(temporal)
  })
}

export async function escribirPdf(
  archivo: string,
  entrada: { cliente: string; caso: string; pais: string; filas: { etiqueta: string; valor: string }[] },
): Promise<void> {
  await reemplazar(archivo, async (temporal) => {
    const doc = new PDFDocument({ margin: 50, size: "A4", compress: false })
    const stream = fs.createWriteStream(temporal)
    doc.pipe(stream)
    doc.info.Title = `Registro de proveedor ${entrada.caso}`
    doc.info.Author = "Agente de registro (borrador sin firma)"
    doc.font("Helvetica-Bold").fontSize(16).text("Formulario de registro como proveedor", { align: "center" })
    doc.moveDown(0.4)
    doc.font("Helvetica").fontSize(10).text("Borrador generado para firma. Sin firma y sin envío.", { align: "center" })
    doc.moveDown()
    doc.fontSize(12).text(entrada.cliente)
    doc.fontSize(10).text(`Caso: ${entrada.caso} · País del cliente: ${entrada.pais}`)
    doc.moveDown()
    for (const fila of entrada.filas) {
      doc.font("Helvetica-Bold").fontSize(11).text(fila.etiqueta)
      doc.font("Helvetica").fontSize(11).text(fila.valor)
      doc.moveDown(0.45)
    }
    doc.moveDown()
    doc.fontSize(9).fillColor("#555555").text("Documento generado automáticamente. Sin firma. Sin envío.")
    doc.end()
    await finished(stream)
  })
}

async function reemplazar(archivo: string, escribir: (temporal: string) => Promise<void>): Promise<void> {
  await fs.promises.mkdir(path.dirname(archivo), { recursive: true })
  const temporal = `${archivo}.parcial`
  try {
    await escribir(temporal)
    await fs.promises.rm(archivo, { force: true })
    await fs.promises.rename(temporal, archivo)
  } catch (error) {
    await fs.promises.rm(temporal, { force: true })
    throw error
  }
}
