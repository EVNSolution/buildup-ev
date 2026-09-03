import { rowState, CUSTOM_OPTION_NAME_MAX, type CustomOptionDraft } from '@shared/pricing/core'
import { BTN } from '../styles/buttons'

/**
 * **커스텀 특장 옵션** — 단가표에 없는 사양을 영업이 직접 적어 넣는 줄.
 *
 * 옵션 목록 맨 아래에 `+` 하나만 두고, 누르면 **그 버튼 위로** 줄이 생긴다.
 * 한 줄에 옵션명과 금액을 나란히 적는다. 여기 적은 금액은 **특장 가격에 그대로 더해져**
 * 견적서·계약서까지 함께 나간다.
 *
 * ⚠️ 반쪽만 적힌 줄(이름만·금액만)은 **저장 자체를 막는다** — 판정은 화면·서버가
 *    같은 함수(`rowState`/`checkCustomOptions`)로 한다. 여기서는 어느 줄이 문제인지
 *    빨갛게 짚어 주기만 한다. 아무것도 안 적은 줄은 없는 것과 같아 조용히 넘어간다.
 */
export function CustomOptionRows({ rows, onChange, disabled = false }: {
  rows: CustomOptionDraft[]
  onChange: (next: CustomOptionDraft[]) => void
  disabled?: boolean
}) {
  const patch = (i: number, v: Partial<CustomOptionDraft>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...v } : r)))

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <span style={s.label}>추가 옵션</span>
        <span style={s.hint}>단가표에 없는 사양을 직접 적습니다</span>
      </div>

      {rows.map((row, i) => {
        // 반쪽만 적힌 줄만 짚는다 — 빈 줄까지 빨갛게 하면 + 를 누르자마자 경고가 뜬다
        const bad = rowState(row) === 'partial'
        return (
          <div key={i} style={s.row}>
            <input
              type="text"
              // 기본 size(20자)가 만드는 고유 너비를 없앤다 — 좁은 화면에서 줄이 밀리지 않게
              size={1}
              value={row.name}
              maxLength={CUSTOM_OPTION_NAME_MAX}
              onChange={e => patch(i, { name: e.target.value })}
              placeholder="옵션명"
              disabled={disabled}
              style={{ ...s.name, ...(bad && !row.name.trim() ? s.bad : null) }}
            />
            <input
              type="text"
              size={1}
              inputMode="numeric"
              value={row.price == null ? '' : row.price.toLocaleString('ko-KR')}
              onChange={e => {
                // 쉼표를 지우고 숫자만 남긴다 — 빈칸은 `null`(「0원」과 다르다)
                const digits = e.target.value.replace(/[^\d]/g, '')
                patch(i, { price: digits === '' ? null : Number(digits) })
              }}
              placeholder="금액 (VAT 포함)"
              disabled={disabled}
              style={{ ...s.price, ...(bad && row.price == null ? s.bad : null) }}
            />
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, k) => k !== i))}
              disabled={disabled}
              style={s.del}
              aria-label={`추가 옵션 ${i + 1}번째 줄 지우기`}
            >
              ×
            </button>
          </div>
        )
      })}

      {rows.some(r => rowState(r) === 'partial') && (
        <div style={s.warn}>옵션명과 금액을 모두 적어야 저장됩니다.</div>
      )}

      {/* + 는 늘 목록 **아래**, 왼쪽 정렬 — 누르면 이 버튼 위로 줄이 늘어난다 */}
      <div style={s.addWrap}>
        <button
          type="button"
          onClick={() => onChange([...rows, { name: '', price: null }])}
          disabled={disabled}
          style={s.add}
        >
          +
        </button>
      </div>
    </div>
  )
}

/**
 * 한 줄의 높이 — 칸도 버튼도 이 값이다.
 *
 * `--h-control`(손가락 기기 50px)을 쓰지 않는다. 한 줄에 칸 둘 + 버튼 하나가 나란히
 * 서는 자리라 50px 이면 덩어리로 보인다(「너무 크다」 제보). 옵션 버튼(「그물망 격벽」)
 * 줄과 비슷한 높이로 맞춘다.
 */
const CTRL = 36

const s: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: 'var(--hairline)' },
  head: { display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' },
  // 옵션 줄 라벨(OptionRow.styles.label)과 **같은 13px** — 같은 성격의 줄이라 크기를 맞춘다
  label: { fontSize: 13, color: 'var(--muted)' },
  hint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  row: { display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)', alignItems: 'center' },
  /*
   * 폭은 **3:7** — 옵션명보다 금액칸이 넓다(실측 32:68 — 남는 폭을 나누는 값이라 근사치다).
   * 금액칸이 좁으면 「금액 (VAT 포함)」 안내가 잘려 무엇을 적는 칸인지 알 수 없었다(제보).
   *
   * ⚠️ 글꼴 크기는 여기서 정하지 않는다. 손가락 기기에서는 `--fs-input`(18.5px)이
   *    걸린다 — 그보다 작으면 **아이폰이 초점 때 화면을 확대한다**(globals.css 참고).
   */
  // ⚠️ `boxSizing: border-box` — 없으면 좌우 여백이 폭에 더해져 3:7 이 2:1 로 어긋난다(실측)
  name: {
    flex: '3 1 0', minWidth: 0, boxSizing: 'border-box' as const,
    minHeight: CTRL, height: CTRL, padding: '0 10px',
  },
  price: {
    flex: '7 1 0', minWidth: 0, boxSizing: 'border-box' as const,
    minHeight: CTRL, height: CTRL, padding: '0 10px', textAlign: 'right' as const,
  },
  /** × 와 + 는 **같은 크기의 정사각형** — 줄 높이와 같다 */
  del: {
    ...BTN.row, flex: 'none',
    // ⚠️ `minWidth` 도 함께 덮는다 — BTN.row 는 폭을 92px 로 **고정**해 두어(SM_W),
    //    `width` 만 줄이면 최소폭에 걸려 그대로 92px 로 남는다(실측 81px 시각크기).
    width: CTRL, minWidth: CTRL, height: CTRL, minHeight: CTRL, padding: 0,
    color: 'var(--muted)', fontSize: 14, lineHeight: 1,
  },
  bad: { borderColor: 'var(--req)' },
  warn: { fontSize: 'var(--fs-caption)', color: 'var(--req)', marginBottom: 'var(--sp-2)' },
  addWrap: { display: 'flex', justifyContent: 'flex-start' },
  /** + 는 × 와 **똑같은 정사각형** — 같은 줄에 서는 버튼이라 크기가 갈리면 안 된다 */
  add: {
    ...BTN.row,
    width: CTRL, minWidth: CTRL, height: CTRL, minHeight: CTRL, padding: 0,
    fontSize: 14, lineHeight: 1,
  },
}
