import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { homeFor } from '../lib/surfaces'
import { BTN } from '../styles/buttons'
import logoUrl from '../assets/logo.png'

/**
 * 로그인 — 임직원 전용.
 *
 * 사이트를 공개한 뒤로 **이 화면은 첫인상이 아니다.** 첫 화면은 공개 컨피규레이터고,
 * 여기는 헤더의 「로그인」을 눌러 들어오는 자리다. 그래서
 *   · 서비스 소개 문구를 두지 않는다(공개 화면이 이미 그 일을 한다)
 *   · **되돌아갈 길**을 반드시 둔다 — 잘못 들어온 고객이 막다른 길에 서면 안 된다
 */
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
    <div style={s.page}>
      <div style={s.card}>
        {/* 로고는 이미지 한 장 — 글자로 흉내 내면 기기마다 다르게 보인다 */}
        <img src={logoUrl} alt="EV&Solution" style={s.logo} />

        <form onSubmit={handleSubmit} style={s.form}>
          <div>
            <label style={s.label} htmlFor="login-email">이메일</label>
            <input
              id="login-email"
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={submitting}
              autoComplete="email"
              autoFocus
            />
          </div>
          <div>
            <label style={s.label} htmlFor="login-pw">비밀번호</label>
            <input
              id="login-pw"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={submitting}
              autoComplete="current-password"
            />
          </div>

          {error && <div style={s.error}>{error}</div>}

          <button type="submit" style={{ ...BTN.primary, width: '100%' }} disabled={submitting}>
            {submitting ? '로그인 중…' : '로그인'}
          </button>
        </form>
      </div>

      {/*
        되돌아갈 길 — 고객이 「로그인」을 잘못 눌러 들어왔을 때 여기서 막히면 안 된다.
        카드 밖에 두어 로그인 폼의 일부로 읽히지 않게 한다.
      */}
      <Link to="/" style={s.back}>← 로그인 없이 견적 보기</Link>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    height: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-4)',
    background: 'var(--card)', padding: 'var(--sp-4)',
  },
  card: {
    background: '#fff', borderRadius: 'var(--r-md)', padding: 'var(--sp-6) var(--sp-5)',
    width: 380, maxWidth: '94vw', boxShadow: 'var(--shadow-2)',
  },
  // 로고(706×261) — 높이만 정하고 폭은 비율대로. 아래 여백이 곧 제목 자리를 대신한다.
  logo: { height: 30, width: 'auto', display: 'block', marginBottom: 'var(--sp-6)' },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },
  label: { display: 'block', fontSize: 'var(--fs-label)', color: 'var(--muted)', marginBottom: 5 },
  error: {
    fontSize: 'var(--fs-label)', color: 'var(--warn)', background: 'var(--warnbg)',
    border: 'var(--hairline)', padding: '8px 10px', borderRadius: 'var(--r-sm)',
  },
  back: { fontSize: 'var(--fs-label)', color: 'var(--muted)', textDecoration: 'none' },
}
