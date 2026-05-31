import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { login, register, demoLogin } = useAuth()
  const navigate = useNavigate()
  const [isRegister, setIsRegister] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('admin@crm.com')
  const [password, setPassword] = useState('7AayN6R9LtShXsFb')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (isRegister) {
        await register(name, email, password)
      } else {
        await login(email, password)
      }
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #ede9fe 0%, #e0e7ff 50%, #fce7f3 100%)',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 36px',
        width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📧</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--gray-800)', marginBottom: 4 }}>
            达人邮件助手
          </h1>
          <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>
            {isRegister ? '创建新账号' : '登录你的账号'}
          </p>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', marginBottom: 16,
            background: 'var(--danger-light)', borderRadius: 8,
            fontSize: 13, color: '#991b1b',
          }}>
            {error}
          </div>
        )}

        <button
          onClick={async () => {
            setError('')
            setSubmitting(true)
            try { await demoLogin(); navigate('/') }
            catch (err) { setError(err.message) }
            finally { setSubmitting(false) }
          }}
          disabled={submitting}
          style={{
            width: '100%', padding: '16px', border: 'none', borderRadius: 12, cursor: 'pointer',
            background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
            color: '#fff', marginBottom: 16, transition: 'opacity 0.2s',
          }}
          onMouseOver={(e) => { e.currentTarget.style.opacity = '0.9' }}
          onMouseOut={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            {submitting ? '⏳ 登录中...' : '👁 一键演示登录'}
          </div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>
            账号：admin@crm.com ｜ 密码：7AayN6R9LtShXsFb
          </div>
        </button>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--gray-200)' }} />
          <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>或手动登录</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--gray-200)' }} />
        </div>

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div className="form-group">
              <label>名字</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="你的名字" autoFocus={isRegister}
              />
            </div>
          )}
          <div className="form-group">
            <label>邮箱</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com" autoFocus={!isRegister}
            />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ width: '100%', padding: '12px', fontSize: 15, marginTop: 8 }}
          >
            {submitting ? '处理中...' : isRegister ? '注册' : '登录'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button
            onClick={() => { setIsRegister(!isRegister); setError('') }}
            style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 13, cursor: 'pointer' }}
          >
            {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
          </button>
        </div>

        {!isRegister && (
          <div style={{
            marginTop: 20, padding: '12px', background: 'var(--gray-50)',
            borderRadius: 8, fontSize: 12, color: 'var(--gray-400)', textAlign: 'center',
          }}>
            账号：admin@crm.com / 密码：7AayN6R9LtShXsFb
          </div>
        )}
      </div>
    </div>
  )
}
