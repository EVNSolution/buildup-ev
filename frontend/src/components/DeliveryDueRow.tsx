import { useState } from 'react'
import { t, tf } from '../i18n'
import { changeDeliveryDue } from '../api/orders'
import { BTN } from '../styles/buttons'

/**
 * 납기일 — **관리자가 수락된 주문의 날짜를 바꾸는 자리.**
 *
 * 납기는 특장사가 수락하며 고른다. 협의 끝에 날짜가 달라지면 관리자가 여기서 고친다.
 * 특장사에게는 이 줄을 두지 않는다 — 단계 탭 머리말에 납기가 이미 보이고, 고칠 수도 없다.
 *
 * 차량 도착 예정 줄 바로 옆에 둔다 — 둘 다 「현장이 날짜에 맞춰 움직이는」 값이다.
 */
export function DeliveryDueRow({ orderId, value, original, onSaved }: {
  orderId: number
  /** YYYY-MM-DD */
  value: string
  /** 특장사가 처음 약속한 날 — 바뀐 적이 없으면 null */
  original: string | null
  onSaved: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!draft) { setErr(t('날짜를 골라 주세요')); return }
    setBusy(true); setErr('')
    try {
      await changeDeliveryDue(orderId, draft, reason)
      onSaved(draft)
      setEditing(false); setReason('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('저장하지 못했습니다'))
    } finally { setBusy(false) }
  }

  return (
    <div style={s.row}>
      <span style={s.label}>{t('납기일')}</span>
      {editing ? (
        <>
          <input
            type="date" style={s.input} value={draft} disabled={busy}
            onChange={e => setDraft(e.target.value)}
            aria-label={t('새 납기일')}
          />
          <input
            type="text" style={{ ...s.input, ...s.reason }} value={reason} disabled={busy} maxLength={200}
            onChange={e => setReason(e.target.value)}
            placeholder={t('사유 (선택)')}
            aria-label={t('사유 (선택)')}
          />
          <button style={BTN.smPrimary} disabled={busy} onClick={() => void save()}>
            {busy ? t('저장 중') : t('저장')}
          </button>
          <button style={BTN.smSecondary} disabled={busy} onClick={() => { setEditing(false); setDraft(value); setReason(''); setErr('') }}>
            {t('취소')}
          </button>
          {/* 지우는 버튼은 없다 — 수락된 주문에는 납기가 늘 있어야 한다 */}
        </>
      ) : (
        <>
          <b style={s.value}>{value}</b>
          {/* 처음 약속과 달라졌으면 그 날도 보여 준다 — 「원래 언제였지」를 묻지 않게 */}
          {original && original !== value && (
            <span style={s.hint}>{tf('처음 약속 {0}', original)}</span>
          )}
          <button style={s.edit} onClick={() => { setDraft(value); setEditing(true) }}>{t('바꾸기')}</button>
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
  input: {
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', padding: '2px 6px',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)',
  },
  reason: { flex: '1 1 160px', minWidth: 0 },
  edit: {
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '2px 8px',
    border: 'var(--hairline)', borderRadius: 999, background: '#fff', cursor: 'pointer',
  },
  hint: { color: 'var(--muted)', fontSize: 'var(--fs-caption)' },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
}
