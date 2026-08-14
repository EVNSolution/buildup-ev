import { useEffect, useMemo, useRef, useState } from 'react'
import {
  STEPS, STEP_BY_CODE, TRACK_LABEL, EVIDENCE_LABEL, canComplete, canUndo, keepsOriginal,
  type EvidenceKind, type Track, type StepState,
} from '@shared/process/steps'
import { fetchSteps, completeStep, undoStep, uploadStepFile, deleteStepFile, stepFileUrl, type ApiStep } from '../api/steps'
import { shrinkImage, fmtBytes, MAX_EDGE } from '../lib/imageResize'
import { BTN } from '../styles/buttons'

/**
 * 단계 중심 주문 화면 — **「다음에 뭘 해야 하나」에 답하는 것이 이 화면의 일이다.**
 *
 * 예전 상세는 사양·서류·하중을 나열할 뿐이라, 보고 나서도 무엇을 해야 하는지는
 * 알 수 없었다. 이제 위에 두 갈래 진행을 두고 아래에 **지금 할 수 있는 단계**를 편다.
 * 끝난 것과 아직 못 하는 것은 접어 둔다 — 할 일이 아니라 배경이다.
 *
 * 완료 판정(선행 단계·필수 증빙)은 **서버와 같은 함수**를 쓴다(`shared/process`) —
 * 화면에서 눌리는데 서버가 거절하는 일이 없어야 한다.
 */
const TRACK_ORDER: Track[] = ['vehicle', 'body', 'tuning', 'merged']

