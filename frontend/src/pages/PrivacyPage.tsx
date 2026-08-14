import { PRIVACY_POLICY } from '../content/privacyPolicy'
import logoUrl from '../assets/logo.png'

/**
 * 개인정보 처리방침 — `/privacy`
 *
 * ⚠️ **아직 어디에서도 링크하지 않는다.** 주소를 아는 사람만 볼 수 있다(숨김 상태).
 *    공개 화면의 동의 문구가 확정되면 그때 상담 신청 폼과 푸터에서 링크한다.
 *
 * 로그인 없이 열려야 한다 — 정보주체가 동의 전에 읽는 문서이기 때문이다.
 */
export function PrivacyPage() {
  return (
    <div style={s.root}>
      <header style={s.header}>
        <img src={logoUrl} alt="EV&Solution" style={s.logo} />
        <span style={s.brandLine} aria-hidden />
        <span style={s.wordmark}>Buildup-EV</span>
      </header>

      <main style={s.body}>
        <article style={s.sheet}>
          {PRIVACY_POLICY.map((b, i) => {
            if (b.type === 'h1') return <h1 key={i} style={s.h1}>{b.text}</h1>
            if (b.type === 'h2') return <h2 key={i} style={s.h2}>{b.text}</h2>
            if (b.type !== 'table') return <p key={i} style={s.p}>{b.text}</p>
            // 표 — 첫 줄을 머리로 본다(원본 문서와 같은 구조)
            const [head, ...rows] = b.rows
            return (
              <div key={i} style={s.tableWrap}>
                <table style={s.table}>
                  {head && (
                    <thead>
                      <tr>{head.map((c, j) => <th key={j} style={s.th}>{c}</th>)}</tr>
                    </thead>
                  )}
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={ri}>{r.map((c, ci) => <td key={ci} style={s.td}>{c}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </article>
      </main>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--card)' },
  header: {
    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
    height: 60, padding: '0 var(--sp-5)', background: '#fff', borderBottom: 'var(--hairline)',
  },
  logo: { height: 28, width: 'auto', display: 'block' },
  brandLine: { width: 1, height: 18, background: 'var(--line)', display: 'block' },
  wordmark: { fontSize: 'var(--fs-section)', fontWeight: 700, letterSpacing: '-0.035em', color: 'var(--dark)' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--sp-5) var(--sp-4)' },
  // 법률 문서는 한 줄이 길면 읽기 어렵다 — 폭을 묶는다
  sheet: {
    maxWidth: 860, margin: '0 auto', background: '#fff', borderRadius: 'var(--r-md)',
    padding: 'var(--sp-6) var(--sp-5)', boxShadow: 'var(--shadow-1)',
  },
  h1: {
    fontSize: 'var(--fs-title)', fontWeight: 'var(--fw-title)' as React.CSSProperties['fontWeight'],
    letterSpacing: 'var(--ls-tight)', color: 'var(--dark)', margin: '0 0 var(--sp-5)',
  },
  h2: {
    fontSize: 'var(--fs-section)', fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
    letterSpacing: 'var(--ls-tight)', color: 'var(--dark)', margin: 'var(--sp-5) 0 var(--sp-2)',
  },
  p: { fontSize: 'var(--fs-body)', lineHeight: 1.75, color: 'var(--body)', margin: '0 0 var(--sp-2)' },
  tableWrap: { overflowX: 'auto', margin: 'var(--sp-3) 0 var(--sp-4)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-label)' },
  th: {
    textAlign: 'left', padding: 'var(--sp-2) var(--sp-3)', background: 'var(--card)',
    border: 'var(--hairline)', fontWeight: 700, color: 'var(--dark)', verticalAlign: 'top',
  },
  td: { padding: 'var(--sp-2) var(--sp-3)', border: 'var(--hairline)', color: 'var(--body)', lineHeight: 'var(--lh-body)', verticalAlign: 'top' },
}
