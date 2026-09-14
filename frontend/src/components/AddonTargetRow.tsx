import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { fetchAddon, setAddonTarget } from '../api/addon'
import { BTN } from '../styles/buttons'

/**
 * **고객 인도 목표일** — 관리자가 배정 이후 어느 단계에서든 찍는다(2026-09-14).
 *
 * 특장사 납기와 **별개**다. 공장 출고 뒤 우리 쪽 부가작업을 거쳐 고객에게 넘기는 날이라 특장사에게는
 * 보이지 않는다 — 이 줄은 관리자 + addon.manage 일 때만 그린다(부르는 쪽이 판단, 서버도 막는다).
 */
export function AddonTargetRow({ orderId, onChanged }: { orderId: number; onChanged?: (next: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    fetchAddon(orderId)
      .then(v => { if (alive) { setValue(v.target_on); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [orderId])

  async function save(next: string) {
    setBusy(true); setErr('')
    try {
      const v = await setAddonTarget(orderId, next)
      setValue(v.target_on); onChanged?.(v.target_on); setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('저장하지 못했습니다'))
    } finally { setBusy(false) }
  }

  if (!loaded) return null
  return (
    <div style={s.row}>
      <span style={s.label}>{t('고객 인도 목표')}</span>
      {editing ? (
        <>
          <input type="date" style={s.input} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} aria-label={t('고객 인도 목표')} />
          <button style={BTN.smPrimary} disabled={busy || !draft} onClick={() => void save(draft)}>{busy ? t('저장 중') : t('저장')}</button>
          <button style={BTN.smSecondary} disabled={busy} onClick={() => { setEditing(false); setErr('') }}>{t('취소')}</button>
          {value && <button style={s.clear} disabled={busy} onClick={() => void save('')}>{t('지우기')}</button>}
        </>
      ) : (
        <>
          <b style={value ? s.value : s.none}>{value ?? t('아직 정해지지 않음')}</b>
          <button style={s.edit} onClick={() => { setDraft(value ?? ''); setEditing(true) }}>{value ? t('변경') : t('지정')}</button>
        </>
      )}
      {err && <span style={s.err}>{err}</span>}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)', fontSize: 'var(--fs-label)' },
  label: { color: 'var(--muted)' },
  value: { color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  none: { color: 'var(--muted)', fontWeight: 400 },
  input: { fontFamily: 'inherit', fontSize: 'var(--fs-label)', padding: '2px 6px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)' },
  edit: { fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '2px 8px', border: 'var(--hairline)', borderRadius: 999, background: '#fff', cursor: 'pointer' },
  clear: { fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '2px 8px', border: 'none', background: 'transparent', color: 'var(--warn)', textDecoration: 'underline', cursor: 'pointer' },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
}
