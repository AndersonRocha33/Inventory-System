const express = require("express")
const multer = require("multer")
const fs = require("fs")
const path = require("path")
const { uploadInventory } = require("../controllers/inventoryController")

const router = express.Router()

const uploadDir = path.resolve("uploads")

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
    cb(null, `${uniqueSuffix}-${file.originalname}`)
  }
})

const upload = multer({ storage })

router.post("/upload", upload.single("file"), uploadInventory)

module.exports = router