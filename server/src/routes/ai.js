import { Router } from 'express'
import { getDb, queryOne, queryAll, run } from '../db.js'
import authMiddleware from '../middleware/auth.js'
import { ensureProxy, fetchWithTimeout } from '../services/proxy-fetch.js'

const router = Router()

router.use(authMiddleware)

// AI 邮件摘要
router.post('/summarize/:influencerId', async (req, res) => {
  try {
    const db = await getDb()
    const inf = queryOne('SELECT id FROM influencers WHERE id = ? AND user_id = ?', [req.params.influencerId, req.userId])
    if (!inf) return res.status(404).json({ error: '达人不存在' })

    const timeline = queryAll('SELECT * FROM timeline_entries WHERE influencer_id = ? ORDER BY date', [req.params.influencerId])
    if (timeline.length === 0) {
      return res.status(400).json({ error: '没有邮件记录可供分析' })
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey || apiKey === 'sk-your-deepseek-api-key') {
      return res.status(400).json({ error: '未配置 DeepSeek API Key' })
    }

    await ensureProxy()

    const emailText = timeline
      .map(e => `${e.direction === 'inbound' ? '达人' : '我'}（${e.date}）：${e.content}`)
      .join('\n\n')

    const prompt = `你是一个海外达人运营助手。以下是我与达人的邮件往来记录：
${emailText}

请分析以上邮件，严格按以下JSON格式输出，不要添加任何额外说明：
{
  "一句话摘要": "",
  "当前合作状态": "",
  "达人报价": "",
  "我方报价": "",
  "是否要求定金": "",
  "当前待处理事项": "",
  "最后动作方": ""
}
（各字段含义：一句话摘要用中文概括最新邮件核心内容30字以内，当前合作状态从"初次接触/初步回复/价格谈判中/等待我方确认/待寄样/待发布/已合作/合作失败"中选择，达人报价和我方报价未提及返回null，是否要求定金返回true或false，当前待处理事项说明下一步需要谁做什么，最后动作方返回"达人"或"我"或null）`

    const response = await fetchWithTimeout('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    }, 60000)

    if (!response.ok) {
      const errText = await response.text()
      return res.status(500).json({ error: `DeepSeek API 请求失败: ${errText}` })
    }

    const data = await response.json()
    const rawText = data.choices[0].message.content
    const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '')
    const match = cleaned.match(/\{[\s\S]*\}/)

    let json
    try {
      json = JSON.parse(match ? match[0] : cleaned)
    } catch {
      return res.status(500).json({ error: 'AI 返回格式异常，请重试', raw: rawText.slice(0, 200) })
    }

    // 持久化
    run(
      'INSERT OR REPLACE INTO ai_summaries (influencer_id, summary_json, saved_at) VALUES (?, ?, datetime(\'now\', \'localtime\'))',
      [req.params.influencerId, JSON.stringify(json)]
    )

    res.json(json)
  } catch (e) {
    console.error('AI 摘要失败:', e)
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'AI 请求超时（60秒），请检查网络或代理设置后重试' })
    }
    res.status(500).json({ error: e.message || 'AI 分析失败' })
  }
})

