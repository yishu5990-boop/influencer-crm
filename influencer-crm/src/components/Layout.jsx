import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import UserProfile from './UserProfile'

export default function Layout() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">📧 达人邮件助手</div>
        <nav className="sidebar-nav">
          <NavLink to="/" end>🏠 首页总览</NavLink>
          <NavLink to="/reports">👥 达人管理</NavLink>
          <NavLink to="/email-settings">⚙️ 邮箱设置</NavLink>
        </nav>
        <UserProfile />
        <button
          onClick={handleLogout}
          style={{
            marginTop: 8, padding: '8px 12px',
            background: 'transparent', border: '1px solid var(--gray-200)',
            borderRadius: 8, cursor: 'pointer', fontSize: 12, color: 'var(--gray-500)',
          }}
        >
          退出登录
        </button>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
