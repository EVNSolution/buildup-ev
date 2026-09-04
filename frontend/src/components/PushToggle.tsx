import { useEffect, useState } from 'react'
import { pushState, enablePush, disablePush, pushConfig, isInstalled, type PushState } from '../lib/push'

/**
 * 이 **기기**에서 알림을 받을지. 계정 설정이 아니라 기기 설정이다 —
 * 같은 사람이 폰에서는 받고 사무실 PC 에서는 안 받을 수 있어야 한다.
 *
 * 대화 창 **왼쪽 위**에 종 모양 하나로 둔다. 「알림을 왜 켜야 하나」가 가장 잘 와닿는
 * 자리라서 대화 창에 두되, 예전처럼 「🔔 이 기기 알림 켜짐」 문구를 달아 두면
 * **한 줄을 통째로 차지해** 대화가 그만큼 밀린다(제보). 상태는 색으로 말한다.
 *
 * 안 되는 환경이 많아서 **왜 안 되는지**는 눌렀을 때 말해 준다(title·aria-label).
 */

/** 종 모양 — 이모지는 기기마다 다르게 그려져 크기·정렬이 제각각이다 */
function Bell({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      {/* 꺼져 있으면 사선 하나로 「지금은 안 온다」를 말한다 */}
      {!on && <path d="M3 3l18 18" />}
    </svg>
  )
}
export function PushToggle() {
  const [cfg, setCfg] = useState<{ enabled: boolean; publicKey: string } | null>(null)
  const [st, setSt] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      const c = await pushConfig()
      if (!alive) return
      setCfg(c)
      if (c.enabled) setSt(await pushState())
    })()
    return () => { alive = false }
  }, [])

  // 서버에 VAPID 키가 없으면 줄 자체를 띄우지 않는다 — 눌러도 안 되는 버튼은 없느니만 못하다
  if (!cfg?.enabled || !st) return null

  async function toggle() {
    setBusy(true); setErr('')
    try {
      if (st?.kind === 'on') await disablePush()
      else await enablePush(cfg!.publicKey)
      setSt(await pushState())
    } catch (e) {
      setErr(e instanceof Error ? e.message : '알림 설정을 바꾸지 못했습니다')
    } finally { setBusy(false) }
  }

  // 못 쓰는 환경 — 눌러도 안 되는 것을 띄우느니 자리를 비운다. 이유는 title 로 남긴다
  if (st.kind === 'unsupported' || st.kind === 'denied') {
    return <span style={s.dim} title={st.why} aria-label={st.why}><Bell on={false} /></span>
  }

  const on = st.kind === 'on'
  /*
   * 아이폰은 홈 화면에 추가하지 않으면 못 받는다 — 켜기 전에 미리 알려야 눌러 보고
   * 안 된다고 여기지 않는다. 문구를 줄에 깔지 않고 이 버튼의 설명으로 붙인다.
   */
  const needsInstall = !on && !isInstalled() && /iPad|iPhone|iPod/.test(navigator.userAgent)
  const label = err ? err
    : needsInstall ? '홈 화면에 추가한 뒤에 켜야 알림이 옵니다'
    : on ? '이 기기 알림 켜짐 — 누르면 끕니다'
    : '이 기기 알림 받기'

  return (
    <button
      style={err ? s.err : on ? s.on : s.off}
      disabled={busy}
      onClick={() => void toggle()}
      title={label}
      aria-label={label}
      aria-pressed={on}
    >
      <Bell on={on} />
    </button>
  )
}

/** 종 하나만 놓는 자리 — 줄을 차지하지 않게 크기를 고정한다 */
const ICON: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, padding: 0, flex: 'none',
  border: 'none', background: 'transparent', borderRadius: 8,
  cursor: 'pointer', fontFamily: 'inherit',
}

const s: Record<string, React.CSSProperties> = {
  /** 켜짐 — 브랜드색. 「지금 오고 있다」 */
  on: { ...ICON, color: 'var(--lime-ink)' },
  /** 꺼짐 — 있는 줄은 알되 재촉하지 않는 톤 */
  off: { ...ICON, color: 'var(--muted)' },
  err: { ...ICON, color: 'var(--req)' },
  /** 못 쓰는 환경 — 누를 수 없다는 것이 보이게 */
  dim: { ...ICON, color: 'var(--line)', cursor: 'default' },
}
