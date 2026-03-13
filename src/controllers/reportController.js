const pool = require("../db/db")
const { Parser } = require("json2csv")

async function positionReport(req, res) {
  try {
    const { positionId } = req.params

    const result = await pool.query(
      `SELECT
        p.codigo AS posicao,
        i.sku,
        i.descricao,
        i.quantidade_sistema,
        COALESCE((
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id
          ORDER BY c.data_contagem DESC
          LIMIT 1
        ), 0) AS quantidade_contada,
        (
          COALESCE((
            SELECT c.quantidade_contada
            FROM contagens c
            WHERE c.item_id = i.id
            ORDER BY c.data_contagem DESC
            LIMIT 1
          ), 0) - i.quantidade_sistema
        ) AS diferenca
      FROM itens i
      JOIN posicoes p ON p.id = i.posicao_id
      WHERE i.posicao_id = $1`,
      [positionId]
    )

    return res.json(result.rows)
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao gerar relatório da posição",
      details: error.message
    })
  }
}

async function inventoryReport(req, res) {
  try {
    const { inventarioId } = req.params

    const itemsResult = await pool.query(
      `SELECT
        p.codigo AS posicao,
        p.status AS status_posicao,
        i.id AS item_id,
        i.sku,
        i.descricao,
        i.quantidade_sistema,
        i.encontrado_a_mais,
        COALESCE((
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id
          ORDER BY c.data_contagem DESC
          LIMIT 1
        ), 0) AS quantidade_contada
      FROM itens i
      JOIN posicoes p ON p.id = i.posicao_id
      WHERE p.inventario_id = $1
      ORDER BY p.codigo, i.descricao`,
      [inventarioId]
    )

    const positionsResult = await pool.query(
      `SELECT
        id,
        codigo,
        status
      FROM posicoes
      WHERE inventario_id = $1`,
      [inventarioId]
    )

    const rows = itemsResult.rows
    const positions = positionsResult.rows

    const totalItens = rows.length
    const totalPosicoes = positions.length

    const itensContados = rows.filter((item) => {
      return Number(item.quantidade_contada) > 0 || item.encontrado_a_mais
    }).length

    const itensCorretos = rows.filter((item) => {
      return Number(item.quantidade_sistema) === Number(item.quantidade_contada)
    }).length

    const itensDivergentes = rows.filter((item) => {
      return Number(item.quantidade_sistema) !== Number(item.quantidade_contada)
    })

    const posicoesFinalizadas = positions.filter((p) => p.status === "finalizado").length
    const posicoesRecontagem = positions.filter((p) => p.status === "recontagem").length
    const posicoesEmAndamento = positions.filter((p) => p.status === "contando").length

    const acuracidade = totalItens > 0 ? (itensCorretos / totalItens) * 100 : 0
    const percentualItensContados = totalItens > 0 ? (itensContados / totalItens) * 100 : 0
    const percentualPosicoesContadas = totalPosicoes > 0 ? (posicoesFinalizadas / totalPosicoes) * 100 : 0

    const top10Divergentes = itensDivergentes
      .map((item) => ({
        ...item,
        diferencaAbsoluta: Math.abs(
          Number(item.quantidade_contada) - Number(item.quantidade_sistema)
        )
      }))
      .sort((a, b) => b.diferencaAbsoluta - a.diferencaAbsoluta)
      .slice(0, 10)

    return res.json({
      resumo: {
        totalItens,
        itensContados,
        itensCorretos,
        itensDivergentes: itensDivergentes.length,
        totalPosicoes,
        posicoesFinalizadas,
        posicoesRecontagem,
        posicoesEmAndamento,
        acuracidade: acuracidade.toFixed(2),
        percentualItensContados: percentualItensContados.toFixed(2),
        percentualPosicoesContadas: percentualPosicoesContadas.toFixed(2)
      },
      top10Divergentes,
      dados: rows
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao gerar relatório",
      details: error.message
    })
  }
}

async function exportInventoryCSV(req, res) {
  try {
    const { inventarioId } = req.params

    const result = await pool.query(
      `SELECT
        p.codigo AS posicao,
        p.status AS status_posicao,
        i.sku,
        i.descricao,
        i.quantidade_sistema,
        COALESCE((
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id
          ORDER BY c.data_contagem DESC
          LIMIT 1
        ), 0) AS quantidade_contada
      FROM itens i
      JOIN posicoes p ON p.id = i.posicao_id
      WHERE p.inventario_id = $1
      ORDER BY p.codigo, i.descricao`,
      [inventarioId]
    )

    const parser = new Parser()
    const csv = parser.parse(result.rows)

    res.header("Content-Type", "text/csv")
    res.attachment("inventario.csv")

    return res.send(csv)
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao exportar CSV",
      details: error.message
    })
  }
}

module.exports = {
  positionReport,
  inventoryReport,
  exportInventoryCSV
}