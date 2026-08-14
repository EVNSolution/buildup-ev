import { useEffect, useMemo, useRef, useState } from 'react'
import {
  STEPS, STEP_BY_CODE, TRACK_LABEL, EVIDENCE_LABEL, canComplete, canUndo, keepsOriginal,
  type EvidenceKind, type Track, type StepState, type StepDef,
} from '@shared/process/steps'
import {
  fetchSteps, completeStep, undoStep, uploadStepFile, deleteStepFile, stepFileUrl,
  type ApiStepsResponse,
} from '../api/steps'
import { shrinkImage, fmtBytes, MAX_EDGE } from '../lib/imageResize'
import { BTN } from '../styles/buttons'

/**
 * 단계 중심 주문 화면 — **「다음에 뭘 해야 하나」에 답하는 것이 이 화면의 일이다.**
 *
 * 예전에는 「지금 할 것 / 아직 / 끝난 것」 세 덩어리로 잘라 놓았는데, 그러면 한 갈래가
 * 어디까지 왔는지 보려면 세 곳을 오가야 했다. **갈래별로 묶고 그 안을 순서대로** 두면
 * 흐름이 그대로 보인다 — 차량이 어디까지 왔고, 특장은 끝났고, 튜닝은 아직 시작 전이라는 것이
 * 한 화면에서 읽힌다.
 *
 * 완료 판정(선행 단계·필수 증빙)은 **서버와 같은 함수**를 쓴다(`shared/process`).
 */
const TRACK_ORDER: Track[] = ['vehicle', 'body', 'tuning', 'merged']

type Phase = 'done' | 'now' | 'later'

