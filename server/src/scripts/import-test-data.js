// 测试邮件数据导入脚本
// 用法: node src/scripts/import-test-data.js [文件路径]
// 默认读取 ../../test_emails.txt

import 'dotenv/config'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getDb, queryOne, run, forceSaveSync } from '../db.js'
import bcrypt from 'bcryptjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseTxt(content) {
  const lines = content.split('\n')
  const influencers = []
  let currentInf = null
  let currentEmail = null
  let emailBodyStarted = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // 跳过注释
    if (trimmed.startsWith('#')) continue

    // 场景分隔符 → 保存当前邮件，开始新达人
    if (trimmed.startsWith('=====')) {
      if (currentEmail && currentEmail.content.trim() && currentInf) {
        currentInf.threads.push(currentEmail)
        currentEmail = null
      }
      // 下一个非空行会是场景标题或达人信息
      emailBodyStarted = false
      continue
    }

    // 达人信息头
    const nameMatch = trimmed.match(/^达人[：:]\s*(.+)/)
    if (nameMatch) {
      if (currentEmail && currentEmail.content.trim() && currentInf) {
        currentInf.threads.push(currentEmail)
      }
      currentInf = {
        name: nameMatch[1].trim(),
        account: '',
        emails: [],
        phase: '初洽',
        phaseHistory: [],
        threads: [],
      }
      influencers.push(currentInf)
      currentEmail = null
      emailBodyStarted = false
      continue
    }

    if (!currentInf) continue

    const accMatch = trimmed.match(/^账号[：:]\s*(.+)/)
    if (accMatch) { currentInf.account = accMatch[1].trim(); continue }

    const emailMatch = trimmed.match(/^邮箱[：:]\s*(.+)/)
    if (emailMatch) { currentInf.emails = [emailMatch[1].trim()]; continue }

    const phaseMatch = trimmed.match(/^当前阶段[：:]\s*(.+)/)
    if (phaseMatch) { currentInf.phase = phaseMatch[1].trim(); continue }

    // 场景标题
    if (trimmed.startsWith('场景') && trimmed.includes('：')) continue

    // 邮件条目开始: "邮件1 - 发件（2026-03-01）"
    const entryMatch = trimmed.match(/^邮件\s*\d+\s*[-–—]\s*(发件|收件)\s*[（(]\s*([\d-]+)\s*[）)]/)
    if (entryMatch) {
      // 保存前一条
      if (currentEmail && currentEmail.content.trim()) {
        currentInf.threads.push(currentEmail)
      }
      currentEmail = {
        direction: entryMatch[1] === '发件' ? 'outbound' : 'inbound',
        date: entryMatch[2].trim(),
        subject: '',
        content: '',
      }
      emailBodyStarted = false
      continue
    }

    if (!currentEmail) continue

    // From/To/Subject 行
    if (/^(From|To|Subject)[：:]\s*/i.test(trimmed)) {
      if (/^Subject[：:]\s*/i.test(trimmed)) {
        currentEmail.subject = trimmed.replace(/^Subject[：:]\s*/i, '').trim()
      }
      emailBodyStarted = true
      continue
    }

    // 邮件分隔符
    if (trimmed === '---') {
      if (currentEmail && currentEmail.content.trim()) {
        currentInf.threads.push(currentEmail)
        currentEmail = null
      }
      emailBodyStarted = false
      continue
    }

    // 空行在 From/To/Subject 之前跳过，之后收集为正文
    if (!emailBodyStarted) continue

    // 空行 → 正文中的换段
    if (trimmed === '') {
      if (currentEmail.content) currentEmail.content += '\n\n'
      continue
    }

    // 正文行
    if (currentEmail.content) {
      currentEmail.content += ' ' + trimmed
    } else {
      currentEmail.content = trimmed
    }
  }

  // 最后一条邮件
  if (currentEmail && currentEmail.content.trim() && currentInf) {
    currentInf.threads.push(currentEmail)
  }

  return influencers
}

async function main() {
  const filePath = process.argv[2] || join(__dirname, '..', '..', '..', 'test_emails.txt')
  console.log('📂 读取文件:', filePath)

  let raw
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (e) {
    console.error('❌ 文件读取失败:', e.message)
    process.exit(1)
  }

  const data = parseTxt(raw)
  console.log('📊 解析出', data.length, '个达人')
  for (const inf of data) {
    console.log('  ' + inf.name + ' (' + inf.phase + ') — ' + inf.threads.length + ' 封邮件')
  }
  console.log('')

  if (data.length === 0) {
    console.error('❌ 未解析到数据')
    process.exit(1)
  }

  const db = await getDb()

  const user = queryOne('SELECT id FROM users LIMIT 1')
  let userId = user?.id
  if (!userId) {
    userId = 'user_1'
    const hash = bcrypt.hashSync('123456', 10)
    run('INSERT OR IGNORE INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [userId, '小李', 'admin@crm.com', hash, '达人运营'])
  }

  // 清理旧测试数据
  run("DELETE FROM timeline_entries WHERE influencer_id LIKE 'inf_test_%'")
  run("DELETE FROM phase_history WHERE influencer_id LIKE 'inf_test_%'")
  run("DELETE FROM influencer_emails WHERE influencer_id LIKE 'inf_test_%'")
  run("DELETE FROM ai_summaries WHERE influencer_id LIKE 'inf_test_%'")
  run("DELETE FROM influencers WHERE id LIKE 'inf_test_%'")
  console.log('🧹 已清理旧测试数据\n')

  let infCount = 0
  let threadCount = 0
  const operatorEmail = 'yishu5990@gmail.com'

  for (const inf of data) {
    const infId = 'inf_test_' + inf.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

    const existing = queryOne('SELECT id FROM influencers WHERE id = ?', [infId])
    if (existing) {
      console.log('⏭ 跳过已存在: ' + inf.name)
      continue
    }

    const lastContact = inf.threads.length > 0
      ? inf.threads[inf.threads.length - 1].date : ''

    run(
      `INSERT INTO influencers (id, user_id, name, account, phase, report_brand, report_note, price, last_contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [infId, userId, inf.name, inf.account, inf.phase, '', '', '待报价', lastContact]
    )

    for (const email of inf.emails) {
      run('INSERT INTO influencer_emails (influencer_id, email) VALUES (?, ?)', [infId, email])
    }

    for (let i = 0; i < inf.threads.length; i++) {
      const t = inf.threads[i]
      const entryId = `em_test_${infId}_${i}_${Date.now()}`
      const primaryEmail = inf.emails[0] || ''

      run(
        `INSERT INTO timeline_entries (id, influencer_id, date, from_email, to_email, subject, content, direction)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [entryId, infId, t.date,
          t.direction === 'inbound' ? primaryEmail : operatorEmail,
          t.direction === 'inbound' ? operatorEmail : primaryEmail,
          t.subject, t.content, t.direction]
      )
      threadCount++
    }

    infCount++
    console.log(`✅ ${inf.name} (${inf.phase}) — ${inf.threads.length} 封邮件`)
  }

  forceSaveSync()
  console.log(`\n🎉 导入完成！新增 ${infCount} 位达人，${threadCount} 封邮件记录`)
}

main().catch(e => {
  console.error('❌ 导入失败:', e)
  process.exit(1)
})
