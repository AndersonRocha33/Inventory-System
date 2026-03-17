const pool = require("../db/db")
const { Parser } = require("json2csv")

const REPORT_QUERY_BY_INVENTORY = `
WITH latest_counts AS (
  SELECT
    c.item_id,
    c.quantidade_contada,
    ROW_NUMBER() OVER (
      PARTITION BY c.item_id
      ORDER BY c.data_contagem DESC, c.id DESC
    ) AS rn
  FROM contagens c
),
grouped AS (
  SELECT
    p.codigo AS posicao,
    p.status AS status_posicao,
    i.sku,
    MAX(i.descricao) AS descricao,
    SUM(COALESCE(i.quantidade_sistema, 0))::integer AS quantidade_sistema,
    SUM(
      COALESCE(i.quantidade_final, lc.quantidade_contada, 0)
    )::integer AS quantidade_contada
  FROM itens i
  JOIN posicoes p ON p.id = i.posicao_id
  LEFT JOIN latest_counts lc
    ON lc.item_id = i.id
   AND lc.rn = 1
  WHERE p.inventario_id = $1
  GROUP BY p.codigo, p.status, i.sku
)
SELECT
  posicao,
  status_posicao,
  sku,
  descricao,
  quantidade_sistema,
  quantidade_contada,
  (quantidade_contada - quantidade_sistema) AS diferenca
FROM grouped
ORDER BY posicao, sku
`

