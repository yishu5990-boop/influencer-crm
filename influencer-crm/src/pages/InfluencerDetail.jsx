import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import SearchBar from '../components/SearchBar'
import { PHASES } from '../data/mockData'
import { getInfluencers, getInfluencer, getTimeline, updateInfluencer, addTimelineEntry, deleteTimelineEntry, deleteInfluencer, getOperatorEmails, getAiSummary, saveAiSummary } from '../utils/storage'
import { detectPhaseSuggestion } from '../utils/aiSuggestions'
import { ai as aiApi } from '../utils/api'

export default function InfluencerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [influencer, setInfluencer] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [allInfluencers, setAllInfluencers] = useState([])
  const [operatorEmails, setOperatorEmails] = useState([])
  const [loading, setLoading] = useState(true)
  const [timelineVersion, setTimelineVersion] = useState(0)
  const [localInf, setLocalInf] = useState(null)
  const [timelineError, setTimelineError] = useState('')

  useEffect(() => {
    loadData()
    entrySummaryTriggered.current = false
  }, [id])

  useEffect(() => {
    if (id) loadTimeline()
  }, [id, timelineVersion])

  const loadData = async () => {
    setLoading(true)
    try {
      const infs = await getInfluencers(true)
      if (infs && infs.length > 0) {
        setAllInfluencers(infs)
        const found = infs.find(i => i.id === id)
        setInfluencer(found || null)
        setLocalInf(found || null)
      } else {
        setInfluencer(null)
        setLocalInf(null)
        setAllInfluencers([])
      }

      try { setOperatorEmails(await getOperatorEmails()) } catch { setOperatorEmails([]) }
    } catch {
      setInfluencer(null)
      setLocalInf(null)
      setAllInfluencers([])
    } finally {
      setLoading(false)
    }
  }

  const loadTimeline = async () => {
    setTimelineError('')
    try {
      const tl = await getTimeline(id, true)
      if (tl && tl.length > 0) {
        setTimeline(tl)
        if (!entrySummaryTriggered.current && tl.some(e => e.ai_summary_generated !== 1)) {
          entrySummaryTriggered.current = true
          handleEntrySummarize(false)
        }
      } else {
        setTimeline([])
        setTimelineError('暂无邮件记录')
      }
    } catch (e) {
      setTimeline([])
      setTimelineError(e.message || '加载邮件记录失败，请刷新重试')
    }
  }

  // AI 阶段建议
  const [suggestion, setSuggestion] = useState(null)
  const [suggestionLoading, setSuggestionLoading] = useState(false)
  const [suggestionError, setSuggestionError] = useState('')
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false)

  const handlePhaseSuggestion = async () => {
    if (!localInf) return
    setSuggestionLoading(true)
    setSuggestionError('')
    setDismissedSuggestion(false)
    try {
      const result = await aiApi.suggestPhase(id)
      if (result._parseError) {
        setSuggestionError(result.reason)
        setSuggestion(null)
      } else {
        setSuggestion(result)
      }
    } catch (e) {
      const latestEmail = timeline.length > 0 ? timeline[timeline.length - 1] : null
      const fallback = detectPhaseSuggestion(localInf.phase, latestEmail?.aiSummary)
      if (fallback) {
        setSuggestion({
          shouldProgress: true,
          suggestedPhase: fallback.to,
          reason: fallback.reason,
          nextAction: '（基于关键词规则，配置 API Key 后可获 AI 精准建议）',
        })
        setSuggestionError('')
      } else {
        setSuggestionError(e.message || 'AI 请求失败')
        setSuggestion(null)
      }
    } finally {
      setSuggestionLoading(false)
    }
  }

  const handleAcceptSuggestion = async () => {
    if (!suggestion || !suggestion.suggestedPhase || !localInf) return
    const historyEntry = {
      id: 'ph_' + Date.now(),
      time: new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      from: localInf.phase,
      to: suggestion.suggestedPhase,
    }
    await updateInfluencer(id, { phase: suggestion.suggestedPhase })
    setLocalInf((prev) => ({
      ...prev,
      phase: suggestion.suggestedPhase,
      phaseHistory: [...(prev.phaseHistory || []), historyEntry],
    }))
    setDismissedSuggestion(true)
  }

  // 沟通概览
  const firstDate = timeline.length > 0 ? timeline[0].date : null
  const lastDate = timeline.length > 0 ? timeline[timeline.length - 1].date : null
  const totalEmails = timeline.length
  const daysSpan = timeline.length >= 2
    ? Math.ceil((new Date(lastDate) - new Date(firstDate)) / (1000 * 60 * 60 * 24))
    : 0

  const [aiAnalyzing, setAiAnalyzing] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [aiError, setAiError] = useState('')
  const [entrySummarizing, setEntrySummarizing] = useState(false)
  const entrySummaryTriggered = useRef(false)
  const [showPhaseModal, setShowPhaseModal] = useState(false)
  const [showPriceModal, setShowPriceModal] = useState(false)
  const [selectedPhase, setSelectedPhase] = useState('')
  const [reportBrand, setReportBrand] = useState('')
  const [reportNote, setReportNote] = useState('')
  const [editingPrice, setEditingPrice] = useState('')
  const [managedEmails, setManagedEmails] = useState([])
  const [showAddEmail, setShowAddEmail] = useState(false)
  const [newEmailInput, setNewEmailInput] = useState('')
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [newEntry, setNewEntry] = useState({ direction: 'inbound', subject: '', content: '', date: new Date().toISOString().split('T')[0] })

  useEffect(() => {
    if (localInf) {
      setSelectedPhase(localInf.phase || '初洽')
      setReportBrand(localInf.reportBrand || '')
      setReportNote(localInf.reportNote || '')
      setEditingPrice(localInf.price || '')
      setManagedEmails(localInf.emails?.length ? [...localInf.emails] : [localInf.email || ''])
    }
  }, [localInf])

  const handleAddEmail = async () => {
    const trimmed = newEmailInput.trim()
    if (!trimmed || managedEmails.includes(trimmed)) return
    const updated = [...managedEmails, trimmed]
    setManagedEmails(updated)
    await updateInfluencer(id, { emails: updated, email: updated[0] })
    setLocalInf({ ...localInf, emails: updated, email: updated[0] })
    setNewEmailInput('')
    setShowAddEmail(false)
  }

  const handleRemoveEmail = async (email) => {
    if (managedEmails.length <= 1) return
    const updated = managedEmails.filter((e) => e !== email)
    setManagedEmails(updated)
    await updateInfluencer(id, { emails: updated, email: updated[0] })
    setLocalInf({ ...localInf, emails: updated, email: updated[0] })
  }

  // 所有 useMemo / hooks 必须在早返回之前（React Hooks 规则）
  const phaseInfo = PHASES.find((p) => p.key === (localInf?.phase)) || PHASES[0]

  const phaseFlowText = useMemo(() => {
    const mainKeys = ['初洽', '谈价格', '提报待审核', '提报已通过', '等待寄样', '待确认', '合作中', '合作完成']
    const branchKeys = ['暂不提报', '提报未通过', '已搁置']
    const main = mainKeys.map((k) => (PHASES.find((p) => p.key === k) || {}).label || k).join(' → ')
    const branch = branchKeys.map((k) => (PHASES.find((p) => p.key === k) || {}).label || k).join(' · ')
    return { main, branch }
  }, [])

  const mergedTimeline = useMemo(() => {
    const phaseHistory = localInf?.phaseHistory || []
    const phaseEntries = phaseHistory.map((entry) => ({
      id: entry.id, date: entry.time, type: 'phaseChange',
      from: entry.from, to: entry.to,
    }))
    const emailEntries = timeline.map((entry) => ({ ...entry, type: 'email' }))
    return [...emailEntries, ...phaseEntries].sort((a, b) => {
      const dateA = a.date || a.time || ''
      const dateB = b.date || b.time || ''
      return dateA.localeCompare(dateB)
    })
  }, [timeline, localInf?.phaseHistory])

  const operatorEmailsList = useMemo(() => {
    const ours = new Set()
    timeline.forEach(e => {
      if (e.direction === 'outbound' && e.from) ours.add(e.from)
      if (e.direction === 'inbound' && e.to) ours.add(e.to)
    })
    if (ours.size > 0) return [...ours]
    // 时间线为空时回退到已配置对接邮箱
    return operatorEmails.length > 0 ? operatorEmails : []
  }, [timeline, operatorEmails])

  const handlePhaseSave = async () => {
    if (selectedPhase !== localInf.phase) {
      const historyEntry = {
        id: 'ph_' + Date.now(),
        time: new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        from: localInf.phase, to: selectedPhase,
      }
      setLocalInf((prev) => ({
        ...prev, phase: selectedPhase, reportBrand, reportNote,
        phaseHistory: [...(prev.phaseHistory || []), historyEntry],
      }))
    } else {
      setLocalInf((prev) => ({ ...prev, reportBrand, reportNote }))
    }
    await updateInfluencer(id, { phase: selectedPhase, reportBrand, reportNote })
    setShowPhaseModal(false)
  }

  const handlePriceSave = async () => {
    const newPrice = editingPrice.trim()
    await updateInfluencer(id, { price: newPrice })
    setLocalInf({ ...localInf, price: newPrice })
    setShowPriceModal(false)
  }

  const handleAddEntry = async () => {
    const { direction, subject, content, date } = newEntry
    if (!subject.trim() || !content.trim()) return
    const entry = {
      date,
      from: direction === 'inbound' ? (localInf.email || localInf.emails?.[0] || '') : (operatorEmailsList[0] || ''),
      to: direction === 'inbound' ? (operatorEmailsList[0] || '') : (localInf.email || localInf.emails?.[0] || ''),
      subject: subject.trim(),
      content: content.trim(),
      aiSummary: content.trim().slice(0, 60) + (content.trim().length > 60 ? '...' : ''),
      direction,
    }
    await addTimelineEntry(id, entry)
    await updateInfluencer(id, { lastContact: date })
    setLocalInf((prev) => ({ ...prev, lastContact: date }))
    setTimelineVersion((v) => v + 1)
    setShowAddEntry(false)
    setNewEntry({ direction: 'inbound', subject: '', content: '', date: new Date().toISOString().split('T')[0] })
  }

  const handleDeleteEntry = async (entryId) => {
    await deleteTimelineEntry(id, entryId)
    setTimelineVersion((v) => v + 1)
  }

  const handleDeleteInfluencer = async () => {
    if (!window.confirm(`确定要删除「${localInf.name}」吗？\n\n该操作将同时删除所有邮件记录、阶段历史和 AI 总结，且无法恢复。`)) return
    try {
      await deleteInfluencer(id)
      navigate('/')
    } catch (e) {
      alert('删除失败：' + (e.message || '未知错误'))
    }
  }

  const handleAiAnalyze = async () => {
    setAiAnalyzing(true)
    setAiError('')
    setAiResult(null)
    try {
      const result = await aiApi.summarize(id)
      setAiResult(result)
      saveAiSummary(id, result)
    } catch (e) {
      setAiError(e.message || 'AI 分析失败')
    } finally {
      setAiAnalyzing(false)
    }
  }

  const handleEntrySummarize = async (force = false) => {
    setEntrySummarizing(true)
    if (!force) setAiError('')
    try {
      const result = await aiApi.summarizeEntries(id, force)
      if (result.summaries && result.summaries.length > 0) {
        const map = {}
        result.summaries.forEach(s => { map[s.id] = s.summary })
        setTimeline(prev => prev.map(e => map[e.id] ? { ...e, aiSummary: map[e.id], ai_summary_generated: 1 } : e))
      }
    } catch (e) {
      if (force) setAiError(e.message || '逐条摘要失败')
    } finally {
      setEntrySummarizing(false)
    }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80, color: 'var(--gray-400)' }}>加载中...</div>
  }

  if (!influencer || !localInf) {
    return (
      <div className="empty-state">
        <div className="icon">🔍</div>
        <div className="text">未找到该达人</div>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/')}>返回首页</button>
      </div>
    )
  }

  return (
    <div>
      <button className="btn btn-outline btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 20 }}>← 返回</button>
      <SearchBar influencers={allInfluencers} />

      <div className="card" style={{ marginTop: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-light), var(--info-light))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>
              {localInf.name[0]}
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700 }}>{localInf.name}</h1>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 13, color: 'var(--gray-500)', alignItems: 'center' }}>
                <span>{localInf.account}</span>
                <span onClick={() => { setEditingPrice(localInf.price || ''); setShowPriceModal(true) }}
                  style={{ background: localInf.price ? '#fef3c7' : 'var(--gray-100)', color: localInf.price ? '#92400e' : 'var(--gray-400)', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', border: '1px solid transparent' }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = '#f59e0b' }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = 'transparent' }}
                >
                  💰 {localInf.price || '添加报价'} ✎
                </span>
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--gray-400)', whiteSpace: 'nowrap', marginTop: 4 }}>达人邮箱：</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {managedEmails.map((email) => (
                      <span key={email} style={{ background: '#f0fdf4', color: '#065f46', padding: '2px 4px 2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {email}
                        {managedEmails.length > 1 && (
                          <span onClick={() => handleRemoveEmail(email)}
                            style={{ cursor: 'pointer', padding: '0 4px', fontSize: 14, lineHeight: 1, color: '#9ca3af', borderRadius: '50%' }}
                            onMouseOver={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fee2e2' }}
                            onMouseOut={(e) => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'transparent' }}
                          >×</span>
                        )}
                      </span>
                    ))}
                    {showAddEmail ? (
                      <form onSubmit={(e) => { e.preventDefault(); handleAddEmail() }} style={{ display: 'inline-flex', gap: 4 }}>
                        <input value={newEmailInput} onChange={(e) => setNewEmailInput(e.target.value)}
                          placeholder="输入新邮箱" autoFocus
                          style={{ width: 160, padding: '3px 8px', border: '1px solid var(--primary)', borderRadius: 6, fontSize: 12, outline: 'none' }}
                          onBlur={() => { if (!newEmailInput.trim()) setShowAddEmail(false) }} />
                        <button type="submit" className="btn btn-primary btn-sm" style={{ padding: '2px 8px', fontSize: 11 }}>确认</button>
                      </form>
                    ) : (
                      <span onClick={() => setShowAddEmail(true)}
                        style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 10, fontSize: 12, color: 'var(--primary)', border: '1px dashed var(--primary)', transition: 'all 0.15s' }}
                        onMouseOver={(e) => { e.currentTarget.style.background = 'var(--primary-light)' }}
                        onMouseOut={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >+ 添加</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>对接邮箱：</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {operatorEmailsList.length > 0 ? operatorEmailsList.map((email) => (
                      <span key={email} style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 500 }}>{email}</span>
                    )) : <span style={{ color: 'var(--gray-400)' }}>暂无</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 4 }}>合作阶段</div>
              <span className="badge" style={{ fontSize: 14, cursor: 'pointer', padding: '6px 14px', background: phaseInfo.bg, color: phaseInfo.textColor }}
                onClick={() => { setSelectedPhase(localInf.phase); setReportBrand(localInf.reportBrand || ''); setReportNote(localInf.reportNote || ''); setShowPhaseModal(true) }}>
                {localInf.phase} ✎
              </span>
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={handleDeleteInfluencer}
                  style={{ fontSize: 11, color: 'var(--gray-400)', borderColor: 'var(--gray-200)' }}
                  onMouseOver={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#fecaca'; e.currentTarget.style.background = '#fef2f2' }}
                  onMouseOut={(e) => { e.currentTarget.style.color = 'var(--gray-400)'; e.currentTarget.style.borderColor = 'var(--gray-200)'; e.currentTarget.style.background = 'transparent' }}
                >🗑 删除达人</button>
              </div>
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={handlePhaseSuggestion} disabled={suggestionLoading} style={{ fontSize: 11 }}>
                  {suggestionLoading ? '⏳ AI 分析中...' : '🤖 AI 阶段建议'}
                </button>
              </div>
            </div>
            {localInf.reportBrand && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 4 }}>提报品牌</div>
                <span style={{ fontSize: 13, color: 'var(--gray-700)', fontWeight: 600 }}>{localInf.reportBrand}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI 阶段建议 */}
      {suggestionError && (
        <div style={{ padding: '12px 16px', marginBottom: 16, background: 'var(--danger-light)', borderRadius: 'var(--radius)', fontSize: 13, color: '#991b1b' }}>
          {suggestionError.includes('未找到 API Key')
            ? <>⚠️ 尚未配置 API Key。请在 server/.env 中填入 DeepSeek API Key 后重启后端。</>
            : <>⚠️ {suggestionError}</>}
        </div>
      )}

      {suggestion && !dismissedSuggestion && (
        <div style={{
          padding: '14px 20px',
          background: suggestion.shouldProgress === true ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)'
            : suggestion.shouldProgress === false ? 'linear-gradient(135deg, #fffbeb, #fef3c7)'
            : 'linear-gradient(135deg, #ede9fe, #e0e7ff)',
          border: suggestion.shouldProgress === true ? '1px solid #86efac'
            : suggestion.shouldProgress === false ? '1px solid #fcd34d'
            : '1px solid #c4b5fd',
          borderRadius: 'var(--radius)', marginBottom: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>🤖</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gray-800)', marginBottom: 2 }}>
                {suggestion.shouldProgress === true
                  ? <>AI 建议：将阶段从「{localInf.phase}」推进到「{suggestion.suggestedPhase}」</>
                  : suggestion.shouldProgress === false
                    ? <>AI 判断：「{localInf.phase}」暂不宜推进</>
                    : <>AI 提示：「{localInf.phase}」— {suggestion.reason}</>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>
                {suggestion.reason}
                {suggestion.nextAction && <> · {suggestion.nextAction}</>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setDismissedSuggestion(true)}>忽略</button>
            {suggestion.shouldProgress === true && (
              <button className="btn btn-primary btn-sm" onClick={handleAcceptSuggestion}>确认推进</button>
            )}
          </div>
        </div>
      )}

      {/* 沟通概览 */}
      {timelineError && (
        <div style={{ padding: '10px 16px', marginBottom: 16, background: '#fef2f2', borderRadius: 'var(--radius)', fontSize: 13, color: '#991b1b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>⚠️ {timelineError}</span>
          <button className="btn btn-outline btn-sm" onClick={() => { setTimelineError(''); loadTimeline() }}>重试</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <div className="stat-card" style={{ padding: '14px 18px' }}>
          <span className="label" style={{ fontSize: 12 }}>邮件往来</span>
          <span className="value" style={{ fontSize: 24, color: timelineError ? 'var(--danger)' : 'var(--primary)' }}>{totalEmails} 封</span>
        </div>
        <div className="stat-card" style={{ padding: '14px 18px' }}>
          <span className="label" style={{ fontSize: 12 }}>对接邮箱</span>
          <span className="value" style={{ fontSize: 24, color: 'var(--info)' }}>{operatorEmailsList.length} 个</span>
        </div>
        <div className="stat-card" style={{ padding: '14px 18px' }}>
          <span className="label" style={{ fontSize: 12 }}>沟通周期</span>
          <span className="value" style={{ fontSize: 24, color: 'var(--success)' }}>{daysSpan} 天</span>
        </div>
        <div className="stat-card" style={{ padding: '14px 18px' }}>
          <span className="label" style={{ fontSize: 12 }}>时间范围</span>
          <span style={{ fontSize: 13, color: 'var(--gray-700)', fontWeight: 600, marginTop: 4 }}>
            {firstDate || '—'} ~ {lastDate || '—'}
          </span>
        </div>
      </div>

      {/* 沟通时间线 */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>📬 AI 沟通时间线</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => handleEntrySummarize(true)} disabled={entrySummarizing} style={{ gap: 6 }}>
              {entrySummarizing ? '⏳ 摘要生成中...' : '🤖 AI 逐条摘要'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleAiAnalyze} disabled={aiAnalyzing} style={{ gap: 6 }}>
              {aiAnalyzing ? '⏳ 分析中...' : '🤖 AI 分析全部邮件'}
            </button>
          </div>
        </div>

        {!showAddEntry ? (
          <button className="btn btn-outline btn-sm" onClick={() => setShowAddEntry(true)}
            style={{ marginBottom: 16, width: '100%', border: '1px dashed var(--gray-300)', color: 'var(--gray-500)' }}>
            + 新增沟通记录
          </button>
        ) : (
          <div style={{ marginBottom: 16, padding: 16, background: 'var(--gray-50)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>方向</label>
                <select value={newEntry.direction} onChange={(e) => setNewEntry((prev) => ({ ...prev, direction: e.target.value }))}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13 }}>
                  <option value="inbound">收件（达人发来）</option>
                  <option value="outbound">发件（我方发出）</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>日期</label>
                <input type="date" value={newEntry.date} onChange={(e) => setNewEntry((prev) => ({ ...prev, date: e.target.value }))}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13 }} />
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>主题</label>
              <input type="text" value={newEntry.subject} onChange={(e) => setNewEntry((prev) => ({ ...prev, subject: e.target.value }))}
                placeholder="邮件主题" style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13 }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>内容</label>
              <textarea value={newEntry.content} onChange={(e) => setNewEntry((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="邮件正文或沟通要点" rows={3}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => { setShowAddEntry(false); setNewEntry({ direction: 'inbound', subject: '', content: '', date: new Date().toISOString().split('T')[0] }) }}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={handleAddEntry}>添加记录</button>
            </div>
          </div>
        )}

        {aiError && (
          <div style={{ padding: '12px 16px', marginBottom: 16, background: 'var(--danger-light)', borderRadius: 'var(--radius)', fontSize: 13, color: '#991b1b' }}>
            ⚠️ {aiError}
          </div>
        )}

        {aiResult && (
          <div style={{ padding: '16px 20px', marginBottom: 16, background: '#f0fdf4', borderRadius: 'var(--radius)', border: '1px solid #86efac' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#065f46' }}>🤖 AI 邮件分析结果</span>
              <span onClick={async () => {
                await aiApi.removeSummary(id)
                setAiResult(null)
              }} title="删除此分析结果"
                style={{ cursor: 'pointer', fontSize: 16, color: 'var(--gray-300)', padding: '2px 6px', borderRadius: 4, transition: 'all 0.15s' }}
                onMouseOver={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fee2e2' }}
                onMouseOut={(e) => { e.currentTarget.style.color = 'var(--gray-300)'; e.currentTarget.style.background = 'transparent' }}
              >×</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
              <div><span style={{ color: 'var(--gray-400)' }}>摘要：</span>{aiResult.一句话摘要}</div>
              <div><span style={{ color: 'var(--gray-400)' }}>状态：</span>{aiResult.当前合作状态}</div>
              <div><span style={{ color: 'var(--gray-400)' }}>达人报价：</span>{aiResult.达人报价 || '—'}</div>
              <div><span style={{ color: 'var(--gray-400)' }}>我方报价：</span>{aiResult.我方报价 || '—'}</div>
              <div><span style={{ color: 'var(--gray-400)' }}>待处理：</span>{aiResult.当前待处理事项}</div>
              <div><span style={{ color: 'var(--gray-400)' }}>最后动作：</span>{aiResult.最后动作方 || '—'}{aiResult.是否要求定金 ? ' · 达人要求定金' : ''}</div>
            </div>
          </div>
        )}

        <div className="timeline">
          {mergedTimeline.map((entry) =>
            entry.type === 'phaseChange' ? (
              <div className="timeline-item phase-change" key={entry.id}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)' }}>{entry.date}</span>
                    <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: '#f3e8ff', color: '#7c3aed' }}>阶段变更</span>
                  </div>
                </div>
                <div style={{ background: '#faf5ff', padding: '12px 16px', borderRadius: 'var(--radius)', border: '1px solid #e9d5ff', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: 'var(--gray-700)' }}>
                    <span style={{ background: 'var(--gray-100)', color: 'var(--gray-600)', padding: '1px 8px', borderRadius: 8, fontSize: 12 }}>{entry.from}</span>
                    <span style={{ margin: '0 6px', color: 'var(--gray-400)' }}>→</span>
                    <span style={{ background: '#f3e8ff', color: '#7c3aed', padding: '1px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{entry.to}</span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="timeline-item" key={entry.id}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)' }}>{entry.date}</span>
                    <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: entry.direction === 'inbound' ? 'var(--info-light)' : 'var(--success-light)', color: entry.direction === 'inbound' ? 'var(--info)' : '#059669' }}>
                      {entry.direction === 'inbound' ? '收件' : '发件'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{entry.from} → {entry.to}</span>
                    <span onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry.id) }}
                      title="删除此记录"
                      style={{ cursor: 'pointer', fontSize: 16, color: 'var(--gray-400)', lineHeight: 1, padding: '0 4px', borderRadius: 4, transition: 'all 0.15s' }}
                      onMouseOver={(ev) => { ev.currentTarget.style.color = '#ef4444'; ev.currentTarget.style.background = '#fee2e2' }}
                      onMouseOut={(ev) => { ev.currentTarget.style.color = 'var(--gray-400)'; ev.currentTarget.style.background = 'transparent' }}
                    >×</span>
                  </div>
                </div>
                <div style={{ background: 'var(--gray-50)', padding: '14px 16px', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 }}>🤖 AI 摘要</span>
                    <span style={{ fontSize: 11, color: 'var(--primary)', background: 'var(--primary-light)', padding: '1px 6px', borderRadius: 6 }}>
                      {['Work_01@gmail.com', 'Work_02@me.com', 'Brand_Official@outlook.com', 'PR_Team@gmail.com'].includes(entry.from) ? '我发送的' : '达人回复'}
                    </span>
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--gray-800)', fontWeight: 500, marginBottom: 8 }}>{entry.aiSummary}</p>
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 12, color: 'var(--gray-400)', cursor: 'pointer' }}>查看邮件原文</summary>
                    <div style={{ marginTop: 8, padding: '12px', background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      <div style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 4 }}>主题: {entry.subject}</div>
                      {entry.content}
                    </div>
                  </details>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Phase Modal */}
      {showPhaseModal && (
        <div className="modal-overlay" onClick={() => setShowPhaseModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>修改合作阶段</h3>
            <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 16 }}>
              主路径：{phaseFlowText.main}<br />
              分支路径：{phaseFlowText.branch}
            </p>
            <div className="form-group">
              <label>合作阶段</label>
              <select value={selectedPhase} onChange={(e) => setSelectedPhase(e.target.value)}>
                {PHASES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            {(selectedPhase === '提报待审核' || selectedPhase === '提报已通过' || selectedPhase === '提报未通过') && (
              <div className="form-group">
                <label>提报品牌（可选）</label>
                <input type="text" value={reportBrand} onChange={(e) => setReportBrand(e.target.value)} placeholder="例如：M·A·C、Nike" />
              </div>
            )}
            {selectedPhase === '提报未通过' && (
              <div className="form-group">
                <label>未通过原因（可选）</label>
                <textarea value={reportNote} onChange={(e) => setReportNote(e.target.value)} placeholder="备注原因" rows={2} />
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowPhaseModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handlePhaseSave}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Price Modal */}
      {showPriceModal && (
        <div className="modal-overlay" onClick={() => setShowPriceModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 480 }}>
            <h3>修改报价</h3>
            <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 16 }}>
              报价由你手动维护。AI 仅负责从邮件中提取价格作为参考。
            </p>
            <div className="form-group">
              <label>当前报价</label>
              <input type="text" value={editingPrice} onChange={(e) => setEditingPrice(e.target.value)} placeholder="例如：$500→$400" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowPriceModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handlePriceSave}>保存报价</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
