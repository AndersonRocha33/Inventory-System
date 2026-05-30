const express = require("express")
const {
  listPositions,
  listAllPositions,
  updatePositionSelection,
  startCounting,
  finishCounting,
  updatePositionObservation
} = require("../controllers/positionController")

const router = express.Router()

router.get("/:inventarioId/positions", listPositions)
router.get("/:inventarioId/positions/all", listAllPositions)
router.put("/:inventarioId/positions/selection", updatePositionSelection)

router.post("/positions/:positionId/start", startCounting)
router.post("/positions/:positionId/finish", finishCounting)
router.put("/positions/:positionId/observation", updatePositionObservation)

module.exports = router