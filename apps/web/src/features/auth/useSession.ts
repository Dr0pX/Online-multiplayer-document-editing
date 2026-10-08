import { useEffect, useState } from 'react'
import {
  getCurrentUser, // GET/api/auth/me - 用现有 access token 获取当前用户
  login,  // POST/api/auth/login/ - 登录
  logout, // POST/api/auth/logout - 登出
  refreshSession, // POST/api/auth/refresh - 用 refresh cookie 换取新 token
  register, // POST/api/auth/register - 注册
} from '../../services/api/auth'
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '../../services/auth/session'
import { isHttpClientError } from '../../services/http/errors'  // 类型守卫，用于在登出时区分“正常的 401 （已经无效的会话）”和“真正的网络错误”。
import type { AuthUser } from '../../types/auth'

interface LoginInput {
  login: string
  password: string
}

interface RegisterInput {
  displayName: string
  email: string
  password: string
  username: string
}

interface SessionState {
  authError: string
  clearAuthError: () => void
  isAuthenticating: boolean
  isBooting: boolean
  loginWithPassword: (payload: LoginInput) => Promise<void>
  logoutCurrentUser: () => Promise<void>
  registerAccount: (payload: RegisterInput) => Promise<void>
  user: AuthUser | null
}
// Hook 主体
export function useSession(): SessionState {
  const [user, setUser] = useState<AuthUser | null>(null) // 核心状态 null —— 未登录或会话恢复失败。有值 —— 已登录
  const [isBooting, setIsBooting] = useState(true)  // 应用启动时为 true，会话回复完成（成功/失败）后为 false
  // 登录/注册按钮的 loading 状态，与 isBooting 分离的原因是：isBooting 控制整页 loading， isAuthenticationg 控制按钮loading
  const [isAuthenticating, setIsAuthenticating] = useState(false) 
  const [authError, setAuthError] = useState('')  // 显示在登录/注册表单下方的错误信息

  useEffect(() => {
    let active = true // 防竞态标记，Strict Mode 的两次重复挂载，会使的异步请求返回时报错

    async function bootstrap() {
      try {
        if (!getAccessToken()) {  // 分支 A：localStorage 中没有 access token
          // 即使没有 access token，仍尝试用 httpOnly cookie 中的 refresh token 恢复
          const restoredSession = await refreshSession()  

          if (!active) {
            return
          }
          
          setAccessToken(restoredSession.accessToken)
          setUser(restoredSession.user)
          return
        }

        const currentUser = await getCurrentUser()  // 分支 B：localStorage 中存在 access token

        if (!active) {
          return
        }

        setUser(currentUser)
      } catch (error) {
        if (!active) {
          return
        }

        clearAccessToken()  // 报错时清理无效 token
        setUser(null) // 标记为未登录状态
        setAuthError('')  // 清除错误——这不是用户操作导致的错误，不用显示
      } finally {
        if (active) {
          setIsBooting(false) // 无论成功/失败，结束 boot 状态
        }
      }
    }

    void bootstrap()

    return () => {
      active = false  // 标记组件已卸载
    }
  }, [])
  // 登录 
  async function loginWithPassword(payload: LoginInput) {
    try {
      setIsAuthenticating(true) // 按钮 loading —— “提交中”
      setAuthError('')  // 清除上次错误
      const session = await login(payload)  // POST /api/auth/login 
      setAccessToken(session.accessToken) // 存入localStorage
      setUser(session.user) // 更新用户状态 —— 触发页面切换
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Login failed.')
      throw error // 重新抛出，调用方可根据是否抛出判断登录是否成功
    } finally {
      setIsAuthenticating(false)
    }
  }
  // 注册，与登录逻辑基本相同，因为现在应用一般注册即登录
  async function registerAccount(payload: RegisterInput) {
    try {
      setIsAuthenticating(true)
      setAuthError('')
      const session = await register(payload)
      setAccessToken(session.accessToken)
      setUser(session.user)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Registration failed.')
      throw error
    } finally {
      setIsAuthenticating(false)
    }
  }
  // 登出
  async function logoutCurrentUser() {
    try {
      setAuthError('')
      if (getAccessToken()) {
        await logout()  // 携带 cookie —— 后端 revoke refresh session
      }
      // 如果已经没有 access token，跳过 API，因为这时后端 session 已经失效了
    } catch (error) {
      if (!isHttpClientError(error) || error.statusCode !== 401) {  // 收到401（session已经失效）是预期行为不需要显示错误
        setAuthError(error instanceof Error ? error.message : 'Logout failed.')
      }
    } finally {
      clearAccessToken()  // 无论如何都清除本地 token
      setUser(null) // 无论如何都清除用户状态
    }
  }

  function clearAuthError() {
    setAuthError('')
  }

  return {
    authError,
    clearAuthError,
    isAuthenticating,
    isBooting,
    loginWithPassword,
    logoutCurrentUser,
    registerAccount,
    user,
  }
}
