import { OPTION_CARD } from '../styles/optionCard'
import type { ApiOptionGroup } from '@shared/types/index'

export function fmtDelta(d: number): string {
  if (!d) return ''
  return d > 0 ? `+${d.toLocaleString()}` : `−${Math.abs(d).toLocaleString()}`
}

/** 그룹의 off 값 코드 ('없음'/'추가없음' 또는 _X/_NONE). 있으면 토글형 그룹, 없으면 일반 선택형. */
export function offValueCode(group: ApiOptionGroup): string | null {
  const off = group.values.find(v => v.name === '없음' || v.name === '추가없음' || /_(X|NONE)$/.test(v.code))
  return off?.code ?? null
}

/** 토글 버튼 — 선택 시 테두리 강조, 미선택 시 증감액 표시. */
export function OptionToggleButton({ label, selected, delta, disabled = false, onClick }: {
  label: string
  selected: boolean
  delta: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      style={{ ...(selected ? styles.on : styles.off), ...(disabled ? styles.disabled : null) }}
      onClick={() => !disabled && onClick()}
      disabled={disabled}
    >
      <span>{label}</span>
      {!selected && delta && <span style={styles.delta}>{delta}</span>}
    </button>
  )
}

const base = {
  width: '100%',
  minHeight: 48,
  fontSize: 'var(--fs-label)',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
}

const styles = {
  off: { ...base, ...OPTION_CARD.base, color: 'var(--body)' },
  on:  { ...base, ...OPTION_CARD.on },
  disabled: OPTION_CARD.disabled,
  delta: { fontSize: 'var(--fs-label)', color: 'var(--muted)', fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'] },
}
