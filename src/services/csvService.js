const fs = require("fs")
const csv = require("csv-parser")

function clean(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/"/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeHeader(header) {
  const cleanHeader = clean(header).toLowerCase()

  const map = {
    codigo: "sku",
    produto: "descricao",
    cliente: "cliente",
    deposito: "deposito",
    endereco: "posicao",
    un: "unidade",
    "disp. quantidade": "quantidade",
    "saldo quantidade": "quantidade",
    lote: "lote",
    fabricacao: "fabricacao",
    validade: "validade"
  }

  return map[cleanHeader] || cleanHeader
}

function parseBrazilianNumber(value) {
  if (value === undefined || value === null || value === "") return 0

  const normalized = String(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/"/g, "")
    .trim()

  const number = Number(normalized)

  if (Number.isNaN(number)) return 0

  return Math.round(number)
}

function detectSeparator(filePath) {
  const content = fs.readFileSync(filePath, "utf8")
  const firstLine = content.split(/\r?\n/)[0] || ""

  const semicolonCount = (firstLine.match(/;/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length

  return semicolonCount > commaCount ? ";" : ","
}

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = []
    const separator = detectSeparator(filePath)

    fs.createReadStream(filePath)
      .pipe(
        csv({
          separator,
          mapHeaders: ({ header }) => normalizeHeader(header)
        })
      )
      .on("data", (data) => {
        const row = {
          sku: clean(data.sku),
          descricao: clean(data.descricao),
          cliente: clean(data.cliente),
          deposito: clean(data.deposito),
          posicao: clean(data.posicao),
          unidade: clean(data.unidade),
          quantidade: parseBrazilianNumber(data.quantidade),
          lote: clean(data.lote),
          fabricacao: clean(data.fabricacao),
          validade: clean(data.validade)
        }

        results.push(row)
      })
      .on("end", () => {
        resolve(results)
      })
      .on("error", (err) => {
        reject(err)
      })
  })
}

module.exports = { parseCSV }