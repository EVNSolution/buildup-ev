import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { t, tf } from '../i18n'
import { fetchInbox, fetchUnreadCount, markAllRead, markRead, type InboxItem } from '../api/notifications'
import { pushConfig, pushState, enablePush, isInstalled, type PushState } from '../lib/push'
import { useEscapeClose } from '../lib/escClose'
import { useBackClose } from '../lib/backClose'
import { useIsMobile } from '../hooks/useIsMobile'

/**
 * **알림함** — 헤더의 종 아이콘. 누르면 받은 알림을 쭉 본다(2026-09-14 요청).
 *
 *   · 안 읽은 알림이 있으면 **아이콘에 빨간 점**. 목록에서는 안 읽은 줄 **맨 앞에 빨간 점**
 *   · 「모두 읽음으로 표시」 — 지우지 않는다. 읽은 것도 목록에 남는다
 *   · 이 기기에서 알림을 아직 허용하지 않았으면 **팝업 맨 위에 「알림 허용」**을 먼저 띄운다.
 *     알림함에는 늘 쌓이지만, 휴대폰·PC 알림으로 뜨는 것은 기기에서 허용했을 때뿐이다.
 *
 * ⚠️ 빨간 점은 **가려지면 안 된다.** 헤더는 `overflow: hidden` 이라 버튼 밖으로 삐져나간 점은
 *    잘린다 — 점을 **버튼 상자 안쪽** 모서리에 두고 `zIndex` 를 올린다. 팝업은 헤더에 갇히지
 *    않게 `body` 로 띄운다(포털).
 */

/** 새 알림을 얼마나 자주 확인할지 — 푸시가 오면 서비스워커가 바로 알려 주므로 이건 보조다 */
const POLL_MS = 30_000

function BellIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

