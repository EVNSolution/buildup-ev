import { useState } from 'react'
import { t, tf } from '../i18n'
import { setCarArrival } from '../api/orders'
import { BTN } from '../styles/buttons'

/**
 * 차량 도착 **예정일** — 관리자가 알려 주고, 특장사는 본다.
 *
 * 특장사가 완료 처리하는 「차량 도착」 단계와 다르다. 이건 **예정**이고, 아는 사람은
 * 차를 보내는 쪽인 관리자다. 그래서 고치는 자리는 관리자에게만 열리고
 * 특장사에게는 **날짜만** 보인다.
 *
 * 주문 제목 바로 아래에 둔다 — 어느 탭을 보고 있든 눈에 들어와야 하는 값이다.
 * 현장은 이 날짜에 맞춰 사람을 뺀다.
 */
export function CarArrivalRow({ orderId, value, canEdit, onSaved }: {
  orderId: number
  /** YYYY-MM-DD. 아직 안 정했으면 null */
  value: string | null
  /** 관리자인가 — 아니면 보기만 한다 */
  canEdit: boolean
  onSaved: (next: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save(next: string) {
    setBusy(true); setErr('')
    try {
      await setCarArrival(orderId, next)
      onSaved(next || null)
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('저장하지 못했습니다'))
    } finally { setBusy(false) }
  }

  if (!canEdit) {
    // 특장사 — 안 정해졌으면 자리를 만들지 않는다(빈 칸이 「없다」를 말해 주지 않는다)
    if (!value) return null
    return (
      <div style={s.row}>
        <span style={s.label}>{t('차량 도착 예정')}</span>
        <b style={s.value}>{value}</b>
      </div>
    )
  }

  return (
    <div style={s.row}>
      <span style={s.label}>{t('차량 도착 예정')}</span>
      {editing ? (
        <>
          <input
            type="date" style={s.input} value={draft} disabled={busy}
            onChange={e => setDraft(e.target.value)}
          />
          <button style={BTN.smPrimary} disabled={busy} onClick={() => void save(draft)}>
            {busy ? t('저장 중') : t('저장')}
          </button>
          <button style={BTN.smSecondary} disabled={busy} onClick={() => { setEditing(false); setDraft(value ?? ''); setErr('') }}>
            {t('취소')}
          </button>
          {/* 지우는 길 — 잘못 찍었을 때 되돌릴 수 있어야 한다 */}
          {value && (
            <button style={s.clear} disabled={busy} onClick={() => void save('')}>{t('지우기')}</button>
          )}
        </>
      ) : (
        <>
          <b style={value ? s.value : s.none}>{value ?? t('아직 정해지지 않음')}</b>
          <button style={s.edit} onClick={() => { setDraft(value ?? ''); setEditing(true) }}>
            {value ? t('바꾸기') : t('지정')}
          </button>
          {/* 바꾸면 특장사에게 알림이 간다는 것을 **누르기 전에** 알려 준다 */}
          <span style={s.hint}>{tf('{0}에게 알림이 갑니다', t('특장사'))}</span>
        </>
      )}
      {err && <span style={s.err}>{err}</span>}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap',
    marginTop: 'var(--sp-2)', fontSize: 'var(--fs-label)',
  },
  label: { color: 'var(--muted)' },
  value: { color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  none: { color: 'var(--muted)', fontWeight: 400 },
  input: {
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', padding: '2px 6px',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)',
  },
  edit: {
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '2px 8px',
    border: 'var(--hairline)', borderRadius: 999, background: '#fff', cursor: 'pointer',
  },
  clear: {
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '2px 8px',
    border: 'none', background: 'transparent', color: 'var(--warn)',
    textDecoration: 'underline', cursor: 'pointer',
  },
  hint: { color: 'var(--muted)', fontSize: 'var(--fs-caption)' },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
}
