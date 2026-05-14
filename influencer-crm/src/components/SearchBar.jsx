import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPhaseInfo } from '../data/mockData'

export default function SearchBar({ influencers = [], autoFocus = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const navigate = useNavigate()

  const handleSearch = (value) => {
    setQuery(value)
    if (value.trim().length > 0) {
      const q = value.toLowerCase()
      const filtered = influencers.filter(
        (inf) =>
          inf.name.toLowerCase().includes(q) ||
          inf.account.toLowerCase().includes(q) ||
          (inf.emails || [inf.email]).some((e) => e.toLowerCase().includes(q))
      )
      setResults(filtered)
      setShowDropdown(true)
    } else {
      setResults([])
      setShowDropdown(false)
    }
  }

  const goToInfluencer = (id) => {
    setShowDropdown(false)
    setQuery('')
    navigate(`/influencer/${id}`)
  }

  const highlightMatch = (text) => {
    if (!query.trim()) return text
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return parts.map((part, i) =>
      i % 2 === 1
        ? <mark key={i} style={{ background: '#fde68a', color: '#92400e', borderRadius: 2, padding: '0 2px' }}>{part}</mark>
        : part
    )
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (results.length === 1) {
      goToInfluencer(results[0].id)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <form className="search-bar" onSubmit={handleSubmit}>
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索达人名字 / 账号 / 邮箱..."
            autoFocus={autoFocus}
            onFocus={() => query.trim() && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          />
        </div>
      </form>
      <div className="search-hint">
        支持搜索：<span>达人名字</span> · <span>账号名称</span> · <span>达人邮箱（含历史邮箱）</span>
      </div>

      {showDropdown && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 52, left: 0, right: 0,
          background: '#fff', borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-md)', border: '1px solid var(--gray-200)',
          zIndex: 50, maxHeight: 300, overflowY: 'auto',
        }}>
          {results.map((inf) => (
            <div key={inf.id} onClick={() => goToInfluencer(inf.id)}
              style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)' }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'var(--gray-50)')}
              onMouseOut={(e) => (e.currentTarget.style.background = '#fff')}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{highlightMatch(inf.name)}</div>
                <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>{highlightMatch(inf.account)} · {highlightMatch(inf.email || (inf.emails && inf.emails[0]) || '')}</div>
              </div>
              <span className="badge" style={{ fontSize: 11, background: getPhaseInfo(inf.phase).bg, color: getPhaseInfo(inf.phase).textColor }}>
                {inf.phase}
              </span>
            </div>
          ))}
        </div>
      )}
      {showDropdown && query.trim() && results.length === 0 && (
        <div style={{
          position: 'absolute', top: 52, left: 0, right: 0,
          background: '#fff', borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-md)', border: '1px solid var(--gray-200)',
          zIndex: 50, padding: '20px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 14,
        }}>
          未找到匹配的达人
        </div>
      )}
    </div>
  )
}
