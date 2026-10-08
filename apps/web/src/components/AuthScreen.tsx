import { useState, type FormEvent } from 'react'

interface AuthScreenProps {
  authError: string
  isSubmitting: boolean
  onLogin: (payload: { login: string; password: string }) => Promise<void>
  onRegister: (payload: {
    displayName: string
    email: string
    password: string
    username: string
  }) => Promise<void>
}

type AuthMode = 'login' | 'register'

export function AuthScreen({
  authError,
  isSubmitting,
  onLogin,
  onRegister,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [loginValue, setLoginValue] = useState('admin_demo')
  const [loginPassword, setLoginPassword] = useState('demo_hash_admin')
  const [registerPassword, setRegisterPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (mode === 'login') {
      await onLogin({
        login: loginValue.trim(),
        password: loginPassword,
      })
      return
    }

    await onRegister({
      displayName: displayName.trim(),
      email: email.trim(),
      password: registerPassword,
      username: username.trim(),
    })
  }

  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <p className="eyebrow">在线协作文档编辑器</p>
        <h1>先登录，再进入多人工作区</h1>
        <p>
          当前项目已经接入真实 MySQL、双 token 登录机制、文档级权限控制，以及实时协作文档同步能力。
        </p>
      </section>

      <section className="auth-card">
        <div className="auth-mode-toggle">
          <button
            className={`ghost-button${mode === 'login' ? ' active' : ''}`}
            type="button"
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            className={`ghost-button${mode === 'register' ? ' active' : ''}`}
            type="button"
            onClick={() => setMode('register')}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' ? (
            <>
              <label className="auth-field">
                <span>用户名</span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>

              <label className="auth-field">
                <span>显示名称</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>

              <label className="auth-field">
                <span>邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="auth-field">
              <span>用户名或邮箱</span>
              <input
                type="text"
                value={loginValue}
                onChange={(event) => setLoginValue(event.target.value)}
              />
            </label>
          )}

          <label className="auth-field">
            <span>密码</span>
            <input
              type="password"
              value={mode === 'login' ? loginPassword : registerPassword}
              onChange={(event) =>
                mode === 'login'
                  ? setLoginPassword(event.target.value)
                  : setRegisterPassword(event.target.value)
              }
            />
          </label>

          <button
            className="primary-button auth-submit"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting
              ? '提交中…'
              : mode === 'login'
                ? '进入工作区'
                : '创建账号'}
          </button>
        </form>

        {authError ? (
          <div className="error-card auth-error">
            <p>{authError}</p>
          </div>
        ) : null}

        <div className="hint-card">
          <p className="hint-title">演示账号提示</p>
          <p>
            如果你已经导入了测试数据，最快的演示账号是 <code>admin_demo</code>，
            密码是 <code>demo_hash_admin</code>。
          </p>
        </div>
      </section>
    </main>
  )
}
