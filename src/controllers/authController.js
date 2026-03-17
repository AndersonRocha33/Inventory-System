const pool = require("../db/db")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      nome: user.nome,
      email: user.email
    },
    process.env.JWT_SECRET || "inventory_secret_dev",
    { expiresIn: "7d" }
  )
}

async function register(req, res) {
  try {
    const { nome, email, senha } = req.body || {}

    if (!nome || !email || !senha) {
      return res.status(400).json({
        error: "nome, email e senha são obrigatórios"
      })
    }

    const existingUser = await pool.query(
      `SELECT id FROM usuarios WHERE email = $1`,
      [email.trim().toLowerCase()]
    )

    if (existingUser.rowCount > 0) {
      return res.status(409).json({
        error: "Já existe um usuário com este email"
      })
    }

    const senhaHash = await bcrypt.hash(senha, 10)

    const result = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash)
       VALUES ($1, $2, $3)
       RETURNING id, nome, email`,
      [nome.trim(), email.trim().toLowerCase(), senhaHash]
    )

    const user = result.rows[0]
    const token = generateToken(user)

    return res.status(201).json({
      message: "Usuário cadastrado com sucesso",
      user,
      token
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao cadastrar usuário",
      details: error.message
    })
  }
}

async function login(req, res) {
  try {
    const { email, senha } = req.body || {}

    if (!email || !senha) {
      return res.status(400).json({
        error: "email e senha são obrigatórios"
      })
    }

    const result = await pool.query(
      `SELECT id, nome, email, senha_hash
       FROM usuarios
       WHERE email = $1`,
      [email.trim().toLowerCase()]
    )

    if (result.rowCount === 0) {
      return res.status(401).json({
        error: "Email ou senha inválidos"
      })
    }

    const user = result.rows[0]

    const senhaOk = await bcrypt.compare(senha, user.senha_hash)

    if (!senhaOk) {
      return res.status(401).json({
        error: "Email ou senha inválidos"
      })
    }

    const token = generateToken(user)

    return res.json({
      message: "Login realizado com sucesso",
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email
      },
      token
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao fazer login",
      details: error.message
    })
  }
}

async function me(req, res) {
  try {
    return res.json({
      user: req.user
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: "Erro ao obter usuário logado",
      details: error.message
    })
  }
}

module.exports = {
  register,
  login,
  me
}