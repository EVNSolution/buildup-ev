import { useMemo } from 'react'
import { deliveryDueLimit, isWeekend, toDateInput } from '@shared/schedule/businessDays'

/**
 * 납기일 고르기 — **고를 수 있는 날짜만 보여준다.**
 *
 * 날짜 입력칸(`input[type=date]`)은 min/max 를 줘도 달력에 다른 달까지 다 보여 준다.
 * 고를 수 없는 날을 눌러 보고 나서야 안 된다는 걸 아는 것은 고르는 사람 잘못이 아니다.
 * 그래서 **발주일 다음날부터 한도(15영업일)까지의 주만** 그린다 — 화면에 있는 것이 곧
 * 고를 수 있는 것이다. 주말은 자리를 비워 두지 않고 회색으로 남긴다(주 모양이 깨지면
 * 날짜를 세기 어렵다).
 *
 * 판정은 서버와 같은 함수(`shared/schedule`)를 쓴다.
 */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export function DueDatePicker({ orderedAt, value, onChange }: {
  /** 발주일 — 한도의 기산점 */
  orderedAt: Date
  /** 고른 날짜 (YYYY-MM-DD). 아직이면 '' */
  value: string
  onChange: (v: string) => void
}) {
  const { weeks, limit, first } = useMemo(() => {
    const base = new Date(orderedAt.getFullYear(), orderedAt.getMonth(), orderedAt.getDate())
    const first = new Date(base); first.setDate(first.getDate() + 1)   // 발주일 다음날부터
    const limit = deliveryDueLimit(base)

    // 첫 주의 일요일부터 마지막 주의 토요일까지 — 주 단위로 채운다
    const gridStart = new Date(first); gridStart.setDate(gridStart.getDate() - gridStart.getDay())
    const gridEnd = new Date(limit); gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))

    const weeks: Date[][] = []
    const cur = new Date(gridStart)
    while (cur <= gridEnd) {
      const w: Date[] = []
      for (let i = 0; i < 7; i++) { w.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
      weeks.push(w)
    }
    return { weeks, limit, first }
  }, [orderedAt])

  const selectable = (d: Date) => !isWeekend(d) && d >= first && d <= limit

  return (
    <div>
      <div style={s.head}>
        {WEEKDAYS.map(w => <div key={w} style={s.wd}>{w}</div>)}
      </div>
      <div style={s.grid}>
        {weeks.flat().map(d => {
          const key = toDateInput(d)
          const ok = selectable(d)
          const on = value === key
          return (
            <button
              key={key}
              type="button"
              disabled={!ok}
              aria-pressed={on}
              onClick={() => onChange(key)}
              style={on ? s.dayOn : ok ? s.day : s.dayOff}
            >
              <span style={s.dayNum}>{d.getDate()}</span>
              {/* 달이 바뀌는 첫날에만 월을 적는다 — 3주가 두 달에 걸치면 헷갈린다 */}
              {d.getDate() === 1 && <span style={s.month}>{d.getMonth() + 1}월</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const dayBase: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  minHeight: 38, padding: 0, borderRadius: 'var(--r-sm)',
  fontFamily: 'inherit', fontSize: 'var(--fs-label)', fontVariantNumeric: 'tabular-nums',
  border: 'var(--hairline)', background: '#fff', color: 'var(--dark)', cursor: 'pointer',
}

const s: Record<string, React.CSSProperties> = {
  head: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 'var(--sp-1)' },
  wd: { textAlign: 'center', fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
  day: dayBase,
  // 고를 수 없는 날 — 지우지 않고 가라앉힌다(주 모양이 유지돼야 날짜를 셀 수 있다)
  dayOff: { ...dayBase, border: '0.5px solid transparent', background: 'transparent', color: 'var(--line-strong, #CFD4CF)', cursor: 'default' },
  dayOn: { ...dayBase, border: '0.5px solid var(--lime)', background: 'var(--lime-bg)', fontWeight: 700 },
  dayNum: { lineHeight: 1.2 },
  month: { fontSize: 9, color: 'var(--muted)', lineHeight: 1 },
}
