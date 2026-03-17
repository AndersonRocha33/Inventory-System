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

    const nomeOperador = operador.trim()

    const positionResult = await pool.query(
      `SELECT
         id,
         codigo,
         status,
         operador_atual,
         fase_atual
       FROM posicoes
       WHERE id = $1`,
      [positionId]
    )

    if (positionResult.rowCount === 0) {
      return res.status(404).json({ error: "Posição não encontrada" })
    }

    const position = positionResult.rows[0]
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
         AND status IN ('pendente', 'recontagem', 'contando')
       RETURNING
         id,
         codigo,
         status,
         operador_atual,
         primeiro_operador,
         segundo_operador,
         terceiro_operador,
         fase_atual,
         data_inicio`,
      [nomeOperador, positionId]
    )

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
      `SELECT
        id,
        codigo,
        status,
        operador_atual,
        fase_atual,
        primeiro_operador,
        segundo_operador,
        terceiro_operador
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
        COALESCE((
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 1
          ORDER BY c.data_contagem DESC, c.id DESC
          LIMIT 1
        ), NULL) AS q1,
        COALESCE((
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 2
          ORDER BY c.data_contagem DESC, c.id DESC
          LIMIT 1
        ), NULL) AS q2,
        COALESCE((
          SELECT c.quantidade_contada
          FROM contagens c
          WHERE c.item_id = i.id AND c.fase = 3
          ORDER BY c.data_contagem DESC, c.id DESC
          LIMIT 1
        ), NULL) AS q3
      FROM itens i
      WHERE i.posicao_id = $1`,
      [positionId]
    )

    const unresolvedItems = []
    const analyzedItems = []

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

      const analyzedItem = {
        ...item,
        resolution
      }

      analyzedItems.push(analyzedItem)

      if (!resolution.resolved && faseAtual < 3) {
        unresolvedItems.push(analyzedItem)
      }
    }

    let novoStatus = "finalizado"
    let novaFase = faseAtual

    if (unresolvedItems.length > 0 && faseAtual < 3) {
      novoStatus = "recontagem"
      novaFase = faseAtual + 1
    } else {
      novoStatus = "finalizado"
      novaFase = faseAtual
    }

    const updateResult = await client.query(
      `UPDATE posicoes
       SET
         status = $1,
         fase_atual = $2,
         data_fim = NOW(),
         operador_atual = NULL
       WHERE id = $3
       RETURNING
         id,
         codigo,
         status,
         operador_atual,
         primeiro_operador,
         segundo_operador,
         terceiro_operador,
         fase_atual,
         data_inicio,
         data_fim`,
      [novoStatus, novaFase, positionId]
    )

    await client.query("COMMIT")

    let message = "Posição finalizada sem divergências"

    if (unresolvedItems.length > 0 && faseAtual === 1) {
      message = "Posição enviada para primeira recontagem"
    } else if (unresolvedItems.length > 0 && faseAtual === 2) {
      message = "Posição enviada para segunda recontagem"
    } else if (faseAtual === 3) {
      const pendenciasFinais = analyzedItems.filter((item) => !item.resolution.resolved)
      if (pendenciasFinais.length > 0) {
        message = "Posição finalizada após terceira contagem, mas ainda sem consenso em alguns itens"
      } else {
        message = "Posição finalizada após terceira contagem"
      }
    }

    return res.json({
      message,
      position: updateResult.rows[0],
      faseAnalisada: faseAtual,
      totalPendentesParaNovaRecontagem: unresolvedItems.length,
      pendentesParaNovaRecontagem: unresolvedItems
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