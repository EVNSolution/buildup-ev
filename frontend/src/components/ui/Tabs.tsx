/**
 * 화면 탭 — 한 화면 안에서 보여줄 내용을 고른다(견적 목록 · 주문 진행 · 계정 관리 …).
 *
 * 밑줄 방식이라 [[Segmented]](역할 전환)보다 약하게 읽힌다. 위계를 모양으로 구분해,
 * 지금 보고 있는 것이 "다른 화면"인지 "같은 화면의 다른 탭"인지 헷갈리지 않게 한다.
 *
 * 권한이 없는 탭은 **여기 목록에 넣지 않는다**(비활성이 아니라 숨김) — 부르는 쪽에서 걸러 준다.
 */
export interface TabItem<T extends string> {
  key: T
  label: string
}

interface Props<T extends string> {
  items: readonly TabItem<T>[]
  value: T
  onChange: (v: T) => void
  /** 좁은 화면에서 줄바꿈 허용(관리자 탭이 많다) */
  wrap?: boolean
}

export function Tabs<T extends string>({ items, value, onChange, wrap }: Props<T>) {
  return (
    <div style={{ ...styles.bar, ...(wrap ? { flexWrap: 'wrap' } : {}) }} role="tablist">
      {items.map(t => {
        const on = t.key === value
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            style={{ ...styles.tab, ...(on ? styles.tabOn : {}) }}
            onClick={() => onChange(t.key)}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  /*
   * 칸을 나누는 가로선은 두지 않는다 — 흰 배경에 선을 그으면 화면이 토막나 보인다.
   * 지금 어느 탭인지는 **선택된 탭의 밑줄**만으로 충분히 읽힌다.
   */
  bar: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 'var(--sp-1)',
    flex: 1,
    minWidth: 0,
    padding: '0 var(--sp-4)',
    overflowX: 'auto',
  },
  tab: {
    background: 'transparent',
    border: 'none',
    // 밑줄 자리를 미리 비워 둔다 — 선택될 때 글자가 위아래로 흔들리지 않게
    borderBottom: '2px solid transparent',
    color: 'var(--muted)',
    fontSize: 'var(--fs-label)',
    fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'],
    padding: '0 var(--sp-3)',
    minHeight: 'var(--h-control)',
    whiteSpace: 'nowrap',
    borderRadius: 0,
  },
  tabOn: {
    color: 'var(--dark)',
    fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
    borderBottom: '2px solid var(--dark)',
  },
}