export function OrderStepsPanel({ orderId, canEdit = true }: {
  orderId: number
  /** 조회만 하는 화면에서는 버튼을 감춘다 */
  canEdit?: boolean
}) {
  const [res, setRes] = useState<ApiStepsResponse | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dates, setDates] = useState<Record<string, string>>({})
  /** 완료 전에 확인해야 하는 단계에서, 확인을 마친 것들(서명본 내려받기 등) */
  const [acked, setAcked] = useState<Set<string>>(new Set())

  function load() {
    fetchSteps(orderId).then(setRes).catch(e => setErr(e instanceof Error ? e.message : '단계 조회 실패'))
  }
  useEffect(() => { load() }, [orderId])   // eslint-disable-line react-hooks/exhaustive-deps

  const steps = res?.data ?? null
  const states: StepState[] = useMemo(
    () => (steps ?? []).map(s => ({ code: s.code, status: s.status })),
    [steps],
  )
  const doneCodes = useMemo(() => new Set(states.filter(s => s.status === 'done').map(s => s.code)), [states])

  if (err && !steps) return <div style={s.err}>{err}</div>
  if (!steps || !res) return <div style={s.muted}>단계를 불러오는 중…</div>

  const byCode = new Map(steps.map(x => [x.code, x]))
  const phaseOf = (d: StepDef): Phase =>
    doneCodes.has(d.code) ? 'done'
      : d.requires.every(q => doneCodes.has(q)) ? 'now'
        : 'later'

  async function handleComplete(code: string) {
    const def = STEP_BY_CODE[code]!
    setBusy(code); setErr('')
    try {
      await completeStep(orderId, code, def.dateLabel ? dates[code] : undefined)
      load()
    } catch (e) { setErr(e instanceof Error ? e.message : '완료 실패') }
    finally { setBusy(null) }
  }

  async function handleUndo(code: string) {
    setBusy(code); setErr('')
    try { await undoStep(orderId, code); load() }
    catch (e) { setErr(e instanceof Error ? e.message : '되돌리기 실패') }
    finally { setBusy(null) }
  }

  async function handleUpload(code: string, kind: EvidenceKind, file: File) {
    setBusy(code + kind); setErr('')
    try {
      // 사진만 줄인다 — 서류는 글자를 읽어야 해서 원본 그대로 간다
      const { file: out } = keepsOriginal(kind) ? { file } : await shrinkImage(file)
      await uploadStepFile(orderId, code, kind, out)
      load()
    } catch (e) { setErr(e instanceof Error ? e.message : '올리기 실패') }
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
      {/*
        발주·수락·납기는 **단계가 아니라 이미 끝난 기록**이다. 머리말에 적어 두고
        완료/되돌리기 대상으로 두지 않는다 — 같은 일을 두 번 관리하지 않기 위해서.
      */}
      <div style={s.record}>
        <Rec label="발주" value={res.order.assigned_at?.slice(0, 10) ?? '—'} />
        <Rec label="수락" value={res.order.accepted_at?.slice(0, 10) ?? '아직'} />
        <Rec label="납기" value={res.order.delivery_due ?? '—'} strong={!!res.order.delivery_due} />
      </div>

      {err && <div style={s.err}>{err}</div>}

      {TRACK_ORDER.map(track => {
        const list = STEPS.filter(d => d.track === track)
        const n = list.filter(d => doneCodes.has(d.code)).length
        const late = list.some(d => byCode.get(d.code)?.stalled && !doneCodes.has(d.code))
        return (
          <section key={track} style={s.track}>
            <div style={s.trackHead}>
              <span style={s.trackName}>{TRACK_LABEL[track]}</span>
              <span style={s.trackBar}>
                {list.map(d => {
                  const p = phaseOf(d)
                  const st = byCode.get(d.code)
                  return (
                    <span key={d.code} title={d.label}
                      style={p === 'done' ? s.segDone : st?.stalled ? s.segLate : p === 'now' ? s.segNow : s.segLater} />
                  )
                })}
              </span>
              <span style={late ? s.trackCountLate : s.trackCount}>{n}/{list.length}</span>
            </div>

            {list.map(def => {
              const st = byCode.get(def.code)!
              const phase = phaseOf(def)
              const kinds = st.files.map(f => f.kind)
              const gate = canComplete(def.code, states, kinds)
              const needDate = !!def.dateLabel
              const dateOk = !needDate || !!dates[def.code]
              const ackOk = !def.ackLabel || acked.has(def.code)
              /*
               * 수락 전에는 제작 완료를 누를 수 없다. 수락은 단계가 아니라 주문의 기록이라
               * 선행 단계로 표현되지 않는다 — 서버도 같은 이유로 막지만, 화면에서 미리
               * 막아 주지 않으면 눌러 보고 나서야 안 된다는 걸 알게 된다.
               */
              const needAccept = def.code === 'build_done' && !res.order.accepted_at
              const undo = canUndo(def.code, states)

              return (
                <div key={def.code} style={phase === 'now' ? (st.stalled ? s.rowNowLate : s.rowNow) : s.row}>
                  <div style={s.rowHead}>
                    <span style={phase === 'done' ? s.markDone : phase === 'now' ? s.markNow : s.markLater}>
                      {phase === 'done' ? '✓' : phase === 'now' ? '●' : '○'}
                    </span>
                    <span style={phase === 'later' ? s.nameLater : s.name}>{def.label}</span>
                    {st.stalled && phase !== 'done' && <span style={s.lateTag}>지연</span>}

                    <span style={s.spacer} />

                    {phase === 'done' && (
                      <>
                        <span style={s.doneMeta}>
                          {st.done_at?.slice(0, 10)}
                          {st.planned_at ? ` · ${def.dateLabel} ${st.planned_at}` : ''}
                        </span>
                        {canEdit && (
                          <button
                            style={undo.ok && busy !== def.code ? s.undoBtn : s.undoBtnOff}
                            disabled={!undo.ok || busy === def.code}
                            title={undo.ok ? '이 단계를 되돌립니다' : (undo as { reason: string }).reason}
                            onClick={() => handleUndo(def.code)}
                          >{busy === def.code ? '…' : '되돌리기'}</button>
                        )}
                      </>
                    )}

                    {phase === 'later' && (
                      <span style={s.laterWhy}>
                        {def.requires.filter(q => !doneCodes.has(q)).map(q => STEP_BY_CODE[q]!.label).join(' · ')} 뒤
                      </span>
                    )}

                    {/* 사람이 누르는 단계가 아니면 버튼을 두지 않는다 — 눌러 줄 일이 없다 */}
                    {phase === 'now' && canEdit && !def.auto && (
                      <button
                        style={gate.ok && dateOk && ackOk && !needAccept && busy !== def.code ? BTN.rowPrimary : BTN.rowDisabled}
                        disabled={!gate.ok || !dateOk || !ackOk || needAccept || busy === def.code}
                        onClick={() => handleComplete(def.code)}
                      >{busy === def.code ? '처리 중…' : '완료'}</button>
                    )}
                    {phase === 'now' && def.auto && (
                      <span style={s.autoTag}>보내면 자동으로 넘어갑니다</span>
                    )}
                  </div>

                  {/* 지금 할 수 있는 단계만 펼친다 — 나머지는 한 줄로 둔다 */}
                  {phase === 'now' && (
                    <div style={s.body}>
                      {needDate && (
                        <div style={s.dateRow}>
                          <label style={s.label}>{def.dateLabel}<span style={s.req}> · 필수</span></label>
                          <input type="date" style={s.date} value={dates[def.code] ?? ''}
                            onChange={e => setDates(p => ({ ...p, [def.code]: e.target.value }))} />
                        </div>
                      )}

                      {def.ackLabel && (
                        <div style={s.ackRow}>
                          <button
                            style={acked.has(def.code) ? s.ackDone : BTN.row}
                            onClick={() => setAcked(p => new Set(p).add(def.code))}
                          >{acked.has(def.code) ? `✓ ${def.ackLabel}` : def.ackLabel}</button>
                          <span style={s.ackHint}>
                            {acked.has(def.code) ? '확인했습니다' : '받아 보기 전에는 완료할 수 없습니다'}
                          </span>
                        </div>
                      )}

                      {def.evidence.map(kind => (
                        <EvidenceRow key={kind} kind={kind} orderId={orderId}
                          files={st.files.filter(f => f.kind === kind)}
                          canEdit={canEdit} busy={busy === def.code + kind}
                          onPick={f => handleUpload(def.code, kind, f)} onDelete={handleDelete} />
                      ))}

                      {/* 왜 아직 못 누르는지 — 버튼만 잠가 두면 이유를 알 수 없다 */}
                      {!gate.ok && <div style={s.blocked}>{gate.reason}</div>}
                      {gate.ok && !dateOk && <div style={s.blocked}>{def.dateLabel}을(를) 골라 주세요</div>}
                      {needAccept && <div style={s.blocked}>발주를 먼저 수락해야 합니다 — 「수락 대기」에서 발주서를 확인하고 받아 주세요</div>}
                    </div>
                  )}

                  {phase === 'done' && st.files.length > 0 && (
                    <div style={s.doneFiles}>
                      {st.files.map(f => (
                        <a key={f.id} href={stepFileUrl(orderId, f.id)} target="_blank" rel="noreferrer" style={s.fileName}>
                          {f.name || `파일 ${f.id}`}
                        </a>
                      ))}
                    </div>
                  )}
                  {phase === 'done' && st.note && <div style={s.doneNote}>{st.note}</div>}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

function Rec({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={s.rec}>
      <span style={s.recLabel}>{label}</span>
      <span style={strong ? s.recValueStrong : s.recValue}>{value}</span>
    </div>
  )
}

/** 증빙 한 종류 — 올린 것 목록 + 올리기 버튼. */
function EvidenceRow({ kind, orderId, files, canEdit, busy, onPick, onDelete }: {
  kind: EvidenceKind
  orderId: number
  files: { id: number; name: string | null; size: number | null }[]
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
        <span style={s.evidenceHint}>{original ? '원본 그대로' : `긴 변 ${MAX_EDGE}px 로 줄여서`}</span>
        {canEdit && (
          <button style={busy ? BTN.rowDisabled : BTN.row} disabled={busy} onClick={() => ref.current?.click()}>
            {busy ? '올리는 중…' : '올리기'}
          </button>
        )}
        <input ref={ref} type="file" style={{ display: 'none' }}
          accept={original ? 'image/*,application/pdf' : 'image/*'}
          onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
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

const seg: React.CSSProperties = { flex: 1, height: 3, borderRadius: 999 }

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' },

  record: { display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', paddingBottom: 'var(--sp-3)', borderBottom: 'var(--hairline)' },
  rec: { display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' },
  recLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  recValue: { fontSize: 'var(--fs-label)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  recValueStrong: { fontSize: 'var(--fs-label)', color: 'var(--dark)', fontWeight: 650, fontVariantNumeric: 'tabular-nums' },

  track: { display: 'flex', flexDirection: 'column' },
  trackHead: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', paddingBottom: 'var(--sp-2)' },
  trackName: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', minWidth: 34 },
  trackBar: { flex: 1, display: 'flex', gap: 2, minWidth: 60 },
  segDone: { ...seg, background: 'var(--lime)' },
  segNow: { ...seg, background: 'var(--dark)' },
  segLate: { ...seg, background: 'var(--req)' },
  segLater: { ...seg, background: 'var(--line)' },
  trackCount: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  trackCountLate: { fontSize: 'var(--fs-caption)', color: 'var(--req)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },

  row: { padding: 'var(--sp-2) 0', borderTop: 'var(--hairline)' },
  rowNow: { padding: 'var(--sp-2) 0 var(--sp-3) var(--sp-3)', borderTop: 'var(--hairline)', boxShadow: 'inset 3px 0 0 0 var(--lime)' },
  rowNowLate: { padding: 'var(--sp-2) 0 var(--sp-3) var(--sp-3)', borderTop: 'var(--hairline)', boxShadow: 'inset 3px 0 0 0 var(--req)' },
  rowHead: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  markDone: { color: 'var(--lime-ink)', fontSize: 'var(--fs-caption)', width: 12 },
  markNow: { color: 'var(--dark)', fontSize: 9, width: 12 },
  markLater: { color: 'var(--line-strong, #CFD4CF)', fontSize: 9, width: 12 },
  name: { fontSize: 'var(--fs-label)', color: 'var(--dark)' },
  nameLater: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  lateTag: { fontSize: 'var(--fs-caption)', color: 'var(--req)', fontWeight: 700 },
  spacer: { flex: 1, minWidth: 'var(--sp-2)' },
  laterWhy: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  autoTag: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  doneMeta: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  doneNote: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', paddingLeft: 20, marginTop: 2 },
  doneFiles: { display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', paddingLeft: 20, marginTop: 2 },

  body: { paddingLeft: 20, marginTop: 'var(--sp-2)' },
  dateRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' },
  label: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  req: { color: 'var(--req)', fontWeight: 700 },
  date: { maxWidth: 190 },

  ackRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' },
  ackDone: { ...BTN.row, color: 'var(--dark)', borderColor: 'var(--lime)', background: 'var(--lime-bg)' },
  ackHint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },

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
  // 되돌리기는 눈에 띄지 않아야 한다 — 자주 쓰는 길이 아니라 잘못 눌렀을 때의 길이다
  undoBtn: { border: 'none', background: 'none', color: 'var(--muted)', fontSize: 'var(--fs-caption)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' },
  undoBtnOff: { border: 'none', background: 'none', color: 'var(--line-strong, #CFD4CF)', fontSize: 'var(--fs-caption)', cursor: 'not-allowed', padding: 0, fontFamily: 'inherit' },

  muted: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: 'var(--sp-3) 0' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', background: 'var(--warnbg)', border: '0.5px solid var(--warn)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)' },
}
