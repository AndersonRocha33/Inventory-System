const fs = require("fs")
const pool = require("../db/db")
const { parseCSV } = require("../services/csvService")

function normalizeInteger(value) {
  const number = Number(value || 0)

  if (Number.isNaN(number)) return 0

  return Math.round(number)
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getUniquePositions(rows) {
  const positions = new Set()

  for (const row of rows) {
    const posicao = cleanText(row.posicao)

    if (posicao) {
      positions.add(posicao)
    }
  }

  return Array.from(positions)
}

function groupRows(rows) {
  const grouped = new Map()

  for (const row of rows) {
    const posicaoCodigo = cleanText(row.posicao)
    const sku = cleanText(row.sku)
    const descricao = cleanText(row.descricao)
    const quantidade = normalizeInteger(row.quantidade)
    const lote = row.lote ? cleanText(row.lote) : null
    const validade = row.validade ? cleanText(row.validade) : null

    if (!posicaoCodigo || !sku || !descricao) continue

    const key = `${posicaoCodigo}::${sku}`

    if (!grouped.has(key)) {
      grouped.set(key, {
        posicao: posicaoCodigo,
        sku,
        descricao,
        quantidade,
        lote,
        validade
      })
    } else {
      grouped.get(key).quantidade += quantidade
    }
  }

  return Array.from(grouped.values())
}

async function uploadInventory(req, res) {
  const client = await pool.connect()

  try {
    const file = req.file
    const { dataInventario } = req.body || {}

    if (!file) {
      return res.status(400).json({ error: "Arquivo não enviado" })
    }

    if (!dataInventario) {
      return res.status(400).json({ error: "Data do inventário é obrigatória" })
    }

    const rows = await parseCSV(file.path)

    if (!rows.length) {
      return res.status(400).json({ error: "CSV vazio" })
    }

    const uniquePositions = getUniquePositions(rows)
    const groupedRows = groupRows(rows)

    if (!uniquePositions.length) {
      return res.status(400).json({
        error: "Nenhuma posição encontrada no CSV"
      })
    }

    await client.query("BEGIN")

    const firstValidRow =
      rows.find((row) => cleanText(row.cliente) || cleanText(row.deposito)) || rows[0]

    const cliente = cleanText(firstValidRow.cliente) || null
    const deposito = cleanText(firstValidRow.deposito) || null
    const nomeInventario = `Inventário ${dataInventario}`

    const inventarioResult = await client.query(
      `INSERT INTO inventarios (nome, cliente, deposito, data_inicio, status, arquivado)
       VALUES ($1, $2, $3, $4, 'aberto', false)
       RETURNING id`,
      [nomeInventario, cliente, deposito, dataInventario]
    )

    const inventarioId = inventarioResult.rows[0].id
    const positionsMap = new Map()

    for (const posicao of uniquePositions) {
      const posicaoResult = await client.query(
        `INSERT INTO posicoes (inventario_id, codigo, incluida_no_inventario)
         VALUES ($1, $2, true)
         ON CONFLICT (inventario_id, codigo)
         DO UPDATE SET codigo = EXCLUDED.codigo
         RETURNING id`,
        [inventarioId, posicao]
      )

      positionsMap.set(posicao, posicaoResult.rows[0].id)
    }

    for (const row of groupedRows) {
      const posicaoId = positionsMap.get(row.posicao)

      if (!posicaoId) continue

      await client.query(
        `INSERT INTO itens (
          posicao_id,
          sku,
          descricao,
          quantidade_sistema,
          lote,
          validade,
          resolvido
        ) VALUES ($1, $2, $3, $4, $5, $6, false)`,
        [
          posicaoId,
          row.sku,
          row.descricao,
          row.quantidade,
          row.lote,
          row.validade
        ]
      )
    }

    await client.query("COMMIT")

    return res.status(201).json({
      message: "Inventário importado com sucesso",
      inventarioId,
      dataInventario,

      totalLinhasOriginais: rows.length,
      totalLinhasConsolidadas: groupedRows.length,

      totalPosicoes: positionsMap.size,
      totalPosicoesArquivo: uniquePositions.length,
      totalPosicoesImportadas: positionsMap.size,

      diagnostico: {
        primeirasPosicoes: uniquePositions.slice(0, 10),
        ultimasPosicoes: uniquePositions.slice(-10)
      }
    })
  } catch (error) {
    await client.query("ROLLBACK")

    return res.status(500).json({
      error: "Erro ao importar inventário",
      details: error.message
    })
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }

    client.release()
  }
}

async function listInventories(req, res) {
  try {
    const result = await pool.query(
      `SELECT
        id,
        nome,
        cliente,
        deposito,
        data_inicio,
        data_criacao,
        finalizado_em,
        status,
        arquivado
      FROM inventarios
      WHERE data_inicio >= NOW() - INTERVAL '1 year'
      ORDER BY data_inicio DESC, id DESC`
    )

    return res.json(result.rows)
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao listar inventários",
      details: error.message
    })
  }
}

async function finishInventory(req, res) {
  try {
    const { inventarioId } = req.params

    const statusResult = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pendente')::integer AS pendentes,
        COUNT(*) FILTER (WHERE status = 'contando')::integer AS em_andamento,
        COUNT(*) FILTER (WHERE status = 'recontagem')::integer AS recontagem,
        COUNT(*) FILTER (WHERE status = 'finalizado')::integer AS finalizadas,
        COUNT(*)::integer AS total
      FROM posicoes
      WHERE inventario_id = $1
        AND COALESCE(incluida_no_inventario, true) = true`,
      [inventarioId]
    )

    const status = statusResult.rows[0]

    const result = await pool.query(
      `UPDATE inventarios
       SET status = 'finalizado',
           arquivado = true,
           finalizado_em = NOW()
       WHERE id = $1
       RETURNING *`,
      [inventarioId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Inventário não encontrado" })
    }

    const temPendencias =
      Number(status.pendentes) > 0 ||
      Number(status.em_andamento) > 0 ||
      Number(status.recontagem) > 0

    return res.json({
      message: temPendencias
        ? "Inventário finalizado com pendências"
        : "Inventário finalizado sem pendências",
      warning: temPendencias,
      resumoFinalizacao: status,
      inventory: result.rows[0]
    })
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao finalizar inventário",
      details: error.message
    })
  }
}

async function reopenInventory(req, res) {
  try {
    const { inventarioId } = req.params

    const result = await pool.query(
      `UPDATE inventarios
       SET status = 'aberto',
           arquivado = false,
           finalizado_em = NULL
       WHERE id = $1
       RETURNING *`,
      [inventarioId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Inventário não encontrado" })
    }

    return res.json({
      message: "Inventário reaberto com sucesso",
      inventory: result.rows[0]
    })
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao reabrir inventário",
      details: error.message
    })
  }
}

async function deleteInventory(req, res) {
  try {
    const { inventarioId } = req.params

    const result = await pool.query(
      `DELETE FROM inventarios
       WHERE id = $1
       RETURNING id`,
      [inventarioId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Inventário não encontrado" })
    }

    return res.json({ message: "Inventário excluído com sucesso" })
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao excluir inventário",
      details: error.message
    })
  }
}

module.exports = {
  uploadInventory,
  listInventories,
  finishInventory,
  reopenInventory,
  deleteInventory
}