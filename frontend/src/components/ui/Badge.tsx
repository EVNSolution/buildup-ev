/**
 * 상태 뱃지 — 진행 상태를 한 낱말로 보여준다(임시저장 · 견적확정 · 서명완료 …).
 *
 * 색은 네 가지 뜻만 갖는다. 상태 이름마다 색을 새로 만들면 곧 무지개가 되고,
 * 그러면 색이 아무 뜻도 갖지 못한다.
 *   progress 지금 굴러가는 중   done 끝난 것   wait 아직 시작 전   warn 손이 필요한 것
 */
export type BadgeTone = 'progress' | 'done' | 'wait' | 'warn'

interface Props {
  tone?: BadgeTone
  children: React.ReactNode
  style?: React.CSSProperties
}

export function Badge({ tone = 'wait', children, style }: Props) {
  return <span style={{ ...base, ...tones[tone], ...style }}>{children}</span>
}

const base: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 'var(--r-pill)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'],
  whiteSpace: 'nowrap',
  lineHeight: 1.6,
}

const tones: Record<BadgeTone, React.CSSProperties> = {
  // 라임 위 글씨는 --dark. 흰 글씨는 대비가 모자라 야외에서 안 보인다(§4-3)
  progress: { background: 'var(--lime-bg)', color: 'var(--dark)' },
  done:     { background: 'var(--card)', color: 'var(--muted)' },
  wait:     { background: '#fff', color: 'var(--muted)', border: 'var(--hairline)' },
  warn:     { background: 'var(--warnbg)', color: 'var(--warn)' },
}
