import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import SearchBar from '../components/SearchBar'
import { getPhaseInfo } from '../data/mockData'
import { getInfluencers, getTimeline, getUserProfile } from '../utils/storage'

const FOLLOWUP_INTERVALS = {
  '初洽': 2,
  '谈价格': 3,
  '提报待审核': 3,
  '提报已通过': 2,
  '等待寄样': 3,
  '待确认': 3,
  '合作中': 7,
}
const TERMINAL_PHASES = ['合作完成', '提报未通过', '暂不提报', '已搁置']

function getFollowupReason(phase, daysAgo) {
  const urgent = daysAgo >= 7 ? '，已超7天需优先处理' : ''
  const map = {
    '初洽': `达人已回复，需尽快推进沟通${urgent}`,
    '谈价格': `等待达人确认报价或回复${urgent}`,
    '提报待审核': `等待主管审核反馈${urgent}`,
    '提报已通过': `审核已通过，需推进寄样或下一步${urgent}`,
    '等待寄样': `等待样品寄出或达人确认收货${urgent}`,
    '待确认': `等待达人确认收到样品并排期${urgent}`,
    '合作中': `合作进行中，关注内容进度和发布${urgent}`,
    '合作完成': `确认合作收尾，评估是否再次合作`,
    '提报未通过': `提报被拒，需决定重新提报或放弃`,
    '暂不提报': `暂缓提报，关注时机重新评估`,
    '已搁置': `达人暂无合作意愿，可择机重新接触${urgent}`,
  }
  return map[phase] || `阶段为「${phase}」${urgent}`
}

