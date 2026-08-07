import { useRef } from 'react'

/**
 * 전화번호 3칸 입력 — [   ]-[    ]-[    ]
 *
 * 하이픈을 넣을지 말지 헷갈리던 문제를 없앤다. 칸이 나뉘어 있어 형식을 고민할 필요가 없고,
 * 저장 값은 항상 `010-1234-5678` 형태 한 가지다(DB·견적서·계약서 전부 동일).
 *
 * 숫자만 입력되고, 칸이 차면 다음 칸으로 자동 이동한다. 지울 때는 앞 칸으로 돌아간다.
 * 첫 칸은 3자리까지 — 서울 유선(02)처럼 2자리도 있으므로 길이를 강제하지 않는다.
 */
interface Props {
  /** `010-1234-5678` 형태. 빈 문자열이면 전부 공란 */
  value: string
  onChange: (v: string) => void
  /** 각 칸에 적용할 스타일(기존 입력칸과 높이·테두리를 맞추려면 넘긴다) */
  boxStyle?: React.CSSProperties
  disabled?: boolean
}

const LENGTHS = [3, 4, 4]

/** `010-1234-5678` → ['010','1234','5678'] (형식이 달라도 숫자만 뽑아 3·4·4 로 자른다) */
function split(v: string): [string, string, string] {
  const parts = (v ?? '').split('-')
  if (parts.length === 3) return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? '']
  const d = (v ?? '').replace(/\D/g, '')
  return [d.slice(0, 3), d.slice(3, 7), d.slice(7, 11)]
}

export function PhoneInput({ value, onChange, boxStyle, disabled }: Props) {
  const parts = split(value)
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  function set(i: number, raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, LENGTHS[i])
    const next: [string, string, string] = [...parts] as [string, string, string]
    next[i] = digits
    // 세 칸이 모두 비면 빈 값 — '--' 같은 찌꺼기가 저장되지 않게
    onChange(next.every((p) => !p) ? '' : next.join('-'))
    if (digits.length === LENGTHS[i] && i < 2) refs[i + 1].current?.focus()
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !parts[i] && i > 0) refs[i - 1].current?.focus()
  }

  return (
    <div style={s.row}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={s.cell}>
          {i > 0 && <span style={s.dash}>-</span>}
          <input
            ref={refs[i]}
            style={{ ...s.box, ...boxStyle, textAlign: 'center' }}
            value={parts[i]}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            inputMode="numeric"
            maxLength={LENGTHS[i]}
            disabled={disabled}
            aria-label={['국번 앞자리', '가운데 자리', '뒷자리'][i]}
          />
        </div>
      ))}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'center', width: '100%' },
  cell: { display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 },
  dash: { color: 'var(--muted)', padding: '0 5px', flexShrink: 0 },
  box: { width: '100%', minWidth: 0, padding: '8px 6px', border: '1px solid #ccc', borderRadius: 7, fontSize: 14, fontFamily: 'inherit' },
}
