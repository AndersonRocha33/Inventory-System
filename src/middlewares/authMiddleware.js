const jwt = require("jsonwebtoken")

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader) {
      return res.status(401).json({
        error: "Token não enviado"
      })
    }

    const parts = authHeader.split(" ")

    if (parts.length !== 2) {
      return res.status(401).json({
        error: "Token inválido"
      })
    }

    const [scheme, token] = parts

    if (scheme !== "Bearer") {
      return res.status(401).json({
        error: "Formato do token inválido"
      })
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "inventory_secret_dev"
    )

    req.user = decoded

    return next()
  } catch (error) {
    console.error(error)
    return res.status(401).json({
      error: "Token inválido ou expirado"
    })
  }
}

module.exports = authMiddleware