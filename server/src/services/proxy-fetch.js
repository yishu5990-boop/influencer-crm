// 智能代理 —— 优先直连，失败后走代理
import { ProxyAgent, setGlobalDispatcher } from 'undici'

let proxySetup = false
let proxyAvailable = null

async function checkProxy(proxyUrl) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(proxyUrl, { method: 'HEAD', signal: controller.signal }).catch(() => null)
    clearTimeout(timeout)
    return true // 代理端口可连接即可
  } catch {
    return false
  }
}

export async function ensureProxy() {
  if (proxySetup) return proxyAvailable
  proxySetup = true

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
  if (!proxyUrl) {
    console.log('[proxy] 未配置代理，使用直连')
    proxyAvailable = false
    return false
  }

  // 检测代理是否可用
  const ok = await checkProxy(proxyUrl)
  if (!ok) {
    console.log('[proxy] 代理不可用 (' + proxyUrl + ')，使用直连')
    proxyAvailable = false
    return false
  }

  setGlobalDispatcher(new ProxyAgent({
    uri: proxyUrl,
    proxyTls: { rejectUnauthorized: false },
    requestTls: { rejectUnauthorized: false },
    connectTimeout: 8000,
  }))
  proxyAvailable = true
  console.log('[proxy] 代理已启用: ' + proxyUrl)
  return true
}

// 带超时的 fetch（毫秒）
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}
