import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { getDb, queryAll, queryOne, run, transaction } from '../db.js'
import { startForwardServer } from './proxy-tunnel.js'
import { getValidAccessToken } from './oauth.js'

let imapClient = null
let connectedEmail = null
let forwardServer = null
let syncStatus = { running: false, total: 0, new: 0, lastSync: null, error: null }
let syncing = false

let discoverStatus = { running: false, total: 0, scanned: 0, lastDiscover: null, error: null }
let discovering = false

export function getSyncStatus() {
  return syncStatus
}

export function getDiscoverStatus() {
  return discoverStatus
}

// 连接 IMAP（通过本地转发 → 代理隧道）
// 优先使用 OAuth2 access token，降级使用应用专用密码
// email 参数必传，指定要连接哪个邮箱账号
async function connect(userId, email) {
  if (!email) {
    throw new Error('未指定邮箱账号')
  }

  // 如果已连接且是同一个邮箱，直接复用
  if (imapClient && imapClient.usable && connectedEmail === email) return imapClient

  // 不同邮箱：断开旧连接
  if (imapClient && connectedEmail !== email) {
    try { await imapClient.logout() } catch { /* ignore */ }
    imapClient = null
    connectedEmail = null
  }

  // 尝试获取 OAuth access token
  let accessToken = null
  if (userId) {
    try {
      accessToken = await getValidAccessToken(userId, email)
      if (accessToken) {
        console.log('[gmail] 使用 OAuth2 认证: ' + email)
      }
    } catch { /* OAuth 失败，降级到密码 */ }
  }

  // 降级：使用应用专用密码
  // 优先级：数据库 per-account 密码 > .env 全局密码（仅主邮箱）
  let password = null
  if (!accessToken) {
    const accRow = queryOne('SELECT app_password FROM email_accounts WHERE email = ? AND user_id = ?', [email, userId])
    if (accRow?.app_password) {
      password = accRow.app_password
      console.log('[gmail] 使用数据库应用专用密码: ' + email)
    } else if (email === process.env.GMAIL_EMAIL && process.env.GMAIL_APP_PASSWORD) {
      password = process.env.GMAIL_APP_PASSWORD
      console.log('[gmail] 使用 .env 应用专用密码: ' + email)
    }
  }

  if (!accessToken && !password) {
    throw new Error(`邮箱 ${email} 未配置登录凭据，请在邮箱设置中填写应用专用密码或进行 OAuth 授权`)
  }

  if (!accessToken) {
    console.log('[gmail] OAuth 不可用，降级使用应用专用密码: ' + email)
  }

  // 启动本地代理转发
  if (!forwardServer) {
    const result = await startForwardServer('imap.gmail.com', 993)
    forwardServer = result.server
    console.log('[proxy] 本地转发已启动: 127.0.0.1:' + result.localPort + ' -> imap.gmail.com:993')
  }

  const localPort = forwardServer.address().port

  const auth = accessToken
    ? { user: email, accessToken }
    : { user: email, pass: password }

  imapClient = new ImapFlow({
    host: '127.0.0.1',
    port: localPort,
    secure: true,
    auth,
    tls: { servername: 'imap.gmail.com', rejectUnauthorized: false, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' },
    logger: false,
  })

  await imapClient.connect()
  connectedEmail = email
  return imapClient
}

// 断开连接
async function disconnect() {
  if (imapClient) {
    try { await imapClient.logout() } catch { /* ignore */ }
    imapClient = null
  }
  if (forwardServer) {
    try {
      forwardServer.close()
      console.log('[proxy] 本地转发已关闭')
    } catch { /* ignore */ }
    forwardServer = null
  }
}

// 获取所有达人邮箱列表
function getInfluencerEmails() {
  const rows = queryAll('SELECT DISTINCT email FROM influencer_emails')
  return rows.map(r => r.email.toLowerCase())
}

// 获取我们这边的邮箱列表
function getOurEmails() {
  const rows = queryAll('SELECT email FROM operator_emails')
  return rows.length > 0 ? rows.map(r => r.email.toLowerCase()) : ['Work_01@gmail.com', 'Work_02@me.com', 'Brand_Official@outlook.com', 'PR_Team@gmail.com']
}

// 检查邮件是否已在时间线中
function emailExists(messageId) {
  const exists = queryOne('SELECT id FROM timeline_entries WHERE id = ?', [messageId])
  return !!exists
}

// 查找达人 ID（根据邮箱匹配）
function findInfluencerId(email) {
  const lowerEmail = email.toLowerCase()
  const row = queryOne(
    'SELECT influencer_id FROM influencer_emails WHERE LOWER(email) = ?',
    [lowerEmail]
  )
  return row?.influencer_id || null
}

// 主函数：同步邮件
async function syncEmails(userId, email) {
  if (!email) {
    return { running: false, total: 0, new: 0, lastSync: null, error: '未指定邮箱账号' }
  }

  // 防止并行同步
  if (syncing) {
    return { running: false, total: 0, new: 0, lastSync: null, error: '同步正在进行中，请稍后再试' }
  }

  syncing = true
  syncStatus = { running: true, total: 0, new: 0, lastSync: null, error: null }

  try {
    const client = await connect(userId, email)

    const infEmails = getInfluencerEmails()
    const ourEmails = getOurEmails()

    if (infEmails.length === 0) {
      syncStatus = { running: false, total: 0, new: 0, lastSync: new Date().toISOString(), error: '没有达人数据，请先导入种子数据' }
      return syncStatus
    }

    const allSearchEmails = [...infEmails, ...ourEmails]

    const lock = await client.getMailboxLock('[Gmail]/All Mail')
    let totalProcessed = 0
    let newEmails = 0
    // 先在事务外收集数据，再在事务内统一写入
    const toInsert = []

    try {
      // 逐邮箱搜索匹配的邮件，收集序号后去重
      const seqSet = new Set()
      for (const email of allSearchEmails) {
        try {
          const fromSeqs = await client.search({ from: email })
          fromSeqs.forEach(s => seqSet.add(s))
          const toSeqs = await client.search({ to: email })
          toSeqs.forEach(s => seqSet.add(s))
        } catch { /* 单个邮箱搜索失败不影响整体 */ }
      }

      const sequences = Array.from(seqSet).sort((a, b) => a - b)
      if (sequences.length === 0) {
        syncStatus = { running: false, total: 0, new: 0, lastSync: new Date().toISOString(), error: null }
        return syncStatus
      }

      // 拉取匹配的邮件
      for await (const msg of client.fetch(sequences, { source: true, envelope: true })) {
        totalProcessed++
        const messageId = msg.envelope?.messageId
          || msg.source?.toString('utf8')?.match(/Message-ID:\s*<([^>]+)>/i)?.[1]
          || `raw_${Date.now()}_${totalProcessed}`

        if (emailExists(messageId)) continue

        const subject = msg.envelope?.subject || '(无主题)'
        const from = msg.envelope?.from?.[0]?.address || ''
        const to = msg.envelope?.to?.map(t => t.address).join(', ') || ''

        // 用 mailparser 解析原始邮件提取正文
        let textContent = ''
        try {
          const parsed = await simpleParser(msg.source)
          textContent = parsed.text || ''
        } catch { /* 解析失败用空正文 */ }

        // 判断方向：发件人是达人 → inbound；发件人是我们 → outbound
        const fromLower = from.toLowerCase()
        const isFromInfluencer = infEmails.some(e => fromLower === e)
        const direction = isFromInfluencer ? 'inbound' : 'outbound'

        // 找到关联的达人
        let influencerId = null
        if (isFromInfluencer) {
          influencerId = findInfluencerId(from)
        } else {
          // 我方发出的邮件，从收件人中找达人
          for (const t of (msg.envelope?.to || [])) {
            const found = findInfluencerId(t.address)
            if (found) { influencerId = found; break }
          }
        }

        // 如果找不到关联达人，跳过
        if (!influencerId) continue

        const summary = textContent.slice(0, 60).replace(/\n/g, ' ') + (textContent.length > 60 ? '...' : '')
        const date = (msg.envelope?.date || new Date()).toISOString().split('T')[0]

        toInsert.push({ messageId, influencerId, date, from, to, subject, textContent, summary, direction })
      }
    } finally {
      lock.release()
    }

    // 在事务中统一写入所有新邮件
    if (toInsert.length > 0) {
      await transaction(() => {
        for (const entry of toInsert) {
          run(
            `INSERT INTO timeline_entries (id, influencer_id, date, from_email, to_email, subject, content, ai_summary, direction)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [entry.messageId, entry.influencerId, entry.date, entry.from, entry.to, entry.subject, entry.textContent || '(无正文)', entry.summary, entry.direction]
          )
        }
        newEmails = toInsert.length
      })

      // 事务完成后，用真实邮件日期更新 last_contact（取最新一封）
      const updatedIds = [...new Set(toInsert.map(e => e.influencerId))]
      for (const infId of updatedIds) {
        run(
          `UPDATE influencers SET
            last_contact = (SELECT MAX(date) FROM timeline_entries WHERE influencer_id = ?),
            updated_at = datetime('now', 'localtime')
           WHERE id = ?`,
          [infId, infId]
        )
      }
    }

    const now = new Date().toISOString()
    syncStatus = { running: false, total: totalProcessed, new: newEmails, lastSync: now, error: null }

    // 更新邮箱账号同步状态（不在事务内，单独写）
    const accRow = queryOne("SELECT id FROM email_accounts WHERE email = ? AND user_id = ?", [email, userId])
    if (accRow) {
      run(
        "UPDATE email_accounts SET status = 'connected', last_sync = datetime('now', 'localtime'), scanned_count = scanned_count + ? WHERE id = ?",
        [newEmails, accRow.id]
      )
    } else {
      const accId = 'email_acc_' + Date.now()
      run(
        "INSERT INTO email_accounts (id, user_id, email, provider, status, last_sync, scanned_count) VALUES (?, ?, ?, ?, 'connected', datetime('now', 'localtime'), ?)",
        [accId, userId, email, 'Gmail', newEmails]
      )
    }

    return syncStatus
  } catch (e) {
    syncStatus = { running: false, total: 0, new: 0, lastSync: null, error: e.message }
    return syncStatus
  } finally {
    syncing = false
  }
}

// 系统邮件过滤规则
const SYSTEM_PATTERNS = [
  'noreply', 'no-reply', 'notification', 'notifications', 'alert',
  'info@', 'support@', 'hello@', 'team@', 'contact@', 'admin@',
  'newsletter', 'marketing', 'billing', 'accounts-noreply',
  'donotreply', 'mailer-daemon', 'postmaster',
  'github.com', 'facebookmail.com', 'twitter.com', 'linkedin.com',
  'amazon.com', 'paypal.com', 'stripe.com',
]

function isSystemEmail(address) {
  const lower = address.toLowerCase()
  for (const p of SYSTEM_PATTERNS) {
    if (lower.includes(p)) return true
  }
  return false
}

// 达人关键词
const INFLUENCER_KEYWORDS = [
  'collab', '合作', 'sponsor', '赞助', 'brand deal', '品牌合作',
  'influencer', 'creator', '内容', 'content', 'tiktok', 'tiktokshop',
  'media kit', 'rate card', '报价', 'promotion', '推广',
  'ambassador', '代言', 'product review', '测评', '寄样', '样品',
  'paid', 'payment', 'follower', '粉丝', 'subscribe', 'pr',
  'partnership', 'campaign', '营销', '广告', 'affiliate', 'ugc',
]

// 发现潜在达人：扫描收件箱，提取未入库的外部联系人
async function discoverContacts(userId, email) {
  if (!email) {
    return { running: false, total: 0, scanned: 0, lastDiscover: null, error: '未指定邮箱账号' }
  }

  if (discovering) {
    return { running: false, total: 0, scanned: 0, lastDiscover: null, error: '发现达人正在进行中，请稍后再试' }
  }

  discovering = true
  discoverStatus = { running: true, total: 0, scanned: 0, lastDiscover: null, error: null }

  try {
    const client = await connect(userId, email)

    const infEmails = getInfluencerEmails()
    const ourEmails = getOurEmails()
    const knownEmails = new Set([...infEmails, ...ourEmails])

    const lock = await client.getMailboxLock('INBOX')
    let scannedCount = 0
    const contactsMap = new Map()

    try {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      const sequences = await client.search({ since })

      if (sequences.length === 0) {
        discoverStatus = { running: false, total: 0, scanned: 0, lastDiscover: new Date().toISOString(), error: null }
        return discoverStatus
      }

      for await (const msg of client.fetch(sequences, { envelope: true, uid: true })) {
        scannedCount++
        const from = msg.envelope?.from?.[0]
        if (!from?.address) continue

        const address = from.address.toLowerCase()

        if (knownEmails.has(address)) continue
        if (isSystemEmail(address)) continue

        const existing = contactsMap.get(address)
        const subject = msg.envelope?.subject || ''
        contactsMap.set(address, {
          email: address,
          displayName: from.name || address.split('@')[0],
          count: (existing?.count || 0) + 1,
          lastDate: msg.envelope?.date
            ? (msg.envelope.date instanceof Date ? msg.envelope.date.toISOString() : String(msg.envelope.date))
            : null,
          subjects: [...(existing?.subjects || []), subject].slice(0, 10),
        })
      }
    } finally {
      lock.release()
    }

    // 第一轮：主题关键词打分（快速）
    const contacts = Array.from(contactsMap.values()).map(c => {
      const subjectText = c.subjects.join(' ').toLowerCase()
      let keywordScore = 0
      const matchedKeywords = []
      for (const kw of INFLUENCER_KEYWORDS) {
        if (subjectText.includes(kw.toLowerCase())) {
          keywordScore++
          matchedKeywords.push(kw)
        }
      }
      return { ...c, keywordScore, matchedKeywords }
    })

    // 第二部分：主题分数 ≤2 的联系人，拉最新 2 封正文做二次打分
    const borderline = contacts.filter(c => c.keywordScore <= 2).slice(0, 30)
    if (borderline.length > 0) {
      const lock2 = await client.getMailboxLock('INBOX')
      try {
        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        for (const contact of borderline) {
          try {
            const seqs = await client.search({ from: contact.email, since })
            if (seqs.length === 0) continue
            const latestSeqs = seqs.slice(-2)
            for await (const msg of client.fetch(latestSeqs, { source: true })) {
              try {
                const parsed = await simpleParser(msg.source)
                const bodyText = (parsed.text || '').toLowerCase()
                for (const kw of INFLUENCER_KEYWORDS) {
                  const kwLower = kw.toLowerCase()
                  if (bodyText.includes(kwLower) && !contact.matchedKeywords.includes(kw)) {
                    contact.keywordScore++
                    contact.matchedKeywords.push(kw)
                  }
                }
              } catch { /* 解析失败跳过 */ }
            }
          } catch { /* 单联系人搜索失败不影响整体 */ }
        }
      } finally {
        lock2.release()
      }
    }

    contacts.sort((a, b) => b.keywordScore - a.keywordScore || b.count - a.count)
    const top = contacts.slice(0, 100)

    discoverStatus = { running: false, total: top.length, scanned: scannedCount, lastDiscover: new Date().toISOString(), error: null }
    return { contacts: top, total: top.length, scanned: scannedCount }
  } catch (e) {
    discoverStatus = { running: false, total: 0, scanned: 0, lastDiscover: null, error: e.message }
    return discoverStatus
  } finally {
    discovering = false
  }
}

export { syncEmails, connect, disconnect, discoverContacts }
