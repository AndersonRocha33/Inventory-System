const pool = require("../db/db")
const { resolveItemUpToPhase } = require("../services/countResolutionService")

async function listItemsByPosition(req, res) {
  try {
    const { positionId } = req.params

    const result = await pool.query(
      `SELECT id, sku, descricao, lote, validade, encontrado_a_mais
       FROM itens
       WHERE posicao_id = $1
       ORDER BY descricao`,
      [positionId]
    )

    return res.json(result.rows)
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao listar itens da posição",
      details: error.message
    })
  }
}

async function listDivergentItemsByPosition(req, res) {
  try {
    const { positionId } = req.params

    const positionResult = await pool.query(
      `SELECT fase_atual FROM posicoes WHERE id = $1`,
      [positionId]
    )

    if (positionResult.rowCount === 0) {
      return res.status(404).json({ error: "Posição não encontrada" })
    }

    const faseAtual = Number(positionResult.rows[0].fase_atual || 1)
    const faseAnterior = faseAtual - 1

    if (faseAnterior < 1) return res.json([])

    const result = await pool.query(
      `SELECT
        i.id,
        i.sku,
        i.descricao,
        i.lote,
        i.validade,
        i.quantidade_sistema,
        i.encontrado_a_mais,
        (SELECT c.quantidade_contada FROM contagens c WHERE c.item_id = i.id AND c.fase = 1 ORDER BY c.data_contagem DESC, c.id DESC LIMIT 1) AS q1,
        (SELECT c.quantidade_contada FROM contagens c WHERE c.item_id = i.id AND c.fase = 2 ORDER BY c.data_contagem DESC, c.id DESC LIMIT 1) AS q2,
        (SELECT c.quantidade_contada FROM contagens c WHERE c.item_id = i.id AND c.fase = 3 ORDER BY c.data_contagem DESC, c.id DESC LIMIT 1) AS q3
      FROM itens i
      WHERE i.posicao_id = $1`,
      [positionId]
    )

    const divergentes = result.rows.filter((item) => {
      const resolution = resolveItemUpToPhase(item, faseAnterior)
      return !resolution.resolved
    })

    return res.json(divergentes)
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao listar itens divergentes",
      details: error.message
    })
  }
}

async function listSavedItemsByPosition(req, res) {
  try {
    const { positionId } = req.params
    const faseQuery = req.query.fase

    const positionResult = await pool.query(
      `SELECT fase_atual FROM posicoes WHERE id = $1`,
      [positionId]
    )

    if (positionResult.rowCount === 0) {
      return res.status(404).json({ error: "Posição não encontrada" })
    }

    const faseAtual = Number(positionResult.rows[0].fase_atual || 1)
    const fase = faseQuery ? Number(faseQuery) : faseAtual

    const result = await pool.query(
      `SELECT
        i.id,
        i.sku,
        i.descricao,
        i.lote,
        i.validade,
        c.quantidade_contada,
        c.operador,
        c.fase,
        c.data_contagem
      FROM itens i
      JOIN LATERAL (
        SELECT *
        FROM contagens c
        WHERE c.item_id = i.id
          AND c.fase = $2
        ORDER BY c.data_contagem DESC, c.id DESC
        LIMIT 1
      ) c ON true
      WHERE i.posicao_id = $1
      ORDER BY i.descricao`,
      [positionId, fase]
    )

    return res.json(result.rows)
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao listar itens salvos",
      details: error.message
    })
  }
}

async function registerCount(req, res) {
  const client = await pool.connect()

  try {
    const { itemId } = req.params
    const { operador, quantidade, tipo, fase } = req.body || {}

    if (!operador || !operador.trim()) {
      return res.status(400).json({ error: "Operador é obrigatório" })
    }

    if (
      quantidade === undefined ||
      quantidade === null ||
      Number.isNaN(Number(quantidade))
    ) {
      return res.status(400).json({ error: "Quantidade inválida" })
    }

    await client.query("BEGIN")

    const itemResult = await client.query(
      `SELECT
        i.id,
        i.posicao_id,
        p.inventario_id,
        p.fase_atual
       FROM itens i
       JOIN posicoes p ON p.id = i.posicao_id
       WHERE i.id = $1`,
      [itemId]
    )

    if (itemResult.rowCount === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Item não encontrado" })
    }

    const item = itemResult.rows[0]
    const faseAtual = Number(fase || item.fase_atual || 1)

    const previousResult = await client.query(
      `SELECT quantidade_contada
       FROM contagens
       WHERE item_id = $1 AND fase = $2
       ORDER BY data_contagem DESC, id DESC
       LIMIT 1`,
      [item.id, faseAtual]
    )

    const quantidadeAnterior =
      previousResult.rowCount > 0
        ? Number(previousResult.rows[0].quantidade_contada)
        : null

    const result = await client.query(
      `INSERT INTO contagens (
        item_id,
        posicao_id,
        operador,
        quantidade_contada,
        tipo,
        fase,
        atualizado_em
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *`,
      [
        item.id,
        item.posicao_id,
        operador.trim(),
        Number(quantidade),
        tipo || `fase_${faseAtual}`,
        faseAtual
      ]
    )

    await client.query(
      `INSERT INTO auditoria_contagens (
        item_id,
        posicao_id,
        inventario_id,
        operador,
        fase,
        quantidade_anterior,
        quantidade_nova,
        acao
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        item.id,
        item.posicao_id,
        item.inventario_id,
        operador.trim(),
        faseAtual,
        quantidadeAnterior,
        Number(quantidade),
        quantidadeAnterior === null ? "CRIACAO_CONTAGEM" : "ALTERACAO_CONTAGEM"
      ]
    )

    await client.query("COMMIT")

    return res.status(201).json({
      message: "Contagem registrada com sucesso",
      count: result.rows[0]
    })
  } catch (error) {
    await client.query("ROLLBACK")

    return res.status(500).json({
      error: "Erro ao registrar contagem",
      details: error.message
    })
  } finally {
    client.release()
  }
}

async function addExtraItem(req, res) {
  try {
    const { positionId } = req.params
    const { sku, descricao, quantidade, operador } = req.body || {}

    if (!sku || !descricao || quantidade === undefined || quantidade === null) {
      return res.status(400).json({
        error: "sku, descricao e quantidade são obrigatórios"
      })
    }

    const positionResult = await pool.query(
      `SELECT fase_atual FROM posicoes WHERE id = $1`,
      [positionId]
    )

    if (positionResult.rowCount === 0) {
      return res.status(404).json({ error: "Posição não encontrada" })
    }

    const faseAtual = Number(positionResult.rows[0].fase_atual || 1)

    const itemResult = await pool.query(
      `INSERT INTO itens (
        posicao_id,
        sku,
        descricao,
        quantidade_sistema,
        encontrado_a_mais
      ) VALUES ($1, $2, $3, 0, true)
      RETURNING *`,
      [positionId, sku.trim(), descricao.trim()]
    )

    const item = itemResult.rows[0]

    await pool.query(
      `INSERT INTO contagens (
        item_id,
        posicao_id,
        operador,
        quantidade_contada,
        tipo,
        fase,
        atualizado_em
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        item.id,
        positionId,
        operador?.trim() || "Operador não informado",
        Number(quantidade),
        "item_a_mais",
        faseAtual
      ]
    )

    return res.status(201).json({
      message: "Item extra adicionado com sucesso",
      item
    })
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao adicionar item extra",
      details: error.message
    })
  }
}

module.exports = {
  listItemsByPosition,
  listDivergentItemsByPosition,
  listSavedItemsByPosition,
  registerCount,
  addExtraItem
}