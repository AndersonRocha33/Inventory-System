const pool = require("../db/db")
const { Parser } = require("json2csv")
const ExcelJS = require("exceljs")

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
    p.observacao AS observacao_posicao,
    i.sku,
    MAX(i.descricao) AS descricao,
    BOOL_OR(i.encontrado_a_mais) AS encontrado_a_mais,
    SUM(COALESCE(i.quantidade_sistema, 0))::integer AS quantidade_sistema,
    SUM(COALESCE(i.quantidade_final, lc.quantidade_contada, 0))::integer AS quantidade_contada
  FROM itens i
  JOIN posicoes p ON p.id = i.posicao_id
  LEFT JOIN latest_counts lc
    ON lc.item_id = i.id
   AND lc.rn = 1
  WHERE p.inventario_id = $1
  GROUP BY p.codigo, p.status, p.observacao, i.sku
)
SELECT
  posicao,
  status_posicao,
  observacao_posicao,
  sku,
  descricao,
  encontrado_a_mais,
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
      `WITH latest_counts AS (
        SELECT
          c.item_id,
          c.quantidade_contada,
          ROW_NUMBER() OVER (
            PARTITION BY c.item_id
            ORDER BY c.data_contagem DESC, c.id DESC
          ) AS rn
        FROM contagens c
      )
      SELECT
        p.codigo AS posicao,
        p.status AS status_posicao,
        p.observacao AS observacao_posicao,
        i.sku,
        i.descricao,
        i.encontrado_a_mais,
        i.quantidade_sistema::integer AS quantidade_sistema,
        COALESCE(i.quantidade_final, lc.quantidade_contada, 0)::integer AS quantidade_contada,
        (COALESCE(i.quantidade_final, lc.quantidade_contada, 0) - i.quantidade_sistema)::integer AS diferenca
      FROM itens i
      JOIN posicoes p ON p.id = i.posicao_id
      LEFT JOIN latest_counts lc
        ON lc.item_id = i.id
       AND lc.rn = 1
      WHERE i.posicao_id = $1
      ORDER BY i.sku`,
      [positionId]
    )

    return res.json(result.rows)
  } catch (error) {
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

    const positionsResult = await pool.query(
      `SELECT id, codigo, status
       FROM posicoes
       WHERE inventario_id = $1`,
      [inventarioId]
    )

    const positions = positionsResult.rows

    const totalItens = rows.length
    const totalPosicoes = positions.length

    const posicoesFinalizadas = positions.filter((p) => p.status === "finalizado").length
    const posicoesRecontagem = positions.filter((p) => p.status === "recontagem").length
    const posicoesEmAndamento = positions.filter((p) => p.status === "contando").length
    const posicoesPendentes = positions.filter((p) => p.status === "pendente").length

    const itensContados = rows.filter((item) =>
      Number(item.quantidade_contada) > 0 ||
      item.status_posicao === "finalizado" ||
      item.status_posicao === "recontagem"
    ).length

    const percentualItensContados =
      totalItens > 0 ? (itensContados / totalItens) * 100 : 0

    const percentualPosicoesContadas =
      totalPosicoes > 0 ? (posicoesFinalizadas / totalPosicoes) * 100 : 0

    const itensAvaliados = rows.filter((item) => item.status_posicao === "finalizado")
    const totalItensAvaliados = itensAvaliados.length

    const itensCorretosAvaliados = itensAvaliados.filter(
      (item) => Number(item.quantidade_sistema) === Number(item.quantidade_contada)
    )

    const itensDivergentesAvaliados = itensAvaliados.filter(
      (item) => Number(item.quantidade_sistema) !== Number(item.quantidade_contada)
    )

    const acuracidadeAtual =
      totalItensAvaliados > 0
        ? (itensCorretosAvaliados.length / totalItensAvaliados) * 100
        : 0

    const projecaoFinal = acuracidadeAtual

    const divergenciasAbertas = rows.filter(
      (item) => item.status_posicao === "recontagem"
    ).length

    const itensExtras = rows.filter((item) => item.encontrado_a_mais === true)

    const itensExtrasFinalizados = itensExtras.filter(
      (item) => item.status_posicao === "finalizado"
    )

    const operatorResult = await pool.query(
      `WITH item_base AS (
         SELECT
           i.id AS item_id,
           p.inventario_id,
           i.quantidade_sistema::integer AS quantidade_sistema,
           COALESCE(i.quantidade_final, i.quantidade_sistema)::integer AS quantidade_final
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
         JOIN item_base ib ON ib.item_id = c.item_id
       )
       SELECT
         l.operador,
         COUNT(*)::integer AS total_contagens,
         SUM(
           CASE
             WHEN l.quantidade_contada = ib.quantidade_final THEN 1
             ELSE 0
           END
         )::integer AS contagens_corretas,
         SUM(
           CASE
             WHEN l.quantidade_contada <> ib.quantidade_final THEN 1
             ELSE 0
           END
         )::integer AS contagens_divergentes
       FROM last_count_per_phase l
       JOIN item_base ib ON ib.item_id = l.item_id
       WHERE l.rn = 1
       GROUP BY l.operador
       ORDER BY total_contagens DESC, contagens_corretas DESC`,
      [inventarioId]
    )

    const rankingOperadores = operatorResult.rows.map((row) => {
      const total = Number(row.total_contagens || 0)
      const corretas = Number(row.contagens_corretas || 0)
      const divergentes = Number(row.contagens_divergentes || 0)

      return {
        operador: row.operador,
        totalContagens: total,
        contagensCorretas: corretas,
        contagensDivergentes: divergentes,
        percentualAcerto: total > 0 ? ((corretas / total) * 100).toFixed(2) : "0.00"
      }
    })

    return res.json({
      resumo: {
        acuracidadeAtual: acuracidadeAtual.toFixed(2),
        projecaoFinal: projecaoFinal.toFixed(2),
        divergenciasAbertas,

        totalItens,
        itensContados,
        percentualItensContados: percentualItensContados.toFixed(2),

        totalItensAvaliados,
        itensCorretosAvaliados: itensCorretosAvaliados.length,
        itensDivergentesAvaliados: itensDivergentesAvaliados.length,

        itensExtras: itensExtras.length,
        itensExtrasFinalizados: itensExtrasFinalizados.length,

        totalPosicoes,
        posicoesFinalizadas,
        posicoesPendentes,
        posicoesRecontagem,
        posicoesEmAndamento,
        percentualPosicoesContadas: percentualPosicoesContadas.toFixed(2)
      },
      rankingOperadores,
      dados: rows
    })
  } catch (error) {
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
        "observacao_posicao",
        "sku",
        "descricao",
        "encontrado_a_mais",
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
    return res.status(500).json({
      error: "Erro ao exportar CSV",
      details: error.message
    })
  }
}

