const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://crm.hys-crm.top/api'

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
  demo: () => request('/auth/demo', { method: 'POST' }),
  me: () => request('/auth/me'),
}

// Influencers
export const influencers = {
  list: () => request('/influencers'),
  get: (id) => request(`/influencers/${id}`),
  create: (data) => request('/influencers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/influencers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id) => request(`/influencers/${id}`, { method: 'DELETE' }),
  importBatch: (contacts) => request('/influencers/batch', { method: 'POST', body: JSON.stringify({ contacts }) }),
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
  removeAccount: (id) => request(`/emails/accounts/${id}`, { method: 'DELETE' }),
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
  removeSummary: (infId) => request(`/ai/summary/${infId}`, { method: 'DELETE' }),
}

// User
export const user = {
  profile: () => request('/user/profile'),
  updateProfile: (data) => request('/user/profile', { method: 'PUT', body: JSON.stringify(data) }),
}

// Gmail
export const gmail = {
  sync: (email) => request('/gmail/sync', { method: 'POST', body: JSON.stringify({ email }) }),
  status: () => request('/gmail/status'),
  authUrl: (email) => request(`/gmail/auth-url${email ? '?email=' + encodeURIComponent(email) : ''}`),
  authStatus: (email) => request(`/gmail/auth-status${email ? '?email=' + encodeURIComponent(email) : ''}`),
  discover: (email) => request('/gmail/discover', { method: 'POST', body: JSON.stringify({ email }) }),
  discoverStatus: () => request('/gmail/discover-status'),
}

export { request as default }
