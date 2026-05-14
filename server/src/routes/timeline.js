import { Router } from 'express'
import { getDb, queryAll, queryOne, run } from '../db.js'
import authMiddleware from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

// 获取某达人的沟通时间线
router.get('/:id/timeline', async (req, res) => {
  try {
    const db = await getDb()
    const inf = queryOne('SELECT id FROM influencers WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!inf) return res.status(404).json({ error: '达人不存在' })

    const timeline = queryAll('SELECT * FROM timeline_entries WHERE influencer_id = ? ORDER BY date', [req.params.id])
    res.json(timeline)
  } catch (e) {
    res.status(500).json({ error: '获取时间线失败' })
  }
})

// 新增沟通记录
router.post('/:id/timeline', async (req, res) => {
  try {
    const db = await getDb()
    const inf = queryOne('SELECT id FROM influencers WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!inf) return res.status(404).json({ error: '达人不存在' })

    const { date, from: fromEmail, to: toEmail, subject, content, aiSummary, direction } = req.body
    if (!subject || !content) {
      return res.status(400).json({ error: '请填写主题和内容' })
    }

    const id = 'em_' + Date.now()
    const summary = aiSummary || content.slice(0, 60) + (content.length > 60 ? '...' : '')
    run(
      `INSERT INTO timeline_entries (id, influencer_id, date, from_email, to_email, subject, content, ai_summary, direction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, date, fromEmail, toEmail, subject.trim(), content.trim(), summary, direction]
    )

    const entry = queryOne('SELECT * FROM timeline_entries WHERE id = ?', [id])
    res.json(entry)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '新增记录失败' })
  }
})

// 删除沟通记录
router.delete('/:id/timeline/:entryId', async (req, res) => {
  try {
    const db = await getDb()
    run('DELETE FROM timeline_entries WHERE id = ? AND influencer_id = ?', [req.params.entryId, req.params.id])
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: '删除记录失败' })
  }
})

export default router
