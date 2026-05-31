import { useState, useEffect } from 'react'
import { getEmailAccounts, saveEmailAccounts, deleteEmailAccount, syncGmail, getGmailAuthUrl, getGmailAuthStatus } from '../utils/storage'
import { emails as emApi } from '../utils/api'
import DiscoverModal from '../components/DiscoverModal'

const STATUS_MAP = {
  connected: { label: '已连接', color: 'var(--success)', bg: 'var(--success-light)', dot: '● ' },
  disconnected: { label: '已断开', color: 'var(--gray-500)', bg: 'var(--gray-200)', dot: '○ ' },
  need_reauth: { label: '需重新授权', color: '#d97706', bg: 'var(--warning-light)', dot: '⚠ ' },
}

const PROVIDER_ICONS = { Gmail: '📧', Outlook: '📨', iCloud: '📩', Yahoo: '📬' }

const STATS = [
  { label: '邮箱总数', key: 'all', color: 'var(--primary)' },
  { label: '已连接', key: 'connected', color: 'var(--success)' },
  { label: '需处理', key: 'problem', color: 'var(--warning)' },
]

export default function EmailSettings() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [showDiscoverModal, setShowDiscoverModal] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newProvider, setNewProvider] = useState('Gmail')
  const [newAppPassword, setNewAppPassword] = useState('')
  const [showPasswordField, setShowPasswordField] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [openModal, setOpenModal] = useState(null)
  // OAuth 状态
  const [oauthStatus, setOauthStatus] = useState(null)
  const [oauthConnecting, setOauthConnecting] = useState(false)
  const [oauthMsg, setOauthMsg] = useState('')

  useEffect(() => {
    loadAccounts()
    checkOAuthStatus()
    checkOAuthCallback()
  }, [])

  // 检测 Google OAuth 回调（URL 参数 oauth=success/error&email=xxx）
  const checkOAuthCallback = async () => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('oauth')
    const msg = params.get('msg')
    const oauthEmail = params.get('email')

    if (result === 'success' && oauthEmail) {
      // 每账号 OAuth 成功 → 自动保存并同步
      const pendingEmail = localStorage.getItem('pending_oauth_email')
      localStorage.removeItem('pending_oauth_email')
      const targetEmail = oauthEmail || pendingEmail
      window.history.replaceState({}, '', '/email-settings')

      if (targetEmail) {
        setOauthMsg(`✅ ${targetEmail} 授权成功，正在自动同步...`)
        setSyncing(true)
        try {
          // 保存账号到数据库
          await emApi.addAccount({ email: targetEmail, provider: 'Gmail' })
          // 同步邮件
          const syncResult = await syncGmail(targetEmail)
          setOauthMsg(`✅ ${targetEmail} 授权并同步完成${syncResult.new ? '，新增 ' + syncResult.new + ' 封邮件' : ''}`)
          await loadAccounts()
        } catch (e) {
          setOauthMsg(`⚠️ ${targetEmail} 授权成功，但同步失败: ${e.message}`)
        } finally {
          setSyncing(false)
        }
      }
    } else if (result === 'success') {
      setOauthMsg('Google 授权成功！你可以点击「同步邮件」开始同步')
      window.history.replaceState({}, '', '/email-settings')
    } else if (result === 'error') {
      setOauthMsg('授权失败: ' + (msg || '未知错误'))
      window.history.replaceState({}, '', '/email-settings')
    }
  }

  const checkOAuthStatus = async () => {
    try {
      const res = await getGmailAuthStatus()
      setOauthStatus(res)
    } catch {
      setOauthStatus({ authorized: false })
    }
  }

  // Google OAuth 授权（email 可选：传了就是每账号授权，不传就是全局授权）
  const handleGoogleAuth = async (email) => {
    setOauthConnecting(true)
    try {
      const { url } = await getGmailAuthUrl(email)
      // 把待授权邮箱存到 localStorage，回调后用
      if (email) {
        localStorage.setItem('pending_oauth_email', email)
      }
      // 用弹窗打开 Google 授权页
      const width = 600, height = 700
      const left = (screen.width - width) / 2
      const top = (screen.height - height) / 2
      const popup = window.open(url, 'google-oauth',
        `width=${width},height=${height},left=${left},top=${top}`)
      if (!popup) {
        // 弹窗被拦截，直接跳转
        window.location.href = url
        return
      }
      // 轮询检测弹窗关闭（授权完成后跳回我们的 redirect URI）
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed)
          setOauthConnecting(false)
          checkOAuthStatus()
        }
      }, 500)
    } catch (e) {
      setOauthMsg('获取授权链接失败: ' + e.message)
    } finally {
      setOauthConnecting(false)
    }
  }

  const loadAccounts = async () => {
    setLoading(true)
    try {
      const accs = await getEmailAccounts()
      setAccounts(accs || [])
    } catch {
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }

  const persistAndSync = async (updated) => {
    setAccounts(updated)
    await saveEmailAccounts(updated)
  }

  const connectedAccounts = accounts.filter((a) => a.status === 'connected')
  const problemAccounts = accounts.filter((a) => a.status !== 'connected')

  const getStatValue = (key) => {
    if (key === 'all') return accounts.length
    if (key === 'connected') return connectedAccounts.length
    if (key === 'problem') return problemAccounts.length
    return 0
  }

  const getModalData = () => {
    switch (openModal) {
      case 'all': return { title: '所有邮箱', icon: '📫', items: accounts }
      case 'connected': return { title: '已连接邮箱', icon: '🟢', items: connectedAccounts }
      case 'problem': return { title: '需处理邮箱', icon: '🟠', items: problemAccounts }
      default: return null
    }
  }

  const handleAddAndSync = async () => {
    if (!newEmail.trim()) return
    setShowAddModal(false)
    setShowSyncModal(true)
    setSyncing(true)
    setSyncResult(null)

    try {
      // 1. 先保存邮箱账号到数据库（含应用专用密码）
      const saved = await emApi.addAccount({ email: newEmail.trim(), provider: newProvider, appPassword: newAppPassword })

      // 2. 触发 Gmail IMAP 同步
      const result = await syncGmail(newEmail.trim())

      setSyncResult(result)

      // 3. 更新本地状态
      const updatedAccount = {
        ...saved,
        status: result.error ? 'need_reauth' : 'connected',
        last_sync: new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-'),
        scanned_count: result.new || 0,
      }
      setAccounts(prev => [updatedAccount, ...prev.filter(a => a.id !== saved.id)])
    } catch (e) {
      setSyncResult({ error: e.message })
    } finally {
      setSyncing(false)
    }
  }

  const handleCloseSync = () => {
    setShowSyncModal(false)
    setNewEmail('')
    setNewProvider('Gmail')
    setNewAppPassword('')
    setShowPasswordField(false)
    setSyncResult(null)
  }

  const handleDisconnect = async (id) => {
    await persistAndSync(accounts.map((a) => (a.id === id ? { ...a, status: 'disconnected' } : a)))
  }

  const handleDeleteAccount = async (acc) => {
    if (!window.confirm(`确定要永久删除「${acc.email}」吗？\n\n该操作将同时删除该邮箱的 OAuth 授权凭据，且无法恢复。`)) return
    try {
      await deleteEmailAccount(acc.id)
      setAccounts((prev) => prev.filter((a) => a.id !== acc.id))
    } catch (e) {
      alert('删除失败：' + (e.message || '未知错误'))
    }
  }

  const handleReconnect = async (id) => {
    setSyncing(true)
    const account = accounts.find(a => a.id === id)
    const email = account?.email || ''
    try {
      const result = await syncGmail(email)
      const now = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-')
      await persistAndSync(accounts.map((a) => (a.id === id ? { ...a, status: result.error ? 'need_reauth' : 'connected', last_sync: now, scanned_count: (a.scanned_count || 0) + (result.new || 0) } : a)))
    } catch (e) {
      alert('同步失败：' + e.message)
    } finally {
      setSyncing(false)
    }
  }

  const modalData = getModalData()

  const renderAccountRow = (acc) => {
    const statusInfo = STATUS_MAP[acc.status]
    return (
      <div key={acc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: acc.status === 'connected' ? 'var(--gray-50)' : '#fefce8', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: acc.provider === 'Gmail' ? '#fee2e2' : acc.provider === 'Outlook' ? '#dbeafe' : '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
            {PROVIDER_ICONS[acc.provider] || '📧'}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{acc.email}</div>
            <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 12, color: 'var(--gray-500)' }}>
              <span>{acc.provider}</span>
              {acc.status === 'connected' && <><span>最后同步: {acc.lastSync || acc.last_sync}</span><span>已扫描 {acc.scannedCount || acc.scanned_count} 封邮件</span></>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 500, background: statusInfo.bg, color: statusInfo.color }}>
            {statusInfo.dot}{statusInfo.label}
          </span>
          {acc.status === 'connected' && <button className="btn btn-outline btn-sm" onClick={() => handleDisconnect(acc.id)}>断开</button>}
          {acc.status !== 'connected' && <button className="btn btn-primary btn-sm" onClick={() => handleReconnect(acc.id)} disabled={syncing}>{acc.status === 'need_reauth' ? '重新授权' : '重新连接'}</button>}
          <span onClick={() => handleDeleteAccount(acc)} title="永久删除"
            style={{ cursor: 'pointer', fontSize: 16, color: 'var(--gray-300)', padding: '2px 4px', borderRadius: 4, transition: 'all 0.15s' }}
            onMouseOver={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fee2e2' }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--gray-300)'; e.currentTarget.style.background = 'transparent' }}
          >×</span>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80, color: 'var(--gray-400)' }}>加载中...</div>
  }

  return (
    <div>
      <div className="top-header">
        <div>
          <h1 className="page-title">邮箱设置</h1>
          <p className="page-subtitle">管理已连接的邮箱账号，查看同步状态</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ 添加邮箱</button>
          <button className="btn btn-outline" onClick={() => setShowDiscoverModal(true)}>🔍 发现达人</button>
        </div>
      </div>

      {oauthMsg && (
        <div style={{ padding: '12px 18px', marginBottom: 20, borderRadius: 10, background: oauthMsg.includes('成功') ? 'var(--success-light)' : 'var(--danger-light)', color: oauthMsg.includes('成功') ? '#166534' : '#991b1b', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{oauthMsg.includes('成功') ? '✅ ' : '⚠️ '}{oauthMsg}</span>
          <button onClick={() => setOauthMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit' }}>✕</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: oauthStatus?.authorized ? '#dcfce7' : '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
              {oauthStatus?.authorized ? '🔐' : '🔓'}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {oauthStatus?.authorized ? 'Google 账号已授权' : 'Google OAuth 授权'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 2 }}>
                {oauthStatus?.authorized
                  ? `已通过 OAuth 2.0 授权 ${oauthStatus.email || ''}，可安全访问 Gmail 邮件`
                  : '使用 Google 官方 OAuth 2.0 安全连接，无需应用专用密码'}
              </div>
            </div>
          </div>
          {oauthStatus?.authorized ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 20, background: 'var(--success-light)', color: '#166534', fontSize: 13, fontWeight: 600 }}>
              ● 已连接
            </span>
          ) : (
            <button className="btn btn-primary" onClick={handleGoogleAuth} disabled={oauthConnecting} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {oauthConnecting ? (
                <>⏳ 等待授权中...</>
              ) : (
                <><span style={{ fontSize: 18 }}>G</span> 连接 Google 账号</>
              )}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {STATS.map((stat) => (
          <div className="stat-card" key={stat.key} onClick={() => setOpenModal(stat.key)}
            style={{ padding: '14px 18px', cursor: 'pointer', transition: 'all 0.2s', border: '2px solid transparent' }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = stat.color; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.1)' }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)' }}
          >
            <span className="label" style={{ fontSize: 12 }}>{stat.label}</span>
            <span className="value" style={{ color: stat.color, fontSize: 24 }}>{getStatValue(stat.key)}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>邮箱列表 ({accounts.length})</h3>
        {accounts.length === 0 ? (
          <div className="empty-state"><div className="icon">📭</div><div className="text">还没有连接任何邮箱</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{accounts.map(renderAccountRow)}</div>
        )}
      </div>

      {openModal && modalData && (
        <div className="modal-overlay" onClick={() => setOpenModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 560, maxWidth: 700 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, margin: 0 }}>
                <span>{modalData.icon}</span><span>{modalData.title}</span>
                <span style={{ fontSize: 13, color: 'var(--gray-400)', fontWeight: 400 }}>{modalData.items.length} 个</span>
              </h3>
              <button className="btn btn-outline btn-sm" onClick={() => setOpenModal(null)}>✕ 关闭</button>
            </div>
            {modalData.items.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}><div className="icon">📭</div><div className="text">暂无数据</div></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {modalData.items.map((acc) => {
                  const si = STATUS_MAP[acc.status]
                  return (
                    <div key={acc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--gray-50)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: acc.provider === 'Gmail' ? '#fee2e2' : acc.provider === 'Outlook' ? '#dbeafe' : '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                          {PROVIDER_ICONS[acc.provider] || '📧'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{acc.email}</div>
                          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{acc.provider}{acc.status === 'connected' && ` · 最后同步 ${acc.lastSync || acc.last_sync} · ${acc.scannedCount || acc.scanned_count} 封`}</div>
                        </div>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500, background: si.bg, color: si.color }}>{si.dot}{si.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="modal-overlay" onClick={() => { setShowAddModal(false); setNewEmail(''); setNewAppPassword(''); setShowPasswordField(false) }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>添加邮箱</h3>
            <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 16 }}>连接 Gmail 后，系统将通过 IMAP 自动扫描达人相关邮件</p>

            <div className="form-group">
              <label>邮箱地址</label>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="your-email@gmail.com" />
            </div>
            <div className="form-group">
              <label>邮箱服务商</label>
              <select value={newProvider} onChange={(e) => setNewProvider(e.target.value)}>
                <option value="Gmail">Gmail</option>
                <option value="Outlook">Outlook / Hotmail</option>
                <option value="iCloud">iCloud / Apple Mail</option>
                <option value="Yahoo">Yahoo Mail</option>
              </select>
            </div>

            {newProvider === 'Gmail' && (
              <>
                {!showPasswordField ? (
                  <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                    <button
                      className="btn btn-primary"
                      style={{ width: '100%', padding: '12px 0', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                      onClick={() => { setShowAddModal(false); handleGoogleAuth(newEmail.trim()) }}
                      disabled={!newEmail.trim() || oauthConnecting}
                    >
                      <span style={{ fontSize: 18 }}>G</span>
                      {oauthConnecting ? '⏳ 等待授权...' : '一键连接 Google 账号'}
                    </button>
                    <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 8 }}>
                      点击后在新窗口中登录该 Gmail 账号并授权即可
                    </p>
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gray-200)' }}>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setShowPasswordField(true)}
                        style={{ fontSize: 12, color: 'var(--gray-500)' }}
                      >
                        或使用应用专用密码
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="form-group">
                    <label>应用专用密码</label>
                    <input
                      type="password"
                      value={newAppPassword}
                      onChange={(e) => setNewAppPassword(e.target.value)}
                      placeholder="16位 Google 应用专用密码"
                      autoComplete="off"
                    />
                    <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
                      前往 Google 账号 → 安全 → 两步验证 → 应用专用密码，生成后粘贴到这里
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => { setShowAddModal(false); setNewEmail(''); setNewAppPassword(''); setShowPasswordField(false) }}>取消</button>
              {newProvider === 'Gmail' && showPasswordField && (
                <button className="btn btn-primary" onClick={handleAddAndSync} disabled={!newEmail.trim()}>保存并同步</button>
              )}
              {newProvider !== 'Gmail' && (
                <button className="btn btn-primary" onClick={handleAddAndSync} disabled={!newEmail.trim()}>保存</button>
              )}
            </div>
          </div>
        </div>
      )}

      {showSyncModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ textAlign: 'center', minWidth: 420 }}>
            {syncing ? (
              <>
                <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
                <h3 style={{ marginBottom: 8 }}>正在同步邮件...</h3>
                <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 20 }}>正在通过 IMAP 连接 {newEmail}，扫描达人相关邮件</p>
                <div style={{ width: '100%', height: 4, background: 'var(--gray-200)', borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
                  <div style={{ width: '60%', height: '100%', background: 'var(--primary)', borderRadius: 2 }} />
                </div>
              </>
            ) : syncResult?.error ? (
              <>
                <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
                <h3 style={{ marginBottom: 8 }}>同步失败</h3>
                <p style={{ fontSize: 13, color: '#991b1b', marginBottom: 20, background: 'var(--danger-light)', padding: '10px 14px', borderRadius: 8 }}>
                  {syncResult.error}
                </p>
                <p style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 20 }}>
                  请确认 Google OAuth 授权是否有效，或检查 server/.env 配置
                </p>
                <button className="btn btn-primary" onClick={handleCloseSync}>知道了</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                <h3 style={{ marginBottom: 8 }}>同步完成！</h3>
                <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 20 }}>
                  <div style={{ textAlign: 'center', padding: '12px 20px', background: 'var(--gray-50)', borderRadius: 12 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>{syncResult?.total || 0}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>扫描邮件</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '12px 20px', background: 'var(--gray-50)', borderRadius: 12 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{syncResult?.new || 0}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>新增时间线</div>
                  </div>
                </div>
                {syncResult?.new === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--gray-400)', marginBottom: 20 }}>
                    未发现新邮件，请确认已导入达人数据且达人的邮箱地址正确
                  </p>
                )}
                <button className="btn btn-primary" onClick={handleCloseSync}>完成</button>
              </>
            )}
          </div>
        </div>
      )}

      {showDiscoverModal && (
        <DiscoverModal onClose={() => setShowDiscoverModal(false)} accounts={accounts} />
      )}
    </div>
  )
}
