const express = require("express")
const {
  positionReport,
  inventoryReport,
  exportInventoryCSV,
  exportInventoryExcel,
  inventoryHistoryReport,
  auditReport
} = require("../controllers/reportController")

const router = express.Router()

router.get("/positions/:positionId/report", positionReport)
router.get("/:inventarioId/report", inventoryReport)
router.get("/:inventarioId/export", exportInventoryCSV)
router.get("/:inventarioId/export-excel", exportInventoryExcel)
router.get("/:inventarioId/history-report", inventoryHistoryReport)
router.get("/:inventarioId/audit", auditReport)

module.exports = router