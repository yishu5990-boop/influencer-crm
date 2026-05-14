const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api'

function getToken() {
  return localStorage.getItem('auth_token')
}

export function setToken(token) {
  localStorage.setItem('auth_token', token)
}

export function clearToken() {
  localStorage.removeItem('auth_token')
}

async function request(path, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 65000)

  try {
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers, signal: controller.signal })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || '请求失败')
    }
    return data
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('请求超时，请检查后端服务是否正常运行')
    }
    console.error('[API]', path, e.message)
    throw e
  } finally {
    clearTimeout(timeout)
  }
}

// Auth
export const auth = {
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name, email, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  me: () => request('/auth/me'),
}

// Influencers
export const influencers = {
  list: () => request('/influencers'),
  get: (id) => request(`/influencers/${id}`),
  create: (data) => request('/influencers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/influencers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
}

// Timeline
export const timeline = {
  list: (infId) => request(`/influencers/${infId}/timeline`),
  create: (infId, data) => request(`/influencers/${infId}/timeline`, { method: 'POST', body: JSON.stringify(data) }),
  remove: (infId, entryId) => request(`/influencers/${infId}/timeline/${entryId}`, { method: 'DELETE' }),
}

// Emails
export const emails = {
  accounts: () => request('/emails/accounts'),
  addAccount: (data) => request('/emails/accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateAccount: (id, data) => request(`/emails/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getOperator: () => request('/emails/operator'),
  saveOperator: (emails) => request('/emails/operator', { method: 'PUT', body: JSON.stringify({ emails }) }),
}

// AI
export const ai = {
  summarize: (infId) => request(`/ai/summarize/${infId}`, { method: 'POST' }),
  suggestPhase: (infId) => request(`/ai/suggest-phase/${infId}`, { method: 'POST' }),
  getSummary: (infId) => request(`/ai/summary/${infId}`),
  summarizeEntries: (infId, force) => request(`/ai/summarize-entries/${infId}${force ? '?force=true' : ''}`, { method: 'POST' }),
  summarizeEntry: (entryId) => request(`/ai/summarize-entry/${entryId}`, { method: 'POST' }),
}

// User
export const user = {
  profile: () => request('/user/profile'),
  updateProfile: (data) => request('/user/profile', { method: 'PUT', body: JSON.stringify(data) }),
}

// Gmail
export const gmail = {
  sync: () => request('/gmail/sync', { method: 'POST' }),
  status: () => request('/gmail/status'),
  authUrl: () => request('/gmail/auth-url'),
  authStatus: () => request('/gmail/auth-status'),
}

export { request as default }
