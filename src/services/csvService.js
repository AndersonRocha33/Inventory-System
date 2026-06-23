const csv = require("csv-parser")
const fs = require("fs")

function normalizeText(text) {
  if (!text) return ""

  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/"/g, "")
    .replace(/\uFEFF/g, "")
    .trim()
}

function normalizeHeader(header) {
  const clean = normalizeText(header).toLowerCase()

  const map = {
    codigo: "sku",
    produto: "descricao",
    endereco: "posicao",
    "saldo quantidade": "quantidade",
    "disp. quantidade": "quantidade",
    deposito: "deposito",
    cliente: "cliente",
    lote: "lote",
    validade: "validade",
    un: "unidade",
    fabricacao: "fabricacao"
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
  return Number.isNaN(number) ? 0 : Math.round(number)
}

function detectSeparator(filePath) {
  const content = fs.readFileSync(filePath, "utf8")
  const firstLine = content.split(/\r?\n/)[0] || ""

  const semicolonCount = (firstLine.match(/;/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length

  return semicolonCount > commaCount ? ";" : ","
}

function clean(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = []
    const separator = detectSeparator(filePath)

    fs.createReadStream(filePath)
      .pipe(
        csv({
          mapHeaders: ({ header }) => normalizeHeader(header),
          separator
        })
      )
      .on("data", (data) => {
        results.push({
          sku: clean(data.sku),
          descricao: clean(data.descricao),
          posicao: clean(data.posicao),
          quantidade: parseBrazilianNumber(data.quantidade),
          deposito: clean(data.deposito),
          cliente: clean(data.cliente),
          lote: clean(data.lote),
          validade: clean(data.validade),
          unidade: clean(data.unidade),
          fabricacao: clean(data.fabricacao)
        })
      })
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err))
  })
}

module.exports = { parseCSV }