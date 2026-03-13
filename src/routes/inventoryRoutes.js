const express = require("express")
const multer = require("multer")

const { uploadInventory } = require("../controllers/inventoryController")

const router = express.Router()

const upload = multer({ dest:"uploads/" })

router.post("/upload",upload.single("file"),uploadInventory)

module.exports = router