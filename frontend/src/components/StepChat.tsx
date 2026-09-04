import { useEffect, useMemo, useRef, useState } from 'react'
import { onVisibleHeightChange, visibleHeight } from '../lib/viewport'
import { promoteChatPhoto } from '../api/steps'
import { STEP_BY_CODE, EVIDENCE_LABEL, keepsOriginal } from '@shared/process/steps'
import { useChatPoll, pollDelay, lastMessageAt, lastId, appendComments } from '../lib/chatPoll'
import { fetchComments, postComment, commentImageUrl, type StepComment } from '../api/stepComments'
import { PushToggle } from './PushToggle'
import { ChatComposer } from './ChatComposer'

/**
 * 단계별 대화 — 특장사와 관리자가 그 단계 자리에서 주고받는다.
 *
 * **이력이 목적이다.** 고치거나 지우는 버튼을 두지 않는다 — 「그때 무슨 이야기가 오갔나」가
 * 나중에 납기 지연·사양 변경의 근거가 된다. 잘못 쓴 글은 다음 글로 바로잡는다.
 *
 * 넓은 화면에서는 오른쪽에 붙는 서랍, 좁은 화면에서는 아래에서 올라오는 창이다.
 * 둘 다 「단계 옆의 대화 버튼을 누르면 열리는 같은 것」이라 하나로 만든다 —
 * 화면 크기마다 다른 컴포넌트를 두면 한쪽만 고치는 일이 생긴다.
 */
const ROLE_LABEL: Record<string, string> = {
  ADMIN: '관리자', MAKER: '특장사', SALES: '영업', SYSTEM: '시스템',
}

