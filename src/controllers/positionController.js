const pool = require("../db/db")
const { resolveItemUpToPhase } = require("../services/countResolutionService")

async function listPositions(req, res) {
  try {
    const { inventarioId } = req.params

    const result = await pool.query(
      `SELECT
        id,
        codigo,
        status,
        operador_atual,
        primeiro_operador,
        segundo_operador,
        terceiro_operador,
        fase_atual,
        observacao,
        incluida_no_inventario,
        data_inicio,
        data_fim
      FROM posicoes
      WHERE inventario_id = $1
        AND COALESCE(incluida_no_inventario, true) = true
      ORDER BY codigo`,
      [inventarioId]
    )

    return res.json(result.rows)
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao listar posições",
      details: error.message
    })
  }
}

async function listAllPositions(req, res) {
  try {
    const { inventarioId } = req.params

    const result = await pool.query(
      `SELECT
        id,
        codigo,
        status,
        incluida_no_inventario
      FROM posicoes
      WHERE inventario_id = $1
      ORDER BY codigo`,
      [inventarioId]
    )

    return res.json(result.rows)
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao listar todas as posições",
      details: error.message
    })
  }
}

async function updatePositionSelection(req, res) {
  const client = await pool.connect()

  try {
    const { inventarioId } = req.params
    const { positionIds } = req.body || {}

    if (!Array.isArray(positionIds)) {
      return res.status(400).json({
        error: "positionIds deve ser uma lista"
      })
    }

    await client.query("BEGIN")

    await client.query(
      `UPDATE posicoes
       SET incluida_no_inventario = false
       WHERE inventario_id = $1`,
      [inventarioId]
    )

    if (positionIds.length > 0) {
      await client.query(
        `UPDATE posicoes
         SET incluida_no_inventario = true
         WHERE inventario_id = $1
           AND id = ANY($2::int[])`,
        [inventarioId, positionIds]
      )
    }

    await client.query("COMMIT")

    return res.json({
      message: "Seleção de posições atualizada com sucesso",
      totalSelecionadas: positionIds.length
    })
  } catch (error) {
    await client.query("ROLLBACK")

    return res.status(500).json({
      error: "Erro ao atualizar seleção de posições",
      details: error.message
    })
  } finally {
    client.release()
  }
}

async function startCounting(req, res) {
  try {
    const { positionId } = req.params
    const { operador } = req.body || {}

    if (!operador || !operador.trim()) {
      return res.status(400).json({ error: "Operador é obrigatório" })
    }

    const nomeOperador = operador.trim()

    const positionResult = await pool.query(
      `SELECT
        id,
        codigo,
        status,
        operador_atual,
        primeiro_operador,
        segundo_operador,
        terceiro_operador,
        fase_atual,
        incluida_no_inventario
       FROM posicoes
       WHERE id = $1`,
      [positionId]
    )

    if (positionResult.rowCount === 0) {
      return res.status(404).json({ error: "Posição não encontrada" })
    }

    const position = positionResult.rows[0]

    if (position.incluida_no_inventario === false) {
      return res.status(400).json({
        error: "Esta posição não está incluída neste inventário"
      })
    }

    const faseAtual = Number(position.fase_atual || 1)

    if (
      position.status === "contando" &&
      position.operador_atual &&
      position.operador_atual !== nomeOperador
    ) {
      return res.status(409).json({
        error: `Posição em uso por ${position.operador_atual}`
      })
    }

    let campoOperador = "primeiro_operador"
    if (faseAtual === 2) campoOperador = "segundo_operador"
    if (faseAtual === 3) campoOperador = "terceiro_operador"

    const result = await pool.query(
      `UPDATE posicoes
       SET
         status = 'contando',
         operador_atual = $1,
         data_inicio = COALESCE(data_inicio, NOW()),
         ${campoOperador} = COALESCE(${campoOperador}, $1)
       WHERE id = $2
       RETURNING *`,
      [nomeOperador, positionId]
    )

    return res.json({
      message: "Contagem iniciada com sucesso",
      position: result.rows[0]
    })
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao iniciar contagem",
      details: error.message
    })
  }
}

async function finishCounting(req, res) {
  const client = await pool.connect()

  try {
    const { positionId } = req.params

    await client.query("BEGIN")

    const positionResult = await client.query(
      `SELECT id, fase_atual
       FROM posicoes
       WHERE id = $1`,
      [positionId]
    )

    if (positionResult.rowCount === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Posição não encontrada" })
    }

    const position = positionResult.rows[0]
    const faseAtual = Number(position.fase_atual || 1)

    const itemsResult = await client.query(
      `SELECT
        i.id AS item_id,
        i.sku,
        i.descricao,
        i.quantidade_sistema,
        i.encontrado_a_mais,
        (
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 1
          ORDER BY c.data_contagem DESC, c.id DESC
          LIMIT 1
        ) AS q1,
        (
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 2
          ORDER BY c.data_contagem DESC, c.id DESC
          LIMIT 1
        ) AS q2,
        (
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 3
          ORDER BY c.data_contagem DESC, c.id DESC
          LIMIT 1
        ) AS q3
      FROM itens i
      WHERE i.posicao_id = $1`,
      [positionId]
    )

    const unresolvedItems = []

    for (const item of itemsResult.rows) {
      const resolution = resolveItemUpToPhase(item, faseAtual)

      await client.query(
        `UPDATE itens
         SET
           quantidade_final = $1,
           criterio_fechamento = $2,
           resolvido = $3
         WHERE id = $4`,
        [
          resolution.finalQuantity,
          resolution.criterion,
          resolution.resolved,
          item.item_id
        ]
      )

      if (!resolution.resolved && faseAtual < 3) {
        unresolvedItems.push(item)
      }
    }

    let novoStatus = "finalizado"
    let novaFase = faseAtual

    if (unresolvedItems.length > 0 && faseAtual < 3) {
      novoStatus = "recontagem"
      novaFase = faseAtual + 1
    }

    const updateResult = await client.query(
      `UPDATE posicoes
       SET
         status = $1,
         fase_atual = $2,
         data_fim = NOW(),
         operador_atual = NULL
       WHERE id = $3
       RETURNING *`,
      [novoStatus, novaFase, positionId]
    )

    await client.query("COMMIT")

    return res.json({
      message:
        novoStatus === "recontagem"
          ? "Posição enviada para recontagem"
          : "Posição finalizada",
      position: updateResult.rows[0]
    })
  } catch (error) {
    await client.query("ROLLBACK")

    return res.status(500).json({
      error: "Erro ao finalizar contagem",
      details: error.message
    })
  } finally {
    client.release()
  }
}

async function updatePositionObservation(req, res) {
  try {
    const { positionId } = req.params
    const { observacao } = req.body || {}

    const result = await pool.query(
      `UPDATE posicoes
       SET observacao = $1
       WHERE id = $2
       RETURNING id, codigo, observacao`,
      [observacao || "", positionId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Posição não encontrada" })
    }

    return res.json({
      message: "Observação salva com sucesso",
      position: result.rows[0]
    })
  } catch (error) {
    return res.status(500).json({
      error: "Erro ao salvar observação",
      details: error.message
    })
  }
}

module.exports = {
  listPositions,
  listAllPositions,
  updatePositionSelection,
  startCounting,
  finishCounting,
  updatePositionObservation
}