// AI 阶段建议
router.post('/suggest-phase/:influencerId', async (req, res) => {
  try {
    const db = await getDb()
    const inf = queryOne('SELECT * FROM influencers WHERE id = ? AND user_id = ?', [req.params.influencerId, req.userId])
    if (!inf) return res.status(404).json({ error: '达人不存在' })

    const timeline = queryAll('SELECT * FROM timeline_entries WHERE influencer_id = ? ORDER BY date', [req.params.influencerId])
    if (timeline.length === 0) {
      return res.json({ shouldProgress: false, suggestedPhase: null, reason: '暂无邮件记录', nextAction: '等待与达人开始沟通' })
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey || apiKey === 'sk-your-deepseek-api-key') {
      return res.status(400).json({ error: '未配置 DeepSeek API Key' })
    }

    await ensureProxy()

    const summaries = timeline.map(e => ({
      日期: e.date,
      AI摘要: e.ai_summary || e.subject || '',
      方向: e.direction === 'inbound' ? '达人回复' : '我方发出',
    }))

    const prompt = `你是一个海外达人运营助手，帮助运营人员判断与达人的合作是否应该推进到下一阶段。

【当前信息】
当前合作阶段：${inf.phase}
全部邮件摘要（按时间从早到晚排列）：
${JSON.stringify(summaries, null, 2)}

【你的任务】
根据以上所有邮件摘要，判断当前阶段是否应该推进，并给出建议。

请严格按照以下JSON格式输出，不要添加任何额外说明：

{
  "是否推进": true或false,
  "推进到": "",
  "判断理由": "",
  "建议行动": ""
}

【字段说明】

是否推进：
- true = 当前阶段可以往前推进
- false = 当前阶段还不能推进，存在问题需要先解决

推进到：
- 如果"是否推进"为true，填写下一个阶段名称
- 如果"是否推进"为false，返回null

判断理由：
- 用一句中文说明为什么推进或不推进
- 控制在30字以内

建议行动：
- 用一句中文说明下一步我应该做什么
- 控制在30字以内

【完整阶段路径】

主路径（按顺序推进）：
初洽 → 谈价格 → 提报待审核 → 提报已通过 → 等待寄样 → 待确认 → 合作中 → 合作完成

分支路径：
- 暂不提报：达人同意合作但时机不成熟，暂时搁置
- 提报未通过：主管审核拒绝，达人被拒
- 已搁置：达人暂无合作意愿或报价分歧过大
- 合作失败：双方明确无法达成合作

重新激活路径：
- 暂不提报 → 初洽（时机成熟，重新开始洽谈）
- 已搁置 → 初洽（达人重新表达合作意愿或新机会出现）

【推进规则】

==== 通用规则 ====

1. 时间兜底规则：
   请根据邮件记录中的日期字段计算时间差。
   如果最后一封达人回复的日期距今超过14天，
   且期间我方已发送跟进邮件但达人仍无回复，
   返回"是否推进": false
   判断理由：达人长期未回复，已超过14天
   建议行动：再次发送跟进邮件，确认达人是否仍有合作意向

   注意：如果最后一封邮件是我方发出且达人尚未回复，
   不要等到14天才提示，应在7天后就建议主动跟进。

2. 达人只有客套话（如 thanks / 感谢问候 / nice to meet you）而无实质进展，建议不推进。

3. 达人明确提出定金要求（deposit、upfront payment、50% upfront等），
   无论其他条件是否满足，都必须返回不推进，
   建议行动写"先与达人确认定金政策，再决定是否推进"。

==== 按阶段判断 ====

【初洽】
推进信号（→ 谈价格）：
- 达人对品牌/产品表达了兴趣，愿意继续沟通
- 达人主动询问报价、预算、合作形式
不推进信号：
- 达人只是简单回复问候，无合作意向前兆
- 达人明确表示不感兴趣或品类不匹配

【谈价格】
推进信号（→ 提报待审核）：
- 达人明确接受报价（如：sounds good / that works for me / I accept / 这个价格可以）
- 双方已就价格达成一致，且达人未提出定金要求
不推进信号：
- 达人拒绝报价或坚持更高要求
- 达人的反报价超过我方出价50%以上，视为差距过大，建议标记为已搁置
- 我方已明确表示预算不足无法满足达人要求，应标记为合作失败或已搁置，不建议推进到提报
- 达人要求定金（deposit/upfront payment）且我方尚未明确回应，必须先处理定金问题再考虑推进
- 达人表示需要考虑或稍后回复（如：let me think about it / I'll get back to you），建议不推进，耐心等待或3天后发送跟进邮件

【提报待审核】【提报已通过】
这两个阶段由运营人员手动控制，AI不做推进判断。返回：
{
  "是否推进": null,
  "推进到": null,
  "判断理由": "此阶段由你手动更新，AI不做判断",
  "建议行动": "等待主管审核结果后手动更新状态"
}

【等待寄样】
推进信号（→ 待确认）：
- 达人确认已收到样品，且表示满意、无损坏
- 达人表示样品没问题，可以开始准备内容
不推进信号：
- 达人反馈样品有问题（破损/漏液/品项不对）
- 达人表示还没收到样品或物流卡关
- 达人收到样品但对产品不满意

【待确认】
推进信号（→ 合作中）：
- 达人确认了排期、内容方向或发布计划
- 达人明确表示"准备开始拍摄/创作"
不推进信号：
- 达人还在犹豫排期或内容方向
- 达人提出新的条件（如额外费用、更多样品）

【合作中】
推进信号（→ 合作完成）：
- 达人已发布内容，并提供了发布链接
- 达人确认所有合作内容已产出
- 我方主动确认发布链接有效，内容符合要求
不推进信号：
- 达人正在创作中但尚未完成
- 达人已发布但内容需要修改或重拍
- 达人迟到/跳票，内容未按约定时间发布
- 达人未主动提供发布链接，我方尚未确认内容已发布

【合作完成】
终态，AI不做推进判断。返回：
{
  "是否推进": null,
  "推进到": null,
  "判断理由": "合作已完成，无需阶段推进",
  "建议行动": "可评估合作效果，决定是否开启新一轮合作"
}

【暂不提报】【已搁置】【合作失败】
AI不做自动推进判断，但可以分析邮件信号给出提示：
- 如果达人主动联系、表达重新合作意愿 → "是否推进": null，"建议行动": "达人有回归意向，可考虑手动移到初洽重新洽谈"
- 如果达人仍无音讯 → "是否推进": null，"建议行动": "达人暂无动静，可继续等待或择机发送跟进邮件"

【提报未通过】
AI不做判断。返回：
{
  "是否推进": null,
  "推进到": null,
  "判断理由": "提报已被拒绝，由你决定下一步",
  "建议行动": "可选择重新提报（修改方案后再次提交）或手动移动到暂不提报/已搁置"
}

【示例一：应该推进（谈价格）】

输入：
当前合作阶段：谈价格
邮件摘要：[
  {"日期": "2026-05-01", "AI摘要": "我方出价$400 + 产品样品", "方向": "我方发出"},
  {"日期": "2026-05-03", "AI摘要": "达人回复：接受$400报价，确认合作意向，要求尽快寄样", "方向": "达人回复"}
]

输出：
{
  "是否推进": true,
  "推进到": "提报待审核",
  "判断理由": "达人已明确接受报价，价格谈判完成",
  "建议行动": "价格已谈拢，可将此达人提报给主管审核"
}

【示例二：不应该推进（报价差距过大）】

输入：
当前合作阶段：谈价格
邮件摘要：[
  {"日期": "2026-05-01", "AI摘要": "我方出价$300 + 免费样品", "方向": "我方发出"},
  {"日期": "2026-05-04", "AI摘要": "达人回复：最低$800，不可议价", "方向": "达人回复"},
  {"日期": "2026-05-05", "AI摘要": "我方回复：预算最高$400，无法满足达人要求", "方向": "我方发出"}
]

输出：
{
  "是否推进": false,
  "推进到": null,
  "判断理由": "双方报价差距过大，我方已明确预算不足",
  "建议行动": "建议标记为已搁置或合作失败，等待未来预算充足时再联系"
}

【示例三：不应该推进（达人要求定金）】

输入：
当前合作阶段：谈价格
邮件摘要：[
  {"日期": "2026-05-01", "AI摘要": "我方出价$500 + 免费产品", "方向": "我方发出"},
  {"日期": "2026-05-03", "AI摘要": "达人回复：接受$500，但要求50%定金upfront", "方向": "达人回复"}
]

输出：
{
  "是否推进": false,
  "推进到": null,
  "判断理由": "达人要求50%定金，我方尚未回应此要求",
  "建议行动": "先与达人确认定金政策，再决定是否推进"
}

【示例四：不应该推进（谈价格，达人模糊回复）】

输入：
当前合作阶段：谈价格
邮件摘要：[
  {"日期": "2026-05-01", "AI摘要": "我方出价$400 + 免费样品", "方向": "我方发出"},
  {"日期": "2026-05-03", "AI摘要": "达人回复：需要考虑一下，稍后回复", "方向": "达人回复"}
]

输出：
{
  "是否推进": false,
  "推进到": null,
  "判断理由": "达人表示需要考虑，尚未明确接受或拒绝",
  "建议行动": "耐心等待，3天后可发送跟进邮件询问决定"
}

【示例五：应该推进（等待寄样→待确认）】

输入：
当前合作阶段：等待寄样
邮件摘要：[
  {"日期": "2026-05-02", "AI摘要": "样品已通过DHL寄出，发送追踪号", "方向": "我方发出"},
  {"日期": "2026-05-06", "AI摘要": "达人确认已收到样品，包装完好，对产品质量满意，将开始准备内容", "方向": "达人回复"}
]

输出：
{
  "是否推进": true,
  "推进到": "待确认",
  "判断理由": "达人已收到样品且确认满意",
  "建议行动": "与达人确认排期和内容方向"
}

【示例六：不应该推进（等待寄样，样品有问题）】

输入：
当前合作阶段：等待寄样
邮件摘要：[
  {"日期": "2026-05-02", "AI摘要": "样品已寄出", "方向": "我方发出"},
  {"日期": "2026-05-07", "AI摘要": "达人反馈收到包裹但精华液漏液，要求补发替换品", "方向": "达人回复"}
]

输出：
{
  "是否推进": false,
  "推进到": null,
  "判断理由": "样品破损漏液，达人需要补发",
  "建议行动": "立即安排补发替换品，并向达人道歉"
}

【示例七：达人长期未回复（我方已跟进）】

输入：
当前合作阶段：谈价格
邮件摘要：[
  {"日期": "2026-04-10", "AI摘要": "达人回复：对合作感兴趣，询问更多细节", "方向": "达人回复"},
  {"日期": "2026-04-12", "AI摘要": "我方发送合作详情和报价", "方向": "我方发出"},
  {"日期": "2026-04-20", "AI摘要": "我方发送跟进邮件，询问达人是否有意向", "方向": "我方发出"}
]

输出：
{
  "是否推进": false,
  "推进到": null,
  "判断理由": "达人长期未回复，我方已跟进但无响应",
  "建议行动": "再次发送跟进邮件，确认达人是否仍有合作意向"
}

【示例八：合作中，达人未提供发布链接】

输入：
当前合作阶段：合作中
邮件摘要：[
  {"日期": "2026-05-01", "AI摘要": "达人确认排期，将于5月10日发布内容", "方向": "达人回复"},
  {"日期": "2026-05-12", "AI摘要": "我方询问内容是否已发布，请求提供链接", "方向": "我方发出"}
]

输出：
{
  "是否推进": false,
  "推进到": null,
  "判断理由": "达人尚未提供发布链接，内容是否发布未确认",
  "建议行动": "继续等待达人回复，或再次催促提供发布链接"
}`

    const response = await fetchWithTimeout('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    }, 60000)

    if (!response.ok) {
      const errText = await response.text()
      return res.status(500).json({ error: `DeepSeek API 请求失败: ${errText}` })
    }

    const data = await response.json()
    const rawText = data.choices[0].message.content
    const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '')
    const match = cleaned.match(/\{[\s\S]*\}/)

    let json
    try {
      json = JSON.parse(match ? match[0] : cleaned)
    } catch {
      return res.status(500).json({ error: 'AI 返回格式异常，请重试', raw: rawText.slice(0, 200) })
    }

    res.json({
      shouldProgress: json['是否推进'],
      suggestedPhase: json['推进到'] || null,
      reason: json['判断理由'] || '',
      nextAction: json['建议行动'] || '',
    })
  } catch (e) {
    console.error('AI 阶段建议失败:', e)
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'AI 请求超时（60秒），请检查网络或代理设置后重试' })
    }
    res.status(500).json({ error: e.message || 'AI 分析失败' })
  }
})

