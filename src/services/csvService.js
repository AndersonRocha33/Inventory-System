const csv = require("csv-parser")
const fs = require("fs")

function normalizeText(text) {
  if (!text) return ""

  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/"/g, "")
    .trim()
}

function normalizeHeader(header) {
  const clean = normalizeText(header).toLowerCase()

  const map = {
    codigo: "sku",
    "código": "sku",
    produto: "descricao",
    endereco: "posicao",
    endereço: "posicao",
    "saldo quantidade": "quantidade",
    "disp. quantidade": "quantidade",
    deposito: "deposito",
    depósito: "deposito",
    cliente: "cliente",
    lote: "lote",
    validade: "validade",
    un: "unidade",
    fabricacao: "fabricacao",
    fabricação: "fabricacao"
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

  if (Number.isNaN(number)) return 0

  return Math.round(number)
}

function detectSeparator(filePath) {
  const content = fs.readFileSync(filePath, "utf8")
  const firstLine = content.split(/\r?\n/)[0] || ""

  const semicolonCount = (firstLine.match(/;/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length

  if (semicolonCount > commaCount) return ";"

  return ","
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
        const sku = String(data.sku || "").trim()
        const descricao = String(data.descricao || "").trim()
        const posicao = String(data.posicao || "").trim()

        const quantidade = parseBrazilianNumber(
          data.quantidade ||
            data.quantidade_disponivel ||
            data.saldo_quantidade ||
            data.disp_quantidade
        )

        if (!sku || !descricao || !posicao) {
          return
        }

        results.push({
          sku,
          descricao,
          posicao,
          quantidade,
          deposito: String(data.deposito || "").trim(),
          cliente: String(data.cliente || "").trim(),
          lote: String(data.lote || "").trim(),
          validade: String(data.validade || "").trim(),
          unidade: String(data.unidade || "").trim(),
          fabricacao: String(data.fabricacao || "").trim()
        })
      })
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err))
  })
}

module.exports = { parseCSV }