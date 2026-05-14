import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { getDb, queryOne, run } from '../db.js'
import authMiddleware from '../middleware/auth.js'

const router = Router()

// 注册
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body
    if (!name || !email || !password) {
      return res.status(400).json({ error: '请填写名字、邮箱和密码' })
    }

    const db = await getDb()
    const existing = queryOne('SELECT id FROM users WHERE email = ?', [email])
    if (existing) {
      return res.status(400).json({ error: '该邮箱已注册' })
    }

    const id = 'user_' + Date.now()
    const hash = await bcrypt.hash(password, 10)
    run(
      'INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [id, name, email, hash, '达人运营']
    )

    const token = jwt.sign({ userId: id }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: { id, name, email, role: '达人运营', signature: '' } })
  } catch (e) {
    console.error('注册失败:', e)
    res.status(500).json({ error: '注册失败' })
  }
})

// 登录
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: '请输入邮箱和密码' })
    }

    const db = await getDb()
    const user = queryOne('SELECT * FROM users WHERE email = ?', [email])
    if (!user) {
      return res.status(400).json({ error: '邮箱未注册' })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(400).json({ error: '密码错误' })
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        signature: user.signature,
      },
    })
  } catch (e) {
    console.error('登录失败:', e)
    res.status(500).json({ error: '登录失败' })
  }
})

// 获取当前用户信息
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const db = await getDb()
    const user = queryOne('SELECT id, name, email, role, signature FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: '用户不存在' })
    res.json(user)
  } catch (e) {
    res.status(500).json({ error: '获取用户信息失败' })
  }
})

export default router
