const express = require("express")
const {
  positionReport,
  inventoryReport,
  exportInventoryCSV,
  inventoryHistoryReport
} = require("../controllers/reportController")

const router = express.Router()

router.get("/positions/:positionId/report", positionReport)
router.get("/:inventarioId/report", inventoryReport)
router.get("/:inventarioId/export", exportInventoryCSV)
router.get("/:inventarioId/history-report", inventoryHistoryReport)

module.exports = router