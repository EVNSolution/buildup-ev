import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAllComments, postComment, type StepComment } from '../api/stepComments'
import { BTN } from '../styles/buttons'
import { PushToggle } from './PushToggle'

/**
 * 「대화」 탭 — 이 주문에서 오간 **모든 이야기를 시간순으로** 한 줄로 읽는다.
 *
 * 단계별 창은 그 단계에 집중할 때 좋지만, 14개를 하나씩 열어 보면 흐름이 안 잡힌다.
 * 여기서는 어느 단계 이야기인지만 표시해 두고 순서대로 늘어놓는다 —
 * 이력을 읽는다는 것은 시간을 따라 읽는다는 뜻이다.
 *
 * 쓸 때는 **어느 단계 이야기인지 먼저 고른다.** 고른 단계로 저장되므로
 * 그 단계의 창(단계 → 대화)에서도 같은 글이 시간순으로 보인다.
 */
const ROLE_LABEL: Record<string, string> = {
  ADMIN: '관리자', MAKER: '특장사', SALES: '영업', SYSTEM: '시스템',
}

const stamp = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const dayOf = (iso: string) => iso.slice(0, 10)

export function OrderChatTab({ orderId, canWrite }: { orderId: number; canWrite: boolean }) {
  const [rows, setRows] = useState<StepComment[] | null>(null)
  const [steps, setSteps] = useState<{ code: string; label: string }[]>([])
  const [me, setMe] = useState('')
  const [step, setStep] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  /*
   * **채팅은 한 화면에 다 들어와야 한다.** 바깥이 같이 스크롤되면 글을 쓰다 말고
   * 입력칸을 찾아 내려야 한다(모바일에서 특히 그렇다).
   *
   * 그래서 남은 높이를 재서 그만큼만 차지한다 — 위(주문 머리말·탭)가 쓰고 남은 만큼.
   * `100vh` 를 쓰지 않는 이유: 모바일 브라우저는 주소창이 접혔다 펴지며 실제 높이가
   * 달라지는데 `vh` 는 그걸 안 따라간다. `innerHeight` 는 따라간다.
   */
  const [boxH, setBoxH] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    fetchAllComments(orderId)
      .then(d => {
        if (!alive) return
        setRows(d.comments); setSteps(d.steps); setMe(d.me)
        // 마지막으로 이야기하던 단계를 기본값으로 — 대개 이어서 쓴다
        setStep(prev => prev || d.comments[d.comments.length - 1]?.step_code || d.steps[0]?.code || '')
      })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : '불러오지 못했습니다') })
    return () => { alive = false }
  }, [orderId])

  /*
   * ⚠️ `scrollIntoView` 를 쓰지 않는다. 그것은 **바깥 스크롤 컨테이너까지 함께** 움직여서,
   *    주문 제목과 「← 배정 주문」 버튼이 화면 밖으로 밀려났다(실측).
   *    목록 자신만 내린다.
   */
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    // 높이(boxH)는 화면을 재서 **나중에** 정해진다 — 그 전에 내리면 아직 짧아서 덜 내려간다
  }, [rows?.length, boxH])

  useEffect(() => {
    const fit = () => {
      const top = rootRef.current?.getBoundingClientRect().top ?? 0
      // 아래 여백 12px — 화면 끝에 딱 붙으면 잘린 것처럼 보인다
      setBoxH(Math.max(280, Math.round(window.innerHeight - top - 12)))
    }
    fit()
    // 글꼴·레이아웃이 자리 잡은 뒤 한 번 더 — 첫 계산이 어긋나는 경우가 있다
    const t = setTimeout(fit, 120)
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit); clearTimeout(t) }
  }, [rows === null])

  const label = useMemo(
    () => new Map(steps.map(s2 => [s2.code, s2.label])),
    [steps],
  )

  async function send() {
    const body = text.trim()
    if (body === '' || step === '' || busy) return
    setBusy(true); setErr('')
    try {
      const row = await postComment(orderId, step, body)
      setRows(prev => [...(prev ?? []), row])
      setText('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '전송하지 못했습니다')
    } finally { setBusy(false) }
  }

  if (err && rows === null) return <div style={s.err}>{err}</div>
  if (rows === null) return <div style={s.muted}>불러오는 중…</div>

  let lastDay = ''
  return (
    <div ref={rootRef} style={boxH ? { ...s.root, height: boxH } : s.root}>
      <div ref={listRef} style={s.list}>
        {rows.length === 0 && (
          <div style={s.empty}>
            아직 오간 이야기가 없습니다.
            {canWrite && <><br />어느 단계에 대한 이야기인지 고르고 남기면 상대에게 알림이 갑니다.</>}
          </div>
        )}
        {rows.map(c => {
          const day = dayOf(c.created_at)
          const newDay = day !== lastDay
          lastDay = day
          const mine = c.author === me
          return (
            <div key={c.id}>
              {/* 날짜가 바뀌면 구분선 — 이력은 「언제」가 중요하다 */}
              {newDay && <div style={s.day}><span style={s.dayText}>{day}</span></div>}
              <div style={mine ? s.mineWrap : s.themWrap}>
                <div style={s.meta}>
                  {/* 어느 단계 이야기인지 — 이것이 없으면 시간순 나열이 뒤죽박죽으로 읽힌다 */}
                  <span style={s.stepTag}>{label.get(c.step_code) ?? c.step_code}</span>
                  {c.author_name ?? c.author}
                  <span style={s.role}>{ROLE_LABEL[c.author_role] ?? c.author_role}</span>
                  <span style={s.time}>{stamp(c.created_at).slice(11)}</span>
                </div>
                <div style={mine ? s.mine : s.them}>{c.body}</div>
              </div>
            </div>
          )
        })}
      </div>

      {err && <div style={s.errLine}>{err}</div>}
      <PushToggle />

      {canWrite ? (
        <div style={s.composer}>
          {/* 무엇에 대한 이야기인지 **먼저** 고른다 — 쓰고 나서 고르면 잘못 붙는다 */}
          <label style={s.pickRow}>
            <span style={s.pickLabel}>단계</span>
            <select style={s.pick} value={step} onChange={e => setStep(e.target.value)}>
              {steps.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </label>
          <div style={s.sendRow}>
            <textarea
              style={s.input}
              rows={2}
              maxLength={2000}
              placeholder="내용을 입력하세요"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
              }}
            />
            <button
              style={busy || text.trim() === '' ? { ...BTN.primary, opacity: 0.45 } : BTN.primary}
              disabled={busy || text.trim() === ''}
              onClick={() => void send()}
            >{busy ? '전송 중…' : '남기기'}</button>
          </div>
        </div>
      ) : (
        <div style={s.readonly}>조회만 가능합니다</div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  /** 높이는 화면을 재서 정한다(위 useEffect) — 여기 값은 계산 전 잠깐 쓰는 것 */
  root: { display: 'flex', flexDirection: 'column', minHeight: 0, height: 'min(60vh, 640px)', overflow: 'hidden' },
  list: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--sp-4)',
    display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)',
  },
  day: { display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 'var(--sp-2) 0' },
  dayText: {
    fontSize: 'var(--fs-caption)', color: 'var(--muted)',
    background: 'var(--card)', borderRadius: 999, padding: '2px 10px',
  },
  themWrap: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  mineWrap: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
  meta: {
    fontSize: 'var(--fs-caption)', color: 'var(--muted)',
    display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap',
  },
  stepTag: {
    background: 'var(--lime-bg)', color: 'var(--lime-ink)', borderRadius: 6,
    padding: '1px 7px', fontSize: 11, fontWeight: 600,
  },
  role: { background: 'var(--card)', borderRadius: 8, padding: '1px 6px', fontSize: 11 },
  time: { fontVariantNumeric: 'tabular-nums' },
  them: {
    background: 'var(--card)', borderRadius: '2px 12px 12px 12px', padding: 'var(--sp-3)',
    fontSize: 'var(--fs-body)', lineHeight: 1.55, whiteSpace: 'pre-wrap', maxWidth: 'min(560px, 88%)',
  },
  mine: {
    background: 'var(--lime-bg)', borderRadius: '12px 2px 12px 12px', padding: 'var(--sp-3)',
    fontSize: 'var(--fs-body)', lineHeight: 1.55, whiteSpace: 'pre-wrap', maxWidth: 'min(560px, 88%)',
  },
  muted: { color: 'var(--muted)', fontSize: 'var(--fs-body)', padding: 'var(--sp-4)' },
  empty: { color: 'var(--muted)', fontSize: 'var(--fs-body)', lineHeight: 1.6, textAlign: 'center', margin: 'auto 0' },
  err: { color: 'var(--req)', fontSize: 'var(--fs-body)', padding: 'var(--sp-4)' },
  errLine: { color: 'var(--req)', fontSize: 'var(--fs-caption)', padding: '0 var(--sp-4) var(--sp-2)' },
  composer: { flex: 'none', borderTop: 'var(--hairline)', padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' },
  pickRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' },
  pickLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', flex: 'none' },
  pick: {
    flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 8,
    border: 'var(--hairline)', fontSize: 'var(--fs-label)', fontFamily: 'inherit', background: 'var(--bg)',
  },
  sendRow: { display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' },
  input: {
    flex: 1, minWidth: 0, resize: 'none', fontFamily: 'inherit', fontSize: 'var(--fs-body)',
    padding: 'var(--sp-2)', borderRadius: 8, border: 'var(--hairline)', boxSizing: 'border-box',
  },
  readonly: {
    flex: 'none', borderTop: 'var(--hairline)', padding: 'var(--sp-4)',
    fontSize: 'var(--fs-caption)', color: 'var(--muted)', textAlign: 'center',
  },
}
