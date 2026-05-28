const express = require("express")
const {
  listPositions,
  startCounting,
  finishCounting,
  updatePositionObservation
} = require("../controllers/positionController")

const router = express.Router()

router.get("/:inventarioId/positions", listPositions)
router.post("/positions/:positionId/start", startCounting)
router.post("/positions/:positionId/finish", finishCounting)
router.patch("/positions/:positionId/observation", updatePositionObservation)

module.exports = router