import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { homeFor } from '../lib/surfaces'

export function LoginPage() {
  const { login, session, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && session) {
      navigate(homeFor(session.user.role), { replace: true })
    }
  }, [session, loading, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('이메일과 비밀번호를 입력해 주세요.'); return }
    setSubmitting(true)
    setError('')
    try {
      await login(email.trim(), password)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '로그인 실패')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return null

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>EV<b style={styles.logoBold}>&</b>Solution</div>
        <p style={styles.sub}>buildup-ev 플랫폼</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.fieldRow}>
            <label style={styles.label}>이메일</label>
            <input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={styles.input}
              disabled={submitting}
              autoComplete="email"
            />
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.label}>비밀번호</label>
            <input
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={styles.input}
              disabled={submitting}
              autoComplete="current-password"
            />
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" style={styles.loginBtn} disabled={submitting}>
            {submitting ? '로그인 중…' : '로그인'}
          </button>
        </form>

        <div style={styles.notice}>계정은 관리자가 발급합니다. 회원가입 없음.</div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'var(--card)',
  },
  card: {
    background: '#fff', borderRadius: 16, padding: '36px 32px',
    width: 400, maxWidth: '94vw',
    boxShadow: '0 4px 24px rgba(0,0,0,.08)',
  },
  logo: { fontWeight: 800, fontSize: 22, color: 'var(--dark)', marginBottom: 4 },
  logoBold: { color: 'var(--lime)' },
  sub: { margin: '0 0 28px', fontSize: 13, color: 'var(--muted)' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  fieldRow: {},
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 },
  input: { width: '100%', boxSizing: 'border-box' as const },
  error: { fontSize: 12, color: 'var(--warn)', background: 'var(--warnbg)', padding: '7px 10px', borderRadius: 8 },
  loginBtn: {
    padding: '12px', border: 'none', borderRadius: 9, cursor: 'pointer',
    background: 'var(--lime)', color: 'var(--dark)', fontWeight: 700, fontSize: 13.5,
  },
  notice: { marginTop: 20, fontSize: 11.5, color: 'var(--muted)', textAlign: 'center' },
}
