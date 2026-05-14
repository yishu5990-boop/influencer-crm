import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { existsSync } from 'fs'
import authRoutes from './routes/auth.js'
import influencerRoutes from './routes/influencers.js'
import timelineRoutes from './routes/timeline.js'
import emailRoutes from './routes/emails.js'
import aiRoutes from './routes/ai.js'
import userRoutes from './routes/user.js'
import gmailRoutes from './routes/gmail.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// API 路由
app.use('/api/auth', authRoutes)
app.use('/api/influencers', influencerRoutes)
app.use('/api/influencers', timelineRoutes)
app.use('/api/emails', emailRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/user', userRoutes)
app.use('/api/gmail', gmailRoutes)

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// 生产环境：提供前端静态文件
const frontendDist = path.join(process.cwd(), '..', 'influencer-crm', 'dist')
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendDist, 'index.html'))
    }
  })
  console.log('前端静态文件:', frontendDist)
}

app.listen(PORT, () => {
  console.log(`达人邮件助手已启动: http://localhost:${PORT}`)
})
