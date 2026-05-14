import { Router } from 'express'
import { getDb, queryOne, run } from '../db.js'
import authMiddleware from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

// 获取用户资料
router.get('/profile', async (req, res) => {
  try {
    const db = await getDb()
    const user = queryOne('SELECT id, name, email, role, signature FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: '用户不存在' })
    res.json(user)
  } catch (e) {
    res.status(500).json({ error: '获取资料失败' })
  }
})

// 更新用户资料
router.put('/profile', async (req, res) => {
  try {
    const db = await getDb()
    const { name, role, signature } = req.body
    run(
      'UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), signature = COALESCE(?, signature) WHERE id = ?',
      [name || null, role || null, signature !== undefined ? signature : null, req.userId]
    )
    const user = queryOne('SELECT id, name, email, role, signature FROM users WHERE id = ?', [req.userId])
    res.json(user)
  } catch (e) {
    res.status(500).json({ error: '更新资料失败' })
  }
})

export default router
