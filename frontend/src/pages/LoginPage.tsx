import { useEffect, useState } from 'react'
import { t } from '../i18n'
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
  /*
   * 「로그인 상태 유지」 — **기본 체크.** 매일 로그인하던 불편을 없애는 것이 목적이라
   * 그냥 로그인하는 대부분이 오래 유지되어야 한다. 공용 PC 에서만 풀면 된다.
   */
  const [remember, setRemember] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && session) {
      navigate(homeFor(session.user.role), { replace: true })
    }
  }, [session, loading, navigate])

  /*
   * **로컬에서는 그냥 들어간다**(2026-09-16 지시 — 개발할 때 비밀번호를 치지 않게).
   *
   * ⚠️ 이 코드는 **개발 서버에서만 산다.** `import.meta.env.DEV` 는 빌드할 때 false 로 굳어
   *    운영 번들에서는 이 블록이 통째로 사라진다. 서버 쪽도 운영에는 그 경로가 없다(routes/dev-auth.ts).
   */
  useEffect(() => {
    if (!import.meta.env.DEV || loading || session) return
    if (window.location.hostname !== 'localhost') return
    const to = `${window.location.origin}/admin`
    window.location.replace(`http://localhost:3001/api/v1/dev/login?email=master@local&to=${encodeURIComponent(to)}`)
  }, [session, loading])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) { setError(t('이메일과 비밀번호를 입력해 주세요.')); return }
    setSubmitting(true)
    setError('')
    try {
      await login(email.trim(), password, remember)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('로그인 실패'))
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
            <label style={s.label} htmlFor="login-email">{t('이메일')}</label>
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
            <label style={s.label} htmlFor="login-pw">{t('비밀번호')}</label>
            <input
              id="login-pw"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={submitting}
              autoComplete="current-password"
            />
          </div>

          {/* 글자까지 눌러도 켜지고 꺼지게 label 로 감싼다 — 작은 네모만 누르게 하면 손가락이 못 맞춘다 */}
          <label style={s.remember}>
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              disabled={submitting}
              style={s.rememberBox}
            />
            <span>
              {t('로그인 상태 유지')}
              <span style={s.rememberHint}>{t('공용 PC에서는 체크를 해제하세요')}</span>
            </span>
          </label>

          {error && <div style={s.error}>{error}</div>}

          <button type="submit" style={{ ...BTN.primary, width: '100%' }} disabled={submitting}>
            {submitting ? t('로그인 중…') : t('로그인')}
          </button>
        </form>
      </div>

      {/*
        되돌아갈 길 — 고객이 「로그인」을 잘못 눌러 들어왔을 때 여기서 막히면 안 된다.
        카드 밖에 두어 로그인 폼의 일부로 읽히지 않게 한다.
      */}
      <Link to="/" style={s.back}>{t('← 로그인 없이 견적 보기')}</Link>
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
    width: 380, maxWidth: '94vw', boxShadow: 'var(--shadow-2)', border: 'var(--hairline)',
  },
  // 로고(706×261) — 높이만 정하고 폭은 비율대로. 아래 여백이 곧 제목 자리를 대신한다.
  logo: { height: 30, width: 'auto', display: 'block', marginBottom: 'var(--sp-6)' },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },
  label: { display: 'block', fontSize: 'var(--fs-label)', color: 'var(--muted)', marginBottom: 'var(--sp-1)' },
  remember: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minHeight: 50,  // 휴대폰은 zoom .88 이 걸려 50 → 44px
    fontSize: 'var(--fs-label)', cursor: 'pointer', userSelect: 'none',
  },
  rememberBox: { width: 20, height: 20, margin: 0, flexShrink: 0, accentColor: 'var(--lime)' },
  rememberHint: { display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  error: {
    fontSize: 'var(--fs-label)', color: 'var(--warn)', background: 'var(--warnbg)',
    border: 'var(--hairline)', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-sm)',
  },
  back: { fontSize: 'var(--fs-label)', color: 'var(--muted)', textDecoration: 'none' },
}
