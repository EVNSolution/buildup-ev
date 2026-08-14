import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Role } from '@shared/types/index'
import { homeFor } from '../lib/surfaces'

async function apiChangePassword(current: string, next: string): Promise<void> {
  const res = await fetch('/api/v1/auth/change-password', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: current, new_password: next }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `비밀번호 변경 실패: ${res.status}`)
  }
}

export function ChangePasswordPage() {
  const { session, refreshSession } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isMustChange = session?.user.must_change_pw ?? false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!current || !next || !confirm) { setError('모든 항목을 입력해 주세요.'); return }
    if (next !== confirm) { setError('새 비밀번호가 일치하지 않습니다.'); return }
    if (next.length < 8) { setError('새 비밀번호는 8자 이상이어야 합니다.'); return }
    setLoading(true)
    setError('')
    try {
      await apiChangePassword(current, next)
      await refreshSession()
      const role = session?.user.role ?? 'SALES'
      navigate(homeFor(role as Role), { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '비밀번호 변경 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>EV<b style={styles.logoBold}>&</b>Solution</div>
        <h2 style={styles.title}>비밀번호 변경</h2>
        {isMustChange && (
          <div style={styles.notice}>
            최초 로그인입니다. 임시 비밀번호를 변경해 주세요.
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.fieldRow}>
            <label style={styles.label}>현재 비밀번호</label>
            <input
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              style={styles.input}
              disabled={loading}
              autoComplete="current-password"
              placeholder="현재(임시) 비밀번호"
            />
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.label}>새 비밀번호 (8자 이상)</label>
            <input
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              style={styles.input}
              disabled={loading}
              autoComplete="new-password"
              placeholder="새 비밀번호"
            />
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.label}>새 비밀번호 확인</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              style={styles.input}
              disabled={loading}
              autoComplete="new-password"
              placeholder="새 비밀번호 재입력"
            />
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" style={styles.submitBtn} disabled={loading}>
            {loading ? '변경 중…' : '비밀번호 변경'}
          </button>
        </form>

        {!isMustChange && (
          <button style={styles.cancelBtn} onClick={() => navigate(-1)} disabled={loading}>
            취소
          </button>
        )}
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
  title: { fontSize: 18, fontWeight: 700, color: 'var(--dark)', margin: '0 0 16px' },
  notice: {
    fontSize: 13, color: 'var(--dark)', background: 'var(--card)',
    border: '0.5px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginBottom: 16,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  fieldRow: {},
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 },
  input: { width: '100%', boxSizing: 'border-box' as const },
  error: { fontSize: 12, color: 'var(--warn)', background: 'var(--warnbg)', padding: '7px 10px', borderRadius: 8 },
  submitBtn: {
    padding: '12px', border: 'none', borderRadius: 9, cursor: 'pointer',
    background: 'var(--lime)', color: 'var(--dark)', fontWeight: 700, fontSize: 13.5,
  },
  cancelBtn: {
    marginTop: 12, width: '100%', padding: '10px', border: '0.5px solid var(--line)',
    borderRadius: 9, cursor: 'pointer', background: '#fff', color: 'var(--muted)', fontSize: 13,
  },
}
