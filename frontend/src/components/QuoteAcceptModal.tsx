import { useEffect, useState } from 'react'
import type { ApiPricingBundle, ApiQuote } from '@shared/types/index'
import { fetchPricingBundle } from '../api/models'
import { customerViewGroups } from './CustomerViewModal'
import { BTN } from '../styles/buttons'

/**
 * 배정된 공개 문의 — **받기 전에 무엇을 받는지 본다.**
 *
 * 수락하면 그 순간부터 내 담당이 된다. 고객이 누구인지, 무슨 사양을 골랐는지,
 * 금액이 얼마인지 모르고 누르면 수락이 형식이 된다 — 그래서 고객정보·선택 옵션·금액을
 * 한 화면에 펴 놓고, 그 자리에서 바로 받을 수 있게 한다.
 *
 * 조회 전용이다. 값을 고치는 것은 수락한 뒤 「수정」에서 한다 — 받기도 전에 고치면
 * 고객이 공개 화면에서 실제로 고른 것이 무엇이었는지가 사라진다.
 */
const won = (n: number | null | undefined) => (n == null ? '—' : '₩' + Math.round(n).toLocaleString('ko-KR'))

export function QuoteAcceptModal({ quote, busy, onAccept, onClose }: {
  quote: ApiQuote
  busy: boolean
  /** null 이면 수락 버튼을 두지 않는다(이미 수락한 건을 다시 볼 때) */
  onAccept: (() => void) | null
  onClose: () => void
}) {
  const [bundle, setBundle] = useState<ApiPricingBundle | null>(null)
  const [bundleErr, setBundleErr] = useState('')

  // 선택 옵션은 코드로 저장돼 있다(BODYTYPE→TOP_FREEZE). 사람이 읽는 이름은 차종 가격표에 있다.
  useEffect(() => {
    let alive = true
    fetchPricingBundle(quote.model_code)
      .then(b => { if (alive) setBundle(b) })
      .catch(() => { if (alive) setBundleErr('옵션 이름을 불러오지 못했습니다 — 코드로 표시합니다') })
    return () => { alive = false }
  }, [quote.model_code])

  const selections = (quote.selections ?? {}) as Record<string, string>
  const picked = Object.entries(selections).map(([groupCode, valueCode]) => {
    const g = bundle?.groups.find(x => x.code === groupCode)
    const v = g?.values.find(x => x.code === valueCode)
    return { label: g?.name ?? groupCode, value: v?.name ?? valueCode }
  })

  const groups = customerViewGroups(quote)

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.box} onClick={e => e.stopPropagation()}>
        <div style={m.title}>
          {quote.quote_no ?? `#${quote.id}`} — 배정된 문의
        </div>
        <div style={m.desc}>
          고객이 공개 화면에서 직접 접수한 문의입니다. 내용을 확인한 뒤 접수하면 담당자로 지정됩니다.
        </div>

        <div style={m.scroll}>
          {/* 금액을 맨 위에 — 받을지 말지를 가장 먼저 가르는 값이다 */}
          <div style={m.moneyRow}>
            <span style={m.moneyLabel}>실구매가(기타 포함)</span>
            <span style={m.moneyValue}>{won(quote.final_price)}</span>
          </div>

          <div style={m.groupTitle}>선택 사양</div>
          {picked.length === 0 ? (
            <div style={m.empty}>선택한 옵션이 없습니다.</div>
          ) : (
            <table style={m.table}>
              <tbody>
                <tr>
                  <td style={m.tdLabel}>차종</td>
                  <td style={m.tdValue}>{quote.model_code}</td>
                </tr>
                {picked.map(o => (
                  <tr key={o.label}>
                    <td style={m.tdLabel}>{o.label}</td>
                    <td style={m.tdValue}>{o.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bundleErr && <div style={m.warn}>{bundleErr}</div>}

          {groups.map(g => (
            <div key={g.title}>
              <div style={m.groupTitle}>{g.title}</div>
              <table style={m.table}>
                <tbody>
                  {g.rows.map(([label, value]) => (
                    <tr key={label}>
                      <td style={m.tdLabel}>{label}</td>
                      <td style={value ? m.tdValue : m.tdEmpty}>{value || '입력 없음'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div style={m.actions}>
          <button style={BTN.secondary} onClick={onClose} disabled={busy}>닫기</button>
          {onAccept && (
            <button style={busy ? BTN.disabled : BTN.primary} disabled={busy} onClick={onAccept}>
              {busy ? '처리 중' : '접수'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const m: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'var(--sp-4)' },
  box: {
    background: '#fff', borderRadius: 14, padding: 'var(--sp-5)', width: 520, maxWidth: '100%',
    maxHeight: '86vh', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
  },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--dark)', letterSpacing: 'var(--ls-tight)' },
  desc: { fontSize: 'var(--fs-label)', color: 'var(--muted)', lineHeight: 'var(--lh-body)' },
  // 내용이 길어도 팝업이 화면 밖으로 나가지 않게 — 버튼줄은 늘 보인다
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto' },
  moneyRow: {
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    padding: 'var(--sp-3) 0', borderBottom: 'var(--hairline)',
  },
  moneyLabel: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  moneyValue: { fontSize: 20, fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  groupTitle: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--muted)', margin: 'var(--sp-4) 0 var(--sp-2)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-label)' },
  tdLabel: { padding: '6px 10px 6px 0', color: 'var(--muted)', width: 110, verticalAlign: 'top', whiteSpace: 'nowrap' },
  tdValue: { padding: '6px 0', color: 'var(--dark)', wordBreak: 'break-all' },
  tdEmpty: { padding: '6px 0', color: 'var(--muted)' },
  empty: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: 'var(--sp-2) 0' },
  warn: { fontSize: 'var(--fs-caption)', color: 'var(--warn)', marginTop: 'var(--sp-2)' },
  actions: { display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' },
}
