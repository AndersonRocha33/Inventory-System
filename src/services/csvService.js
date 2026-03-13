const csv = require("csv-parser")
const fs = require("fs")

function normalizeText(text) {
  if (!text) return ""

  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

function normalizeHeader(header) {
  const clean = normalizeText(header).toLowerCase()

  const map = {
    "codigo": "sku",
    "produto": "descricao",
    "endereco": "posicao",
    "saldo quantidade": "quantidade",
    "disp. quantidade": "quantidade_disponivel",
    "deposito": "deposito",
    "cliente": "cliente",
    "lote": "lote",
    "validade": "validade"
  }

  return map[clean] || clean
}

function parseBrazilianNumber(value) {
  if (value === undefined || value === null || value === "") return 0

  const normalized = String(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/"/g, "")
    .trim()

  const number = Number(normalized)
  return Number.isNaN(number) ? 0 : number
}

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = []

    fs.createReadStream(filePath)
      .pipe(
        csv({
          mapHeaders: ({ header }) => normalizeHeader(header),
          separator: ","
        })
      )
      .on("data", (data) => {
        results.push({
          sku: data.sku || "",
          descricao: data.descricao || "",
          posicao: data.posicao || "",
          quantidade: parseBrazilianNumber(data.quantidade),
          deposito: data.deposito || "",
          cliente: data.cliente || "",
          lote: data.lote || "",
          validade: data.validade || ""
        })
      })
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err))
  })
}

module.exports = { parseCSV }