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
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 9,
  cursor: 'pointer',
  background: '#fff',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
}

const styles = {
  off: { ...base, border: '1px solid var(--line)', color: 'var(--body)' },
  on:  { ...base, border: '2px solid var(--lime)', boxShadow: '0 0 0 2px rgba(200,210,0,.25)', color: 'var(--dark)', fontWeight: 700 },
  disabled: { opacity: 0.4, cursor: 'not-allowed' },
  delta: { fontSize: 10, color: 'var(--muted)', fontWeight: 500 },
}
