// 数据服务层 —— 调用后端 API（带 localStorage 降级）
import { influencers as infApi, timeline as tlApi, emails as emApi, ai as aiApi, user as userApi, gmail as gmailApi } from './api'

const STORAGE_KEY = 'influencer_crm_data'

// 将 API 返回的 snake_case 字段转为 camelCase（兼容前端旧代码）
function normalizeInfluencer(inf) {
  if (!inf) return inf
  return {
    ...inf,
    lastContact: inf.lastContact || inf.last_contact || '',
    reportBrand: inf.reportBrand || inf.report_brand || '',
    reportNote: inf.reportNote || inf.report_note || '',
    email: inf.email || (inf.emails?.[0] || ''),
  }
}

function normalizeTimelineEntry(entry) {
  if (!entry) return entry
  return {
    ...entry,
    from: entry.from || entry.from_email || '',
    to: entry.to || entry.to_email || '',
    aiSummary: entry.aiSummary || entry.ai_summary || '',
  }
}

// ===== 本地 fallback（API 不可用时使用） =====

function getLocal(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function setLocal(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* ignore */ }
}

function getLegacyData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        influencers: parsed.influencers || [],
        timelines: parsed.timelines || {},
        signature: parsed.signature || '',
        signatureCustom: parsed.signatureCustom || false,
      }
    }
  } catch { /* ignore */ }
  return { influencers: [], timelines: {}, signature: '', signatureCustom: false }
}

// ===== 达人相关（异步，API 优先） =====

export async function getInfluencers(noFallback = false) {
  try {
    const list = await infApi.list()
    return (list || []).map(normalizeInfluencer)
  } catch {
    if (noFallback) throw new Error('无法连接到后端服务，请确认后端已启动')
    return getLegacyData().influencers
  }
}

export async function getInfluencer(id) {
  try {
    const inf = await infApi.get(id)
    return normalizeInfluencer(inf)
  } catch {
    const legacy = getLegacyData()
    return legacy.influencers.find(i => i.id === id) || null
  }
}

export async function updateInfluencer(id, updates) {
  try { return await infApi.update(id, updates) }
  catch {
    // 本地降级
    const data = getLegacyData()
    const idx = data.influencers.findIndex(i => i.id === id)
    if (idx >= 0) data.influencers[idx] = { ...data.influencers[idx], ...updates }
    else data.influencers.push({ id, ...updates })
    setLocal(STORAGE_KEY, { ...data, influencers: data.influencers })
    return data
  }
}

export async function createInfluencer(data) {
  try { return await infApi.create(data) }
  catch {
    const legacy = getLegacyData()
    legacy.influencers.push({ ...data, id: data.id || 'inf_' + Date.now() })
    setLocal(STORAGE_KEY, legacy)
    return data
  }
}

// ===== 时间线相关 =====

export async function getTimeline(infId, noFallback = false) {
  try {
    const list = await tlApi.list(infId)
    return (list || []).map(normalizeTimelineEntry)
  } catch {
    if (noFallback) throw new Error('无法连接到后端服务，请确认后端已启动')
    return getLegacyData().timelines[infId] || []
  }
}

export async function addTimelineEntry(infId, entry) {
  try { return await tlApi.create(infId, entry) }
  catch {
    const data = getLegacyData()
    if (!data.timelines[infId]) data.timelines[infId] = []
    data.timelines[infId].push({ id: 'em_' + Date.now(), ...entry })
    setLocal(STORAGE_KEY, data)
    return data
  }
}

export async function deleteTimelineEntry(infId, entryId) {
  try { return await tlApi.remove(infId, entryId) }
  catch {
    const data = getLegacyData()
    if (data.timelines[infId]) {
      data.timelines[infId] = data.timelines[infId].filter(e => e.id !== entryId)
    }
    setLocal(STORAGE_KEY, data)
    return data
  }
}

// ===== 邮箱相关 =====

export async function getEmailAccounts() {
  try { return await emApi.accounts() }
  catch { return getLocal('influencer_crm_email_accounts') || [] }
}

export async function saveEmailAccounts(accounts) {
  try {
    // 逐个更新（简化处理）
    for (const acc of accounts) {
      await emApi.updateAccount(acc.id, acc)
    }
  } catch {
    setLocal('influencer_crm_email_accounts', accounts)
  }
}

export async function getOperatorEmails() {
  try { return await emApi.getOperator() }
  catch { return [] }
}

export async function saveOperatorEmails(emails) {
  try { await emApi.saveOperator(emails) }
  catch { setLocal('influencer_crm_operator_emails', emails) }
}

// ===== 用户相关 =====

let cachedProfile = null

export async function getUserProfile() {
  try {
    cachedProfile = await userApi.profile()
    return cachedProfile
  } catch {
    return cachedProfile || getLocal('influencer_crm_profile')
  }
}

export async function updateUserProfile(profile) {
  try {
    cachedProfile = await userApi.updateProfile(profile)
    return cachedProfile
  } catch {
    cachedProfile = { ...cachedProfile, ...profile }
    setLocal('influencer_crm_profile', cachedProfile)
    return cachedProfile
  }
}

export async function updateSignature(text, custom = true) {
  try {
    await userApi.updateProfile({ signature: text })
  } catch {
    const data = getLegacyData()
    data.signature = text
    data.signatureCustom = custom
    setLocal(STORAGE_KEY, data)
  }
}

// ===== AI 相关 =====

export async function getAiSummary(infId) {
  try { return await aiApi.getSummary(infId) }
  catch { return getLocal('influencer_crm_ai_summaries')?.[infId] || null }
}

export async function saveAiSummary(infId, summary) {
  try {
    const all = getLocal('influencer_crm_ai_summaries') || {}
    all[infId] = { ...summary, savedAt: new Date().toISOString() }
    setLocal('influencer_crm_ai_summaries', all)
  } catch { /* ignore */ }
}

// ===== Gmail 同步 =====

export async function syncGmail() {
  return await gmailApi.sync()
}

export async function getGmailAuthUrl() {
  return await gmailApi.authUrl()
}

export async function getGmailAuthStatus() {
  return await gmailApi.authStatus()
}

// ===== 获取旧版全量数据（兼容旧代码） =====

export function getData() {
  return getLegacyData()
}
