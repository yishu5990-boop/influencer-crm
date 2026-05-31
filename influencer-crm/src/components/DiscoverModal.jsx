import { useState, useEffect } from 'react'
import { discoverContacts, importInfluencers, syncGmail } from '../utils/storage'

export default function DiscoverModal({ onClose, accounts }) {
  const connectedAccounts = (accounts || []).filter(a => a.status === 'connected')
  const defaultEmail = connectedAccounts.length > 0 ? connectedAccounts[0].email : ''

  const [state, setState] = useState(defaultEmail ? 'selecting' : 'noaccount') // selecting | scanning | results | importing | syncing | done | error | noaccount
  const [scanEmail, setScanEmail] = useState(defaultEmail)
  const [contacts, setContacts] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [scanned, setScanned] = useState(0)
  const [error, setError] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectAll, setSelectAll] = useState(false)

  async function startDiscovery() {
    setState('scanning')
    try {
      const result = await discoverContacts(scanEmail)
      if (result.error) {
        setError(result.error)
        setState('error')
        return
      }
      const list = result.contacts || []
      setContacts(list)
      setScanned(result.scanned || 0)

      // 预勾选 keywordScore >= 2 的联系人
      const preSelected = new Set()
      for (const c of list) {
        if ((c.keywordScore || 0) >= 2) preSelected.add(c.email)
      }
      setSelected(preSelected)
      setState('results')
    } catch (e) {
      setError(e.message || '发现达人失败')
      setState('error')
    }
  }

  function toggleContact(email) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email); else next.add(email)
      return next
    })
  }

  function toggleSelectAll() {
    const filtered = filteredContacts()
    if (selectAll) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(c => c.email)))
    }
    setSelectAll(!selectAll)
  }

  function filteredContacts() {
    if (!searchTerm) return contacts
    const q = searchTerm.toLowerCase()
    return contacts.filter(c =>
      (c.displayName || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    )
  }

  async function handleImport() {
    setState('importing')
    const selectedContacts = contacts.filter(c => selected.has(c.email)).map(c => ({
      email: c.email,
      displayName: c.displayName,
    }))
    try {
      const result = await importInfluencers(selectedContacts)
      setImportResult(result)

      // 导入后自动同步邮件
      if (result.imported > 0) {
        setState('syncing')
        try {
          const syncResult = await syncGmail(scanEmail)
          setImportResult({ ...result, sync: syncResult })
        } catch {
          // 同步失败不影响导入结果
          setImportResult({ ...result, sync: { error: '邮件同步失败，请手动同步' } })
        }
      }
      setState('done')
    } catch (e) {
      setError(e.message || '导入失败')
      setState('error')
    }
  }

  function getInitial(name) {
    if (!name) return '?'
    return name[0].toUpperCase()
  }

  function formatDate(isoStr) {
    if (!isoStr) return '-'
    try {
      const d = new Date(isoStr)
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    } catch { return isoStr.slice(0, 10) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 640, maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>
              {state === 'scanning' ? `正在扫描 ${scanEmail}` : state === 'done' ? '导入完成' : '发现达人'}
            </h2>
            {state === 'results' && (
              <p style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 2 }}>
                共找到 {contacts.length} 个潜在联系人，已扫描 {scanned} 封邮件。勾选后点击导入
              </p>
            )}
          </div>
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 20, color: 'var(--gray-400)', lineHeight: 1 }}>&times;</span>
        </div>

        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {/* 无已连接邮箱 */}
          {state === 'noaccount' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
              <p style={{ fontSize: 16, color: 'var(--gray-600)', marginBottom: 8 }}>没有已连接的邮箱账号</p>
              <p style={{ fontSize: 13, color: 'var(--gray-400)', marginBottom: 16 }}>
                请先在邮箱设置页面添加并授权 Gmail 账号
              </p>
              <button className="btn btn-outline" onClick={onClose}>返回设置</button>
            </div>
          )}

          {/* 选择扫描邮箱 */}
          {state === 'selecting' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
              <p style={{ fontSize: 16, color: 'var(--gray-600)', marginBottom: 16 }}>选择要扫描的邮箱账号</p>
              <div style={{ maxWidth: 360, margin: '0 auto' }}>
                <select
                  value={scanEmail}
                  onChange={e => setScanEmail(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', fontSize: 14,
                    border: '1px solid var(--gray-200)', borderRadius: 8,
                    background: '#fff', outline: 'none', marginBottom: 16,
                  }}
                >
                  {connectedAccounts.map(acc => (
                    <option key={acc.email} value={acc.email}>{acc.email}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '10px 0', fontSize: 15 }}
                  onClick={startDiscovery}
                >
                  开始扫描
                </button>
                <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 12 }}>
                  系统将扫描该邮箱的收件箱，通过关键词匹配发现潜在达人
                </p>
              </div>
            </div>
          )}

          {/* 扫描中 */}
          {state === 'scanning' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
              <p style={{ fontSize: 16, color: 'var(--gray-600)', marginBottom: 8 }}>正在扫描 {scanEmail} 的收件箱...</p>
              <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>寻找潜在达人联系人，这可能需要几十秒</p>
              <div style={{ marginTop: 24, width: '100%', height: 4, background: 'var(--gray-100)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '60%', background: 'linear-gradient(90deg, var(--primary), var(--info-light))', borderRadius: 2, animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
            </div>
          )}

          {/* 结果列表 */}
          {state === 'results' && filteredContacts().length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="搜索联系人..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ flex: 1, padding: '6px 12px', fontSize: 13, border: '1px solid var(--gray-200)', borderRadius: 6, outline: 'none' }}
                />
                <button className="btn btn-outline btn-sm" onClick={toggleSelectAll}>
                  {selectAll ? '取消全选' : '全选'}
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={selected.size === 0}>
                  导入选中 ({selected.size})
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filteredContacts().map(c => {
                  const isChecked = selected.has(c.email)
                  return (
                    <div
                      key={c.email}
                      onClick={() => toggleContact(c.email)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 12px', borderRadius: 8,
                        cursor: 'pointer',
                        border: isChecked ? '2px solid var(--primary)' : '2px solid transparent',
                        background: isChecked ? '#f0f7ff' : 'var(--gray-50)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {/* 勾选框 */}
                      <div style={{
                        width: 20, height: 20, borderRadius: 4,
                        border: isChecked ? '2px solid var(--primary)' : '2px solid var(--gray-300)',
                        background: isChecked ? 'var(--primary)' : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, color: '#fff', fontSize: 12, fontWeight: 700,
                      }}>
                        {isChecked ? '✓' : ''}
                      </div>

                      {/* 头像 */}
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: `hsl(${c.email.charCodeAt(0) * 37 % 360}, 55%, 88%)`,
                        color: `hsl(${c.email.charCodeAt(0) * 37 % 360}, 60%, 35%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, fontWeight: 700, flexShrink: 0,
                      }}>
                        {getInitial(c.displayName || c.email)}
                      </div>

                      {/* 信息 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {c.displayName || c.email.split('@')[0]}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                          {c.email}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                          ✉ {c.count} 封 · 最后联系 {formatDate(c.lastDate)}
                          {c.matchedKeywords && c.matchedKeywords.length > 0 && (
                            <span style={{ marginLeft: 8 }}>
                              {c.matchedKeywords.slice(0, 4).map(kw => (
                                <span key={kw} style={{
                                  display: 'inline-block',
                                  background: '#dcfce7', color: '#166534',
                                  padding: '0 6px', borderRadius: 8, fontSize: 10,
                                  marginRight: 3, fontWeight: 500,
                                }}>{kw}</span>
                              ))}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 分数标签 */}
                      {(c.keywordScore || 0) > 0 && (
                        <div style={{
                          background: 'var(--primary)',
                          color: '#fff',
                          fontSize: 11, fontWeight: 700,
                          padding: '2px 8px', borderRadius: 10,
                          flexShrink: 0,
                        }}>
                          {c.keywordScore} 分
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* 空结果 */}
          {state === 'results' && filteredContacts().length === 0 && contacts.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
              <p style={{ fontSize: 15, color: 'var(--gray-600)', marginBottom: 4 }}>没有发现新的潜在联系人</p>
              <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>
                已扫描 {scanned} 封邮件，未发现未录入的外部联系人
              </p>
              <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 4 }}>
                提示：请确保收件箱中有与外部联系人的往来邮件
              </p>
            </div>
          )}

          {state === 'results' && filteredContacts().length === 0 && contacts.length > 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ fontSize: 14, color: 'var(--gray-500)' }}>没有匹配搜索条件的联系人</p>
            </div>
          )}

          {/* 导入中 */}
          {(state === 'importing' || state === 'syncing') && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{state === 'syncing' ? '📬' : '⏳'}</div>
              <p style={{ fontSize: 15, color: 'var(--gray-600)' }}>
                {state === 'syncing' ? '正在同步历史邮件...' : '正在导入达人...'}
              </p>
              <p style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 4 }}>
                {state === 'syncing' ? '通过 IMAP 搜索往来邮件' : '创建达人记录'}
              </p>
            </div>
          )}

          {/* 导入完成 */}
          {state === 'done' && importResult && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>导入完成</p>
              <p style={{ fontSize: 14, color: 'var(--gray-500)' }}>
                成功导入 {importResult.imported} 人
                {importResult.skipped > 0 && ` · 跳过 ${importResult.skipped} 人（已存在）`}
              </p>
              {importResult.sync && !importResult.sync.error && (
                <p style={{ fontSize: 13, color: 'var(--success)', marginTop: 4 }}>
                  📬 已同步 {importResult.sync.new || 0} 封新邮件
                </p>
              )}
              {importResult.sync && importResult.sync.error && (
                <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 4 }}>
                  ⚠ {importResult.sync.error}
                </p>
              )}
              {importResult.created && importResult.created.length > 0 && (
                <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                  {importResult.created.map(inf => (
                    <span key={inf.id} style={{
                      background: '#f0fdf4', color: '#065f46',
                      padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
                    }}>{inf.name}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 错误 */}
          {state === 'error' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
              <p style={{ fontSize: 15, color: 'var(--danger)', marginBottom: 8 }}>{error || '操作失败'}</p>
              <button className="btn btn-outline btn-sm" onClick={() => setState('selecting')}>重试</button>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {state === 'done' && (
            <button className="btn btn-primary" onClick={onClose}>完成</button>
          )}
          {state === 'error' && (
            <button className="btn btn-outline" onClick={onClose}>关闭</button>
          )}
          {(state === 'results' || state === 'selecting') && (
            <button className="btn btn-outline" onClick={onClose}>取消</button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
