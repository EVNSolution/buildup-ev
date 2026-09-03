import { useEffect, useRef, useState } from 'react'
import { onVisibleHeightChange, visibleHeight } from '../lib/viewport'
import { fetchComments, postComment, commentImageUrl, type StepComment } from '../api/stepComments'
import { BTN } from '../styles/buttons'
import { shrinkImage } from '../lib/imageResize'
import { PushToggle } from './PushToggle'
import { safeBottom } from '../styles/safeArea'

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
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)

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
              아직 오간 이야기가 없습니다.
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
              </div>
            )
          })}
        </div>

        {err && <div style={s.err}>{err}</div>}

        {/* 알림은 이 자리에서 권한다 — 대화를 보고 있을 때가 가장 와닿는다 */}
        <PushToggle />

        {canWrite ? (
          <div style={s.composer}>
            {/*
              사진 첨부 — 올리기 전에 줄인다(`shrinkImage`). 현장에서 찍은 사진이
              그대로 쌓이면 목록을 여는 것만으로 데이터를 다 쓴다.
            */}
            <button
              style={s.clip}
              onClick={() => fileRef.current?.click()}
              title="사진 첨부"
            >{image ? '📎 1' : '📎'}</button>
            <input
              ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={async e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                try { setImage((await shrinkImage(f)).file) }
                catch { setImage(f) }   // 못 줄여도 원본으로 보낸다 — 못 보내는 것보다 낫다
              }}
            />
          {image && (
            <div style={s.preview}>
              <img src={URL.createObjectURL(image)} alt="첨부할 사진" style={s.previewImg} />
              <span style={s.previewName}>{image.name}</span>
              <button style={s.previewX} onClick={() => setImage(null)} aria-label="첨부 취소">✕</button>
            </div>
          )}
            <textarea
              style={s.input}
              rows={2}
              placeholder="내용을 입력하세요"
              value={text}
              maxLength={2000}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                // ⌘/Ctrl + Enter 로 보낸다. 그냥 Enter 는 줄바꿈 — 여러 줄로 적는 일이 많다
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
              }}
            />
            <button
              style={busy || (text.trim() === '' && !image) ? { ...BTN.primary, opacity: 0.45 } : BTN.primary}
              disabled={busy || (text.trim() === '' && !image)}
              onClick={() => void send()}
            >{busy ? '전송 중…' : '남기기'}</button>
          </div>
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
    // 넓은 화면 — 오른쪽에 붙는 서랍. 좁은 화면 — 아래에서 올라오는 창(미디어쿼리 대신 clamp 로)
    top: 0, right: 0, bottom: 0, width: 'min(420px, 100vw)',
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
    display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)',
  },
  muted: { color: 'var(--muted)', fontSize: 'var(--fs-body)' },
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
  clip: {
    flexShrink: 0, border: 'var(--hairline)', background: 'var(--bg)', borderRadius: 8,
    minHeight: 38, padding: '0 10px', cursor: 'pointer', fontSize: 15, fontFamily: 'inherit',
  },
  preview: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  previewImg: { width: 36, height: 36, objectFit: 'cover' as const, borderRadius: 6, border: 'var(--hairline)' },
  previewName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  previewX: { border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 14 },
  /** 말풍선 안의 사진 — 눌러서 원본을 연다 */
  photo: {
    display: 'block', maxWidth: '100%', maxHeight: 220, borderRadius: 8,
    marginBottom: 'var(--sp-2)', objectFit: 'cover' as const,
  },
  composer: {
    flex: 'none', borderTop: 'var(--hairline)', padding: 'var(--sp-4)',
    paddingBottom: safeBottom('var(--sp-4)'),
    display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end',
  },
  input: {
    flex: 1, minWidth: 0, resize: 'none', fontFamily: 'inherit', fontSize: 'var(--fs-body)',
    padding: 'var(--sp-2)', borderRadius: 8, border: 'var(--hairline)', boxSizing: 'border-box',
  },
  readonly: {
    flex: 'none', borderTop: 'var(--hairline)', padding: 'var(--sp-4)',
    fontSize: 'var(--fs-caption)', color: 'var(--muted)', textAlign: 'center',
  },
}
