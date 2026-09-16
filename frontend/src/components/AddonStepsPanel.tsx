import { useEffect, useState } from 'react'
import { DateField } from './ui/DateField'
import { t, tf } from '../i18n'
import { ADDON_TRACKS, ADDON_TRACK_LABEL, type AddonTrack } from '@shared/process/addon'
import { fetchAddon, completeAddonStep, undoAddonStep, type AddonView, type AddonStepView } from '../api/addon'
import { toDateInput } from '@shared/schedule/businessDays'
import { BTN } from '../styles/buttons'
import { OrderChecklistPanel } from './OrderChecklistPanel'

/**
 * **부가작업 탭** — 공장 출고 뒤 우리 쪽 작업.
 * 보는 것은 `addon.view`(영업관리·경영관리도), **누르는 것은 `addon.manage`**(PM·생산관리·마스터) — 2026-09-16.
 *
 * 특장사 단계 탭과 같은 모양: 트랙(작업 전 · 작업 중 · 고객 인도)마다 진척 막대와 단계 줄.
 * 단계는 누르면 끝나고, 인도 완료는 **실제 인도일**을 골라야 끝난다. 잘못 눌렀으면 되돌린다
 * (뒤 단계가 끝났으면 막힌다 — 규칙은 서버와 같은 shared/process/addon.ts).
 */