async function exportInventoryExcel(req, res) {
  try {
    const { inventarioId } = req.params

    const reportResult = await pool.query(REPORT_QUERY_BY_INVENTORY, [inventarioId])
    const rows = reportResult.rows

    const historyResult = await pool.query(
      `SELECT
        p.codigo AS posicao,
        p.status AS status_posicao,
        p.observacao AS observacao_posicao,
        p.primeiro_operador,
        p.segundo_operador,
        p.terceiro_operador,
        i.sku,
        i.descricao,
        i.encontrado_a_mais,
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

    const auditResult = await pool.query(
      `SELECT
        a.id,
        p.codigo AS posicao,
        i.sku,
        i.descricao,
        a.operador,
        a.fase,
        a.quantidade_anterior,
        a.quantidade_nova,
        a.acao,
        a.data_alteracao
      FROM auditoria_contagens a
      LEFT JOIN itens i ON i.id = a.item_id
      LEFT JOIN posicoes p ON p.id = a.posicao_id
      WHERE a.inventario_id = $1
      ORDER BY a.data_alteracao DESC, a.id DESC`,
      [inventarioId]
    )

    const workbook = new ExcelJS.Workbook()
    workbook.creator = "SpotInventory"
    workbook.created = new Date()

    const resumoSheet = workbook.addWorksheet("Resumo")
    resumoSheet.columns = [
      { header: "Indicador", key: "indicador", width: 32 },
      { header: "Valor", key: "valor", width: 20 }
    ]

    const itensFinalizados = rows.filter((item) => item.status_posicao === "finalizado")
    const itensCorretos = itensFinalizados.filter(
      (item) => Number(item.quantidade_sistema) === Number(item.quantidade_contada)
    ).length
    const itensDivergentes = itensFinalizados.filter(
      (item) => Number(item.quantidade_sistema) !== Number(item.quantidade_contada)
    ).length
    const itensAvaliados = itensCorretos + itensDivergentes
    const acuracidade =
      itensAvaliados > 0 ? ((itensCorretos / itensAvaliados) * 100).toFixed(2) : "0.00"

    resumoSheet.addRows([
      { indicador: "Total de itens", valor: rows.length },
      { indicador: "Itens avaliados", valor: itensAvaliados },
      { indicador: "Itens corretos", valor: itensCorretos },
      { indicador: "Itens divergentes", valor: itensDivergentes },
      { indicador: "Acuracidade", valor: `${acuracidade}%` }
    ])

    const itensSheet = workbook.addWorksheet("Itens")
    itensSheet.columns = [
      { header: "Posição", key: "posicao", width: 18 },
      { header: "Status", key: "status_posicao", width: 18 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Descrição", key: "descricao", width: 60 },
      { header: "Sistema", key: "quantidade_sistema", width: 14 },
      { header: "Contada", key: "quantidade_contada", width: 14 },
      { header: "Diferença", key: "diferenca", width: 14 },
      { header: "Extra", key: "encontrado_a_mais", width: 12 },
      { header: "Observação posição", key: "observacao_posicao", width: 40 }
    ]
    itensSheet.addRows(rows)

    const divergenciasSheet = workbook.addWorksheet("Divergências")
    divergenciasSheet.columns = itensSheet.columns
    divergenciasSheet.addRows(rows.filter((item) => Number(item.diferenca) !== 0))

    const historicoSheet = workbook.addWorksheet("Histórico")
    historicoSheet.columns = [
      { header: "Posição", key: "posicao", width: 18 },
      { header: "Status", key: "status_posicao", width: 18 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Descrição", key: "descricao", width: 60 },
      { header: "Sistema", key: "quantidade_sistema", width: 14 },
      { header: "Q1", key: "q1", width: 12 },
      { header: "Q2", key: "q2", width: 12 },
      { header: "Q3", key: "q3", width: 12 },
      { header: "Final", key: "quantidade_final", width: 12 },
      { header: "Critério", key: "criterio_fechamento", width: 28 },
      { header: "Resolvido", key: "resolvido", width: 12 },
      { header: "1º Operador", key: "primeiro_operador", width: 22 },
      { header: "2º Operador", key: "segundo_operador", width: 22 },
      { header: "3º Operador", key: "terceiro_operador", width: 22 },
      { header: "Observação posição", key: "observacao_posicao", width: 40 }
    ]
    historicoSheet.addRows(historyResult.rows)

    const auditoriaSheet = workbook.addWorksheet("Auditoria")
    auditoriaSheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Posição", key: "posicao", width: 18 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Descrição", key: "descricao", width: 60 },
      { header: "Operador", key: "operador", width: 24 },
      { header: "Fase", key: "fase", width: 10 },
      { header: "Qtd anterior", key: "quantidade_anterior", width: 16 },
      { header: "Qtd nova", key: "quantidade_nova", width: 16 },
      { header: "Ação", key: "acao", width: 24 },
      { header: "Data alteração", key: "data_alteracao", width: 24 }
    ]
    auditoriaSheet.addRows(auditResult.rows)

    for (const sheet of workbook.worksheets) {
      sheet.getRow(1).font = { bold: true }
      sheet.views = [{ state: "frozen", ySplit: 1 }]
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columnCount }
      }
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=inventario-${inventarioId}.xlsx`
    )

    await workbook.xlsx.write(res)
    return res.end()
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao exportar Excel",
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
        p.status AS status_posicao,
        p.observacao AS observacao_posicao,
        p.primeiro_operador,
        p.segundo_operador,
        p.terceiro_operador,
        i.sku,
        i.descricao,
        i.encontrado_a_mais,
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
    return res.status(500).json({
      error: "Erro ao gerar relatório histórico",
      details: error.message
    })
  }
}

async function auditReport(req, res) {
  try {
    const { inventarioId } = req.params

    const result = await pool.query(
      `SELECT
        a.id,
        p.codigo AS posicao,
        i.sku,
        i.descricao,
        a.operador,
        a.fase,
        a.quantidade_anterior,
        a.quantidade_nova,
        a.acao,
        a.data_alteracao
      FROM auditoria_contagens a
      LEFT JOIN itens i ON i.id = a.item_id
      LEFT JOIN posicoes p ON p.id = a.posicao_id
      WHERE a.inventario_id = $1
      ORDER BY a.data_alteracao DESC, a.id DESC`,
      [inventarioId]
    )

    return res.json(result.rows)
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao gerar auditoria",
      details: error.message
    })
  }
}

module.exports = {
  positionReport,
  inventoryReport,
  exportInventoryCSV,
  exportInventoryExcel,
  inventoryHistoryReport,
  auditReport
}