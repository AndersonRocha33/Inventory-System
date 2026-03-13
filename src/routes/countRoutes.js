const express = require("express")
const {
  listItemsByPosition,
  listDivergentItemsByPosition,
  registerCount,
  addExtraItem
} = require("../controllers/countController")

const router = express.Router()

router.get("/positions/:positionId/items", listItemsByPosition)
router.get("/positions/:positionId/divergent-items", listDivergentItemsByPosition)
router.post("/items/:itemId/count", registerCount)
router.post("/positions/:positionId/extra-item", addExtraItem)

module.exports = router