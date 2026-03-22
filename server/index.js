import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import AppState from './models/AppState.js'

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT || 5000)
const STATE_KEY = 'main'

app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'demo-vip-anti-backend' })
})

app.get('/api/state', async (_req, res) => {
  try {
    let state = await AppState.findOne({ key: STATE_KEY }).lean()

    if (!state) {
      state = await AppState.create({ key: STATE_KEY })
      state = state.toObject()
    }

    res.json({
      rawMaterials: state.rawMaterials || [],
      manufacturingData: state.manufacturingData || [],
      tradingData: state.tradingData || [],
      wastageData: state.wastageData || [],
      stockUsage: state.stockUsage || [],
      updatedAt: state.updatedAt || null,
    })
  } catch (error) {
    res.status(500).json({ message: 'Failed to load app state', error: error.message })
  }
})

app.put('/api/state', async (req, res) => {
  try {
    const payload = {
      rawMaterials: Array.isArray(req.body.rawMaterials) ? req.body.rawMaterials : [],
      manufacturingData: Array.isArray(req.body.manufacturingData) ? req.body.manufacturingData : [],
      tradingData: Array.isArray(req.body.tradingData) ? req.body.tradingData : [],
      wastageData: Array.isArray(req.body.wastageData) ? req.body.wastageData : [],
      stockUsage: Array.isArray(req.body.stockUsage) ? req.body.stockUsage : [],
    }

    const state = await AppState.findOneAndUpdate(
      { key: STATE_KEY },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean()

    res.json({
      message: 'State saved',
      updatedAt: state.updatedAt,
    })
  } catch (error) {
    res.status(500).json({ message: 'Failed to save app state', error: error.message })
  }
})

async function start() {
  const mongoUri = process.env.MONGODB_URI

  if (!mongoUri) {
    throw new Error('MONGODB_URI is missing in environment variables')
  }

  await mongoose.connect(mongoUri)

  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`)
  })
}

start().catch((error) => {
  console.error('Failed to start backend:', error)
  process.exit(1)
})