async function positionReport(req, res) {
  try {
    const { positionId } = req.params

    const result = await pool.query(
      `SELECT
        p.codigo AS posicao,
        p.status AS status_posicao,
        i.sku,
        i.descricao,
        i.quantidade_sistema::integer AS quantidade_sistema,
        COALESCE(i.quantidade_final, 0)::integer AS quantidade_contada,
        (COALESCE(i.quantidade_final, 0) - i.quantidade_sistema)::integer AS diferenca
      FROM itens i
      JOIN posicoes p ON p.id = i.posicao_id
      WHERE i.posicao_id = $1
      ORDER BY i.sku`,
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

    const result = await pool.query(REPORT_QUERY_BY_INVENTORY, [inventarioId])
    const rows = result.rows

    const totalItens = rows.length
    const itensContados = rows.filter((item) => Number(item.quantidade_contada) > 0).length
    const itensCorretos = rows.filter(
      (item) => Number(item.quantidade_sistema) === Number(item.quantidade_contada)
    ).length
    const itensDivergentes = rows.filter(
      (item) => Number(item.quantidade_sistema) !== Number(item.quantidade_contada)
    )

    const positionsResult = await pool.query(
      `SELECT id, codigo, status
       FROM posicoes
       WHERE inventario_id = $1`,
      [inventarioId]
    )

    const positions = positionsResult.rows
    const totalPosicoes = positions.length
    const posicoesFinalizadas = positions.filter((p) => p.status === "finalizado").length
    const posicoesRecontagem = positions.filter((p) => p.status === "recontagem").length
    const posicoesEmAndamento = positions.filter((p) => p.status === "contando").length

    const acuracidade = totalItens > 0 ? (itensCorretos / totalItens) * 100 : 0
    const percentualItensContados = totalItens > 0 ? (itensContados / totalItens) * 100 : 0
    const percentualPosicoesContadas = totalPosicoes > 0
      ? (posicoesFinalizadas / totalPosicoes) * 100
      : 0

    const top10Divergentes = itensDivergentes
      .map((item) => ({
        ...item,
        diferencaAbsoluta: Math.abs(
          Number(item.quantidade_contada) - Number(item.quantidade_sistema)
        )
      }))
      .sort((a, b) => b.diferencaAbsoluta - a.diferencaAbsoluta)
      .slice(0, 10)

    // gráfico: top SKUs com maior divergência acumulada
    const divergenciaPorSkuMap = new Map()

    for (const item of itensDivergentes) {
      const key = `${item.sku}||${item.descricao}`
      const atual = divergenciaPorSkuMap.get(key) || {
        sku: item.sku,
        descricao: item.descricao,
        divergenciaTotal: 0
      }

      atual.divergenciaTotal += Math.abs(
        Number(item.quantidade_contada) - Number(item.quantidade_sistema)
      )

      divergenciaPorSkuMap.set(key, atual)
    }

    const graficoDivergencias = Array.from(divergenciaPorSkuMap.values())
      .sort((a, b) => b.divergenciaTotal - a.divergenciaTotal)
      .slice(0, 10)

    // ranking de operadores
    const operatorResult = await pool.query(
      `WITH item_final AS (
         SELECT
           i.id AS item_id,
           p.inventario_id,
           i.quantidade_sistema::integer AS quantidade_sistema,
           COALESCE(i.quantidade_final, 0)::integer AS quantidade_final
         FROM itens i
         JOIN posicoes p ON p.id = i.posicao_id
         WHERE p.inventario_id = $1
       ),
       last_count_per_phase AS (
         SELECT
           c.item_id,
           c.operador,
           c.fase,
           c.quantidade_contada::integer AS quantidade_contada,
           ROW_NUMBER() OVER (
             PARTITION BY c.item_id, c.fase
             ORDER BY c.data_contagem DESC, c.id DESC
           ) AS rn
         FROM contagens c
         JOIN item_final f ON f.item_id = c.item_id
       )
       SELECT
         l.operador,
         COUNT(*)::integer AS total_contagens,
         SUM(
           CASE
             WHEN l.quantidade_contada = f.quantidade_sistema THEN 1
             ELSE 0
           END
         )::integer AS contagens_corretas,
         SUM(
           CASE
             WHEN l.quantidade_contada <> f.quantidade_sistema THEN 1
             ELSE 0
           END
         )::integer AS contagens_divergentes
       FROM last_count_per_phase l
       JOIN item_final f ON f.item_id = l.item_id
       WHERE l.rn = 1
       GROUP BY l.operador
       ORDER BY total_contagens DESC, contagens_corretas DESC`,
      [inventarioId]
    )

    const rankingOperadores = operatorResult.rows.map((row) => {
      const total = Number(row.total_contagens || 0)
      const corretas = Number(row.contagens_corretas || 0)
      const divergentes = Number(row.contagens_divergentes || 0)
      const percentualAcerto = total > 0 ? ((corretas / total) * 100).toFixed(2) : "0.00"

      return {
        operador: row.operador,
        totalContagens: total,
        contagensCorretas: corretas,
        contagensDivergentes: divergentes,
        percentualAcerto
      }
    })

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
      graficoDivergencias,
      rankingOperadores,
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

    const result = await pool.query(REPORT_QUERY_BY_INVENTORY, [inventarioId])

    const parser = new Parser({
      fields: [
        "posicao",
        "status_posicao",
        "sku",
        "descricao",
        "quantidade_sistema",
        "quantidade_contada",
        "diferenca"
      ]
    })

    const csv = parser.parse(result.rows)

    res.header("Content-Type", "text/csv; charset=utf-8")
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

async function inventoryHistoryReport(req, res) {
  try {
    const { inventarioId } = req.params

    const result = await pool.query(
      `SELECT
        p.codigo AS posicao,
        p.primeiro_operador,
        p.segundo_operador,
        p.terceiro_operador,
        i.sku,
        i.descricao,
        i.quantidade_sistema::integer AS quantidade_sistema,
        (
          SELECT c.quantidade_contada::integer
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 1
          ORDER BY c.data_contagem DESC, c.id DESC
          LIMIT 1
        ) AS q1,
        (
          SELECT c.quantidade_contada::integer
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 2
          ORDER BY c.data_contagem DESC, c.id DESC
          LIMIT 1
        ) AS q2,
        (
          SELECT c.quantidade_contada::integer
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 3
          ORDER BY c.data_contagem DESC, c.id DESC
          LIMIT 1
        ) AS q3,
        i.quantidade_final::integer AS quantidade_final,
        i.criterio_fechamento,
        i.resolvido
      FROM itens i
      JOIN posicoes p ON p.id = i.posicao_id
      WHERE p.inventario_id = $1
      ORDER BY p.codigo, i.sku`,
      [inventarioId]
    )

    return res.json(result.rows)
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao gerar relatório histórico",
      details: error.message
    })
  }
}

module.exports = {
  positionReport,
  inventoryReport,
  exportInventoryCSV,
  inventoryHistoryReport
}