/**
 * 빈 상태 — 목록에 아무것도 없을 때.
 *
 * 문구는 **사과가 아니라 다음 행동 안내**로 쓴다. "없습니다"에서 끝나면 사용자는
 * 무엇을 해야 하는지 모른 채 화면을 떠난다.
 *   제목  아직 저장된 견적이 없습니다
 *   설명  컨피규레이터에서 옵션을 선택하고 견적을 저장해 보세요
 *   버튼  컨피규레이터로 이동   (있으면)
 */
import { BTN } from '../../styles/buttons'

interface Props {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ title, description, actionLabel, onAction }: Props) {
  return (
    <div style={styles.root}>
      <div style={styles.title}>{title}</div>
      {description && <div style={styles.desc}>{description}</div>}
      {actionLabel && onAction && (
        <button style={{ ...BTN.primary, marginTop: 'var(--sp-4)' }} onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: 'var(--sp-6) var(--sp-5)',
    gap: 'var(--sp-2)',
  },
  title: {
    fontSize: 'var(--fs-section)',
    fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
    letterSpacing: 'var(--ls-tight)',
    color: 'var(--dark)',
  },
  desc: { fontSize: 'var(--fs-body)', color: 'var(--muted)', lineHeight: 'var(--lh-body)' },
}
