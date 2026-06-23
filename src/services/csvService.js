const fs = require("fs")

function clean(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/^"|"$/g, "")
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
    "tipo de area": "tipo_area",
    unitizacao: "unitizacao",
    pack: "pack",
    classificacao: "classificacao",
    un: "unidade",
    "disp. quantidade": "quantidade",
    "saldo quantidade": "quantidade_saldo",
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

function detectSeparator(firstLine) {
  const semicolonCount = (firstLine.match(/;/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length

  return semicolonCount >= commaCount ? ";" : ","
}

function splitLine(line, separator) {
  return String(line || "")
    .split(separator)
    .map((value) => clean(value))
}

async function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, "utf8")

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length <= 1) return []

  const separator = detectSeparator(lines[0])
  const headers = splitLine(lines[0], separator).map(normalizeHeader)

  const results = []

  for (let index = 1; index < lines.length; index++) {
    const values = splitLine(lines[index], separator)
    const data = {}

    headers.forEach((header, headerIndex) => {
      data[header] = values[headerIndex] || ""
    })

    const quantidade =
      data.quantidade !== undefined && data.quantidade !== ""
        ? data.quantidade
        : data.quantidade_saldo

    results.push({
      sku: clean(data.sku),
      descricao: clean(data.descricao),
      cliente: clean(data.cliente),
      deposito: clean(data.deposito),
      posicao: clean(data.posicao),
      unidade: clean(data.unidade),
      quantidade: parseBrazilianNumber(quantidade),
      lote: clean(data.lote),
      fabricacao: clean(data.fabricacao),
      validade: clean(data.validade)
    })
  }

  return results
}

module.exports = { parseCSV }