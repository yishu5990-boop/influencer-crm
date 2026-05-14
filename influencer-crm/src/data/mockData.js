// 达人合作阶段配置
// 路径: 初洽→谈价格→提报待审核→提报已通过→等待寄样→待确认→合作中→合作完成
//        ↘暂不提报  ↘提报未通过  ↘已搁置
export const PHASES = [
  { key: '初洽', label: '初洽', color: 'blue', bg: 'var(--info-light)', textColor: 'var(--info)' },
  { key: '谈价格', label: '谈价格', color: 'orange', bg: 'var(--warning-light)', textColor: '#d97706' },
  { key: '提报待审核', label: '提报待审核', color: 'orange', bg: 'var(--warning-light)', textColor: '#d97706' },
  { key: '提报已通过', label: '提报已通过', color: 'green', bg: 'var(--success-light)', textColor: '#059669' },
  { key: '等待寄样', label: '等待寄样', color: 'pink', bg: '#fce7f3', textColor: '#be185d' },
  { key: '待确认', label: '待确认', color: 'purple', bg: '#e0e7ff', textColor: '#6366f1' },
  { key: '合作中', label: '合作中', color: 'green', bg: 'var(--success-light)', textColor: '#059669' },
  { key: '合作完成', label: '合作完成', color: 'gray', bg: 'var(--gray-100)', textColor: 'var(--gray-600)' },
  { key: '提报未通过', label: '提报未通过', color: 'red', bg: 'var(--danger-light)', textColor: '#dc2626' },
  { key: '暂不提报', label: '暂不提报', color: 'pink', bg: '#fce7f3', textColor: '#be185d' },
  { key: '已搁置', label: '已搁置', color: 'red', bg: 'var(--danger-light)', textColor: '#dc2626' },
]

export function getPhaseInfo(phase) {
  return PHASES.find((p) => p.key === phase) || { key: phase, label: phase, bg: 'var(--gray-100)', textColor: 'var(--gray-600)' }
}

export const FOLLOWUP_INTERVALS = {
  '初洽': 2,
  '谈价格': 3,
  '提报待审核': 3,
  '提报已通过': 2,
  '等待寄样': 3,
  '待确认': 3,
  '合作中': 7,
}

const TERMINAL_PHASES = ['合作完成', '提报未通过', '暂不提报', '已搁置']

export function calcNeedFollowup(influencers) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return influencers
    .filter((inf) => {
      if (TERMINAL_PHASES.includes(inf.phase)) return false
      const lastContact = inf.lastContact || inf.last_contact
      if (!lastContact) return false
      const daysAgo = Math.floor((today - new Date(lastContact)) / (1000 * 60 * 60 * 24))
      const threshold = FOLLOWUP_INTERVALS[inf.phase] ?? 5
      return daysAgo > threshold
    })
    .map((inf) => {
      const lastContact = inf.lastContact || inf.last_contact
      const daysAgo = Math.floor((today - new Date(lastContact)) / (1000 * 60 * 60 * 24))
      return { influencerId: inf.id, name: inf.name, account: inf.account, phase: inf.phase, lastContact, daysAgo }
    })
    .sort((a, b) => b.daysAgo - a.daysAgo)
}

export function calcTodayReplies(influencers, timelines) {
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  const results = []
  for (const inf of influencers) {
    const entries = timelines[inf.id] || []
    for (const entry of entries) {
      if (entry.direction !== 'inbound') continue
      const d = new Date(entry.date)
      if (d < todayStart) continue

      const diffMs = now - d
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      let timeStr
      if (diffHours < 1) timeStr = '刚刚'
      else if (diffHours < 24) timeStr = `${diffHours}小时前`
      else if (diffDays === 1) timeStr = '昨天'
      else timeStr = `${diffDays}天前`

      results.push({
        influencerId: inf.id,
        name: inf.name,
        account: inf.account,
        avatar: inf.avatar || '',
        summary: entry.aiSummary || entry.ai_summary || entry.subject || '',
        time: timeStr,
        phase: inf.phase,
      })
    }
  }
  return results
}
