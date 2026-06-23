const fs = require("fs")
const path = require("path")
const { parseCSV } = require("./src/services/csvService")

async function run() {
  const filePath = path.resolve("./Teste_Atualizado.csv")

  console.log("Arquivo lido:", filePath)

  const stat = fs.statSync(filePath)
  console.log("Tamanho:", stat.size, "bytes")
  console.log("Modificado em:", stat.mtime)

  const raw = fs.readFileSync(filePath, "utf8")
  const linhasFisicas = raw.split(/\r?\n/)

  console.log("Linhas físicas do arquivo:", linhasFisicas.length)
  console.log("Cabeçalho:", linhasFisicas[0])
  console.log("Primeira linha de dados:", linhasFisicas[1])
  console.log("Última linha:", linhasFisicas[linhasFisicas.length - 2])

  const rows = await parseCSV(filePath)

  const positions = [
    ...new Set(
      rows
        .map((r) => String(r.posicao || "").trim())
        .filter(Boolean)
    )
  ]

  const semPosicao = rows.filter((r) => !String(r.posicao || "").trim())

  console.log("Linhas parseadas:", rows.length)
  console.log("Linhas sem posição:", semPosicao.length)
  console.log("Posições únicas:", positions.length)

  console.log("Primeiras posições:", positions.slice(0, 20))
  console.log("Últimas posições:", positions.slice(-20))
}

run()