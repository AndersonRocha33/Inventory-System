require("dotenv").config()

const express = require("express")
const cors = require("cors")

const authRoutes = require("./routes/authRoutes")
const inventoryRoutes = require("./routes/inventoryRoutes")
const positionRoutes = require("./routes/positionRoutes")
const countRoutes = require("./routes/countRoutes")
const reportRoutes = require("./routes/reportRoutes")
const authMiddleware = require("./middlewares/authMiddleware")

const app = express()

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}))

app.use(express.json())

app.use("/auth", authRoutes)

app.use("/inventory", authMiddleware, inventoryRoutes)
app.use("/inventory", authMiddleware, positionRoutes)
app.use("/inventory", authMiddleware, countRoutes)
app.use("/inventory", authMiddleware, reportRoutes)

app.get("/", (req, res) => {
  res.send("Inventory API running")
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})