/** 「방금」·「5분 전」·「3시간 전」, 하루가 넘으면 날짜 */
function when(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const min = Math.floor((now - d.getTime()) / 60_000)
  if (min < 1) return t('방금')
  if (min < 60) return tf('{0}분 전', min)
  if (min < 24 * 60) return tf('{0}시간 전', Math.floor(min / 60))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function NotificationBell() {
  const navigate = useNavigate()
  const isMobile = useIsMobile(600)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 64, right: 12 })

  const refreshCount = useCallback(() => {
    fetchUnreadCount().then(setUnread).catch(() => { /* 점이 안 바뀔 뿐 */ })
  }, [])

  // 처음 · 주기적으로 · 화면으로 돌아왔을 때 · 푸시가 왔을 때
  useEffect(() => {
    refreshCount()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refreshCount() }, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') refreshCount() }
    const onSw = (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'notification') refreshCount() }
    document.addEventListener('visibilitychange', onVis)
    navigator.serviceWorker?.addEventListener('message', onSw)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      navigator.serviceWorker?.removeEventListener('message', onSw)
    }
  }, [refreshCount])

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await fetchInbox()
      setItems(r.data); setUnread(r.unread); setNextBefore(r.next_before)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('알림을 불러오지 못했습니다'))
    }
  }, [])

  // 팝업 자리 — 종 아이콘 바로 아래, 오른쪽 끝을 맞춘다
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: Math.round(r.bottom + 8), right: Math.max(8, Math.round(window.innerWidth - r.right)) })
  }, [open])

  useEffect(() => { if (open) void load() }, [open, load])

  const close = useCallback(() => setOpen(false), [])
  useEscapeClose(close, open)
  useBackClose(open, close)

  async function more() {
    if (!nextBefore) return
    setBusy(true)
    try {
      const r = await fetchInbox(nextBefore)
      setItems(prev => [...(prev ?? []), ...r.data]); setNextBefore(r.next_before); setUnread(r.unread)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('알림을 불러오지 못했습니다'))
    } finally { setBusy(false) }
  }

  async function readAll() {
    setBusy(true); setErr('')
    try {
      await markAllRead()
      const now = new Date().toISOString()
      setItems(prev => prev?.map(n => (n.read_at ? n : { ...n, read_at: now })) ?? prev)
      setUnread(0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('읽음 처리하지 못했습니다'))
    } finally { setBusy(false) }
  }

  function openItem(n: InboxItem) {
    if (!n.read_at) {
      // 먼저 화면에서 지운다 — 서버 응답을 기다리면 누른 뒤에도 점이 남아 보인다
      setItems(prev => prev?.map(x => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? prev)
      setUnread(u => Math.max(0, u - 1))
      markRead(n.id).then(setUnread).catch(() => refreshCount())
    }
    setOpen(false)
    // 같은 앱 안의 주소만 따라간다 — 알림 주소는 서버가 만든 앱 경로다
    if (n.url.startsWith('/')) navigate(n.url)
  }

  const label = unread > 0 ? t('알림 — 안 읽은 알림 있음') : t('알림')

  const panel = (
        <>
          {/* 바깥을 누르면 닫힌다 — 투명한 막. 키보드는 Esc(useEscapeClose), 휴대폰은 뒤로가기(useBackClose) */}
          <div style={s.scrim} onClick={ev => { if (ev.target === ev.currentTarget) close() }} />
          <div
            role="dialog"
            aria-label={t('알림')}
            style={{
              ...s.panel,
              top: pos.top,
              ...(isMobile ? { left: 8, right: 8 } : { right: pos.right, width: 400 }),
              maxHeight: `calc(100dvh - ${pos.top + 16}px)`,
            }}
          >
            <div style={s.head}>
              <span style={s.title}>{t('알림')}</span>
              <button type="button" style={unread > 0 ? s.readAll : s.readAllOff} disabled={busy || unread === 0} onClick={() => void readAll()}>
                {t('모두 읽음으로 표시')}
              </button>
            </div>

            <div style={s.scroll}>
              {/* 이 기기에서 알림을 허용하지 않았으면 **맨 위에 먼저** */}
              <PushPrompt />

              {err && <div style={s.err}>{err}</div>}
              {!items && !err && <div style={s.empty}>{t('불러오는 중…')}</div>}
              {items && items.length === 0 && <div style={s.empty}>{t('받은 알림이 없습니다')}</div>}
              {items?.map(n => (
                <button key={n.id} type="button" style={s.item} onClick={() => openItem(n)}>
                  {/* 점 자리는 **늘 비워 둔다** — 읽은 줄도 글자가 같은 자리에서 시작한다. 점은 줄 맨 앞 */}
                  <span style={s.dotSlot} aria-hidden="true">{!n.read_at && <span style={s.dot} />}</span>
                  <span style={s.itemText}>
                    <span style={n.read_at ? s.itemTitleRead : s.itemTitle}>
                      {!n.read_at && <span style={s.srOnly}>{t('안 읽음')} </span>}
                      {n.title}
                    </span>
                    {n.body && <span style={s.itemBody}>{n.body}</span>}
                    <span style={s.itemTime}>{when(n.created_at)}</span>
                  </span>
                </button>
              ))}
              {nextBefore && (
                <button type="button" style={s.more} disabled={busy} onClick={() => void more()}>{t('더 보기')}</button>
              )}
            </div>
          </div>
        </>
  )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        style={s.bell}
        onClick={() => setOpen(o => !o)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <BellIcon />
        {unread > 0 && <span style={s.bellDot} data-testid="bell-dot" aria-hidden="true" />}
      </button>

      {/* 팝업은 헤더(overflow: hidden)에 갇히지 않게 body 로 띄운다 */}
      {open && createPortal(panel, document.body)}
    </>
  )
}

/**
 * **이 기기에서 알림 허용** — 아직 안 켠 기기에서만, 팝업 맨 위에.
 * 서버에 푸시 키가 없으면 띄우지 않는다(눌러도 안 되는 버튼은 없느니만 못하다).
 */
