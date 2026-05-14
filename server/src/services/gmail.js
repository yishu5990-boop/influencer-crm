import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { getDb, queryAll, queryOne, run, transaction } from '../db.js'
import { startForwardServer } from './proxy-tunnel.js'
import { getValidAccessToken } from './oauth.js'

let imapClient = null
let forwardServer = null
let syncStatus = { running: false, total: 0, new: 0, lastSync: null, error: null }
let syncing = false

export function getSyncStatus() {
  return syncStatus
}

// 连接 IMAP（通过本地转发 → 代理隧道）
// 优先使用 OAuth2 access token，降级使用应用专用密码
async function connect(userId) {
  if (imapClient && imapClient.usable) return imapClient

  const email = process.env.GMAIL_EMAIL
  if (!email) {
    throw new Error('未配置 Gmail 邮箱，请在 server/.env 中设置 GMAIL_EMAIL')
  }

  // 尝试获取 OAuth access token
  let accessToken = null
  if (userId) {
    try {
      accessToken = await getValidAccessToken(userId, email)
      if (accessToken) {
        console.log('[gmail] 使用 OAuth2 认证')
      }
    } catch { /* OAuth 失败，降级到密码 */ }
  }

  // 降级：使用应用专用密码
  const password = process.env.GMAIL_APP_PASSWORD
  if (!accessToken && !password) {
    throw new Error('未配置 Gmail 认证方式，请在 server/.env 中设置 OAth2（推荐）或 GMAIL_APP_PASSWORD')
  }

  if (!accessToken) {
    console.log('[gmail] OAuth 不可用，降级使用应用专用密码')
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
async function syncEmails(userId) {
  // 防止并行同步
  if (syncing) {
    return { running: false, total: 0, new: 0, lastSync: null, error: '同步正在进行中，请稍后再试' }
  }

  syncing = true
  syncStatus = { running: true, total: 0, new: 0, lastSync: null, error: null }

  try {
    const client = await connect(userId)

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

          // 更新达人 last_contact
          run('UPDATE influencers SET last_contact = date(\'now\', \'localtime\'), updated_at = datetime(\'now\', \'localtime\') WHERE id = ?', [entry.influencerId])
        }
        newEmails = toInsert.length
      })
    }

    const now = new Date().toISOString()
    syncStatus = { running: false, total: totalProcessed, new: newEmails, lastSync: now, error: null }

    // 更新邮箱账号同步状态（不在事务内，单独写）
    const gmailEmail = process.env.GMAIL_EMAIL
    if (gmailEmail) {
      const accRow = queryOne("SELECT id FROM email_accounts WHERE email = ? AND user_id = ?", [gmailEmail, userId])
      if (accRow) {
        run(
          "UPDATE email_accounts SET status = 'connected', last_sync = datetime('now', 'localtime'), scanned_count = scanned_count + ? WHERE id = ?",
          [newEmails, accRow.id]
        )
      } else {
        const accId = 'email_acc_' + Date.now()
        run(
          "INSERT INTO email_accounts (id, user_id, email, provider, status, last_sync, scanned_count) VALUES (?, ?, ?, ?, 'connected', datetime('now', 'localtime'), ?)",
          [accId, userId, gmailEmail, 'Gmail', newEmails]
        )
      }
    }

    return syncStatus
  } catch (e) {
    syncStatus = { running: false, total: 0, new: 0, lastSync: null, error: e.message }
    return syncStatus
  } finally {
    syncing = false
  }
}

export { syncEmails, connect, disconnect }
