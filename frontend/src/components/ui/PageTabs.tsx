import { t } from '../../i18n'

/**
 * 발주서 장 넘기기 — **1페이지 / 2페이지.**
 *
 * 종이 한 장이 화면 한 장이라, 두 장을 아래위로 늘어놓지 않고 **바꿔 끼운다.**
 * 「그대로 보는 것」이 발주서의 전부인데 스크롤로 이어 붙이면 장 구분이 사라진다.
 *
 * 크기는 **글자를 감싸는 만큼만**이다. 발주서 위에 얹히는 보조 컨트롤이라
 * 커지면 정작 봐야 할 서류에서 눈을 뺏는다 — 다만 손가락이 닿을 폭은 남긴다.
 */
export function PageTabs({ page, onChange, hasAppendix }: {
  page: 1 | 2
  onChange: (p: 1 | 2) => void
  /** 별지가 없으면 2페이지 칸을 흐리게 둔다 — 사라지면 「원래 없나」 하고 헷갈린다 */
  hasAppendix: boolean
}) {
  return (
    <div style={s.wrap} role="tablist">
      {([1, 2] as const).map(n => {
        const on = n === page
        const off = n === 2 && !hasAppendix
        return (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={on}
            aria-disabled={off}
            title={off ? t('별지에 적힌 내용이 없습니다') : undefined}
            style={on ? s.on : off ? s.off : s.tab}
            onClick={() => { if (!off) onChange(n) }}
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'inline-flex', gap: 4, flexShrink: 0 },
  /*
   * 높이는 글자만 감싸고, 폭만 손가락이 닿게 남긴다.
   * 발주서가 주인공이라 이 버튼이 커지면 서류보다 먼저 눈에 들어온다.
   */
  tab: {
    minWidth: 34, padding: '2px 0', border: 'var(--hairline)', borderRadius: 4,
    background: '#fff', color: 'var(--body)', font: 'inherit',
    fontSize: 'var(--fs-caption)', lineHeight: 1.5, cursor: 'pointer',
  },
  on: {
    minWidth: 34, padding: '2px 0', border: '1px solid var(--dark)', borderRadius: 4,
    background: 'var(--dark)', color: '#fff', font: 'inherit',
    fontSize: 'var(--fs-caption)', lineHeight: 1.5, fontWeight: 700, cursor: 'pointer',
  },
  off: {
    minWidth: 34, padding: '2px 0', border: 'var(--hairline)', borderRadius: 4,
    background: '#fff', color: 'var(--muted)', font: 'inherit',
    fontSize: 'var(--fs-caption)', lineHeight: 1.5, cursor: 'not-allowed', opacity: 0.5,
  },
}
