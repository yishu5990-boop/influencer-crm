import { useState, useEffect } from 'react'
import { getData, updateSignature } from '../utils/storage'

const DEFAULT_QUOTES = [
  '今天也是高效的一天 ✨',
  '每一封邮件都值得被认真对待 💌',
  '好记性不如好工具 🚀',
  '让沟通变得简单而有温度 🌟',
  '达人运营，从整理开始 📮',
  '用心连接每一个创作者 💪',
]

export default function Signature() {
  const [signature, setSignature] = useState('')
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')

  useEffect(() => {
    const data = getData()
    if (data.signatureCustom && data.signature) {
      setSignature(data.signature)
    } else {
      const today = new Date().getDate()
      setSignature(DEFAULT_QUOTES[today % DEFAULT_QUOTES.length])
    }
  }, [])

  const handleSave = () => {
    const text = input.trim()
    if (text) {
      setSignature(text)
      updateSignature(text, true)
    }
    setEditing(false)
    setInput('')
  }

  return (
    <div style={{ marginTop: 'auto', padding: '12px', borderTop: '1px solid var(--gray-200)' }}>
      {editing ? (
        <div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="写下今天的心情..."
            style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13, marginBottom: 6 }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>保存</button>
            <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{signature}</span>
          <span onClick={() => { setInput(signature); setEditing(true) }} style={{ cursor: 'pointer', fontSize: 14 }} title="编辑签名">✏️</span>
        </div>
      )}
    </div>
  )
}
