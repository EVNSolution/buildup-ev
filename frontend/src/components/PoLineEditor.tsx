import { poTotal, unpricedLines, PO_LINES_MAX, PO_LINE_LABEL_MAX, type PoLine } from '@shared/docs/po-lines'
import { t, tf } from '../i18n'

/**
 * 발주서 **공급가 표** 편집기 — 배정 화면에서만 쓴다.
 *
 * 세 종류의 줄이 섞인다:
 *   · **계약 줄**(`CONTRACT`) — 계약 단가표에서 자동으로 온다. **아무것도 고치지 않는다.**
 *     계약이 정한 값이라 여기서 바꾸면 계약과 발주서가 어긋난다.
 *   · **저절로 생긴 줄**(`AUTO`) — 고른 옵션인데 계약에 단가가 없다(또는 아직 분류하지 않았다).
 *     품목명은 옵션 이름이라 고정이고, 관리자는 **금액만** 채운다.
 *     예전엔 「+ 항목 추가」를 눌러 품목명부터 타이핑해야 했다 — 무엇을 적어야 하는지
 *     화면이 이미 아는데 사람에게 다시 묻던 셈이다.
 *   · **손으로 더한 줄**(`MANUAL`) — 어느 옵션에도 매이지 않는 것. 이름부터 적는다.
 *
 * ⚠️ 빈 금액을 0원으로 두고 넘어가지 않는다. 특장사가 「무상으로 해 주기로 한 일」로 읽는다.
 *    서버도 배정을 거부한다.
 * ⚠️ 금액(공급가액)은 **여기서 고칠 수 없다** — 단가×수량으로만 나온다.
 *    손으로 고칠 수 있게 두면 표가 스스로 거짓말을 할 수 있다(서버도 다시 곱해서 저장한다).
 */
export function PoLineEditor({ lines, onChange, disabled }: {
  lines: PoLine[]
  onChange: (next: PoLine[]) => void
  disabled?: boolean
}) {
  const total = poTotal(lines)
  const blank = unpricedLines(lines)

  const patch = (i: number, p: Partial<PoLine>) => {
    const next = lines.map((l, idx) => {
      if (idx !== i) return l
      /*
       * 계약 줄은 **여기서 아무것도 바뀌지 않는다.** `readOnly` 는 사람이 타이핑하는 것만 막는다 —
       * 값이 다른 길(붙여넣기·스크립트)로 들어와도 계약 단가는 계약이 정한 값이어야 한다.
       * 서버도 계약 줄을 **다시 만들어** 저장하므로 화면만 뚫려도 저장되지는 않는다.
       */
      if (l.source === 'CONTRACT') return l
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
          {t('특장사를 고르면 계약 단가가 채워집니다. 계약에 없는 항목은 금액 칸이 저절로 생깁니다.')}
        </div>
      )}
      {/*
        금액이 빈 줄을 **먼저 말한다.** 표가 길면 어느 줄이 비었는지 찾다 놓친다.
        0 원으로 두고 넘어가면 특장사가 무상으로 읽는다 — 그래서 서버도 배정을 거부한다.
      */}
      {blank.length > 0 && (
        <div style={s.needPrice}>
          {tf('금액을 적어야 배정할 수 있습니다: {0}', blank.map(l => l.label || t('(이름 없음)')).join(' · '))}
        </div>
      )}

      {lines.map((l, i) => {
        const contract = l.source === 'CONTRACT'
        const auto = l.source === 'AUTO'
        // 품목명은 계약(계약서 문구)이나 옵션(옵션 이름)이 정한다 — 손으로 더한 줄만 적는다
        const lockedLabel = contract || auto
        const needPrice = l.unit_price <= 0
        return (
          <div key={l.ref ?? `${l.source}-${i}`} style={s.row}>
            <div style={s.line1}>
              <input
                style={lockedLabel ? s.inputLocked : s.input}
                value={l.label}
                readOnly={lockedLabel}
                disabled={disabled}
                maxLength={PO_LINE_LABEL_MAX}
                placeholder={t('품목명')}
                onChange={e => patch(i, { label: e.target.value })}
              />
              {contract && <span style={s.tagContract}>{t('계약')}</span>}
              {auto && <span style={s.tagAuto}>{t('선택 옵션')}</span>}
              {!lockedLabel && (
                <button type="button" style={s.del} disabled={disabled} onClick={() => remove(i)}>
                  {t('삭제')}
                </button>
              )}
            </div>
            <div style={s.line2}>
              <label style={s.field}>
                <span style={s.fieldLabel}>{t('단위')}</span>
                <input
                  style={{ ...(contract ? s.inputLocked : s.input), width: 56 }}
                  value={l.unit} readOnly={contract} disabled={disabled} maxLength={10}
                  onChange={e => patch(i, { unit: e.target.value })}
                />
              </label>
              <label style={s.field}>
                <span style={s.fieldLabel}>{t('발주수량')}</span>
                <input
                  style={{ ...(contract ? s.inputLocked : s.input), width: 64, textAlign: 'right' }}
                  type="number" min={1} value={l.qty} readOnly={contract} disabled={disabled}
                  onChange={e => patch(i, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
                />
              </label>
              <label style={s.field}>
                <span style={s.fieldLabel}>{t('단가')}</span>
                {/* 금액이 비면 눈에 띄게 — 채워야 배정된다 */}
                <input
                  style={{
                    ...(contract ? s.inputLocked : needPrice ? s.inputNeed : s.input),
                    width: 110, textAlign: 'right',
                  }}
                  type="number" min={0} readOnly={contract} disabled={disabled}
                  value={l.unit_price || ''}
                  placeholder={contract ? '' : t('금액')}
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
  /** 저절로 생긴 줄 — 「이건 네가 고른 옵션이라 뜬 것」이라고 말해 준다 */
  tagAuto: {
    fontSize: 'var(--fs-caption)', color: 'var(--muted)', flexShrink: 0,
    border: '1px dashed var(--line)', borderRadius: 999, padding: '1px 8px',
  },
  /** 금액이 빈 칸 — 채워야 배정된다. 붉은 테두리로 어디를 봐야 하는지 말한다 */
  inputNeed: {
    flex: 1, minWidth: 0, font: 'inherit', fontSize: 'var(--fs-sheet)',
    border: '1px solid var(--req)', borderRadius: 4, padding: '4px 6px', boxSizing: 'border-box',
  },
  needPrice: {
    fontSize: 'var(--fs-caption)', color: 'var(--req)', lineHeight: 1.5,
    padding: 'var(--sp-2) 0',
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
