const pool = require("../db/db")
const { resolveItem } = require("../services/countResolutionService")

async function listItemsByPosition(req, res) {
  try {
    const { positionId } = req.params

    const result = await pool.query(
      `SELECT
        id,
        sku,
        descricao,
        lote,
        validade,
        encontrado_a_mais
      FROM itens
      WHERE posicao_id = $1
      ORDER BY descricao`,
      [positionId]
    )

    return res.json(result.rows)
  } catch (error) {
    console.error(error)
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
      `SELECT fase_atual
       FROM posicoes
       WHERE id = $1`,
      [positionId]
    )

    if (positionResult.rowCount === 0) {
      return res.status(404).json({ error: "Posição não encontrada" })
    }

    const faseAtual = Number(positionResult.rows[0].fase_atual || 1)
    const faseAnterior = faseAtual - 1

    if (faseAnterior < 1) {
      return res.json([])
    }

    const result = await pool.query(
      `SELECT
        i.id,
        i.sku,
        i.descricao,
        i.lote,
        i.validade,
        i.quantidade_sistema,
        i.encontrado_a_mais,
        COALESCE((
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 1
          ORDER BY c.data_contagem DESC
          LIMIT 1
        ), NULL) AS q1,
        COALESCE((
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 2
          ORDER BY c.data_contagem DESC
          LIMIT 1
        ), NULL) AS q2,
        COALESCE((
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 3
          ORDER BY c.data_contagem DESC
          LIMIT 1
        ), NULL) AS q3
      FROM itens i
      WHERE i.posicao_id = $1`,
      [positionId]
    )

    const divergentes = result.rows.filter((item) => {
      const resolution = resolveItem(item, faseAnterior)
      return !resolution.resolved
    })

    return res.json(divergentes)
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao listar itens divergentes",
      details: error.message
    })
  }
}

async function registerCount(req, res) {
  try {
    const { itemId } = req.params
    const { operador, quantidade, tipo } = req.body || {}

    if (!operador || !operador.trim()) {
      return res.status(400).json({ error: "Operador é obrigatório" })
    }

    if (quantidade === undefined || quantidade === null || Number.isNaN(Number(quantidade))) {
      return res.status(400).json({ error: "Quantidade inválida" })
    }

    const itemResult = await pool.query(
      `SELECT
        i.id,
        i.posicao_id,
        p.fase_atual
       FROM itens i
       JOIN posicoes p ON p.id = i.posicao_id
       WHERE i.id = $1`,
      [itemId]
    )

    if (itemResult.rowCount === 0) {
      return res.status(404).json({ error: "Item não encontrado" })
    }

    const item = itemResult.rows[0]
    const faseAtual = Number(item.fase_atual || 1)

    const result = await pool.query(
      `INSERT INTO contagens (
        item_id,
        posicao_id,
        operador,
        quantidade_contada,
        tipo,
        fase
      ) VALUES ($1, $2, $3, $4, $5, $6)
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

    return res.status(201).json({
      message: "Contagem registrada com sucesso",
      count: result.rows[0]
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao registrar contagem",
      details: error.message
    })
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
      `SELECT fase_atual
       FROM posicoes
       WHERE id = $1`,
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
        fase
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
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
    console.error(error)
    return res.status(500).json({
      error: "Erro ao adicionar item extra",
      details: error.message
    })
  }
}

module.exports = {
  listItemsByPosition,
  listDivergentItemsByPosition,
  registerCount,
  addExtraItem
}