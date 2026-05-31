import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { auth, setToken, clearToken } from '../utils/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      auth.me()
        .then(u => setUser(u))
        .catch(() => clearToken())
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = useCallback(async (email, password) => {
    const result = await auth.login(email, password)
    setToken(result.token)
    setUser(result.user)
    return result
  }, [])

  const register = useCallback(async (name, email, password) => {
    const result = await auth.register(name, email, password)
    setToken(result.token)
    setUser(result.user)
    return result
  }, [])

  const demoLogin = useCallback(async () => {
    const result = await auth.demo()
    setToken(result.token)
    setUser(result.user)
    return result
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, demoLogin, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
