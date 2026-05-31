import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import bcrypt from 'bcryptjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data.db')

let db = null
let dirty = false
let inTransaction = false
let saveTimer = null

// 自动保存间隔（毫秒）
const SAVE_INTERVAL = 3000

async function getDb() {
  if (db) return db

  const SQL = await initSqlJs()

  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
    // 每次启动都运行迁移，确保新表存在（CREATE TABLE IF NOT EXISTS 是安全的）
    ensureTables()
  } else {
    db = new SQL.Database()
    ensureTables()
    seedData()
    // 首次创建后立即保存
    forceSaveSync()
  }

  startAutoSave()
  registerExitHandlers()

  return db
}

function startAutoSave() {
  if (saveTimer) return
  saveTimer = setInterval(() => {
    if (dirty && !inTransaction) {
      try {
        const data = db.export()
        writeFileSync(DB_PATH, Buffer.from(data))
        dirty = false
      } catch (e) {
        console.error('[db] 自动保存失败:', e.message)
      }
    }
  }, SAVE_INTERVAL)
  // 不允许定时器阻止进程退出
  saveTimer.unref()
}

function registerExitHandlers() {
  const saveAndExit = () => {
    if (dirty && db) {
      try {
        forceSaveSync()
      } catch { /* 尽力保存 */ }
    }
    process.exit()
  }
  // 首次调用时注册，避免重复
  if (process.listeners('beforeExit').length === 0) {
    process.on('SIGINT', saveAndExit)
    process.on('SIGTERM', saveAndExit)
    // beforeExit 在事件循环为空时触发，适合正常退出
    process.on('beforeExit', () => {
      if (dirty && db) {
        try { forceSaveSync() } catch { /* ignore */ }
      }
    })
  }
}

function saveDb() {
  if (!db) return
  dirty = true
}

function forceSaveSync() {
  if (!db) return
  const data = db.export()
  writeFileSync(DB_PATH, Buffer.from(data))
  dirty = false
}

// 事务辅助函数（支持 async callback）
async function transaction(callback) {
  if (!db) throw new Error('数据库未初始化')
  inTransaction = true
  db.run('BEGIN TRANSACTION')
  try {
    const result = await callback()
    db.run('COMMIT')
    forceSaveSync()
    return result
  } catch (e) {
    try { db.run('ROLLBACK') } catch { /* ignore */ }
    throw e
  } finally {
    inTransaction = false
  }
}

function ensureTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT '达人运营',
      signature TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS influencers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      account TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      phase TEXT DEFAULT '初洽',
      report_brand TEXT DEFAULT '',
      report_note TEXT DEFAULT '',
      price TEXT DEFAULT '',
      last_contact TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS influencer_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id TEXT NOT NULL,
      email TEXT NOT NULL,
      FOREIGN KEY (influencer_id) REFERENCES influencers(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS timeline_entries (
      id TEXT PRIMARY KEY,
      influencer_id TEXT NOT NULL,
      date TEXT NOT NULL,
      from_email TEXT NOT NULL,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      ai_summary TEXT DEFAULT '',
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT DEFAULT 'disconnected' CHECK(status IN ('connected', 'disconnected', 'need_reauth')),
      last_sync TEXT DEFAULT '',
      scanned_count INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 迁移：为旧数据库补充 app_password 列
  try { db.run('ALTER TABLE email_accounts ADD COLUMN app_password TEXT DEFAULT \'\'') } catch { /* 列已存在 */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'google',
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expiry TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS operator_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS phase_history (
      id TEXT PRIMARY KEY,
      influencer_id TEXT NOT NULL,
      from_phase TEXT NOT NULL,
      to_phase TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      FOREIGN KEY (influencer_id) REFERENCES influencers(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_summaries (
      influencer_id TEXT PRIMARY KEY,
      summary_json TEXT NOT NULL,
      saved_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id) ON DELETE CASCADE
    )
  `)

  // 迁移：为 timeline_entries 新增 ai_summary_generated 标记字段
  try {
    db.run('ALTER TABLE timeline_entries ADD COLUMN ai_summary_generated INTEGER DEFAULT 0')
  } catch { /* 列已存在则忽略 */ }

  // 回填：已有 AI 格式摘要的条目标记为已生成
  db.run("UPDATE timeline_entries SET ai_summary_generated = 1 WHERE (ai_summary LIKE '达人回复：%' OR ai_summary LIKE '我发送：%') AND ai_summary_generated = 0")
}

function seedData() {
  const userId = 'user_1'
  const hash = bcrypt.hashSync('7AayN6R9LtShXsFb', 10)
  db.run(
    `INSERT OR IGNORE INTO users (id, name, email, password, role, signature) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, '小李', 'admin@crm.com', hash, '达人运营', '今天也是高效的一天 ✨']
  )

  // 测试达人数据
  const testInfluencers = [
    { id: 'inf_test_celia_thompson', name: 'Celia Thompson', account: '@celia_lifestyle', phase: '谈价格', last_contact: '2026-03-05', emails: ['celia.thompson@gmail.com'] },
    { id: 'inf_test_mike_rodriguez', name: 'Mike Rodriguez', account: '@mike_fitness', phase: '谈价格', last_contact: '2026-05-14', emails: ['mike.rod@outlook.com'] },
    { id: 'inf_test_anna_marie', name: 'Anna Marie', account: '@anna_lifestyle', phase: '初洽', last_contact: '2026-03-11', emails: ['anna.m@yahoo.com'] },
    { id: 'inf_test_priya_sharma', name: 'Priya Sharma', account: '@priya_organic', phase: '谈价格', last_contact: '2026-03-10', emails: ['priya.s@gmail.com'] },
    { id: 'inf_test_jake_kitchen', name: 'Jake Kitchen', account: '@jakekitchen', phase: '谈价格', last_contact: '2026-03-14', emails: ['jake.k@gmail.com'] },
    { id: 'inf_test_luna_park', name: 'Luna Park', account: '@luna_kbeauty', phase: '等待寄样', last_contact: '2026-03-21', emails: ['luna.p@naver.com'] },
    { id: 'inf_test_carlos_mendez', name: 'Carlos Mendez', account: '@carlos_fitness', phase: '合作中', last_contact: '2026-04-02', emails: ['carlos.m@hotmail.com'] },
    { id: 'inf_test_siti_nurhaliza', name: 'Siti Nurhaliza', account: '@siti_beauty', phase: '谈价格', last_contact: '2026-02-27', emails: ['siti.n@gmail.com'] },
  ]

  for (const inf of testInfluencers) {
    db.run(
      `INSERT OR IGNORE INTO influencers (id, user_id, name, account, phase, last_contact) VALUES (?, ?, ?, ?, ?, ?)`,
      [inf.id, userId, inf.name, inf.account, inf.phase, inf.last_contact]
    )
    for (const email of inf.emails) {
      db.run('INSERT OR IGNORE INTO influencer_emails (influencer_id, email) VALUES (?, ?)', [inf.id, email])
    }
  }

  // 测试时间线数据
  const testTimelines = {
    inf_test_celia_thompson: [
      { id: 'em_test_celia_0', date: '2026-03-01', from_email: 'yishu5990@gmail.com', to_email: 'celia.thompson@gmail.com', subject: 'Collaboration Opportunity - LIRAN Hair Care', content: "Hi Celia,\n\n I hope this message finds you well! I'm reaching out from LIRAN Hair Care. We love your content and think you'd be a perfect fit for our brand.\n\n We'd love to collaborate on a dedicated TikTok video featuring our new hair serum. Our budget is $350, plus we'll send you a free product bundle worth $150.\n\n Please let us know if you're interested!\n\n Best regards, Sarah\n", ai_summary: '', direction: 'outbound' },
      { id: 'em_test_celia_1', date: '2026-03-03', from_email: 'celia.thompson@gmail.com', to_email: 'yishu5990@gmail.com', subject: 'Re: Collaboration Opportunity - LIRAN Hair Care', content: "Hi Sarah,\n\n Thank you so much for reaching out! I've checked out LIRAN Hair Care and I really love your products.\n\n I'd be happy to collaborate! My standard rate for a dedicated TikTok video is $400, which includes one revision. The product bundle sounds great too.\n\n Looking forward to working together!\n\n Celia\n", ai_summary: '', direction: 'inbound' },
      { id: 'em_test_celia_2', date: '2026-03-04', from_email: 'yishu5990@gmail.com', to_email: 'celia.thompson@gmail.com', subject: 'Re: Collaboration Opportunity - LIRAN Hair Care', content: "Hi Celia,\n\n That sounds great! We're happy to meet your rate of $400 plus the product bundle.\n\n Could you please confirm and we'll get the paperwork started?\n\n Best, Sarah\n", ai_summary: '', direction: 'outbound' },
      { id: 'em_test_celia_3', date: '2026-03-05', from_email: 'celia.thompson@gmail.com', to_email: 'yishu5990@gmail.com', subject: 'Re: Collaboration Opportunity - LIRAN Hair Care', content: "Hi Sarah,\n\n That works for me! I accept the offer. Please send over the collaboration details and I'll get started.\n\n Excited to work with LIRAN!\n\n Celia\n", ai_summary: '', direction: 'inbound' },
    ],
    inf_test_mike_rodriguez: [
      { id: 'em_test_mike_0', date: '2026-03-05', from_email: 'yishu5990@gmail.com', to_email: 'mike.rod@outlook.com', subject: 'Partnership Opportunity - FitPro Supplements', content: "Hi Mike,\n\n We love your fitness content! We'd like to collaborate on a TikTok video for our FitPro protein powder. Our offer is $300 plus free products worth $100.\n\n Let us know if you're interested!\n\n Best, Sarah\n", ai_summary: '我发送：报价$300加产品，邀约合作视频。', direction: 'outbound', ai_summary_generated: 1 },
      { id: 'em_test_mike_1', date: '2026-03-07', from_email: 'mike.rod@outlook.com', to_email: 'yishu5990@gmail.com', subject: 'Re: Partnership Opportunity - FitPro Supplements', content: "Hi Sarah,\n\n Thanks for reaching out. Unfortunately $300 is well below my minimum rate. I charge $800 for a dedicated video and that's not negotiable.\n\n If your budget increases in the future, feel free to reach out again.\n\n Mike\n", ai_summary: '达人回复：最低报价$800，拒绝合作。', direction: 'inbound', ai_summary_generated: 1 },
      { id: 'em_test_mike_2', date: '2026-03-08', from_email: 'yishu5990@gmail.com', to_email: 'mike.rod@outlook.com', subject: 'Re: Partnership Opportunity - FitPro Supplements', content: "Hi Mike,\n\n Thank you for your transparency. We understand. Our maximum budget for this campaign is $400, which unfortunately doesn't meet your minimum.\n\n We hope to work together in the future when budgets allow!\n\n Best, Sarah\n", ai_summary: '我发送：最高预算$400，无法合作。', direction: 'outbound', ai_summary_generated: 1 },
    ],
    inf_test_anna_marie: [
      { id: 'em_test_anna_0', date: '2026-03-10', from_email: 'yishu5990@gmail.com', to_email: 'anna.m@yahoo.com', subject: 'Exciting Collaboration Opportunity!', content: "Hi Anna,\n\n I love your lifestyle content! We'd love to discuss a potential collaboration with our skincare brand.\n\n Would you be open to chatting?\n\n Best, Sarah\n", ai_summary: '', direction: 'outbound' },
      { id: 'em_test_anna_1', date: '2026-03-11', from_email: 'anna.m@yahoo.com', to_email: 'yishu5990@gmail.com', subject: 'Re: Exciting Collaboration Opportunity!', content: "Hi Sarah,\n\n Thank you so much for your kind words! Hope you're having a wonderful week.\n\n Best wishes, Anna\n", ai_summary: '', direction: 'inbound' },
    ],
    inf_test_priya_sharma: [
      { id: 'em_test_priya_0', date: '2026-03-08', from_email: 'yishu5990@gmail.com', to_email: 'priya.s@gmail.com', subject: 'Collaboration - Organic Beauty Brand', content: "Hi Priya,\n\n We'd love to collaborate on a TikTok video for our organic skincare line. Our offer is $500 plus free products.\n\n Looking forward to hearing from you!\n\n Sarah\n", ai_summary: '', direction: 'outbound' },
      { id: 'em_test_priya_1', date: '2026-03-10', from_email: 'priya.s@gmail.com', to_email: 'yishu5990@gmail.com', subject: 'Re: Collaboration - Organic Beauty Brand', content: "Hi Sarah,\n\n Thank you for reaching out! I'd love to collaborate. $500 works for me.\n\n However, I do require a 50% deposit upfront ($250) before I begin creating content. This is my standard policy for all brand collaborations.\n\n Please let me know if this works for you.\n\n Priya\n", ai_summary: '', direction: 'inbound' },
    ],
    inf_test_jake_kitchen: [
      { id: 'em_test_jake_0', date: '2026-03-12', from_email: 'yishu5990@gmail.com', to_email: 'jake.k@gmail.com', subject: 'Kitchen Brand Collaboration', content: "Hi Jake,\n\n We'd love to collaborate with you for our premium cookware brand. We're offering $450 for a dedicated TikTok video.\n\n Interested?\n\n Sarah\n", ai_summary: '', direction: 'outbound' },
      { id: 'em_test_jake_1', date: '2026-03-14', from_email: 'jake.k@gmail.com', to_email: 'yishu5990@gmail.com', subject: 'Re: Kitchen Brand Collaboration', content: "Hi Sarah,\n\n Thanks for reaching out! Let me think about it and I'll get back to you soon.\n\n Jake\n", ai_summary: '', direction: 'inbound' },
    ],
    inf_test_luna_park: [
      { id: 'em_test_luna_0', date: '2026-03-15', from_email: 'yishu5990@gmail.com', to_email: 'luna.p@naver.com', subject: 'Your Sample is on the Way!', content: "Hi Luna,\n\n Great news! We've shipped your skincare sample via DHL. Tracking number: DHL123456789. Expected delivery: March 20.\n\n Please confirm once you receive it!\n\n Best, Sarah\n", ai_summary: '', direction: 'outbound' },
      { id: 'em_test_luna_1', date: '2026-03-21', from_email: 'luna.p@naver.com', to_email: 'yishu5990@gmail.com', subject: 'Re: Your Sample is on the Way!', content: "Hi Sarah,\n\n I received the package today but unfortunately the serum bottle was leaking. The product spilled inside the box and the bottle is only half full now.\n\n I'm a bit disappointed. Could you send a replacement?\n\n Luna\n", ai_summary: '', direction: 'inbound' },
    ],
    inf_test_carlos_mendez: [
      { id: 'em_test_carlos_0', date: '2026-04-01', from_email: 'carlos.m@hotmail.com', to_email: 'yishu5990@gmail.com', subject: 'Video is Live!', content: "Hi Sarah,\n\n I'm excited to let you know that the video is now live on my TikTok! Here's the link: https://tiktok.com/@carlos_fitness/video/123456\n\n The video has already received 50,000 views in the first hour! I used all the talking points we discussed and included the discount code CARLOS20.\n\n Let me know if you need anything else!\n\n Carlos\n", ai_summary: '', direction: 'inbound' },
      { id: 'em_test_carlos_1', date: '2026-04-02', from_email: 'yishu5990@gmail.com', to_email: 'carlos.m@hotmail.com', subject: 'Re: Video is Live!', content: "Hi Carlos,\n\n The video looks amazing! Thank you so much for the great content. The engagement is fantastic.\n\n We've confirmed the video meets all our requirements. Consider this collaboration officially complete!\n\n We'd love to work with you again in the future.\n\n Best, Sarah\n", ai_summary: '', direction: 'outbound' },
    ],
    inf_test_siti_nurhaliza: [
      { id: 'em_test_siti_0', date: '2026-02-20', from_email: 'yishu5990@gmail.com', to_email: 'siti.n@gmail.com', subject: 'Beauty Brand Collaboration Opportunity', content: "Hi Siti,\n\n We'd love to collaborate with you! Our offer is $400 for a TikTok video featuring our new foundation.\n\n Looking forward to hearing from you!\n\n Sarah\n", ai_summary: '', direction: 'outbound' },
      { id: 'em_test_siti_1', date: '2026-02-27', from_email: 'yishu5990@gmail.com', to_email: 'siti.n@gmail.com', subject: 'Following Up - Beauty Brand Collaboration', content: "Hi Siti,\n\n Just following up on my previous email. Are you interested in collaborating?\n\n Best, Sarah\n", ai_summary: '', direction: 'outbound' },
    ],
  }

  for (const [infId, entries] of Object.entries(testTimelines)) {
    for (const e of entries) {
      db.run(
        `INSERT OR IGNORE INTO timeline_entries (id, influencer_id, date, from_email, to_email, subject, content, ai_summary, direction, ai_summary_generated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.id, infId, e.date, e.from_email, e.to_email, e.subject, e.content, e.ai_summary, e.direction, e.ai_summary_generated || 0]
      )
    }
  }

  // 运营邮箱
  db.run('INSERT OR IGNORE INTO operator_emails (user_id, email) VALUES (?, ?)', [userId, 'yishu5990@gmail.com'])

  // Mike Rodriguez 阶段历史
  db.run('INSERT OR IGNORE INTO phase_history (id, influencer_id, from_phase, to_phase, changed_at) VALUES (?, ?, ?, ?, ?)',
    ['ph_test_mike_1', 'inf_test_mike_rodriguez', '谈价格', '已搁置', '2026/05/14 10:52'])
  db.run('INSERT OR IGNORE INTO phase_history (id, influencer_id, from_phase, to_phase, changed_at) VALUES (?, ?, ?, ?, ?)',
    ['ph_test_mike_2', 'inf_test_mike_rodriguez', '已搁置', '谈价格', '2026/05/14 10:53'])

  dirty = true
}

// 执行查询，返回数组
function queryAll(sql, params = []) {
  if (!db) throw new Error('数据库未初始化')
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const results = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params)
  return results[0] || null
}

function run(sql, params = []) {
  if (!db) throw new Error('数据库未初始化')
  db.run(sql, params)
  dirty = true
}

export { getDb, saveDb, forceSaveSync, transaction, queryAll, queryOne, run }
