import { Router } from 'express'
import { getDb, queryAll, queryOne, run } from '../db.js'
import authMiddleware from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

// 获取邮箱账号列表
router.get('/accounts', async (req, res) => {
  try {
    const db = await getDb()
    const accounts = queryAll('SELECT * FROM email_accounts WHERE user_id = ?', [req.userId])
    res.json(accounts)
  } catch (e) {
    res.status(500).json({ error: '获取邮箱列表失败' })
  }
})

// 添加邮箱账号
router.post('/accounts', async (req, res) => {
  try {
    const db = await getDb()
    const { email, provider } = req.body
    if (!email || !provider) {
      return res.status(400).json({ error: '请填写邮箱和服务商' })
    }

    const id = 'email_acc_' + Date.now()
    run(
      'INSERT INTO email_accounts (id, user_id, email, provider) VALUES (?, ?, ?, ?)',
      [id, req.userId, email.trim(), provider]
    )

    const acc = queryOne('SELECT * FROM email_accounts WHERE id = ?', [id])
    res.json(acc)
  } catch (e) {
    res.status(500).json({ error: '添加邮箱失败' })
  }
})

// 更新邮箱账号状态
router.put('/accounts/:id', async (req, res) => {
  try {
    const db = await getDb()
    const { status, lastSync, scannedCount } = req.body

    const now = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-')
    run(
      `UPDATE email_accounts SET status = COALESCE(?, status), last_sync = COALESCE(?, last_sync), scanned_count = COALESCE(?, scanned_count) WHERE id = ? AND user_id = ?`,
      [status || null, lastSync || (status === 'connected' ? now : null), scannedCount || null, req.params.id, req.userId]
    )

    const acc = queryOne('SELECT * FROM email_accounts WHERE id = ?', [req.params.id])
    res.json(acc)
  } catch (e) {
    res.status(500).json({ error: '更新邮箱失败' })
  }
})

// 获取运营邮箱
router.get('/operator', async (req, res) => {
  try {
    const db = await getDb()
    const emails = queryAll('SELECT * FROM operator_emails WHERE user_id = ?', [req.userId])
    res.json(emails.map(e => e.email))
  } catch (e) {
    res.status(500).json({ error: '获取运营邮箱失败' })
  }
})

// 保存运营邮箱
router.put('/operator', async (req, res) => {
  try {
    const db = await getDb()
    const { emails } = req.body
    if (!Array.isArray(emails)) {
      return res.status(400).json({ error: '请提供邮箱列表' })
    }

    run('DELETE FROM operator_emails WHERE user_id = ?', [req.userId])
    for (const email of emails) {
      if (email.includes('@')) {
        run('INSERT INTO operator_emails (user_id, email) VALUES (?, ?)', [req.userId, email.trim()])
      }
    }
    res.json(emails.filter(e => e.includes('@')))
  } catch (e) {
    res.status(500).json({ error: '保存运营邮箱失败' })
  }
})

export default router
