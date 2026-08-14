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
import { rolesOf } from '@shared/types/index'
import { useAuth } from '../contexts/AuthContext'

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

/** 담당 역할을 사람이 읽는 말로 — 화면에 SALES 라고 쓰지 않는다 */
const ACTOR_LABEL: Record<string, string> = {
  SALES: '영업', ADMIN: '관리자', MAKER: '특장사', SYSTEM: '시스템',
}

export function OrderStepsPanel({ orderId, canEdit = true }: {
  orderId: number
  /** 조회만 하는 화면에서는 버튼을 감춘다 */
  canEdit?: boolean
}) {
  const { session } = useAuth()
  const myRoles = session ? rolesOf(session.user) : []
  const [res, setRes] = useState<ApiStepsResponse | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dates, setDates] = useState<Record<string, string>>({})
  /** 완료 전에 확인해야 하는 단계에서, 확인을 마친 것들(서명본 내려받기 등) */
  const [acked, setAcked] = useState<Set<string>>(new Set())

  function load() {
    fetchSteps(orderId).then(setRes).catch(e => setErr(e instanceof Error ? e.message : '단계 정보를 불러오지 못했습니다'))
  }
  useEffect(() => { load() }, [orderId])   // eslint-disable-line react-hooks/exhaustive-deps

  const steps = res?.data ?? null
  const states: StepState[] = useMemo(
    () => (steps ?? []).map(s => ({ code: s.code, status: s.status })),
    [steps],
  )
  const doneCodes = useMemo(() => new Set(states.filter(s => s.status === 'done').map(s => s.code)), [states])

  if (err && !steps) return <div style={s.err}>{err}</div>
  if (!steps || !res) return <div style={s.muted}>단계를 불러오는 중입니다.</div>

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
    } catch (e) { setErr(e instanceof Error ? e.message : '완료 처리에 실패했습니다') }
    finally { setBusy(null) }
  }

  async function handleUndo(code: string) {
    setBusy(code); setErr('')
    try { await undoStep(orderId, code); load() }
    catch (e) { setErr(e instanceof Error ? e.message : '완료 취소에 실패했습니다') }
    finally { setBusy(null) }
  }

  async function handleUpload(code: string, kind: EvidenceKind, file: File) {
    setBusy(code + kind); setErr('')
    try {
      // 사진만 줄인다 — 서류는 글자를 읽어야 해서 원본 그대로 간다
      const { file: out } = keepsOriginal(kind) ? { file } : await shrinkImage(file)
      await uploadStepFile(orderId, code, kind, out)
      load()
    } catch (e) { setErr(e instanceof Error ? e.message : '파일 등록에 실패했습니다') }
    finally { setBusy(null) }
  }

  async function handleDelete(fileId: number) {
    setBusy('f' + fileId); setErr('')
    try { await deleteStepFile(orderId, fileId); load() }
    catch (e) { setErr(e instanceof Error ? e.message : '파일 삭제에 실패했습니다') }
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
        <Rec label="수락" value={res.order.accepted_at?.slice(0, 10) ?? '미수락'} />
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
              const undo = canUndo(def.code, states)

              return (
                <div key={def.code} style={phase === 'now' ? (st.stalled ? s.rowNowLate : s.rowNow) : s.row}>
                  <div style={s.rowHead}>
                    <span style={phase === 'done' ? s.markDone : phase === 'now' ? s.markNow : s.markLater}>
                      {phase === 'done' ? '✓' : phase === 'now' ? '●' : '○'}
                    </span>
                    <span style={phase === 'later' ? s.nameLater : s.name}>{def.label}</span>
                    {/* 지연은 숫자로 말한다 — 「지연」만으로는 얼마나 늦었는지 모른다 */}
                    {st.stalled && st.overdue_days != null && (
                      <span style={s.lateTag}>기한 {st.due_at} · {st.overdue_days}일 경과</span>
                    )}
                    {/* 마감이 있는데 아직 안 넘겼으면 언제까지인지 */}
                    {phase === 'now' && !st.stalled && st.due_at && (
                      <span style={s.dueTag}>기한 {st.due_at}</span>
                    )}

                    <span style={s.spacer} />

                    {phase === 'done' && (
                      <>
                        <span style={s.doneMeta}>
                          {st.done_at?.slice(0, 10)}
                          {st.planned_at ? ` · ${def.dateLabel} ${st.planned_at}` : ''}
                        </span>
                        {canEdit && undo.ok && (
                          <button
                            style={busy === def.code ? s.undoBtnOff : s.undoBtn}
                            disabled={busy === def.code}
                            onClick={() => handleUndo(def.code)}
                          >{busy === def.code ? '처리 중' : '완료 취소'}</button>
                        )}
                        {/*
                          취소할 수 없으면 **버튼을 잠그는 대신 이유를 적는다.**
                          잠긴 버튼은 왜 안 되는지 알려 주지 않아, 눌러 보고도 알 수 없다(실제 제보).
                        */}
                        {canEdit && !undo.ok && (
                          <span style={s.undoWhy}>{(undo as { reason: string }).reason}</span>
                        )}
                      </>
                    )}

                    {phase === 'later' && (
                      <span style={s.laterWhy}>
                        {def.requires.filter(q => !doneCodes.has(q)).map(q => STEP_BY_CODE[q]!.label).join(' · ')} 뒤
                      </span>
                    )}

                    {/*
                      `auto` 단계는 다른 행위(전자서명 발송 등)가 일어나면 저절로 지나간다.
                      **그 담당에게는 버튼을 준다** — 아직 그 기능이 붙기 전이라, 버튼이 아예
                      없으면 이 갈래가 영구히 막힌다. 담당이 아닌 사람에게는 안내만 보인다.
                    */}
                    {phase === 'now' && canEdit && (!def.auto || myRoles.includes(def.actor as never)) && (
                      <button
                        style={gate.ok && dateOk && ackOk && busy !== def.code ? BTN.rowPrimary : BTN.rowDisabled}
                        disabled={!gate.ok || !dateOk || !ackOk || busy === def.code}
                        onClick={() => handleComplete(def.code)}
                      >{busy === def.code ? '처리 중' : '완료 처리'}</button>
                    )}
                    {phase === 'now' && def.auto && !myRoles.includes(def.actor as never) && (
                      <span style={s.autoTag}>{ACTOR_LABEL[def.actor]} 발송 시 처리됩니다</span>
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
                            {acked.has(def.code) ? '확인 완료' : '서명본 확인 후 완료 처리할 수 있습니다'}
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
                      {gate.ok && !dateOk && <div style={s.blocked}>{def.dateLabel}을(를) 선택하십시오</div>}
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
        <span style={s.evidenceHint}>{original ? '원본 저장' : `긴 변 ${MAX_EDGE}px 로 축소 저장`}</span>
        {canEdit && (
          <button style={busy ? BTN.rowDisabled : BTN.row} disabled={busy} onClick={() => ref.current?.click()}>
            {busy ? '등록 중' : '등록'}
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
          {canEdit && <button style={s.fileDel} onClick={() => onDelete(f.id)}>삭제</button>}
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
  lateTag: { fontSize: 'var(--fs-caption)', color: 'var(--req)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  dueTag: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
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
  undoWhy: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  undoBtnOff: { border: 'none', background: 'none', color: 'var(--line-strong, #CFD4CF)', fontSize: 'var(--fs-caption)', cursor: 'not-allowed', padding: 0, fontFamily: 'inherit' },

  muted: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: 'var(--sp-3) 0' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', background: 'var(--warnbg)', border: '0.5px solid var(--warn)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)' },
}
