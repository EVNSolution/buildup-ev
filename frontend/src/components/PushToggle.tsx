import { useEffect, useState } from 'react'
import { pushState, enablePush, disablePush, pushConfig, isInstalled, type PushState } from '../lib/push'

/**
 * 이 **기기**에서 알림을 받을지. 계정 설정이 아니라 기기 설정이다 —
 * 같은 사람이 폰에서는 받고 사무실 PC 에서는 안 받을 수 있어야 한다.
 *
 * 대화 창 안에 둔다. 「알림을 왜 켜야 하나」가 가장 잘 와닿는 자리라서다 —
 * 설정 화면 깊은 곳에 두면 아무도 못 찾는다(특장사 화면에는 설정 탭도 없다).
 *
 * 안 되는 환경이 많아서 **왜 안 되는지**를 그 자리에 적는다.
 */
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

  if (st.kind === 'unsupported' || st.kind === 'denied') {
    return <div style={s.note}>{st.why}</div>
  }

  return (
    <div style={s.wrap}>
      <button style={busy ? s.btnOff : s.btn} disabled={busy} onClick={() => void toggle()}>
        {st.kind === 'on' ? '🔔 이 기기 알림 켜짐' : '🔕 이 기기 알림 받기'}
      </button>
      {/* 아이폰은 설치하지 않으면 못 받는다 — 켜기 전에 미리 알린다 */}
      {st.kind === 'off' && !isInstalled() && /iPad|iPhone|iPod/.test(navigator.userAgent) && (
        <span style={s.hint}>홈 화면에 추가한 뒤에 켜야 알림이 옵니다</span>
      )}
      {err && <span style={s.err}>{err}</span>}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap',
    padding: '0 var(--sp-4) var(--sp-3)',
  },
  btn: {
    border: 'var(--hairline)', background: 'var(--bg)', borderRadius: 999,
    padding: '4px 12px', fontSize: 'var(--fs-caption)', cursor: 'pointer',
    color: 'var(--body)', fontFamily: 'inherit',
  },
  btnOff: {
    border: 'var(--hairline)', background: 'var(--card)', borderRadius: 999,
    padding: '4px 12px', fontSize: 'var(--fs-caption)', color: 'var(--muted)',
    fontFamily: 'inherit', cursor: 'default',
  },
  hint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  note: { padding: '0 var(--sp-4) var(--sp-3)', fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  err: { fontSize: 'var(--fs-caption)', color: 'var(--req)' },
}
