/**
 * 세그먼티드 컨트롤 — **역할 전환**(영업·관리·특장)처럼 서로 배타적인 선택에 쓴다.
 *
 * 회색 트랙 위에 흰 알약이 얹히는 macOS 컨트롤. 지금 있던 「검은 알약」은 화면 어디서나
 * 가장 진한 색이라 실제 중요도보다 세게 읽혔다 — 트랙+알약은 "고르는 자리"라는 것만 말한다.
 *
 * 화면 안의 내용 탭(견적 목록·주문 칸반 …)은 이것보다 약한 밑줄 탭을 쓴다([[Tabs]]).
 * 둘을 같은 모양으로 두면 무엇이 상위인지 알 수 없다.
 */
export interface SegmentedItem<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  items: readonly SegmentedItem<T>[]
  value: T
  onChange: (v: T) => void
  /** 좁은 화면에서 한 줄을 다 쓰게 할 때 */
  fullWidth?: boolean
}

export function Segmented<T extends string>({ items, value, onChange, fullWidth }: Props<T>) {
  return (
    <div style={{ ...styles.track, ...(fullWidth ? { width: '100%' } : {}) }} role="tablist">
      {items.map(it => {
        const on = it.value === value
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={on}
            style={{ ...styles.item, ...(on ? styles.itemOn : {}), ...(fullWidth ? { flex: 1 } : {}) }}
            onClick={() => onChange(it.value)}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  track: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    background: 'var(--track)',
    borderRadius: 'var(--r-pill)',
    flexShrink: 0,
  },
  item: {
    // 트랙 안쪽 알약 — 바깥 반경에서 여백만큼 줄인 동심원(패딩 2px)
    borderRadius: 'var(--r-pill)',
    border: 'none',
    background: 'transparent',
    color: 'var(--muted)',
    fontSize: 'var(--fs-label)',
    fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'],
    padding: '0 var(--sp-4)',
    // 알약 자체가 손가락이 닿는 자리다 — 트랙이 아니라 여기서 높이를 맞춘다
    minHeight: 'var(--h-control)',
    whiteSpace: 'nowrap',
  },
  itemOn: {
    background: '#fff',
    color: 'var(--dark)',
    boxShadow: 'var(--shadow-1)',
  },
}
