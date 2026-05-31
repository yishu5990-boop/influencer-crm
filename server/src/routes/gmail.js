import { Router } from 'express'
import { syncEmails, getSyncStatus, discoverContacts, getDiscoverStatus } from '../services/gmail.js'
import { getAuthUrl, exchangeCode, isAuthorized, getStoredToken, saveToken, parseOAuthState } from '../services/oauth.js'
import authMiddleware from '../middleware/auth.js'

const router = Router()

// 获取 Google OAuth 授权 URL（需登录，email 参数可选）
router.get('/auth-url', authMiddleware, async (req, res) => {
  try {
    const email = req.query.email || process.env.GMAIL_EMAIL
    const url = getAuthUrl(req.userId, email)
    res.json({ url })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// OAuth 回调 —— Google 重定向到这里（无需认证）
router.get('/oauth-callback', async (req, res) => {
  const { code, state } = req.query

  if (!code) {
    return res.redirect('https://crm.hys-crm.top/email-settings?oauth=error&msg=' + encodeURIComponent('未收到授权码'))
  }

  try {
    const tokenData = await exchangeCode(code)

    // 从 state 中解析 userId 和 email
    const { userId, email } = parseOAuthState(state)
    const targetEmail = email || process.env.GMAIL_EMAIL

    if (!userId) {
      return res.redirect('https://crm.hys-crm.top/email-settings?oauth=error&msg=' + encodeURIComponent('授权状态无效'))
    }

    // 保存 token（关联到具体 email）
    saveToken(userId, targetEmail, tokenData)

    // 重定向时带上 email 参数，前端可用它触发自动同步
    res.redirect(`https://crm.hys-crm.top/email-settings?oauth=success&email=${encodeURIComponent(targetEmail)}`)
  } catch (e) {
    console.error('[oauth] 回调处理失败:', e.message)
    res.redirect('https://crm.hys-crm.top/email-settings?oauth=error&msg=' + encodeURIComponent(e.message))
  }
})

// 检查 OAuth 授权状态（需登录）
router.get('/auth-status', authMiddleware, async (req, res) => {
  try {
    const email = req.query.email || process.env.GMAIL_EMAIL
    if (!email) return res.json({ authorized: false, email: null })

    const token = getStoredToken(req.userId, email)
    res.json({
      authorized: !!(token && token.refresh_token),
      email,
      hasToken: !!token,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 触发 Gmail 同步（需传入 email 指定要同步的邮箱）
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const email = req.body?.email || process.env.GMAIL_EMAIL
    const result = await syncEmails(req.userId, email)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message || '同步失败' })
  }
})

// 获取同步状态
router.get('/status', (req, res) => {
  res.json(getSyncStatus())
})

// 发现潜在达人（扫描收件箱发现新联系人，需传入 email 指定扫描哪个邮箱）
router.post('/discover', authMiddleware, async (req, res) => {
  try {
    const email = req.body?.email || process.env.GMAIL_EMAIL
    const result = await discoverContacts(req.userId, email)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message || '发现达人失败' })
  }
})

// 获取发现达人状态
router.get('/discover-status', (req, res) => {
  res.json(getDiscoverStatus())
})

export default router
