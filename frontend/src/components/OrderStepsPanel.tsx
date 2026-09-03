import { useEffect, useMemo, useRef, useState } from 'react'
import {
  TRACK_LABEL, EVIDENCE_LABEL, canComplete, canUndo, keepsOriginal,
  stepsFor, stepMapFor, EXTRA_EVIDENCE,
  type EvidenceKind, type Track, type StepState, type StepDef,
} from '@shared/process/steps'
import {
  fetchSteps, completeStep, undoStep, uploadStepFile, deleteStepFile, stepFileUrl,
  type ApiStepsResponse,
} from '../api/steps'
import { shrinkImage, fmtBytes } from '../lib/imageResize'
import { BTN } from '../styles/buttons'
import { DocLink } from './DocLink'
import { openPdf } from '../lib/openPdf'
import { rolesOf } from '@shared/types/index'
import { useAuth } from '../contexts/AuthContext'
import { StepChat } from './StepChat'
import { fetchUnread } from '../api/stepComments'

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
  /*
   * 단계별 대화 — 특장사와 관리자가 그 단계 자리에서 주고받는다.
   * 안 읽은 글이 있는 단계에만 빨간 점을 찍는다(내가 쓴 글은 안 센다 — 서버가 판정).
   */
  const [chat, setChat] = useState<{ code: string; label: string } | null>(null)
  const [unread, setUnread] = useState<Record<string, number>>({})
  const reloadUnread = () => { fetchUnread(orderId).then(setUnread).catch(() => { /* 점이 안 켜질 뿐 */ }) }
  useEffect(reloadUnread, [orderId])

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

  /*
   * **이 주문의 카탈로그** — 특장만 주문은 차량 트랙이 「차량 도착」 하나로 줄고,
   * 그 단계가 받는 증빙도 인수증이 아니라 자동차등록증이다.
   * 서버가 같은 함수로 판정하므로, 화면에서 눌리는데 서버가 거절하는 일이 없다.
   */
  const bodyOnly = res?.order.body_only === true
  const defs = useMemo(() => stepsFor(bodyOnly), [bodyOnly])
  const defByCode = useMemo(() => stepMapFor(bodyOnly), [bodyOnly])

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
    const def = defByCode[code]!
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

  /**
   * 증빙 등록 — **여러 장을 한 번에** 받는다(검수 사진은 보통 여러 장이다).
   *
   * 한 장씩 차례로 올린다. 한꺼번에 보내면 그중 하나가 너무 커서 거부될 때
   * 나머지까지 함께 죽는다 — 무엇이 안 올라갔는지도 알 수 없다.
   * 실패하면 **어느 파일에서 멈췄는지** 이름을 적어 준다.
   */
  async function handleUpload(code: string, kind: EvidenceKind, picked: File[]) {
    setBusy(code + kind); setErr('')
    let ok = 0
    try {
      for (const file of picked) {
        // 사진만 줄인다 — 서류는 글자를 읽어야 해서 원본 그대로 간다
        const { file: out } = keepsOriginal(kind) ? { file } : await shrinkImage(file)
        await uploadStepFile(orderId, code, kind, out)
        ok++
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : '파일 등록에 실패했습니다'
      const rest = picked[ok]?.name
      setErr(picked.length > 1 ? `${ok}장 등록 후 실패${rest ? ` (${rest})` : ''} — ${why}` : why)
    } finally {
      load()
      setBusy(null)
    }
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
        const list = defs.filter(d => d.track === track)
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
              // 카탈로그에는 있는데 단계 행이 아직 없을 수 있다(주문 직후 한순간) — 건너뛴다
              const st = byCode.get(def.code)
              if (!st) return null
              const phase = phaseOf(def)
              const kinds = st.files.map(f => f.kind)
              const gate = canComplete(def.code, states, kinds, defs)
              const needDate = !!def.dateLabel
              const dateOk = !needDate || !!dates[def.code]
              const ackOk = !def.ackLabel || acked.has(def.code)
              const undo = canUndo(def.code, states, defs)

              return (
                <div key={def.code} style={phase === 'now' ? (st.stalled ? s.rowNowLate : s.rowNow) : s.row}>
                  <div style={s.rowHead}>
                    <span style={phase === 'done' ? s.markDone : phase === 'now' ? s.markNow : s.markLater}>
                      {phase === 'done' ? '✓' : phase === 'now' ? '●' : '○'}
                    </span>
                    <span style={phase === 'later' ? s.nameLater : s.name}>{def.label}</span>

                    {/*
                      **완료 취소는 단계 이름 바로 옆**에 둔다. 오른쪽 끝에 있으면
                      줄이 길어질수록 「어느 단계를 되돌리는 버튼인가」가 눈으로 안 이어진다.

                      ⚠️ 취소할 수 없는 이유는 **적지 않는다.** 예전엔 「후속 단계를 먼저
                         취소하십시오 — …」를 그 자리에 적었는데, 문장이 길어 줄이 깨졌다
                         (실제 제보). 취소할 수 있으면 버튼, 아니면 **빈칸**으로 둔다.
                  */}
                    {phase === 'done' && canEdit && undo.ok && (
                      <button
                        style={busy === def.code ? s.undoBtnOff : s.undoBtn}
                        disabled={busy === def.code}
                        onClick={() => handleUndo(def.code)}
                      >{busy === def.code ? '처리 중' : '완료 취소'}</button>
                    )}
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
                      <span style={s.doneMeta}>
                        {st.done_at?.slice(0, 10)}
                        {st.planned_at ? ` · ${def.dateLabel} ${st.planned_at}` : ''}
                      </span>
                    )}

                    {phase === 'later' && (
                      <span style={s.laterWhy}>
                        {def.requires.filter(q => !doneCodes.has(q)).map(q => defByCode[q]?.label ?? q).join(' · ')} 뒤
                      </span>
                    )}

                    {/*
                      `auto` 단계는 다른 행위(발송 등)가 일어나면 저절로 지나간다.
                      **그 담당에게는 버튼을 준다** — 담당이 아닌 사람에게는 안내만 보인다.

                      ⚠️ 튜닝 전자서명 버튼은 걷어냈다. **튜닝은 종이로 받아 스캔해 올린다** —
                         신청서 업로드 → 서명본 업로드 → 승인서 수령. 세 단계 모두 파일이 근거다.
                         전자서명을 다시 켤 때는 그 단계와 함께 이 버튼도 되살릴 것.
                    */}
                    {phase === 'now' && canEdit
                      && (!def.auto || myRoles.includes(def.actor as never)) && (
                      <button
                        style={gate.ok && dateOk && ackOk && busy !== def.code ? BTN.rowPrimary : BTN.rowDisabled}
                        disabled={!gate.ok || !dateOk || !ackOk || busy === def.code}
                        onClick={() => handleComplete(def.code)}
                      >{busy === def.code ? '처리 중' : '완료'}</button>
                    )}
                    {phase === 'now' && def.auto && !myRoles.includes(def.actor as never) && (
                      <span style={s.autoTag}>{ACTOR_LABEL[def.actor]} 발송 시 처리됩니다</span>
                    )}

                    {/*
                      단계별 대화 — 이 단계에서 오간 이야기가 여기 남는다.
                      안 읽은 글이 있으면 빨간 점. 숫자를 적지 않는 이유는 「몇 개인가」가
                      아니라 「내가 안 본 것이 있나」만 알면 열어 보기 때문이다.
                    */}
                    <button
                      style={s.chatBtn}
                      onClick={() => setChat({ code: def.code, label: def.label })}
                      title={`${def.label} 대화`}
                    >
                      대화
                      {(unread[def.code] ?? 0) > 0 && <span style={s.dot} aria-label="안 읽은 대화 있음" />}
                    </button>
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

                      {/*
                        「서명본 확인」은 **실제로 내려받는 것**이다. 예전엔 눌렀다는 사실이
                        브라우저에만 남아 새로고침하면 사라졌고, 서버는 검사하지도 않았다.
                        이제 파일이 나간 순간이 서버에 기록되고, 그 기록이 없으면 완료가 막힌다.
                      */}
                      {def.ackLabel && (
                        <div style={s.ackRow}>
                          <button
                            style={acked.has(def.code) ? s.ackDone : BTN.row}
                            onClick={() => {
                              // 앱(PWA)에는 탭이 없다 — openPdf 가 갈라서 처리한다
                              openPdf(`/api/v1/orders/${orderId}/tuning/signed`, '튜닝신청서_서명본.pdf')
                              setAcked(p => new Set(p).add(def.code))
                            }}
                          >{acked.has(def.code) ? `✓ ${def.ackLabel}` : def.ackLabel}</button>
                          <span style={s.ackHint}>
                            {acked.has(def.code) ? '내려받았습니다' : '서명본을 내려받아야 완료 처리할 수 있습니다'}
                          </span>
                        </div>
                      )}

                      {def.evidence.map(kind => (
                        <EvidenceRow key={kind} kind={kind} orderId={orderId}
                          files={st.files.filter(f => f.kind === kind)}
                          canEdit={canEdit} busy={busy === def.code + kind}
                          onPick={fs => handleUpload(def.code, kind, fs)} onDelete={handleDelete} />
                      ))}
                      {/*
                        **검수 사진은 어느 단계에나 붙는다** — 완료를 막지 않는 덧증빙이다.
                        나중에 「그때 이 부분이 어땠나」를 물을 때 남아 있는 것은 사진뿐이고,
                        그때 가서는 다시 찍을 수 없다. 그래서 필수가 아닌 자리에도 열어 둔다.
                      */}
                      {EXTRA_EVIDENCE.filter(k => !def.evidence.includes(k)).map(kind => (
                        <EvidenceRow key={kind} kind={kind} orderId={orderId} optional
                          files={st.files.filter(f => f.kind === kind)}
                          canEdit={canEdit} busy={busy === def.code + kind}
                          onPick={fs => handleUpload(def.code, kind, fs)} onDelete={handleDelete} />
                      ))}

                      {/* 왜 아직 못 누르는지 — 버튼만 잠가 두면 이유를 알 수 없다 */}
                      {!gate.ok && <div style={s.blocked}>{gate.reason}</div>}
                      {gate.ok && !dateOk && <div style={s.blocked}>{def.dateLabel}을(를) 선택하십시오</div>}
                    </div>
                  )}

                  {phase === 'done' && st.files.length > 0 && (
                    <div style={s.doneFiles}>
                      {st.files.map(f => (
                        <DocLink key={f.id} href={stepFileUrl(orderId, f.id)} name={f.name ?? `파일_${f.id}`} style={s.fileName}>
                          {f.name || `파일 ${f.id}`}
                        </DocLink>
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

      {/*
        대화 서랍 — 닫을 때 안 읽은 개수를 다시 불러 빨간 점을 갱신한다.
        영업은 조회만(쓰기는 서버가 403 으로 막는다 — 화면에서만 감추면 막은 것이 아니다).
      */}
      {chat && (
        <StepChat
          orderId={orderId}
          stepCode={chat.code}
          stepLabel={chat.label}
          canWrite={myRoles.includes('ADMIN') || myRoles.includes('MAKER')}
          onRead={reloadUnread}
          onClose={() => { setChat(null); reloadUnread() }}
        />
      )}
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
function EvidenceRow({ kind, orderId, files, canEdit, busy, optional, onPick, onDelete }: {
  kind: EvidenceKind
  orderId: number
  files: { id: number; name: string | null; size: number | null }[]
  canEdit: boolean
  busy: boolean
  /** 완료를 막지 않는 덧증빙 — 없어도 넘어간다. 그걸 화면에 적어 준다 */
  optional?: boolean
  onPick: (files: File[]) => void
  onDelete: (id: number) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  /** 서류는 PDF 도 받고 사진은 이미지만 받는다 — 화면 문구는 없애도 이 구분은 남는다 */
  const original = keepsOriginal(kind)
  return (
    <div style={s.evidence}>
      <div style={s.evidenceHead}>
        <span style={files.length > 0 ? s.evidenceOk : optional ? s.evidenceOpt : s.evidenceNeed}>
          {files.length > 0 ? '✓' : '·'} {EVIDENCE_LABEL[kind]}
          {/*
            필수인지 선택인지 **둘 다 적는다.** 예전엔 선택일 때만 「· 선택」을 적었는데,
            아무 표시가 없는 항목이 필수인지 그냥 안 적힌 것인지 알 수 없었다.
            날짜 칸(`· 필수`)과 같은 표기를 쓴다 — 같은 뜻이면 같게 보여야 한다.
          */}
          {optional
            ? <span style={s.optTag}> · 선택</span>
            : <span style={s.req}> · 필수</span>}
          {files.length > 1 && <span style={s.optTag}> · {files.length}장</span>}
        </span>
        {/* 등록 버튼은 **대화 버튼과 같은 줄 끝**에 선다 — 오른쪽 끝이 나란해야 눈이 편하다 */}
        <span style={s.spacer} />
        {canEdit && (
          <button style={busy ? BTN.rowDisabled : BTN.row} disabled={busy} onClick={() => ref.current?.click()}>
            {busy ? '올리는 중' : files.length > 0 ? '추가' : '업로드'}
          </button>
        )}
        {/* 여러 장 고를 수 있다 — 검수 사진은 한 장으로 끝나는 일이 드물다 */}
        <input ref={ref} type="file" multiple style={{ display: 'none' }}
          accept={original ? 'image/*,application/pdf' : 'image/*'}
          onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) onPick(fs); e.target.value = '' }} />
      </div>
      {files.map(f => (
        <div key={f.id} style={s.file}>
          <DocLink href={stepFileUrl(orderId, f.id)} name={f.name ?? `파일_${f.id}`} style={s.fileName}>
            {f.name || `파일 ${f.id}`}
          </DocLink>
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
  /**
   * 대화 버튼 — **다른 버튼과 같은 크기**여야 한다.
   *
   * 예전엔 여백만 준 제 폭짜리였고, 그래서 「완료 처리」·「등록」과 세로로 안 맞아
   * 오른쪽 끝이 들쭉날쭉했다(실제 제보 사진). `BTN.row` 를 그대로 쓴다 —
   * 폭 92px 이 못 박혀 있어 무엇이 오든 나란해진다.
   * 빨간 점을 얹어야 하므로 `position` 만 더한다.
   */
  chatBtn: {
    ...BTN.row,
    position: 'relative' as const,
    /*
     * 대화는 **다른 일**이다 — 업로드·완료는 진행을 바꾸고, 대화는 이야기를 남긴다.
     * 크기는 같게 두되(줄이 나란해야 하니까) 테두리만 브랜드색으로 은은하게 둘러
     * 「추가/업로드」와 눈으로 갈린다.
     */
    border: '1px solid var(--lime)',
    color: 'var(--lime-ink)',
  },
  /**
   * 안 읽은 대화 표시. **개수를 적지 않는다** — 「몇 개인가」가 아니라
   * 「내가 안 본 것이 있나」만 알면 열어 보게 된다. 숫자는 버튼만 복잡하게 만든다.
   */
  dot: {
    position: 'absolute' as const, top: -3, right: -3,
    width: 8, height: 8, borderRadius: '50%',
    background: 'var(--req)', border: '1.5px solid var(--bg)',
  },
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
  ovl: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex',
         alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 'var(--sp-4)' },
  modal: { background: '#fff', borderRadius: 10, padding: 'var(--sp-5)', maxWidth: 420, width: '100%' },
  modalTitle: { fontSize: 'var(--fs-label)', fontWeight: 700, marginBottom: 'var(--sp-2)' },
  modalDesc: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginBottom: 'var(--sp-4)', lineHeight: 1.5 },
  modalErr: { fontSize: 'var(--fs-caption)', color: 'var(--req)', marginBottom: 'var(--sp-3)' },
  recip: { fontSize: 'var(--fs-caption)', background: 'var(--bg-soft, #f6f6f6)', borderRadius: 6,
           padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)', lineHeight: 1.7 },
  recipWarn: { marginTop: 'var(--sp-2)', color: 'var(--req)', fontWeight: 600, lineHeight: 1.5 },
  modalBtns: { display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  doneMeta: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  doneNote: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', paddingLeft: 20, marginTop: 2 },
  doneFiles: { display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', paddingLeft: 20, marginTop: 2 },

  body: { paddingLeft: 20, marginTop: 'var(--sp-2)' },
  dateRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' },
  label: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  /** 필수/선택은 **크기가 아니라 색으로** 구분한다 — 라벨보다 튀면 정작 항목 이름이 묻힌다 */
  req: { fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--req)' },
  date: { maxWidth: 190 },

  ackRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' },
  ackDone: { ...BTN.row, color: 'var(--dark)', borderColor: 'var(--lime)', background: 'var(--lime-bg)' },
  ackHint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },

  evidence: { marginTop: 'var(--sp-2)' },
  /** 증빙 줄의 오른쪽 끝을 단계 줄과 맞춘다 — 버튼 열이 하나로 보이게 */
  evidenceHead: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  evidenceOk: { fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--dark)' },
  /*
   * 증빙 줄은 **필수든 선택이든 같은 크기·같은 굵기**로 적는다.
   * 예전엔 필수만 크고 굵고 빨갰는데, 그러면 항목 이름끼리 크기가 달라 목록이 어수선했다.
   * 구분은 뒤에 붙는 「· 필수」/「· 선택」 태그의 **색**으로만 한다.
   */
  evidenceOpt: { fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--body)' },
  optTag: { fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--muted)' },
  evidenceNeed: { fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--body)' },
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
