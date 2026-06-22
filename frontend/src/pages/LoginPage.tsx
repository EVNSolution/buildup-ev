import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Role } from '@shared/types/index'

const ROLE_HOME: Record<Role, string> = {
  SALES: '/sales',
  ADMIN: '/admin',
  MAKER: '/maker',
}

const SEED_ACCOUNTS: { email: string; role: Role; name: string; org: string }[] = [
  { email: 'admin@evnsolution.com',  role: 'ADMIN', name: '관리자',  org: 'EV&Solution 본사' },
  { email: 'sales1@evnsolution.com', role: 'SALES', name: '영업담당', org: 'EV&Solution 본사' },
  { email: 'maker1@partner.com',     role: 'MAKER', name: '특장담당', org: '△△특장' },
]

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'SALES', label: '영업 (Sales)' },
  { value: 'ADMIN', label: '관리자 (Admin)' },
  { value: 'MAKER', label: '특장사 (Maker)' },
]

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // custom form
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('SALES')

  async function handleSeedLogin(acc: typeof SEED_ACCOUNTS[0]) {
    setLoading(true)
    setError('')
    try {
      await login(acc.email, acc.role)
      navigate(ROLE_HOME[acc.role], { replace: true })
    } catch {
      setError('로그인 실패')
    } finally {
      setLoading(false)
    }
  }

  async function handleCustomLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('이메일을 입력해 주세요.'); return }
    setLoading(true)
    setError('')
    try {
      await login(email.trim(), role)
      navigate(ROLE_HOME[role], { replace: true })
    } catch {
      setError('로그인 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>EV<b style={styles.logoBold}>&</b>Solution</div>
        <p style={styles.sub}>buildup-ev 플랫폼</p>

        <div style={styles.section}>
          <div style={styles.sectionLabel}>시드 계정으로 바로 로그인</div>
          <div style={styles.seedList}>
            {SEED_ACCOUNTS.map(acc => (
              <button
                key={acc.email}
                style={styles.seedBtn}
                onClick={() => handleSeedLogin(acc)}
                disabled={loading}
              >
                <span style={styles.seedRole}>{acc.role}</span>
                <span style={styles.seedName}>{acc.name}</span>
                <span style={styles.seedEmail}>{acc.email}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={styles.divider}><span>또는 직접 입력</span></div>

        <form onSubmit={handleCustomLogin} style={styles.form}>
          <div style={styles.fieldRow}>
            <label style={styles.label}>이메일</label>
            <input
              type="text"
              placeholder="email@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={styles.input}
              disabled={loading}
            />
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.label}>역할</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as Role)}
              style={styles.input}
              disabled={loading}
            >
              {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" style={styles.loginBtn} disabled={loading}>
            {loading ? '로그인 중…' : '로그인'}
          </button>
        </form>

        <div style={styles.notice}>
          계정은 관리자가 발급합니다. 회원가입 없음.
        </div>
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
    width: 420, maxWidth: '94vw',
    boxShadow: '0 4px 24px rgba(0,0,0,.08)',
  },
  logo: { fontWeight: 800, fontSize: 22, color: 'var(--dark)', marginBottom: 4 },
  logoBold: { color: 'var(--lime)' },
  sub: { margin: '0 0 24px', fontSize: 13, color: 'var(--muted)' },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 },
  seedList: { display: 'flex', flexDirection: 'column', gap: 8 },
  seedBtn: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', border: '1px solid var(--line)',
    borderRadius: 10, background: '#fff', cursor: 'pointer',
    textAlign: 'left',
  },
  seedRole: {
    fontSize: 11, fontWeight: 700, background: 'var(--lime)',
    color: 'var(--dark)', padding: '2px 8px', borderRadius: 12, flexShrink: 0,
  },
  seedName: { fontSize: 13, fontWeight: 600, color: 'var(--dark)', flexShrink: 0 },
  seedEmail: { fontSize: 11.5, color: 'var(--muted)', marginLeft: 'auto' },
  divider: {
    display: 'flex', alignItems: 'center', gap: 10,
    margin: '20px 0', color: 'var(--muted)', fontSize: 12,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  fieldRow: {},
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 },
  input: { width: '100%' },
  error: { fontSize: 12, color: 'var(--warn)', background: 'var(--warnbg)', padding: '7px 10px', borderRadius: 8 },
  loginBtn: {
    padding: '12px', border: 'none', borderRadius: 9, cursor: 'pointer',
    background: 'var(--lime)', color: 'var(--dark)', fontWeight: 700, fontSize: 13.5,
  },
  notice: { marginTop: 20, fontSize: 11.5, color: 'var(--muted)', textAlign: 'center' },
}