function calcNeedFollowup(influencers) {
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

function calcTodayReplies(influencers, timelines) {
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

export default function Dashboard() {
  const navigate = useNavigate()
  const [openModal, setOpenModal] = useState(null)
  const [influencers, setInfluencers] = useState([])
  const [timelines, setTimelines] = useState({})
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const infs = await getInfluencers(true) // noFallback: 仅使用后端真实 API
      setInfluencers(infs || [])

      const tls = {}
      for (const inf of infs || []) {
        try {
          tls[inf.id] = await getTimeline(inf.id, true)
        } catch {
          tls[inf.id] = []
        }
      }
      setTimelines(tls)

      try {
        const p = await getUserProfile()
        if (p) setProfile(p)
      } catch { /* ignore */ }
    } catch (e) {
      setInfluencers([])
      setLoadError(e.message || '数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return '☀️ 早上好'
    if (hour < 18) return '🌤 下午好'
    return '🌙 晚上好'
  }, [])

  const pendingReviewList = useMemo(
    () => influencers.filter((inf) => inf.phase === '提报待审核'),
    [influencers]
  )
  const completedList = useMemo(
    () => influencers.filter((inf) => inf.phase === '合作完成'),
    [influencers]
  )

  const todayReplies = useMemo(() => calcTodayReplies(influencers, timelines), [influencers, timelines])
  const needFollowup = useMemo(() => calcNeedFollowup(influencers), [influencers])

  const stats = [
    { label: '今日新回复', value: todayReplies.length, color: 'var(--danger)', key: 'todayReplies' },
    { label: '待跟进', value: needFollowup.length, color: 'var(--warning)', key: 'needFollowup' },
    { label: '提报待审核', value: pendingReviewList.length, color: 'var(--info)', key: 'pendingReview' },
    { label: '本月合作达成', value: completedList.length, color: 'var(--success)', key: 'completedMonth' },
  ]

  const getModalData = () => {
    switch (openModal) {
      case 'todayReplies': return { title: '今日新回复', icon: '🔴', items: todayReplies, type: 'reply' }
      case 'needFollowup': return { title: '需要跟进', icon: '🟠', items: needFollowup, type: 'followup' }
      case 'pendingReview': return { title: '提报待审核', icon: '🔵', items: pendingReviewList, type: 'review' }
      case 'completedMonth': return { title: '本月合作达成', icon: '🟢', items: completedList, type: 'completed' }
      default: return null
    }
  }

  const modalData = getModalData()

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80, color: 'var(--gray-400)' }}>加载中...</div>
  }

  if (loadError) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gray-700)', marginBottom: 8 }}>数据加载失败</div>
        <div style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 24 }}>{loadError}</div>
        <button className="btn btn-primary" onClick={() => { setLoadError(''); loadData() }}>重新加载</button>
      </div>
    )
  }

  return (
    <div>
      {/* 欢迎横幅 */}
      <div style={{
        background: 'linear-gradient(135deg, #ede9fe 0%, #e0e7ff 50%, #fce7f3 100%)',
        borderRadius: 12, padding: '24px 28px', marginBottom: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-800)', marginBottom: 4 }}>
            {greeting}，{profile?.name || '小李'}
          </div>
          <div style={{ fontSize: 14, color: 'var(--gray-500)' }}>
            {todayReplies.length > 0
              ? `你有 ${todayReplies.length} 条新回复待查看，${needFollowup.length} 位达人需要跟进`
              : '目前没有新回复，看看需要跟进的达人吧'}
          </div>
        </div>
        <div style={{ fontSize: 40, opacity: 0.6 }}>
          {todayReplies.length > 0 ? '📬' : '☕'}
        </div>
      </div>

      <div className="top-header">
        <div>
          <h1 className="page-title">首页总览</h1>
          <p className="page-subtitle">今日工作重点一览，快速了解回复与待跟进状态</p>
        </div>
      </div>

      {/* 优先级引导 */}
      {needFollowup.length > 0 && (
        <div style={{
          padding: '16px 20px',
          background: needFollowup[0].daysAgo >= 7
            ? 'linear-gradient(135deg, #fef2f2, #fee2e2)'
            : 'linear-gradient(135deg, #fffbeb, #fef3c7)',
          border: needFollowup[0].daysAgo >= 7 ? '2px solid #fca5a5' : '1px solid #fcd34d',
          borderRadius: 'var(--radius)', marginBottom: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>
              {needFollowup[0].daysAgo >= 7 ? '🔴' : '🟡'}
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gray-800)', marginBottom: 4 }}>
                {needFollowup[0].daysAgo >= 7
                  ? `优先处理：${needFollowup[0].name} 已 ${needFollowup[0].daysAgo} 天未联系`
                  : `今日建议：关注 ${needFollowup[0].name}，已 ${needFollowup[0].daysAgo} 天未跟进`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>
                {getFollowupReason(needFollowup[0].phase, needFollowup[0].daysAgo)}
                {needFollowup.length > 1 && ` · 还有 ${needFollowup.length - 1} 人也需要关注`}
              </div>
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => navigate(`/influencer/${needFollowup[0].influencerId}`)}
            style={{ flexShrink: 0, marginLeft: 16 }}
          >
            立即处理 →
          </button>
        </div>
      )}

      {/* 顶部数据卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {stats.map((stat, i) => (
          <div
            className="stat-card" key={i}
            onClick={() => setOpenModal(stat.key)}
            style={{ padding: '14px 18px', cursor: 'pointer', transition: 'all 0.2s', border: '2px solid transparent' }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = stat.color; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.1)' }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)' }}
          >
            <span className="label" style={{ fontSize: 12 }}>{stat.label}</span>
            <span className="value" style={{ color: stat.color, fontSize: 24 }}>{stat.value}</span>
          </div>
        ))}
      </div>

      <SearchBar influencers={influencers} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 32 }}>
        {/* 今日新回复 */}
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            🔴 今日新回复 <span style={{ fontSize: 13, color: 'var(--gray-400)', fontWeight: 400 }}>{todayReplies.length} 条</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {todayReplies.map((reply, i) => (
              <div key={i} onClick={() => navigate(`/influencer/${reply.influencerId}`)}
                style={{ padding: '14px 16px', background: 'var(--gray-50)', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'all 0.15s', border: '1px solid transparent' }}
                onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--primary)' }}
                onMouseOut={(e) => { e.currentTarget.style.borderColor = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-light), var(--info-light))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: 'var(--primary)' }}>
                      {reply.name[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{reply.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{reply.account}</div>
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--gray-400)', flexShrink: 0 }}>{reply.time}</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.5 }}>{reply.summary}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 需要跟进 */}
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            🟠 需要跟进 <span style={{ fontSize: 13, color: 'var(--gray-400)', fontWeight: 400 }}>{needFollowup.length} 人</span>
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--gray-200)' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 }}>达人</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 }}>阶段</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 }}>跟进原因</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 }}>距上次沟通</th>
              </tr>
            </thead>
            <tbody>
              {needFollowup.map((item, i) => {
                const reason = getFollowupReason(item.phase, item.daysAgo)
                return (
                  <tr key={i} onClick={() => navigate(`/influencer/${item.influencerId}`)}
                    style={{ borderBottom: '1px solid var(--gray-100)', cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'var(--gray-50)' }}
                    onMouseOut={(e) => { e.currentTarget.style.background = '#fff' }}
                  >
                    <td style={{ padding: '12px 12px' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--gray-400)', marginLeft: 6 }}>{item.account}</span>
                    </td>
                    <td style={{ padding: '12px 12px' }}>
                      {(() => {
                        const pi = getPhaseInfo(item.phase)
                        return <span className="badge" style={{ background: pi.bg, color: pi.textColor, fontSize: 12 }}>{item.phase}</span>
                      })()}
                    </td>
                    <td style={{ padding: '12px 12px', fontSize: 13, color: 'var(--gray-600)' }}>{reason}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: 'var(--gray-500)' }}>{item.daysAgo} 天前</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {openModal && modalData && (
        <div className="modal-overlay" onClick={() => setOpenModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 560, maxWidth: 700 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, margin: 0 }}>
                <span>{modalData.icon}</span><span>{modalData.title}</span>
                <span style={{ fontSize: 13, color: 'var(--gray-400)', fontWeight: 400 }}>{modalData.items.length} 条</span>
              </h3>
              <button className="btn btn-outline btn-sm" onClick={() => setOpenModal(null)}>✕ 关闭</button>
            </div>
            {modalData.items.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}><div className="icon">📭</div><div className="text">暂无数据</div></div>
            ) : (
              modalData.items.map((item, i) => (
                <div key={i} onClick={() => { setOpenModal(null); navigate(`/influencer/${item.influencerId || item.id}`) }}
                  style={{ padding: '12px 16px', background: 'var(--gray-50)', borderRadius: 'var(--radius)', cursor: 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid transparent' }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--primary)' }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = 'transparent' }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</span>
                    {item.account && <span style={{ fontSize: 12, color: 'var(--gray-400)', marginLeft: 8 }}>{item.account}</span>}
                  </div>
                  {item.phase && (
                    <span className="badge" style={{ fontSize: 12, background: getPhaseInfo(item.phase).bg, color: getPhaseInfo(item.phase).textColor }}>{item.phase}</span>
                  )}
                  {item.time && <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{item.time}</span>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
