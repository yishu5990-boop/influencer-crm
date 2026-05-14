import { Router } from 'express'
import { getDb, queryAll, queryOne, run } from '../db.js'
import authMiddleware from '../middleware/auth.js'

const router = Router()

// 所有路由都需要登录
router.use(authMiddleware)

// 获取达人列表
router.get('/', async (req, res) => {
  try {
    const db = await getDb()
    const influencers = queryAll('SELECT * FROM influencers WHERE user_id = ? ORDER BY updated_at DESC', [req.userId])

    if (influencers.length === 0) return res.json([])

    // 批量查询 emails 和 phase_history（避免 N+1）
    const ids = influencers.map(i => i.id)
    const placeholders = ids.map(() => '?').join(',')

    const allEmails = queryAll(
      `SELECT influencer_id, email FROM influencer_emails WHERE influencer_id IN (${placeholders})`,
      ids
    )
    const allPhases = queryAll(
      `SELECT * FROM phase_history WHERE influencer_id IN (${placeholders}) ORDER BY changed_at`,
      ids
    )

    // 组装
    const emailMap = {}
    for (const e of allEmails) {
      if (!emailMap[e.influencer_id]) emailMap[e.influencer_id] = []
      emailMap[e.influencer_id].push(e.email)
    }
    const phaseMap = {}
    for (const p of allPhases) {
      if (!phaseMap[p.influencer_id]) phaseMap[p.influencer_id] = []
      phaseMap[p.influencer_id].push({ id: p.id, time: p.changed_at, from: p.from_phase, to: p.to_phase })
    }

    for (const inf of influencers) {
      inf.emails = emailMap[inf.id] || []
      inf.phaseHistory = phaseMap[inf.id] || []
    }

    res.json(influencers)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '获取达人列表失败' })
  }
})

// 获取单个达人
router.get('/:id', async (req, res) => {
  try {
    const db = await getDb()
    const inf = queryOne('SELECT * FROM influencers WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!inf) return res.status(404).json({ error: '达人不存在' })
    inf.emails = queryAll('SELECT email FROM influencer_emails WHERE influencer_id = ?', [inf.id]).map(e => e.email)
    inf.phaseHistory = queryAll('SELECT * FROM phase_history WHERE influencer_id = ? ORDER BY changed_at', [inf.id])
    inf.phaseHistory = inf.phaseHistory.map(h => ({ id: h.id, time: h.changed_at, from: h.from_phase, to: h.to_phase }))
    res.json(inf)
  } catch (e) {
    res.status(500).json({ error: '获取达人详情失败' })
  }
})

// 新增达人
router.post('/', async (req, res) => {
  try {
    const db = await getDb()
    const { name, account, email, phase } = req.body
    if (!name || !account || !email) {
      return res.status(400).json({ error: '请填写达人名称、账号和邮箱' })
    }

    const id = 'inf_' + Date.now()
    const today = new Date().toISOString().split('T')[0]

    run(
      `INSERT INTO influencers (id, user_id, name, account, phase, last_contact) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.userId, name.trim(), account.trim(), phase || '初洽', today]
    )
    run('INSERT INTO influencer_emails (influencer_id, email) VALUES (?, ?)', [id, email.trim()])

    const inf = queryOne('SELECT * FROM influencers WHERE id = ?', [id])
    inf.emails = [email.trim()]
    inf.phaseHistory = []
    res.json(inf)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '新增达人失败' })
  }
})

// 更新达人
router.put('/:id', async (req, res) => {
  try {
    const db = await getDb()
    const inf = queryOne('SELECT * FROM influencers WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!inf) return res.status(404).json({ error: '达人不存在' })

    const { name, account, phase, reportBrand, reportNote, price, emails } = req.body

    // 阶段变更记录历史
    if (phase && phase !== inf.phase) {
      const historyId = 'ph_' + Date.now()
      const now = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      run(
        'INSERT INTO phase_history (id, influencer_id, from_phase, to_phase, changed_at) VALUES (?, ?, ?, ?, ?)',
        [historyId, inf.id, inf.phase, phase, now]
      )
    }

    // 统一使用 !== undefined 判断，允许空字符串清空字段
    const coalesce = (val) => val !== undefined ? val : null

    const today = new Date().toISOString().split('T')[0]
    run(
      `UPDATE influencers SET
        name = COALESCE(?, name),
        account = COALESCE(?, account),
        phase = COALESCE(?, phase),
        report_brand = COALESCE(?, report_brand),
        report_note = COALESCE(?, report_note),
        price = COALESCE(?, price),
        last_contact = ?,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?`,
      [
        coalesce(name), coalesce(account), coalesce(phase),
        coalesce(reportBrand), coalesce(reportNote), coalesce(price),
        today, inf.id
      ]
    )

    // 更新邮箱列表
    if (emails && Array.isArray(emails)) {
      run('DELETE FROM influencer_emails WHERE influencer_id = ?', [inf.id])
      for (const email of emails) {
        run('INSERT INTO influencer_emails (influencer_id, email) VALUES (?, ?)', [inf.id, email])
      }
    }

    const updated = queryOne('SELECT * FROM influencers WHERE id = ?', [inf.id])
    updated.emails = queryAll('SELECT email FROM influencer_emails WHERE influencer_id = ?', [inf.id]).map(e => e.email)
    updated.phaseHistory = queryAll('SELECT * FROM phase_history WHERE influencer_id = ? ORDER BY changed_at', [inf.id])
    updated.phaseHistory = updated.phaseHistory.map(h => ({ id: h.id, time: h.changed_at, from: h.from_phase, to: h.to_phase }))
    res.json(updated)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '更新达人失败' })
  }
})

export default router