function PushPrompt() {
  const [cfg, setCfg] = useState<{ enabled: boolean; publicKey: string } | null>(null)
  const [st, setSt] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      const c = await pushConfig().catch(() => ({ enabled: false, publicKey: '' }))
      if (!alive) return
      setCfg(c)
      if (c.enabled) setSt(await pushState().catch(() => null))
    })()
    return () => { alive = false }
  }, [])

  if (!cfg?.enabled || !st || st.kind === 'on') return null

  const needsInstall = !isInstalled() && /iPad|iPhone|iPod/.test(navigator.userAgent)

  async function allow() {
    setBusy(true); setErr('')
    try {
      await enablePush(cfg!.publicKey)
      setSt(await pushState())
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('알림 설정을 바꾸지 못했습니다'))
    } finally { setBusy(false) }
  }

  return (
    <div style={s.prompt}>
      <div style={s.promptTitle}>{t('이 기기에서 알림 받기')}</div>
      {st.kind === 'off' ? (
        <>
          <div style={s.promptText}>
            {needsInstall
              ? t('아이폰은 홈 화면에 추가한 앱에서 알림을 허용할 수 있습니다')
              : t('허용하면 새 알림이 휴대폰·PC 알림으로도 바로 뜹니다')}
          </div>
          <button type="button" style={s.promptBtn} disabled={busy} onClick={() => void allow()}>
            {busy ? t('설정 중…') : t('알림 허용')}
          </button>
        </>
      ) : (
        // 차단했거나 지원하지 않는 환경 — 왜 안 되는지 적는다
        <div style={s.promptText}>{st.why}</div>
      )}
      {err && <div style={s.err}>{err}</div>}
    </div>
  )
}

const RED = 'var(--req)'

const s: Record<string, React.CSSProperties> = {
  bell: {
    position: 'relative', flexShrink: 0, width: 40, height: 40,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', borderRadius: 999, padding: 0,
    color: 'var(--dark)', cursor: 'pointer',
  },
  // 버튼 상자 **안쪽** 오른쪽 위 — 헤더가 넘치는 것을 자르므로 밖으로 내보내지 않는다
  bellDot: {
    position: 'absolute', top: 6, right: 7, width: 10, height: 10, borderRadius: 999,
    background: RED, border: '2px solid #fff', boxSizing: 'border-box',
    zIndex: 2, pointerEvents: 'none',
  },
  scrim: { position: 'fixed', inset: 0, zIndex: 3000, background: 'transparent' },
  panel: {
    position: 'fixed', zIndex: 3001, background: '#fff', borderRadius: 'var(--r-md)',
    boxShadow: 'var(--shadow-2)', border: 'var(--hairline)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  head: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)',
    padding: '12px 14px', borderBottom: 'var(--hairline)', flexShrink: 0,
  },
  title: { fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--dark)' },
  readAll: {
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', fontWeight: 600, color: 'var(--dark)',
    background: 'transparent', border: 'var(--hairline)', borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
    minHeight: 36,
  },
  readAllOff: {
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', color: 'var(--muted)',
    background: 'transparent', border: 'var(--hairline)', borderRadius: 999, padding: '6px 12px', minHeight: 36,
  },
  scroll: { overflowY: 'auto', overscrollBehavior: 'contain', flex: 1, minHeight: 0 },
  prompt: {
    margin: 10, padding: '12px 14px', borderRadius: 'var(--r-sm)', background: 'var(--lime-bg, #f4f9dc)',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  promptTitle: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--dark)' },
  promptText: { fontSize: 'var(--fs-label)', color: 'var(--body)', lineHeight: 1.45 },
  promptBtn: {
    alignSelf: 'flex-start', fontFamily: 'inherit', fontSize: 'var(--fs-label)', fontWeight: 700,
    background: 'var(--dark)', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px',
    minHeight: 40, cursor: 'pointer',
  },
  item: {
    display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none', borderBottom: 'var(--hairline)',
    padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit',
  },
  // 점 자리 — 줄 **맨 앞**, 폭을 고정해 글자와 겹치지 않는다
  dotSlot: { width: 10, flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: 6, position: 'relative', zIndex: 1 },
  dot: { width: 9, height: 9, borderRadius: 999, background: RED, display: 'block' },
  itemText: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 },
  itemTitle: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--dark)', wordBreak: 'keep-all' },
  itemTitleRead: { fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--body)', wordBreak: 'keep-all' },
  itemBody: {
    fontSize: 'var(--fs-label)', color: 'var(--muted)', lineHeight: 1.4,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  itemTime: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  more: {
    display: 'block', width: '100%', padding: '12px', fontFamily: 'inherit', fontSize: 'var(--fs-label)',
    background: 'transparent', border: 'none', color: 'var(--dark)', cursor: 'pointer', minHeight: 44,
  },
  empty: { padding: '28px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-label)' },
  err: { padding: '8px 14px', color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
}
