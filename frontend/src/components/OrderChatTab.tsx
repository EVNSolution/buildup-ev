import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAllComments, postComment, commentImageUrl, type StepComment } from '../api/stepComments'
import { useChatPoll, pollDelay, lastMessageAt, lastId, appendComments } from '../lib/chatPoll'
import { PushToggle } from './PushToggle'
import { ChatComposer } from './ChatComposer'

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

export function OrderChatTab(
  { orderId, canWrite, initialStep }:
  { orderId: number; canWrite: boolean; /** 알림을 눌러 들어왔을 때 골라 둘 단계 */ initialStep?: string },
) {
  const [rows, setRows] = useState<StepComment[] | null>(null)
  const [steps, setSteps] = useState<{ code: string; label: string }[]>([])
  const [me, setMe] = useState('')
  const [step, setStep] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  /*
   * 붙일 사진 — 보내기 전에 **줄여서** 올린다. 요즘 폰 사진은 한 장에 5MB 를 넘고,
   * 대화에 그대로 쌓이면 현장에서 목록을 여는 것만으로 데이터를 다 쓴다.
   */
  const [image, setImage] = useState<File | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /*
   * **채팅은 한 화면에 다 들어와야 한다.** 바깥이 같이 스크롤되면 글을 쓰다 말고
   * 입력칸을 찾아 내려야 한다(모바일에서 특히 그렇다).
   *
   * 높이는 **부모(OrderDetail 의 탭 본문)를 채워서** 얻는다 — 화면을 여기서 다시 재지
   * 않는다. 예전엔 `innerHeight` 를 직접 쟀는데, 모바일의 `#root { zoom: .88 }` 때문에
   * 화면 픽셀과 CSS 픽셀이 어긋나 **바닥에 빈 띠가 남았다**(실측 89px).
   * 부모는 이미 바닥까지 채워져 있으므로 그냥 따라 늘어나면 된다.
   */

  useEffect(() => {
    let alive = true
    fetchAllComments(orderId)
      .then(d => {
        if (!alive) return
        // 첫 조회라 단계 목록이 함께 온다(증분 조회에는 안 온다)
        const steps = d.steps ?? []
        setRows(d.comments); setSteps(steps); setMe(d.me)
        /*
         * 알림을 눌러 들어왔으면 **그 단계**를 고른 채로 연다 — 알림이 말하는 내용이
         * 그 단계에 있으므로 바로 이어서 답할 수 있다.
         * 그 밖에는 마지막으로 이야기하던 단계를 기본값으로 — 대개 이어서 쓴다.
         */
        const preferred = initialStep && steps.some(x => x.code === initialStep) ? initialStep : ''
        setStep(prev => prev || preferred || d.comments[d.comments.length - 1]?.step_code || steps[0]?.code || '')
      })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : '불러오지 못했습니다') })
    return () => { alive = false }
  }, [orderId])

  /*
   * **상대가 남긴 글이 저절로 뜨게** 한다 — 열 때 한 번만 받아 오면 알림이 와도
   * 화면은 그대로여서 새로고침을 눌러야 보인다(실제 제보).
   *
   * 고른 단계(`step`)는 **건드리지 않는다.** 답을 쓰려고 골라 둔 것이 5초마다
   * 되돌아가면 글을 쓸 수 없다.
   */
  useChatPoll(
    () => {
      // **새로 생긴 것만** — 단계 목록은 처음 한 번 받았으니 다시 받지 않는다
      fetchAllComments(orderId, lastId(rows))
        .then(d => { if (d.comments.length > 0) setRows(prev => appendComments(prev, d.comments)) })
        .catch(() => { /* 잠깐 끊긴 것뿐이다 — 다음 차례에 다시 받는다 */ })
    },
    () => pollDelay(lastMessageAt(rows)),
    [orderId],
  )

  /*
   * ⚠️ `scrollIntoView` 를 쓰지 않는다. 그것은 **바깥 스크롤 컨테이너까지 함께** 움직여서,
   *    주문 제목과 「← 배정 주문」 버튼이 화면 밖으로 밀려났다(실측).
   *    목록 자신만 내린다.
   */
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rows?.length])


  /*
   * **페이지가 조금이라도 스크롤되면 안 된다.**
   *
   * 위에서 남은 높이를 재도 바깥 여백·테두리 때문에 몇 px 이 넘칠 때가 있었다
   * (「미세하게 스크롤된다」는 제보). 두 가지로 막는다.
   *   ① 넘친 만큼 실제로 재서 줄인다 — 내용이 잘리지 않게
   *   ② 그래도 남으면 body 스크롤 자체를 잠근다 — 원천봉쇄
   */

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 탭을 벗어나면 반드시 되돌린다 — 안 되돌리면 앱 전체가 굳는다
    return () => { document.body.style.overflow = prev }
  }, [])

  const label = useMemo(
    () => new Map(steps.map(s2 => [s2.code, s2.label])),
    [steps],
  )

  async function send() {
    const body = text.trim()
    if ((body === '' && !image) || step === '' || busy) return
    setBusy(true); setErr('')
    try {
      const row = await postComment(orderId, step, body, image)
      setRows(prev => [...(prev ?? []), row])
      setText(''); setImage(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '전송하지 못했습니다')
    } finally { setBusy(false) }
  }

  if (err && rows === null) return <div style={s.err}>{err}</div>
  if (rows === null) return <div style={s.muted}>불러오는 중…</div>

  let lastDay = ''
  return (
    <div style={s.root}>
      {/* 알림 종 — **왼쪽 위**. 예전엔 입력줄 위에 문구까지 달고 한 줄을 통째로 썼다 */}
      <div style={s.bellRow}><PushToggle /></div>

      <div ref={listRef} style={s.list}>
        {rows.length === 0 && (
          <div style={s.empty}>
            아직 오간 대화가 없습니다.
            {canWrite && <><br />어느 단계에 대한 대화인지 고르고 남기면 상대에게 알림이 갑니다.</>}
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
                <div style={mine ? s.mine : s.them}>
                  {c.image_file_id && (
                    <a href={commentImageUrl(orderId, c.image_file_id)} target="_blank" rel="noreferrer">
                      <img src={commentImageUrl(orderId, c.image_file_id)} alt="첨부 사진" style={s.photo} />
                    </a>
                  )}
                  {c.body}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {err && <div style={s.errLine}>{err}</div>}

      {canWrite ? (
        <ChatComposer
          text={text}
          onTextChange={setText}
          image={image}
          onImageChange={setImage}
          onSend={() => void send()}
          busy={busy}
          /*
            무엇에 대한 이야기인지 **먼저** 고른다 — 쓰고 나서 고르면 잘못 붙는다.
            라벨(「단계」)은 뺐다. 고를 것이 단계뿐이라 말하지 않아도 알고,
            라벨이 앞을 차지하면 칸이 입력줄보다 좁아져 줄이 어긋나 보였다(제보).
          */
          above={
            <select style={s.pick} value={step} onChange={e => setStep(e.target.value)} aria-label="단계 고르기">
              {steps.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          }
        />
      ) : (
        <div style={s.readonly}>조회만 가능합니다</div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  /** 단계 고르기 — 입력줄 **바로 위, 같은 폭**. 라벨 없이 칸 하나로 둔다 */
  pick: { width: '100%', boxSizing: 'border-box' },
  /** 높이는 화면을 재서 정한다(위 useEffect) — 여기 값은 계산 전 잠깐 쓰는 것 */
  /** 부모가 정한 높이를 그대로 채운다 — 여기서 화면을 재지 않는다(zoom 함정) */
  root: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' },
  list: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--sp-4)',
    // 대화 목록 끝에서 더 당겨도 바깥으로 넘기지 않는다 — 넘기면 화면 전체가 출렁인다
    overscrollBehavior: 'contain',
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
  /** 종 한 칸 — 줄을 통째로 쓰지 않게 높이를 종 크기에 맞춘다 */
  bellRow: { flex: 'none', display: 'flex', justifyContent: 'flex-start', padding: '2px var(--sp-2) 0' },
  photo: {
    display: 'block', maxWidth: '100%', maxHeight: 220, borderRadius: 8,
    marginBottom: 'var(--sp-2)', objectFit: 'cover' as const,
  },
  readonly: {
    flex: 'none', borderTop: 'var(--hairline)', padding: 'var(--sp-4)',
    fontSize: 'var(--fs-caption)', color: 'var(--muted)', textAlign: 'center',
  },
}