// AI 逐条邮件摘要（批量）
router.post('/summarize-entries/:influencerId', async (req, res) => {
  try {
    const db = await getDb()
    const inf = queryOne('SELECT id, name FROM influencers WHERE id = ? AND user_id = ?', [req.params.influencerId, req.userId])
    if (!inf) return res.status(404).json({ error: '达人不存在' })

    const force = req.query.force === 'true'
    const filterClause = force ? '' : ' AND ai_summary_generated = 0'
    const entries = queryAll(
      `SELECT id, direction, subject, content FROM timeline_entries WHERE influencer_id = ?${filterClause} ORDER BY date`,
      [req.params.influencerId]
    )
    if (entries.length === 0) {
      return res.json({ summaries: [], message: force ? '没有邮件记录' : '所有邮件均已有 AI 摘要' })
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey || apiKey === 'sk-your-deepseek-api-key') {
      return res.status(400).json({ error: '未配置 DeepSeek API Key' })
    }

    await ensureProxy()

    const entriesText = entries.map(e => {
      const dirLabel = e.direction === 'inbound' ? '收件（达人发来）' : '发件（我方发出）'
      const content = (e.content || '').slice(0, 500)
      return `[ID: ${e.id}]\n方向: ${dirLabel}\n主题: ${e.subject || '(无)'}\n内容: ${content}`
    }).join('\n\n---\n\n')

    const prompt = `你是一个海外达人运营助手。以下是我与达人「${inf.name}」的邮件往来。请为每封邮件生成一句中文摘要，提炼核心行动或诉求，忽略客套话。

格式规则：
- 达人发来的邮件以「达人回复：」开头
- 我方发出的邮件以「我发送：」开头
- 每条摘要控制在25字以内，不要换行

邮件列表：
${entriesText}

请严格按此JSON格式输出，key是邮件ID，value是摘要：
{"${entries[0].id}": "达人回复：xxx", "${entries.length > 1 ? entries[1].id : entries[0].id}": "我发送：xxx"}
只输出JSON对象，不要添加任何额外文字。`

    const response = await fetchWithTimeout('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    }, 90000)

    if (!response.ok) {
      const errText = await response.text()
      return res.status(500).json({ error: `DeepSeek API 请求失败: ${errText}` })
    }

    const data = await response.json()
    const rawText = data.choices[0].message.content
    const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '')
    const match = cleaned.match(/\{[\s\S]*\}/)

    let summaries
    try {
      summaries = JSON.parse(match ? match[0] : cleaned)
    } catch {
      return res.status(500).json({ error: 'AI 返回格式异常，请重试', raw: rawText.slice(0, 200) })
    }

    // 更新每条 timeline_entry 的 ai_summary 并标记为已生成
    const results = []
    for (const entry of entries) {
      const summary = summaries[entry.id]
      if (summary) {
        run('UPDATE timeline_entries SET ai_summary = ?, ai_summary_generated = 1 WHERE id = ?', [summary, entry.id])
        results.push({ id: entry.id, summary })
      }
    }

    res.json({ summaries: results })
  } catch (e) {
    console.error('逐条摘要失败:', e)
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'AI 请求超时（90秒），请检查网络或代理设置后重试' })
    }
    res.status(500).json({ error: e.message || 'AI 分析失败' })
  }
})

