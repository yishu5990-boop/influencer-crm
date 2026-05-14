import { Router } from 'express'
import { syncEmails, getSyncStatus } from '../services/gmail.js'
import { getAuthUrl, exchangeCode, isAuthorized, getStoredToken, saveToken } from '../services/oauth.js'
import authMiddleware from '../middleware/auth.js'

const router = Router()

// 获取 Google OAuth 授权 URL（需登录）
router.get('/auth-url', authMiddleware, async (req, res) => {
  try {
    const url = getAuthUrl(req.userId)
    res.json({ url })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// OAuth 回调 —— Google 重定向到这里（无需认证）
router.get('/oauth-callback', async (req, res) => {
  const { code, state: userId } = req.query

  if (!code) {
    return res.redirect('http://localhost:3000/email-settings?oauth=error&msg=' + encodeURIComponent('未收到授权码'))
  }

  try {
    const tokenData = await exchangeCode(code)
    const email = process.env.GMAIL_EMAIL

    if (!email) {
      return res.redirect('http://localhost:3000/email-settings?oauth=error&msg=' + encodeURIComponent('未配置邮箱'))
    }

    // 保存 token
    saveToken(userId, email, tokenData)

    res.redirect('http://localhost:3000/email-settings?oauth=success')
  } catch (e) {
    console.error('[oauth] 回调处理失败:', e.message)
    res.redirect('http://localhost:3000/email-settings?oauth=error&msg=' + encodeURIComponent(e.message))
  }
})

// 检查 OAuth 授权状态（需登录）
router.get('/auth-status', authMiddleware, async (req, res) => {
  try {
    const email = process.env.GMAIL_EMAIL
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

// 触发 Gmail 同步
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const result = await syncEmails(req.userId)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message || '同步失败' })
  }
})

// 获取同步状态
router.get('/status', (req, res) => {
  res.json(getSyncStatus())
})

export default router
