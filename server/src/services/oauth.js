import { getDb, queryOne, run } from '../db.js'
import { ensureProxy } from './proxy-fetch.js'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://mail.google.com/'

// 生成 Google OAuth 授权 URL
// email 参数可选：如果不传则使用 process.env.GMAIL_EMAIL（兼容旧版）
export function getAuthUrl(userId, email) {
  if (!CLIENT_ID || !REDIRECT_URI) {
    throw new Error('未配置 Google OAuth 凭据')
  }

  // state 编码 userId 和 email（用 ::: 分隔），回调时用于保存 token
  const state = `${userId}:::${email || ''}`

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',        // 获取 refresh_token
    prompt: 'consent',             // 强制每次显示同意画面（确保拿到 refresh_token）
    state,                         // 回调时带回 userId + email
  })

  return `${AUTH_URL}?${params.toString()}`
}

// 解析 OAuth state 参数，返回 { userId, email }
export function parseOAuthState(state) {
  if (!state) return { userId: null, email: null }
  const parts = state.split(':::')
  return {
    userId: parts[0] || null,
    email: parts[1] || null,
  }
}

// 用授权码换取 token
export async function exchangeCode(code) {
  ensureProxy()
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code,
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error_description || data.error || '换取 token 失败')
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiry: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
  }
}

// 用 refresh_token 刷新 access_token
export async function refreshAccessToken(refreshToken) {
  ensureProxy()
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error_description || data.error || '刷新 token 失败')
  }

  return {
    accessToken: data.access_token,
    expiry: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
  }
}

// 从数据库获取已保存的 token
export function getStoredToken(userId, email) {
  return queryOne(
    'SELECT * FROM oauth_tokens WHERE user_id = ? AND email = ? AND provider = ?',
    [userId, email, 'google']
  )
}

// 保存或更新 token
export function saveToken(userId, email, tokenData) {
  const existing = getStoredToken(userId, email)
  if (existing) {
    run(
      `UPDATE oauth_tokens SET
        access_token = ?, refresh_token = COALESCE(?, refresh_token),
        token_expiry = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?`,
      [
        tokenData.accessToken,
        tokenData.refreshToken || null,
        tokenData.expiry,
        existing.id,
      ]
    )
  } else {
    const id = 'oat_' + Date.now()
    run(
      `INSERT INTO oauth_tokens (id, user_id, email, provider, access_token, refresh_token, token_expiry)
       VALUES (?, ?, ?, 'google', ?, ?, ?)`,
      [id, userId, email, tokenData.accessToken, tokenData.refreshToken || null, tokenData.expiry]
    )
  }
}

// 获取有效的 access_token（过期则自动刷新）
export async function getValidAccessToken(userId, email) {
  const stored = getStoredToken(userId, email)
  if (!stored) return null

  // 未过期直接返回
  if (stored.token_expiry && new Date(stored.token_expiry) > new Date(Date.now() + 60000)) {
    return stored.access_token
  }

  // 过期则刷新
  if (!stored.refresh_token) return null

  try {
    const refreshed = await refreshAccessToken(stored.refresh_token)
    saveToken(userId, email, refreshed)
    return refreshed.accessToken
  } catch (e) {
    console.error('[oauth] token 刷新失败:', e.message)
    return null
  }
}

// 检查是否已授权
export function isAuthorized(userId, email) {
  const stored = getStoredToken(userId, email)
  return !!(stored && stored.refresh_token)
}
