import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PHASES } from '../data/mockData'
import { getInfluencers, createInfluencer, updateInfluencer } from '../utils/storage'

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: '提报待审核', label: '待审核' },
  { key: '提报已通过', label: '已通过' },
  { key: '合作中', label: '合作中' },
  { key: '合作完成', label: '已完成' },
  { key: '提报未通过', label: '未通过' },
  { key: '暂不提报', label: '暂不提报' },
  { key: '已搁置', label: '已搁置' },
]

export default function ReportManagement() {
  const navigate = useNavigate()
  const [influencers, setInfluencers] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')
  const [editingPhaseId, setEditingPhaseId] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', account: '', email: '', phase: '初洽' })

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const infs = await getInfluencers(true)
      setInfluencers(infs || [])
    } catch {
      setInfluencers([])
    } finally {
      setLoading(false)
    }
  }

  const filtered = activeFilter === 'all'
    ? influencers
    : influencers.filter((inf) => inf.phase === activeFilter)

  const counts = {}
  FILTER_TABS.forEach((tab) => {
    counts[tab.key] = tab.key === 'all'
      ? influencers.length
      : influencers.filter((inf) => inf.phase === tab.key).length
  })

  const handlePhaseChange = async (id, newPhase) => {
    const today = new Date().toISOString().split('T')[0]
    await updateInfluencer(id, { phase: newPhase, lastContact: today })
    setInfluencers((prev) =>
      prev.map((inf) => (inf.id === id ? { ...inf, phase: newPhase, lastContact: today } : inf))
    )
    setEditingPhaseId(null)
  }

  const handleAddInfluencer = async () => {
    const { name, account, email, phase } = newForm
    if (!name.trim() || !account.trim() || !email.trim()) return
    const newInf = {
      name: name.trim(), account: account.trim(), email: email.trim(), phase: phase || '初洽',
    }
    try {
      const created = await createInfluencer(newInf)
      setInfluencers((prev) => [...prev, created])
    } catch {
      const id = 'inf_' + Date.now()
      const today = new Date().toISOString().split('T')[0]
      setInfluencers((prev) => [...prev, { id, ...newInf, emails: [newInf.email], reportBrand: '', reportNote: '', lastContact: today, price: '', phaseHistory: [] }])
    }
    setShowAddModal(false)
    setNewForm({ name: '', account: '', email: '', phase: '初洽' })
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80, color: 'var(--gray-400)' }}>加载中...</div>
  }

  return (
    <div>
      <div className="top-header">
        <div>
          <h1 className="page-title">达人管理</h1>
          <p className="page-subtitle">管理所有达人的合作进度</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ 新增达人</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
        {FILTER_TABS.map((tab) => (
          <button key={tab.key}
            className={`btn btn-sm ${activeFilter === tab.key ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveFilter(tab.key)}>
            {tab.label}
            <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8, background: activeFilter === tab.key ? 'rgba(255,255,255,0.25)' : 'var(--gray-200)', padding: '1px 6px', borderRadius: 10 }}>
              {counts[tab.key] || 0}
            </span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {filtered.map((inf) => {
          const phaseInfo = PHASES.find((p) => p.key === inf.phase)
          const isUrgent = inf.phase === '提报待审核'
          const isPassed = inf.phase === '提报已通过'
          const isDone = inf.phase === '合作完成'
          const isStopped = inf.phase === '已搁置' || inf.phase === '提报未通过' || inf.phase === '暂不提报'

          return (
            <div key={inf.id} className="card" style={{
              padding: 20,
              borderLeft: isUrgent ? '3px solid var(--warning)' : isPassed ? '3px solid var(--success)' : isDone ? '3px solid var(--info)' : isStopped ? '3px solid var(--danger)' : '3px solid transparent',
              background: isUrgent ? '#fffdf5' : isPassed ? '#f8fdf5' : isStopped ? '#fef9f9' : '#fff',
              transition: 'all 0.15s',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, var(--primary-light), var(--info-light))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: 'var(--primary)', flexShrink: 0 }}>
                  {inf.name[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div onClick={() => navigate(`/influencer/${inf.id}`)} style={{ fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>{inf.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
                    {inf.account} · {inf.email || (inf.emails && inf.emails[0]) || ''}
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 }}>合作阶段</div>
                {editingPhaseId === inf.id ? (
                  <select value={inf.phase} onChange={(e) => handlePhaseChange(inf.id, e.target.value)}
                    onBlur={() => setEditingPhaseId(null)} autoFocus
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--primary)', borderRadius: 6, fontSize: 13, outline: 'none' }}>
                    {PHASES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                ) : (
                  <span onClick={() => setEditingPhaseId(inf.id)} className="badge"
                    style={{ fontSize: 13, cursor: 'pointer', padding: '5px 12px', background: phaseInfo?.bg, color: phaseInfo?.textColor }}>
                    {inf.phase} ✎
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--gray-100)', fontSize: 12, color: 'var(--gray-500)' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {inf.reportBrand ? (
                    <span>品牌：<strong style={{ color: 'var(--gray-700)' }}>{inf.reportBrand}</strong></span>
                  ) : <span style={{ color: 'var(--gray-400)' }}>未提报品牌</span>}
                  {inf.price && (
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>{inf.price}</span>
                  )}
                </div>
                <span style={{ color: 'var(--gray-400)' }}>{inf.lastContact || inf.last_contact}</span>
              </div>

              {isUrgent && (
                <div style={{ marginTop: 10, padding: '6px 12px', background: 'var(--warning-light)', borderRadius: 6, fontSize: 12, color: '#92400e', textAlign: 'center', fontWeight: 500 }}>⏳ 待审核反馈</div>
              )}
              {isPassed && (
                <div style={{ marginTop: 10, padding: '6px 12px', background: 'var(--success-light)', borderRadius: 6, fontSize: 12, color: '#065f46', textAlign: 'center', fontWeight: 500 }}>✅ 已通过审核</div>
              )}
              {inf.phase === '提报未通过' && (
                <div style={{ marginTop: 10, padding: '6px 12px', background: 'var(--danger-light)', borderRadius: 6, fontSize: 12, color: '#991b1b', textAlign: 'center', fontWeight: 500 }}>
                  ❌ 提报未通过{inf.reportNote ? ` — ${inf.reportNote}` : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state"><div className="icon">📭</div><div className="text">该状态下暂无达人</div></div>
      )}

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>新增达人</h3>
            <div className="form-group">
              <label>达人名称 *</label>
              <input type="text" value={newForm.name} onChange={(e) => setNewForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="例如：张三" autoFocus />
            </div>
            <div className="form-group">
              <label>账号 *</label>
              <input type="text" value={newForm.account} onChange={(e) => setNewForm((prev) => ({ ...prev, account: e.target.value }))} placeholder="例如：@zhangsan_tiktok" />
            </div>
            <div className="form-group">
              <label>邮箱 *</label>
              <input type="email" value={newForm.email} onChange={(e) => setNewForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="zhangsan@gmail.com" />
            </div>
            <div className="form-group">
              <label>初始阶段</label>
              <select value={newForm.phase} onChange={(e) => setNewForm((prev) => ({ ...prev, phase: e.target.value }))}>
                {PHASES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => { setShowAddModal(false); setNewForm({ name: '', account: '', email: '', phase: '初洽' }) }}>取消</button>
              <button className="btn btn-primary" onClick={handleAddInfluencer} disabled={!newForm.name.trim() || !newForm.account.trim() || !newForm.email.trim()}>确认新增</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