// AI 单条邮件摘要
router.post('/summarize-entry/:entryId', async (req, res) => {
  try {
    const db = await getDb()
    const entry = queryOne(
      `SELECT te.*, inf.user_id FROM timeline_entries te
       JOIN influencers inf ON te.influencer_id = inf.id
       WHERE te.id = ? AND inf.user_id = ?`,
      [req.params.entryId, req.userId]
    )
    if (!entry) return res.status(404).json({ error: '邮件记录不存在' })

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey || apiKey === 'sk-your-deepseek-api-key') {
      return res.status(400).json({ error: '未配置 DeepSeek API Key' })
    }

    await ensureProxy()

    const dirHint = entry.direction === 'inbound' ? '达人回复：' : '我发送：'
    const content = (entry.content || '').slice(0, 500)

    const prompt = `你是一个海外达人运营助手。请为以下单封邮件生成一句中文摘要，提炼核心行动或诉求，忽略客套话。
摘要必须以"${dirHint}"开头，控制在25字以内，不要换行。

主题: ${entry.subject || '(无)'}
内容: ${content}

请只输出摘要文本，不要加引号或任何额外说明。`

    const response = await fetchWithTimeout('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 100,
      }),
    }, 30000)

    if (!response.ok) {
      const errText = await response.text()
      return res.status(500).json({ error: `DeepSeek API 请求失败: ${errText}` })
    }

    const data = await response.json()
    const summary = data.choices[0].message.content.trim()

    run('UPDATE timeline_entries SET ai_summary = ?, ai_summary_generated = 1 WHERE id = ?', [summary, entry.id])

    res.json({ id: entry.id, summary })
  } catch (e) {
    console.error('单条摘要失败:', e)
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'AI 请求超时（30秒），请检查网络或代理设置后重试' })
    }
    res.status(500).json({ error: e.message || 'AI 分析失败' })
  }
})

// 获取已保存的 AI 摘要
router.get('/summary/:influencerId', async (req, res) => {
  try {
    const db = await getDb()
    const row = queryOne('SELECT summary_json, saved_at FROM ai_summaries WHERE influencer_id = ?', [req.params.influencerId])
    if (!row) return res.json(null)
    res.json({ ...JSON.parse(row.summary_json), savedAt: row.saved_at })
  } catch (e) {
    res.status(500).json({ error: '获取摘要失败' })
  }
})

export default router
