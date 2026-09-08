import { poTotal, PO_LINES_MAX, PO_LINE_LABEL_MAX, type PoLine } from '@shared/docs/po-lines'
import { t, tf } from '../i18n'

/**
 * 발주서 **공급가 표** 편집기 — 배정 화면에서만 쓴다.
 *
 * 두 종류의 줄이 섞인다:
 *   · **계약 줄**(`CONTRACT`) — 특장사 계약 단가표에서 자동으로 온다. **금액을 고치지 않는다.**
 *     계약으로 정한 값이라 여기서 바꾸면 계약과 발주서가 어긋난다. 필요 없으면 **빼는 것**만 된다.
 *   · **직접 적은 줄**(`MANUAL`) — 계약에 없는 사양. 관리자가 품목명·단위·수량·단가를 적는다.
 *
 * ⚠️ 계약에 없는 사양을 0원으로 채워 넣지 않는다. 특장사가 「무상으로 해 주기로 한 일」로 읽는다.
 * ⚠️ 금액(공급가액)은 **여기서 고칠 수 없다** — 단가×수량으로만 나온다.
 *    손으로 고칠 수 있게 두면 표가 스스로 거짓말을 할 수 있다(서버도 다시 곱해서 저장한다).
 */
export function PoLineEditor({ lines, onChange, disabled }: {
  lines: PoLine[]
  onChange: (next: PoLine[]) => void
  disabled?: boolean
}) {
  const total = poTotal(lines)

  const patch = (i: number, p: Partial<PoLine>) => {
    const next = lines.map((l, idx) => {
      if (idx !== i) return l
      /*
       * 계약 줄의 **금액은 여기서 바뀌지 않는다.** `readOnly` 는 사람이 타이핑하는 것만 막는다 —
       * 값이 다른 길(붙여넣기·스크립트)로 들어와도 계약 단가는 계약이 정한 값이어야 한다.
       * 서버도 계약 줄을 **다시 만들어** 저장하므로 화면만 뚫려도 저장되지는 않는다.
       */
      if (l.source === 'CONTRACT') {
        const { qty } = { qty: p.qty ?? l.qty }
        return { ...l, qty, amount: l.unit_price * qty }
      }
      const merged = { ...l, ...p }
      // 금액은 늘 다시 센다 — 단가·수량과 어긋난 합계가 남으면 안 된다
      return { ...merged, amount: merged.unit_price * merged.qty }
    })
    onChange(next)
  }
  const remove = (i: number) => onChange(lines.filter((_, idx) => idx !== i))
  const add = () => onChange([...lines, {
    label: '', section: 'OPTION', unit: 'EA', qty: 1, unit_price: 0, amount: 0, source: 'MANUAL',
  }])

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <span style={s.title}>
          {t('공급가액')} <span style={s.vat}>({t('VAT 별도')})</span>
        </span>
        <b style={s.total}>₩{total.toLocaleString()}</b>
      </div>

      {lines.length === 0 && (
        <div style={s.empty}>
          {t('특장사를 고르면 계약 단가가 채워집니다. 계약에 없는 항목은 직접 적어 주세요.')}
        </div>
      )}

      {lines.map((l, i) => {
        const locked = l.source === 'CONTRACT'
        return (
          <div key={i} style={s.row}>
            <div style={s.line1}>
              {/*
                계약 줄은 품목명도 잠근다 — 계약서 문구가 그대로 발주서에 나가야
                특장사가 「어느 항목인지」를 계약서와 대조할 수 있다.
              */}
              <input
                style={locked ? s.inputLocked : s.input}
                value={l.label}
                readOnly={locked}
                disabled={disabled}
                maxLength={PO_LINE_LABEL_MAX}
                placeholder={t('품목명')}
                onChange={e => patch(i, { label: e.target.value })}
              />
              {locked
                ? <span style={s.tagContract}>{t('계약')}</span>
                : (
                  <button type="button" style={s.del} disabled={disabled} onClick={() => remove(i)}>
                    {t('삭제')}
                  </button>
                )}
            </div>
            <div style={s.line2}>
              <label style={s.field}>
                <span style={s.fieldLabel}>{t('단위')}</span>
                <input
                  style={{ ...(locked ? s.inputLocked : s.input), width: 56 }}
                  value={l.unit} readOnly={locked} disabled={disabled} maxLength={10}
                  onChange={e => patch(i, { unit: e.target.value })}
                />
              </label>
              <label style={s.field}>
                <span style={s.fieldLabel}>{t('발주수량')}</span>
                <input
                  style={{ ...s.input, width: 64, textAlign: 'right' }}
                  type="number" min={1} value={l.qty} disabled={disabled}
                  onChange={e => patch(i, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
                />
              </label>
              <label style={s.field}>
                <span style={s.fieldLabel}>{t('단가')}</span>
                <input
                  style={{ ...(locked ? s.inputLocked : s.input), width: 110, textAlign: 'right' }}
                  type="number" min={0} value={l.unit_price} readOnly={locked} disabled={disabled}
                  onChange={e => patch(i, { unit_price: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                />
              </label>
              {/* 공급가액은 읽기만 — 단가×수량으로만 나온다 */}
              <span style={s.amount}>₩{l.amount.toLocaleString()}</span>
            </div>
          </div>
        )
      })}

      <button type="button" style={s.add} disabled={disabled || lines.length >= PO_LINES_MAX} onClick={add}>
        {t('+ 항목 추가')}
      </button>
      {lines.length >= PO_LINES_MAX && (
        <div style={s.warn}>{tf('한 장에 담기는 줄은 {0}개까지입니다.', PO_LINES_MAX)}</div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' },
  head: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--line)',
    fontSize: 'var(--fs-sheet)',
  },
  title: { color: 'var(--dark)' },
  vat: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  total: { fontVariantNumeric: 'tabular-nums' },
  empty: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', padding: 'var(--sp-2) 0', lineHeight: 1.6 },
  row: {
    display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)',
    padding: 'var(--sp-2) 0', borderBottom: 'var(--hairline)',
  },
  line1: { display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' },
  // 좁은 화면에서 줄바꿈되게 둔다 — 한 줄에 밀어 넣으면 칸이 잘린다
  line2: { display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' },
  field: { display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' },
  fieldLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', flexShrink: 0 },
  input: {
    flex: 1, minWidth: 0, font: 'inherit', fontSize: 'var(--fs-sheet)',
    border: 'var(--hairline)', borderRadius: 4, padding: '4px 6px', boxSizing: 'border-box',
  },
  /* 계약 단가는 고칠 수 없다 — 눌러 보고 나서 안 된다는 걸 알게 하지 않는다 */
  inputLocked: {
    flex: 1, minWidth: 0, font: 'inherit', fontSize: 'var(--fs-sheet)',
    border: 'var(--hairline)', borderRadius: 4, padding: '4px 6px', boxSizing: 'border-box',
    background: 'var(--surface-2, #f6f6f6)', color: 'var(--body)', cursor: 'default',
  },
  tagContract: {
    fontSize: 'var(--fs-caption)', color: 'var(--muted)', flexShrink: 0,
    border: 'var(--hairline)', borderRadius: 999, padding: '1px 8px',
  },
  amount: { marginLeft: 'auto', fontSize: 'var(--fs-sheet)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  del: {
    background: 'none', border: 'none', padding: 0, font: 'inherit',
    fontSize: 'var(--fs-caption)', color: 'var(--req)', textDecoration: 'underline',
    cursor: 'pointer', flexShrink: 0,
  },
  add: {
    alignSelf: 'flex-start', background: 'none', border: 'var(--hairline)', borderRadius: 6,
    padding: '4px 10px', font: 'inherit', fontSize: 'var(--fs-caption)',
    color: 'var(--muted)', cursor: 'pointer',
  },
  warn: { fontSize: 'var(--fs-caption)', color: 'var(--req)' },
}
