const express = require("express")
const {
  positionReport,
  inventoryReport,
  exportInventoryCSV
} = require("../controllers/reportController")

const router = express.Router()

router.get("/positions/:positionId/report", positionReport)
router.get("/:inventarioId/report", inventoryReport)
router.get("/:inventarioId/export", exportInventoryCSV)

module.exports = router