export function OrderStepsPanel({ orderId, canEdit = true }: {
  orderId: number
  /** 조회만 하는 화면(관리자 관제 등)에서는 버튼을 감춘다 */
  canEdit?: boolean
}) {
  const [steps, setSteps] = useState<ApiStep[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dates, setDates] = useState<Record<string, string>>({})
  const [showDone, setShowDone] = useState(false)

  function load() {
    fetchSteps(orderId).then(setSteps).catch(e => setErr(e instanceof Error ? e.message : '단계 조회 실패'))
  }
  useEffect(() => { load() }, [orderId])   // eslint-disable-line react-hooks/exhaustive-deps

  const states: StepState[] = useMemo(
    () => (steps ?? []).map(s => ({ code: s.code, status: s.status })),
    [steps],
  )
  const doneCodes = useMemo(() => new Set(states.filter(s => s.status === 'done').map(s => s.code)), [states])

  if (err && !steps) return <div style={s.err}>{err}</div>
  if (!steps) return <div style={s.muted}>단계를 불러오는 중…</div>

  const byCode = new Map(steps.map(x => [x.code, x]))
  /** 지금 손댈 수 있는 것 = 선행이 다 끝났고 아직 안 끝난 것 */
  const open = STEPS.filter(d => !doneCodes.has(d.code) && d.requires.every(q => doneCodes.has(q)))
  const locked = STEPS.filter(d => !doneCodes.has(d.code) && !d.requires.every(q => doneCodes.has(q)))
  const done = STEPS.filter(d => doneCodes.has(d.code))

  async function handleComplete(code: string) {
    const def = STEP_BY_CODE[code]!
    setBusy(code); setErr('')
    try {
      await completeStep(orderId, code, def.dateLabel ? dates[code] : undefined)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '완료 실패')
    } finally { setBusy(null) }
  }

  async function handleUpload(code: string, kind: EvidenceKind, file: File) {
    setBusy(code + kind); setErr('')
    try {
      // 사진만 줄인다 — 서류는 글자를 읽어야 해서 원본 그대로 간다
      const { file: out } = keepsOriginal(kind) ? { file } : await shrinkImage(file)
      await uploadStepFile(orderId, code, kind, out)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '올리기 실패')
    } finally { setBusy(null) }
  }

  async function handleUndo(code: string) {
    setBusy(code); setErr('')
    try { await undoStep(orderId, code); load() }
    catch (e) { setErr(e instanceof Error ? e.message : '되돌리기 실패') }
    finally { setBusy(null) }
  }

  async function handleDelete(fileId: number) {
    setBusy('f' + fileId); setErr('')
    try { await deleteStepFile(orderId, fileId); load() }
    catch (e) { setErr(e instanceof Error ? e.message : '삭제 실패') }
    finally { setBusy(null) }
  }

  return (
    <div style={s.root}>
      {/* ── 두 갈래 진행 ── */}
      <div style={s.tracks}>
        {TRACK_ORDER.map(t => {
          const list = STEPS.filter(d => d.track === t)
          const n = list.filter(d => doneCodes.has(d.code)).length
          return (
            <div key={t} style={s.track}>
              <div style={s.trackHead}>
                <span style={s.trackName}>{TRACK_LABEL[t]}</span>
                <span style={s.trackCount}>{n}/{list.length}</span>
              </div>
              <div style={s.dots}>
                {list.map(d => {
                  const st = byCode.get(d.code)
                  const isDone = doneCodes.has(d.code)
                  const isOpen = !isDone && d.requires.every(q => doneCodes.has(q))
                  return (
                    <span
                      key={d.code}
                      title={`${d.label}${st?.stalled ? ' · 지연' : ''}`}
                      style={isDone ? s.dotDone : st?.stalled ? s.dotStalled : isOpen ? s.dotOpen : s.dotLocked}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {err && <div style={s.err}>{err}</div>}

      {/* ── 지금 할 것 ── */}
      <div style={s.sectionTitle}>지금 할 것 <span style={s.count}>{open.length}</span></div>
      {open.length === 0 ? (
        <div style={s.muted}>지금 처리할 단계가 없습니다.</div>
      ) : open.map(def => {
        const st = byCode.get(def.code)!
        const kinds = st.files.map(f => f.kind)
        const gate = canComplete(def.code, states, kinds)
        const needDate = !!def.dateLabel
        const dateOk = !needDate || !!dates[def.code]
        return (
          <div key={def.code} style={st.stalled ? s.cardStalled : s.card}>
            <div style={s.cardHead}>
              <div>
                <span style={s.stepName}>{def.label}</span>
                <span style={s.trackTag}>{TRACK_LABEL[def.track]}</span>
                {st.stalled && <span style={s.stalledTag}>지연</span>}
              </div>
              {canEdit && (
                <button
                  style={gate.ok && dateOk && busy !== def.code ? BTN.rowPrimary : BTN.rowDisabled}
                  disabled={!gate.ok || !dateOk || busy === def.code}
                  onClick={() => handleComplete(def.code)}
                >
                  {busy === def.code ? '처리 중…' : '완료'}
                </button>
              )}
            </div>

            {needDate && (
              <div style={s.dateRow}>
                <label style={s.label}>{def.dateLabel}<span style={s.req}> · 필수</span></label>
                <input
                  type="date" style={s.date} value={dates[def.code] ?? ''}
                  onChange={e => setDates(p => ({ ...p, [def.code]: e.target.value }))}
                />
              </div>
            )}

            {def.evidence.map(kind => (
              <EvidenceRow
                key={kind}
                kind={kind}
                orderId={orderId}
                files={st.files.filter(f => f.kind === kind)}
                canEdit={canEdit}
                busy={busy === def.code + kind}
                onPick={f => handleUpload(def.code, kind, f)}
                onDelete={handleDelete}
              />
            ))}

            {/* 왜 아직 못 누르는지 — 버튼만 잠가 두면 이유를 알 수 없다 */}
            {!gate.ok && <div style={s.blocked}>{gate.reason}</div>}
            {gate.ok && needDate && !dateOk && <div style={s.blocked}>{def.dateLabel}을(를) 골라 주세요</div>}
          </div>
        )
      })}

      {/* ── 아직 못 하는 것 ── */}
      {locked.length > 0 && (
        <>
          <div style={s.sectionTitle}>아직 <span style={s.count}>{locked.length}</span></div>
          <div style={s.lockedList}>
            {locked.map(def => (
              <div key={def.code} style={s.lockedRow}>
                <span style={s.lockedName}>{def.label}</span>
                <span style={s.lockedWhy}>
                  {def.requires.filter(q => !doneCodes.has(q)).map(q => STEP_BY_CODE[q]!.label).join(' · ')} 뒤
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 끝난 것 ── */}
      {done.length > 0 && (
        <>
          <button style={s.doneToggle} onClick={() => setShowDone(v => !v)}>
            {showDone ? '▾' : '▸'} 끝난 단계 {done.length}
          </button>
          {showDone && (
            <div style={s.lockedList}>
              {done.map(def => {
                const st = byCode.get(def.code)!
                const undo = canUndo(def.code, states)
                return (
                  <div key={def.code} style={s.doneRow}>
                    <span style={s.doneName}>{def.label}</span>
                    <span style={s.doneMeta}>
                      {st.done_at?.slice(0, 10)} · {st.done_by ?? ''}
                      {st.planned_at ? ` · ${def.dateLabel} ${st.planned_at}` : ''}
                    </span>
                    {canEdit && (
                      <button
                        style={undo.ok && busy !== def.code ? s.undoBtn : s.undoBtnOff}
                        disabled={!undo.ok || busy === def.code}
                        // 왜 못 되돌리는지 — 잠긴 버튼만 두면 이유를 알 수 없다
                        title={undo.ok ? '이 단계를 되돌립니다' : (undo as { reason: string }).reason}
                        onClick={() => handleUndo(def.code)}
                      >
                        {busy === def.code ? '…' : '되돌리기'}
                      </button>
                    )}
                    {st.note && <span style={s.doneNote}>{st.note}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 증빙 한 종류 — 올린 것 목록 + 올리기 버튼. */
function EvidenceRow({ kind, orderId, files, canEdit, busy, onPick, onDelete }: {
  kind: EvidenceKind
  orderId: number
  files: { id: number; name: string | null; size: number | null; kept_original: boolean }[]
  canEdit: boolean
  busy: boolean
  onPick: (f: File) => void
  onDelete: (id: number) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const original = keepsOriginal(kind)
  return (
    <div style={s.evidence}>
      <div style={s.evidenceHead}>
        <span style={files.length > 0 ? s.evidenceOk : s.evidenceNeed}>
          {files.length > 0 ? '✓' : '·'} {EVIDENCE_LABEL[kind]}
        </span>
        <span style={s.evidenceHint}>
          {original ? '원본 그대로' : `긴 변 ${MAX_EDGE}px 로 줄여서`}
        </span>
        {canEdit && (
          <button style={busy ? BTN.rowDisabled : BTN.row} disabled={busy} onClick={() => ref.current?.click()}>
            {busy ? '올리는 중…' : '올리기'}
          </button>
        )}
        <input
          ref={ref} type="file" style={{ display: 'none' }}
          accept={original ? 'image/*,application/pdf' : 'image/*'}
          onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }}
        />
      </div>
      {files.map(f => (
        <div key={f.id} style={s.file}>
          <a href={stepFileUrl(orderId, f.id)} target="_blank" rel="noreferrer" style={s.fileName}>
            {f.name || `파일 ${f.id}`}
          </a>
          <span style={s.fileSize}>{f.size ? fmtBytes(f.size) : ''}</span>
          {canEdit && <button style={s.fileDel} onClick={() => onDelete(f.id)}>지우기</button>}
        </div>
      ))}
    </div>
  )
}

const dotBase: React.CSSProperties = { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 }

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },

  tracks: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--sp-3)' },
  track: { minWidth: 0 },
  trackHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-2)' },
  trackName: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontWeight: 600 },
  trackCount: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  dots: { display: 'flex', gap: 3, marginTop: 5, flexWrap: 'wrap' },
  dotDone: { ...dotBase, background: 'var(--lime)' },
  dotOpen: { ...dotBase, background: 'var(--dark)' },
  dotStalled: { ...dotBase, background: 'var(--req)' },
  dotLocked: { ...dotBase, background: 'var(--line)' },

  sectionTitle: {
    fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)',
    marginTop: 'var(--sp-3)', paddingBottom: 'var(--sp-2)', borderBottom: 'var(--hairline)',
  },
  count: { fontWeight: 400, color: 'var(--muted)', marginLeft: 'var(--sp-1)' },

  // 할 일 한 건 — 칸을 채우지 않고 왼쪽 띠로만 구분한다
  card: { padding: 'var(--sp-3) 0 var(--sp-3) var(--sp-3)', borderBottom: 'var(--hairline)', boxShadow: 'inset 3px 0 0 0 var(--lime)' },
  cardStalled: { padding: 'var(--sp-3) 0 var(--sp-3) var(--sp-3)', borderBottom: 'var(--hairline)', boxShadow: 'inset 3px 0 0 0 var(--req)' },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  stepName: { fontSize: 'var(--fs-body)', fontWeight: 650, color: 'var(--dark)' },
  trackTag: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginLeft: 'var(--sp-2)' },
  stalledTag: { fontSize: 'var(--fs-caption)', color: 'var(--req)', fontWeight: 700, marginLeft: 'var(--sp-2)' },

  dateRow: { marginTop: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  label: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  req: { color: 'var(--req)', fontWeight: 700 },
  date: { maxWidth: 190 },

  evidence: { marginTop: 'var(--sp-2)' },
  evidenceHead: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  evidenceOk: { fontSize: 'var(--fs-label)', color: 'var(--dark)' },
  evidenceNeed: { fontSize: 'var(--fs-label)', color: 'var(--req)', fontWeight: 600 },
  evidenceHint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', flex: 1, minWidth: 0 },
  file: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginTop: 3, paddingLeft: 14 },
  fileName: { fontSize: 'var(--fs-caption)', color: 'var(--dark)', textDecoration: 'underline', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fileSize: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  fileDel: { border: 'none', background: 'none', color: 'var(--muted)', fontSize: 'var(--fs-caption)', cursor: 'pointer', padding: 0, fontFamily: 'inherit' },

  blocked: { marginTop: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--muted)' },

  lockedList: { display: 'flex', flexDirection: 'column' },
  lockedRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-3)', padding: 'var(--sp-2) 0', borderBottom: 'var(--hairline)' },
  lockedName: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  lockedWhy: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', textAlign: 'right' },
  doneRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-3)', padding: 'var(--sp-2) 0', borderBottom: 'var(--hairline)', flexWrap: 'wrap' },
  doneName: { fontSize: 'var(--fs-label)', color: 'var(--dark)' },
  doneMeta: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  doneNote: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', flexBasis: '100%' },
  // 되돌리기는 눈에 띄지 않아야 한다 — 자주 쓰는 길이 아니라 잘못 눌렀을 때의 길이다
  undoBtn: { border: 'none', background: 'none', color: 'var(--muted)', fontSize: 'var(--fs-caption)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' },
  undoBtnOff: { border: 'none', background: 'none', color: 'var(--line-strong, #CFD4CF)', fontSize: 'var(--fs-caption)', cursor: 'not-allowed', padding: 0, fontFamily: 'inherit' },
  doneToggle: {
    alignSelf: 'flex-start', border: 'none', background: 'none', padding: 'var(--sp-2) 0',
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', color: 'var(--muted)', cursor: 'pointer',
  },

  muted: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: 'var(--sp-3) 0' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', background: 'var(--warnbg)', border: '0.5px solid var(--warn)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)' },
}