/** 「2026-09-03 14:22」 — 이력이라 날짜까지 적는다. 「3분 전」은 나중에 보면 쓸모가 없다 */
function stamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function StepChat({ orderId, stepCode, stepLabel, canWrite, onClose, onRead }: {
  orderId: number
  stepCode: string
  stepLabel: string
  /** 영업처럼 조회만 하는 역할은 입력칸을 감춘다 */
  canWrite: boolean
  onClose: () => void
  /** 읽음 처리가 끝났다 — 바깥의 빨간 점을 끄게 알린다 */
  onRead: () => void
}) {
  const [rows, setRows] = useState<StepComment[] | null>(null)
  const [me, setMe] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  /*
   * 붙일 사진 — 보내기 전에 **줄여서** 올린다. 요즘 폰 사진은 한 장에 5MB 를 넘고,
   * 대화에 그대로 쌓이면 현장에서 목록을 여는 것만으로 데이터를 다 쓴다.
   */
  const [image, setImage] = useState<File | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  /*
   * 이 단계가 받는 **사진 증빙** 한 가지. 서류 증빙(인수증·튜닝신청서…)은 원본이 필요해
   * 대화 사진으로 대신할 수 없다 — 그런 단계에서는 버튼을 아예 띄우지 않는다.
   */
  const photoKind = useMemo(() => {
    const def = STEP_BY_CODE[stepCode]
    return def?.evidence.find(e => !keepsOriginal(e))
  }, [stepCode])
  const [promoting, setPromoting] = useState<number | null>(null)
  const [promoted, setPromoted] = useState<Set<number>>(new Set())

  async function promote(fileId: number) {
    if (!photoKind) return
    setPromoting(fileId); setErr('')
    try {
      await promoteChatPhoto(orderId, stepCode, fileId, photoKind)
      setPromoted(prev => new Set(prev).add(fileId))
      onRead()   // 증빙이 늘었으니 바깥 목록도 다시 읽게 한다
    } catch (e) {
      setErr(e instanceof Error ? e.message : '증빙으로 등록하지 못했습니다')
    } finally { setPromoting(null) }
  }

  /*
   * **키보드가 올라온 만큼만 줄인다** — 카카오톡처럼.
   *
   * 서랍은 `position: fixed` 라 아이폰에서 키보드가 올라와도 그대로 화면 전체를
   * 차지한다(레이아웃 뷰포트는 안 줄어든다). 그러면 입력칸이 키보드 뒤로 숨는다.
   * 실제로 보이는 높이(`visualViewport`)에 맞춰 서랍 자체를 줄인다.
   */
  const [panelH, setPanelH] = useState<number | null>(null)
  useEffect(() => {
    const fit = () => {
      const el = panelRef.current
      if (!el) return
      // zoom(.88) 되돌리기 — 화면 픽셀로 잰 값을 CSS 픽셀 height 로 넣어야 한다
      const rect = el.getBoundingClientRect()
      const zoom = el.offsetHeight > 0 ? rect.height / el.offsetHeight : 1
      setPanelH(Math.max(240, Math.round(visibleHeight() / (zoom || 1))))
    }
    fit()
    const t = setTimeout(fit, 120)
    const off = onVisibleHeightChange(fit)
    return () => { off(); clearTimeout(t) }
  }, [])

  useEffect(() => {
    let alive = true
    setRows(null); setErr('')
    fetchComments(orderId, stepCode)
      .then(d => { if (!alive) return; setRows(d.comments); setMe(d.me); onRead() })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : '불러오지 못했습니다') })
    return () => { alive = false }
    // onRead 는 매 렌더 새 함수라 넣으면 무한 루프가 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, stepCode])

  /*
   * **상대가 남긴 글이 저절로 뜨게** 한다. 열 때 한 번만 받아 오던 시절에는
   * 알림만 오고 화면은 그대로여서, 새로고침을 눌러야 보였다(실제 제보).
   *
   * 여기서는 `setRows(null)`(불러오는 중)을 **하지 않는다** — 5초마다 화면이 비면
   * 글을 읽던 사람이 매번 깜빡임을 본다. 바뀐 게 없으면 아예 손대지 않는다.
   */
  useChatPoll(
    () => {
      // **새로 생긴 것만** 받는다 — 대화가 길어져도 오가는 양이 늘지 않는다
      fetchComments(orderId, stepCode, lastId(rows))
        .then(d => {
          if (d.comments.length === 0) return          // 새 글 없음 — 목록을 손대지 않는다
          setRows(prev => appendComments(prev, d.comments))
          onRead()                                     // 새 글이 **실제로 왔을 때만** 읽음 처리
        })
        .catch(() => { /* 잠깐 끊긴 것뿐이다 — 다음 차례에 다시 받는다 */ })
    },
    () => pollDelay(lastMessageAt(rows)),
    [orderId, stepCode],
  )

  /*
   * 새 글이 오면 아래로. ⚠️ `scrollIntoView` 는 바깥 컨테이너까지 움직인다 —
   * 목록 자신만 내린다.
   */
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rows?.length])

  /*
   * 서랍이 열려 있는 동안 **뒤 화면이 스크롤되지 않게** 잠근다.
   * 안 막으면 서랍 안에서 손가락을 움직였는데 뒤 목록이 흘러가 있다(모바일에서 특히).
   */
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  async function send() {
    const body = text.trim()
    if ((body === '' && !image) || busy) return
    setBusy(true); setErr('')
    try {
      const row = await postComment(orderId, stepCode, body, image)
      setRows(prev => [...(prev ?? []), row])
      setText(''); setImage(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '전송하지 못했습니다')
    } finally { setBusy(false) }
  }

  return (
    <>
      {/* 뒤를 덮어 바깥 클릭으로 닫는다 — 좁은 화면에서 닫기 버튼을 찾기 어렵다 */}
      <div style={s.scrim} onClick={onClose} />
      <aside
        ref={panelRef}
        style={panelH ? { ...s.panel, height: panelH, bottom: 'auto' } : s.panel}
        role="dialog"
        aria-label={`${stepLabel} 대화`}
      >
        <header style={s.head}>
          {/* 알림 종 — **왼쪽 위**. 예전엔 입력줄 위에 문구까지 달고 한 줄을 통째로 썼다 */}
          <PushToggle />
          <div style={s.headText}>
            <div style={s.title}>{stepLabel}</div>
            <div style={s.sub}>주문 #{orderId} · 단계별 대화</div>
          </div>
          <button style={s.close} onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <div ref={listRef} style={s.body}>
          {rows === null && <div style={s.muted}>불러오는 중…</div>}
          {rows?.length === 0 && (
            <div style={s.empty}>
              아직 오간 대화가 없습니다.
              {canWrite && <><br />이 단계에 대해 남기면 상대에게 알림이 갑니다.</>}
            </div>
          )}
          {rows?.map(c => {
            const mine = c.author === me
            return (
              <div key={c.id} style={mine ? s.mineWrap : s.themWrap}>
                <div style={s.meta}>
                  {c.author_name ?? c.author}
                  <span style={s.role}>{ROLE_LABEL[c.author_role] ?? c.author_role}</span>
                  <span style={s.time}>{stamp(c.created_at)}</span>
                </div>
                <div style={mine ? s.mine : s.them}>
                  {c.image_file_id && (
                    <a href={commentImageUrl(orderId, c.image_file_id)} target="_blank" rel="noreferrer">
                      <img src={commentImageUrl(orderId, c.image_file_id)} alt="첨부 사진" style={s.photo} />
                    </a>
                  )}
                  {c.body}
                </div>
                {/*
                  **대화 사진을 그대로 증빙으로.** 특장사가 단계를 끝까지 안 밟는 큰 이유가
                  업로드의 번거로움이다. 대화에는 사진을 곧잘 올리므로, 한 번 더 올릴 일을 없앤다.
                  사진 증빙을 받는 단계에서만 뜬다(서류 증빙은 원본이 필요해 안 된다).
                */}
                {c.image_file_id && photoKind && canWrite && (
                  <button
                    style={s.promote}
                    disabled={promoting === c.image_file_id}
                    onClick={() => void promote(c.image_file_id!)}
                    title={`이 사진을 「${EVIDENCE_LABEL[photoKind]}」으로 등록합니다`}
                  >
                    {promoted.has(c.image_file_id) ? '✓ 증빙 등록됨'
                      : promoting === c.image_file_id ? '등록 중…'
                      : `증빙으로 등록 · ${EVIDENCE_LABEL[photoKind]}`}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {err && <div style={s.err}>{err}</div>}

        {canWrite ? (
            <ChatComposer
            text={text}
            onTextChange={setText}
            image={image}
            onImageChange={setImage}
            onSend={() => void send()}
            busy={busy}
          />
        ) : (
          <div style={s.readonly}>조회만 가능합니다</div>
        )}
      </aside>
    </>
  )
}

const s: Record<string, React.CSSProperties> = {
  scrim: { position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 40 },
  panel: {
    position: 'fixed', zIndex: 41, background: 'var(--bg)',
    display: 'flex', flexDirection: 'column',
    /*
     * 넓은 화면 — 오른쪽에 붙는 서랍. 좁은 화면 — 화면을 꽉 채운다.
     *
     * ⚠️ `100vw` 를 쓰지 않는다. 이 서랍은 `zoom: .88` 이 걸린 `#root` 안에 있는데,
     *    `vw` 는 그 보정을 받지 않아 **0.88 배로 그려진다**(390 화면에서 343px, 실측).
     *    `--root-w` 는 그 보정이 들어간 값이다(useAppHeight).
     */
    top: 0, right: 0, bottom: 0, width: 'var(--panel-w, min(420px, 100vw))',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    boxShadow: '-2px 0 24px rgba(22,24,15,.18)',
  },
  head: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
    padding: 'var(--sp-4)', borderBottom: 'var(--hairline)', flex: 'none',
  },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: 'var(--fs-title)', fontWeight: 700, letterSpacing: 'var(--ls-tight)' },
  sub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: 2 },
  close: {
    border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer',
    color: 'var(--muted)', padding: 4, lineHeight: 1,
  },
  body: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--sp-4)',
    // 대화 목록 끝에서 더 당겨도 바깥으로 넘기지 않는다 — 넘기면 화면 전체가 출렁인다
    overscrollBehavior: 'contain',
    display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)',
  },
  muted: { color: 'var(--muted)', fontSize: 'var(--fs-body)' },
  /** 말풍선 아래 작은 줄 — 사진을 증빙으로 올리는 자리 */
  promote: {
    marginTop: 4, alignSelf: 'flex-start',
    border: '0.5px solid var(--lime)', background: 'transparent', color: 'var(--lime-ink)',
    borderRadius: 999, padding: '3px 10px', fontSize: 'var(--fs-caption)',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  empty: { color: 'var(--muted)', fontSize: 'var(--fs-body)', lineHeight: 1.6, textAlign: 'center', margin: 'auto 0' },
  themWrap: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  mineWrap: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
  meta: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'baseline' },
  role: { background: 'var(--card)', borderRadius: 8, padding: '1px 6px', fontSize: 11 },
  time: { fontVariantNumeric: 'tabular-nums' },
  them: {
    background: 'var(--card)', borderRadius: '2px 12px 12px 12px', padding: 'var(--sp-3)',
    fontSize: 'var(--fs-body)', lineHeight: 1.55, whiteSpace: 'pre-wrap', maxWidth: '90%',
  },
  mine: {
    background: 'var(--lime-bg)', borderRadius: '12px 2px 12px 12px', padding: 'var(--sp-3)',
    fontSize: 'var(--fs-body)', lineHeight: 1.55, whiteSpace: 'pre-wrap', maxWidth: '90%',
  },
  err: { color: 'var(--req)', fontSize: 'var(--fs-caption)', padding: '0 var(--sp-4) var(--sp-2)' },
  photo: {
    display: 'block', maxWidth: '100%', maxHeight: 220, borderRadius: 8,
    marginBottom: 'var(--sp-2)', objectFit: 'cover' as const,
  },
  readonly: {
    flex: 'none', borderTop: 'var(--hairline)', padding: 'var(--sp-4)',
    fontSize: 'var(--fs-caption)', color: 'var(--muted)', textAlign: 'center',
  },
}
