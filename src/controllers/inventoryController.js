const fs = require("fs")
const pool = require("../db/db")
const { parseCSV } = require("../services/csvService")

async function uploadInventory(req, res) {
  const client = await pool.connect()

  try {
    const file = req.file

    if (!file) {
      return res.status(400).json({ error: "Arquivo não enviado" })
    }

    const rows = await parseCSV(file.path)

    if (!rows.length) {
      return res.status(400).json({ error: "CSV vazio" })
    }

    await client.query("BEGIN")

    const nomeInventario = `Inventário ${new Date().toLocaleString("pt-BR")}`
    const cliente = rows[0].cliente || null
    const deposito = rows[0].deposito || null

    const inventarioResult = await client.query(
      `INSERT INTO inventarios (nome, cliente, deposito)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [nomeInventario, cliente, deposito]
    )

    const inventarioId = inventarioResult.rows[0].id
    const positionsMap = new Map()

    for (const row of rows) {
      const posicaoCodigo = String(row.posicao || "").trim()
      const sku = String(row.sku || "").trim()
      const descricao = String(row.descricao || "").trim()
      const quantidade = Number(row.quantidade || 0)
      const lote = row.lote ? String(row.lote).trim() : null
      const validade = row.validade ? String(row.validade).trim() : null

      if (!posicaoCodigo || !sku || !descricao) {
        continue
      }

      let posicaoId = positionsMap.get(posicaoCodigo)

      if (!posicaoId) {
        const posicaoResult = await client.query(
          `INSERT INTO posicoes (inventario_id, codigo)
           VALUES ($1, $2)
           ON CONFLICT (inventario_id, codigo) DO UPDATE SET codigo = EXCLUDED.codigo
           RETURNING id`,
          [inventarioId, posicaoCodigo]
        )

        posicaoId = posicaoResult.rows[0].id
        positionsMap.set(posicaoCodigo, posicaoId)
      }

      await client.query(
        `INSERT INTO itens (
          posicao_id, sku, descricao, quantidade_sistema, lote, validade
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [posicaoId, sku, descricao, quantidade, lote, validade]
      )
    }

    await client.query("COMMIT")

    return res.status(201).json({
      message: "Inventário importado com sucesso",
      inventarioId,
      totalLinhas: rows.length,
      totalPosicoes: positionsMap.size
    })
  } catch (error) {
    await client.query("ROLLBACK")
    console.error(error)
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

module.exports = { uploadInventory }