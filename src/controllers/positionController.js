const pool = require("../db/db")

async function listPositions(req, res) {
  try {
    const { inventarioId } = req.params

    const result = await pool.query(
      `SELECT
        id,
        codigo,
        status,
        operador_atual,
        data_inicio,
        data_fim
      FROM posicoes
      WHERE inventario_id = $1
      ORDER BY codigo`,
      [inventarioId]
    )

    return res.json(result.rows)
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao listar posições",
      details: error.message
    })
  }
}

async function startCounting(req, res) {
  try {
    const { positionId } = req.params
    const { operador } = req.body || {}

    if (!operador || !operador.trim()) {
      return res.status(400).json({ error: "Operador é obrigatório" })
    }

    const result = await pool.query(
      `UPDATE posicoes
       SET
         status = 'contando',
         operador_atual = $1,
         data_inicio = NOW()
       WHERE id = $2
         AND status IN ('pendente', 'recontagem')
       RETURNING id, codigo, status, operador_atual, data_inicio`,
      [operador.trim(), positionId]
    )

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: "Posição não disponível para contagem"
      })
    }

    return res.json({
      message: "Contagem iniciada com sucesso",
      position: result.rows[0]
    })
  } catch (error) {
    console.error(error)
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
      `SELECT id, codigo, status, operador_atual
       FROM posicoes
       WHERE id = $1`,
      [positionId]
    )

    if (positionResult.rowCount === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Posição não encontrada" })
    }

    const position = positionResult.rows[0]

    const divergenceResult = await client.query(
      `SELECT
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
      WHERE i.posicao_id = $1`,
      [positionId]
    )

    const divergencias = divergenceResult.rows.filter((item) => {
      const sistema = Number(item.quantidade_sistema || 0)
      const contado = Number(item.quantidade_contada || 0)

      if (item.encontrado_a_mais) return true
      return sistema !== contado
    })

    const novoStatus = divergencias.length > 0 ? "recontagem" : "finalizado"

    const updateResult = await client.query(
      `UPDATE posicoes
       SET
         status = $1,
         data_fim = NOW()
       WHERE id = $2
       RETURNING id, codigo, status, operador_atual, data_inicio, data_fim`,
      [novoStatus, positionId]
    )

    await client.query("COMMIT")

    return res.json({
      message:
        novoStatus === "finalizado"
          ? "Posição finalizada sem divergências"
          : "Posição enviada para recontagem",
      position: updateResult.rows[0],
      totalDivergencias: divergencias.length,
      divergencias
    })
  } catch (error) {
    await client.query("ROLLBACK")
    console.error(error)
    return res.status(500).json({
      error: "Erro ao finalizar contagem",
      details: error.message
    })
  } finally {
    client.release()
  }
}

module.exports = {
  listPositions,
  startCounting,
  finishCounting
}