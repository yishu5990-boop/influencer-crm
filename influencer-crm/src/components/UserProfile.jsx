import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getUserProfile, updateUserProfile, getOperatorEmails, saveOperatorEmails } from '../utils/storage'

export default function UserProfile() {
  const { user: authUser } = useAuth()
  const [profile, setProfile] = useState({ name: '小李', role: '达人运营', signature: '' })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', role: '', signature: '', operatorEmails: '' })

  useEffect(() => {
    if (authUser) {
      setProfile({
        name: authUser.name || '小李',
        role: authUser.role || '达人运营',
        signature: authUser.signature || '',
      })
    }
  }, [authUser])

  const handleSave = async () => {
    const updated = {
      name: form.name.trim() || profile.name,
      role: form.role.trim() || profile.role,
      signature: form.signature.trim() || profile.signature,
    }
    setProfile(updated)
    await updateUserProfile(updated)

    const emails = form.operatorEmails
      .split(/[,;\n]/)
      .map((e) => e.trim())
      .filter((e) => e.includes('@'))
    if (emails.length > 0) await saveOperatorEmails(emails)
    setEditing(false)
  }

  return (
    <div style={{ marginTop: 'auto', padding: '12px 8px' }}>
      {editing ? (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="你的名字" style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 12, outline: 'none' }} autoFocus />
            <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
              placeholder="职位" style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 12, outline: 'none' }} />
          </div>
          <input value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })}
            placeholder="今天想说点什么..." style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 12, marginBottom: 6, outline: 'none' }} />
          <textarea value={form.operatorEmails} onChange={(e) => setForm({ ...form, operatorEmails: e.target.value })}
            placeholder="我方工作邮箱（逗号或换行分隔）" rows={2}
            style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 11, marginBottom: 6, outline: 'none', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>保存</button>
            <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div
          onClick={async () => {
            const emails = await getOperatorEmails()
            setForm({ name: profile.name, role: profile.role, signature: profile.signature, operatorEmails: Array.isArray(emails) ? emails.join(', ') : '' })
            setEditing(true)
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderRadius: 8, padding: 8, transition: 'background 0.15s' }}
          onMouseOver={(e) => (e.currentTarget.style.background = '#fff')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, #818cf8, #c084fc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {profile.name[0]}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--gray-800)' }}>{profile.name}</div>
            <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{profile.role}</div>
            <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.signature}</div>
          </div>
        </div>
      )}
    </div>
  )
}