export function AddonStepsPanel({ orderId, canEdit = true, onChanged }: { orderId: number; canEdit?: boolean; onChanged?: () => void }) {
  const [view, setView] = useState<AddonView | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dates, setDates] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    fetchAddon(orderId).then(v => { if (alive) setView(v) }).catch(e => { if (alive) setErr(e instanceof Error ? e.message : t('부가작업을 불러오지 못했습니다')) })
    return () => { alive = false }
  }, [orderId])

  async function run(key: string, fn: () => Promise<AddonView>) {
    setBusy(key); setErr('')
    try { setView(await fn()); onChanged?.() }
    catch (e) { setErr(e instanceof Error ? e.message : t('저장하지 못했습니다')) }
    finally { setBusy(null) }
  }

  if (!view) return <div style={s.muted}>{err || t('불러오는 중…')}</div>

  const byTrack = (tr: AddonTrack) => view.steps.filter(x => x.track === tr)
  const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')

  return (
    <div>
      <div style={s.record}>
        <Rec label={t('공장 출고')} value={view.factory_done ? dayOf(view.factory_done_at) : t('출고 전')} />
        <Rec label={t('고객 인도 목표')} value={view.target_on ?? '—'} strong={!!view.target_on} />
        <Rec label={t('실제 인도일')} value={view.delivered_on ?? '—'} strong={!!view.delivered_on} />
      </div>

      {!view.factory_done && <div style={s.notice}>{t('특장사가 출고하면 부가작업을 시작할 수 있습니다.')}</div>}
      {err && <div style={s.err}>{err}</div>}

      {ADDON_TRACKS.map(track => {
        const list = byTrack(track)
        const n = list.filter(x => x.done).length
        return (
          <section key={track} style={s.track}>
            <div style={s.trackHead}>
              <span style={s.trackName}>{t(ADDON_TRACK_LABEL[track])}</span>
              <span style={s.trackBar}>
                {list.map(x => <span key={x.code} style={x.done ? s.segDone : x.can_complete.ok ? s.segNow : s.segLater} />)}
              </span>
              <span style={s.trackCount}>{n}/{list.length}</span>
            </div>
            {list.map(x => (
              <div key={x.code}>
              <StepRow
                canEdit={canEdit}
                step={x}
                busy={busy === x.code}
                date={dates[x.code] ?? toDateInput(new Date())}
                onDate={v => setDates(d => ({ ...d, [x.code]: v }))}
                onComplete={() => void run(x.code, () => completeAddonStep(orderId, x.code, x.date_label ? (dates[x.code] ?? toDateInput(new Date())) : undefined))}
                onUndo={() => void run(x.code, () => undoAddonStep(orderId, x.code))}
              />
              {/*
                체크리스트 — 지금 할 수 있는 단계에만. 서식에 항목이 없으면 패널이 아무것도 그리지 않는다.
                항목이 있으면 모두 합격·제출해야 완료된다(서버가 막는다).
              */}
              {canEdit && !x.done && x.can_complete.ok && (
                <div style={s.checklist}>
                  <OrderChecklistPanel orderId={orderId} stepCode={x.code} stepLabel={t(x.label)} scope="addon"
                    onDone={() => { fetchAddon(orderId).then(setView).catch(() => {}) }} />
                </div>
              )}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function Rec({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span style={s.rec}>
      <span style={s.recLabel}>{label}</span>
      <span style={strong ? s.recValueStrong : s.recValue}>{value}</span>
    </span>
  )
}

function StepRow({ step, busy, date, canEdit, onDate, onComplete, onUndo }: {
  step: AddonStepView; busy: boolean; date: string
  /** 누를 수 있는가 — 보기 전용 자리(영업관리·경영관리)에서는 완료·되돌리기 버튼을 두지 않는다 */
  canEdit: boolean
  onDate: (v: string) => void; onComplete: () => void; onUndo: () => void
}) {
  const open = canEdit && !step.done && step.can_complete.ok
  return (
    <div style={open ? s.rowNow : s.row}>
      <span style={step.done ? s.dotDone : open ? s.dotNow : s.dotLater} aria-hidden="true">{step.done ? '✓' : '●'}</span>
      <span style={s.rowMain}>
        <span style={step.done || open ? s.label : s.labelLater}>{t(step.label)}</span>
        {step.done && (
          <span style={s.sub}>
            {step.done_on ? tf('{0} {1}', t(step.date_label ?? ''), step.done_on) : (step.done_at ?? '').slice(0, 10)}
            {step.done_by ? ` · ${step.done_by}` : ''}
          </span>
        )}
        {!step.done && !step.can_complete.ok && <span style={s.sub}>{step.can_complete.reason}</span>}
      </span>
      <span style={s.actions}>
        {open && step.date_label && (
          <DateField value={date} max={toDateInput(new Date())} disabled={busy} onChange={onDate} ariaLabel={t(step.date_label)} />
        )}
        {open && (
          <button type="button" style={BTN.rowPrimary} disabled={busy || (!!step.date_label && !date)} onClick={onComplete}>
            {busy ? t('저장 중') : t('완료')}
          </button>
        )}
        {canEdit && step.done && step.can_undo.ok && (
          <button type="button" style={s.undo} disabled={busy} onClick={onUndo}>{t('되돌리기')}</button>
        )}
      </span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  muted: { color: 'var(--muted)', fontSize: 'var(--fs-body)', padding: 'var(--sp-4) 0' },
  checklist: { padding: '0 0 var(--sp-2) 28px' },
  record: { display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-5)', padding: 'var(--sp-3) 0', borderBottom: 'var(--hairline)', marginBottom: 'var(--sp-2)' },
  rec: { display: 'flex', alignItems: 'baseline', gap: 8 },
  recLabel: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  recValue: { fontSize: 'var(--fs-body)', color: 'var(--body)', fontVariantNumeric: 'tabular-nums' },
  recValueStrong: { fontSize: 'var(--fs-body)', color: 'var(--dark)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  notice: { background: 'var(--card)', borderRadius: 'var(--r-sm)', padding: '10px 12px', fontSize: 'var(--fs-label)', color: 'var(--body)', margin: 'var(--sp-2) 0' },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-label)', padding: '6px 0' },
  track: { padding: 'var(--sp-3) 0', borderBottom: 'var(--hairline)' },
  trackHead: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' },
  trackName: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--dark)', minWidth: 64 },
  trackBar: { display: 'flex', gap: 3, flex: 1 },
  segDone: { flex: 1, height: 4, borderRadius: 2, background: 'var(--lime)' },
  segNow: { flex: 1, height: 4, borderRadius: 2, background: 'var(--dark)' },
  segLater: { flex: 1, height: 4, borderRadius: 2, background: 'var(--line)' },
  trackCount: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' },
  rowNow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px', margin: '0 -10px', borderLeft: '3px solid var(--lime)', background: 'rgba(200,214,0,.06)' },
  dotDone: { width: 18, textAlign: 'center', color: 'var(--lime-ink)', fontWeight: 700, flexShrink: 0 },
  dotNow: { width: 18, textAlign: 'center', color: 'var(--dark)', fontSize: 10, flexShrink: 0 },
  dotLater: { width: 18, textAlign: 'center', color: 'var(--line)', fontSize: 10, flexShrink: 0 },
  rowMain: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  label: { fontSize: 'var(--fs-body)', color: 'var(--dark)' },
  labelLater: { fontSize: 'var(--fs-body)', color: 'var(--muted)' },
  sub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  actions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  date: { fontFamily: 'inherit', fontSize: 'var(--fs-label)', padding: '4px 6px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)' },
  undo: { fontFamily: 'inherit', fontSize: 'var(--fs-caption)', color: 'var(--muted)', background: 'transparent', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: '6px 4px' },
}
