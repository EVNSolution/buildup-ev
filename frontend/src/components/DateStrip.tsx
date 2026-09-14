import { useEffect, useState } from 'react'
import { t, tf } from '../i18n'
import { setCarArrival, changeDeliveryDue } from '../api/orders'
import { fetchAddon, setAddonTarget } from '../api/addon'
import { dueInfo } from '@shared/process/due'
import { BTN } from '../styles/buttons'
import { shortDate } from '../lib/shortDate'

/**
 * **날짜 띠** — 차량 도착 · 납기 · 고객 인도를 한 줄 세 칸에(2026-09-14 지시).
 *
 * 예전에는 날짜마다 한 줄씩 세 줄이라 주문 상세 머리가 너무 길었다(「3줄은 너무 에반데」).
 * 칸 안에 이름(작게)과 날짜만 두고, 고칠 수 있는 칸을 누르면 **그 아래에만** 입력 줄이 열린다.
 * 날짜는 「10/13」처럼 짧게 — 올해가 아니면 연도를 붙인다.
 *
 * 누가 무엇을:
 *   · 차량 도착 예정 — 관리자가 정한다(특장사는 보기만)
 *   · 납기 — 특장사가 수락하며 정하고, 수락된 뒤 관리자가 바꾼다(사유·처음 약속은 입력 줄 안에서)
 *   · 고객 인도 목표 — 관리자 + addon.manage 만. **특장사에게는 칸 자체가 없다**
 */
type Key = 'arrival' | 'due' | 'target'

export function DateStrip({ orderId, arrival, due, target = false }: {
  orderId: number
  arrival: { value: string | null; canEdit: boolean; onSaved: (next: string | null) => void }
  /** 납기 칸 — 넘기지 않으면 칸이 없다(수락 팝업은 아래에서 따로 고른다) */
  due?: { value: string | null; original: string | null; canEdit: boolean; onSaved: (next: string) => void }
  /** 고객 인도 목표 칸 — 관리자 + addon.manage 일 때만 true */
  target?: boolean
}) {
  const [open, setOpen] = useState<Key | null>(null)
  const [draft, setDraft] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [targetOn, setTargetOn] = useState<string | null>(null)
  const [targetDone, setTargetDone] = useState(false)

  useEffect(() => {
    if (!target) return
    let alive = true
    fetchAddon(orderId).then(v => { if (alive) { setTargetOn(v.target_on); setTargetDone(v.finished) } }).catch(() => {})
    return () => { alive = false }
  }, [orderId, target])

  const cells: { key: Key; label: string; value: string | null; canEdit: boolean; late: boolean }[] = [
    { key: 'arrival', label: t('차량 도착'), value: arrival.value, canEdit: arrival.canEdit, late: false },
    ...(due ? [{ key: 'due' as const, label: t('납기'), value: due.value, canEdit: due.canEdit, late: dueInfo(due.value).state === 'overdue' }] : []),
    ...(target ? [{ key: 'target' as const, label: t('고객 인도'), value: targetOn, canEdit: true, late: !targetDone && dueInfo(targetOn).state === 'overdue' }] : []),
  ]

  function toggle(c: typeof cells[number]) {
    if (!c.canEdit) return
    if (open === c.key) { setOpen(null); return }
    setOpen(c.key); setDraft(c.value ?? ''); setReason(''); setErr('')
  }

  async function save(next: string) {
    setBusy(true); setErr('')
    try {
      if (open === 'arrival') { await setCarArrival(orderId, next); arrival.onSaved(next || null) }
      else if (open === 'due' && due) { await changeDeliveryDue(orderId, next, reason); due.onSaved(next) }
      else if (open === 'target') { const v = await setAddonTarget(orderId, next); setTargetOn(v.target_on) }
      setOpen(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('저장하지 못했습니다'))
    } finally { setBusy(false) }
  }

  const current = cells.find(c => c.key === open)
  return (
    <div style={s.wrap}>
      <div style={{ ...s.strip, gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map((c, i) => (
          <button
            key={c.key}
            type="button"
            onClick={() => toggle(c)}
            disabled={!c.canEdit}
            aria-expanded={c.canEdit ? open === c.key : undefined}
            aria-label={`${c.label} ${c.value ?? t('미정')}`}
            style={{
              ...s.cell,
              ...(i < cells.length - 1 ? s.cellDivider : {}),
              ...(c.canEdit ? s.cellEditable : {}),
              ...(open === c.key ? s.cellOpen : {}),
            }}
          >
            <span style={s.label}>
              {c.label}
              {/* 고칠 수 있는 칸 표시 — 연필 하나. 특장사처럼 보기만 하는 칸에는 없다 */}
              {c.canEdit && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 3 }}>
                  <path d="M4 20h4L19 9l-4-4L4 16z" />
                </svg>
              )}
            </span>
            <span style={c.value ? (c.late ? s.valueLate : s.value) : s.none}>{c.value ? shortDate(c.value) : t('미정')}</span>
          </button>
        ))}
      </div>

      {current && (
        <div style={s.editor}>
          <input type="date" style={s.input} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} aria-label={current.label} />
          {open === 'due' && (
            <input type="text" style={{ ...s.input, ...s.reason }} value={reason} maxLength={200} disabled={busy}
              onChange={e => setReason(e.target.value)} placeholder={t('사유 (선택)')} aria-label={t('사유 (선택)')} />
          )}
          <button type="button" style={BTN.smPrimary} disabled={busy || !draft} onClick={() => void save(draft)}>{busy ? t('저장 중') : t('저장')}</button>
          <button type="button" style={BTN.smSecondary} disabled={busy} onClick={() => setOpen(null)}>{t('취소')}</button>
          {/* 지우기 — 납기는 수락된 주문에 늘 있어야 해서 없다 */}
          {open !== 'due' && current.value && (
            <button type="button" style={s.clear} disabled={busy} onClick={() => void save('')}>{t('지우기')}</button>
          )}
          {open === 'due' && due?.original && due.original !== due.value && (
            <span style={s.hint}>{tf('처음 약속 {0}', shortDate(due.original))}</span>
          )}
          {err && <span style={s.err}>{err}</span>}
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 'var(--sp-2)' },
  strip: { display: 'grid', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', overflow: 'hidden', background: '#fff' },
  // ⚠️ 테두리·여백은 한 줄로만 쓰고 덮을 때도 같은 이름으로 — 섞으면 창 폭을 오갈 때 사라진다
  cell: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0, minWidth: 0,
    padding: '3px 10px', margin: 0, border: 'none', background: 'transparent', textAlign: 'left',
    fontFamily: 'inherit', cursor: 'default', minHeight: 0, lineHeight: 1.2,
  },
  cellDivider: { borderRight: 'var(--hairline)' },
  cellEditable: { cursor: 'pointer' },
  cellOpen: { background: 'var(--card)' },
  label: { display: 'flex', alignItems: 'center', fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  value: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  valueLate: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--req)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  none: { fontSize: 'var(--fs-body)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  editor: {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6,
    padding: '6px 8px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: 'var(--card)',
  },
  input: { fontFamily: 'inherit', fontSize: 'var(--fs-label)', padding: '2px 6px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff' },
  reason: { flex: '1 1 140px', minWidth: 0 },
  clear: { fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '2px 6px', border: 'none', background: 'transparent', color: 'var(--warn)', textDecoration: 'underline', cursor: 'pointer' },
  hint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  err: { fontSize: 'var(--fs-caption)', color: 'var(--warn)' },
}
