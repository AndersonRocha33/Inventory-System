require("dotenv").config()
const express = require("express")
const cors = require("cors")
const inventoryRoutes = require("./routes/inventoryRoutes")
const positionRoutes = require("./routes/positionRoutes")
const countRoutes = require("./routes/countRoutes")
const reportRoutes = require("./routes/reportRoutes")

const app = express()

app.use(cors())
app.use(express.json())

app.use("/inventory", inventoryRoutes)
app.use("/inventory", positionRoutes)
app.use("/inventory", countRoutes)
app.use("/inventory", reportRoutes)

app.get("/", (req, res) => {
  res.send("Inventory API running")
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})