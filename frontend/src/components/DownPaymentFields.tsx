import { useEffect, useState } from 'react'

/**
 * 선수금 입력 — **비율과 금액 중 하나만 고른다.**
 *
 * 영업은 「30%」로 말할 때도 있고 「1,500만원」으로 말할 때도 있다. 둘 다 열어 두면
 * 서로 어긋난 값이 저장되고, 견적서에 「30% / 1,200만원」처럼 맞지 않는 두 줄이 나간다.
 *
 * 그래서 **먼저 적은 쪽이 기준이 되고 다른 쪽은 잠긴다.** 잠긴 칸은 비어 있지 않고
 * 계산된 값이 채워져 보인다 — 얼마인지 알아야 고객에게 말할 수 있기 때문이다.
 * 기준을 바꾸려면 적어 둔 칸을 비우면 둘 다 다시 열린다.
 */
export function DownPaymentFields({ base, rate, amount, disabled, onChange, Field, inputStyle }: {
  /** 선수금과 할부원금이 나눠 갖는 몫(원). 서버 계산이 준 값을 그대로 쓴다 */
  base: number
  /** 저장된 비율(0~1) */
  rate: number
  /**
   * 저장된 금액(원). 있으면 금액이 기준이다.
   *
   * ⚠️ `null` 은 **「금액 기준을 푼 것」**이지 「0원」이 아니다. 저장할 때 기준을 풀면
   *    `null` 을 보내 지우기 때문에, 다시 열면 이 값이 `null` 로 들어온다.
   */
  amount?: number | null
  disabled?: boolean
  onChange: (next: { rate: number; amount?: number }) => void
  /** 라벨 감싸개 — 팝업마다 모양이 달라 밖에서 받는다 */
  Field: (p: { label: string; children: React.ReactNode }) => React.ReactElement
  inputStyle: React.CSSProperties
}) {
  /** 무엇을 기준으로 잡았나. 금액이 저장돼 있으면 금액, 아니면 비율. */
  /*
   * ⚠️ `!= null` 이다(`!== undefined` 가 아니다).
   *
   * 기준을 풀고 저장하면 `down_payment_amount` 에 `null` 이 남는다. `!== undefined` 로 보면
   * 그 `null` 이 「금액으로 정했다」로 읽혀, 칸에 **`String(null)` = 「null」이라는 글자가
   * 그대로 찍히고** 비율 칸이 잠긴다(실제 제보).
   */
  const [mode, setMode] = useState<'rate' | 'amount' | null>(amount != null ? 'amount' : (rate > 0 ? 'rate' : null))
  const [pct, setPct] = useState(rate > 0 ? String(Math.round(rate * 1000) / 10) : '')
  const [won, setWon] = useState(amount != null ? String(amount) : '')

  // 기준이 되는 쪽이 바뀌면 잠긴 쪽을 다시 채운다
  useEffect(() => {
    if (mode === 'rate') {
      const r = (Number(pct) || 0) / 100
      setWon(String(Math.floor(base * r)))
    } else if (mode === 'amount') {
      const a = Math.min(Math.max(Number(won) || 0, 0), base)
      setPct(base > 0 ? String(Math.floor((a / base) * 100)) : '0')
    }
  }, [mode, pct, won, base])

  function editRate(v: string) {
    if (v.trim() === '') { setPct(''); setMode(null); setWon(''); onChange({ rate: 0 }); return }
    /*
     * 0~100% 로 눌러 준다 — 금액 칸과 같은 규칙이다.
     *
     * 넘겨 두면 선수금이 나눠 가질 몫을 넘어 **할부원금이 음수**가 된다.
     * (예전 팝업에는 `max={100}` 이 있었는데 이 조각으로 옮기면서 빠졌다)
     */
    const n = Math.min(Math.max(Number(v) || 0, 0), 100)
    setPct(String(n))
    setMode('rate')
    onChange({ rate: n / 100 })   // 금액은 보내지 않는다 — 비율이 기준
  }

  function editAmount(v: string) {
    if (v.trim() === '') { setWon(''); setMode(null); setPct(''); onChange({ rate: 0 }); return }
    /*
     * 나눠 가질 몫을 넘기면 **화면에 적힌 숫자도 함께 눌러** 준다.
     * 예전엔 저장만 눌리고 칸에는 친 그대로 남아, 「999,999,999원을 선수금으로 넣었다」고
     * 읽히는데 실제로 저장된 값은 달랐다. 보이는 것과 저장되는 것이 다르면 안 된다.
     */
    const a = Math.min(Math.max(Number(v) || 0, 0), base)
    setWon(String(a))
    setMode('amount')
    onChange({ rate: base > 0 ? a / base : 0, amount: a })
  }

  const rateLocked = disabled || mode === 'amount'
  const amountLocked = disabled || mode === 'rate'
  const lockedStyle = { ...inputStyle, background: 'var(--card)', color: 'var(--muted)' }

  return (
    <>
      <Field label="선수금 비율 (%)">
        <input
          style={rateLocked ? lockedStyle : inputStyle}
          inputMode="decimal" value={pct} disabled={rateLocked}
          placeholder={mode === 'amount' ? '금액에서 계산됨' : ''}
          onChange={e => editRate(e.target.value)}
        />
      </Field>
      <Field label="선수금 금액 (원)">
        <input
          style={amountLocked ? lockedStyle : inputStyle}
          inputMode="numeric" value={won} disabled={amountLocked}
          placeholder={mode === 'rate' ? '비율에서 계산됨' : ''}
          onChange={e => editAmount(e.target.value)}
        />
      </Field>
      {mode !== null && !disabled && (
        <div style={hint}>
          {mode === 'rate' ? '비율' : '금액'}로 정했습니다 — 다른 쪽은 자동으로 계산됩니다.
          바꾸려면 적어 둔 칸을 비우세요.
        </div>
      )}
    </>
  )
}

const hint: React.CSSProperties = {
  gridColumn: '1 / -1', fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: -4,
}
