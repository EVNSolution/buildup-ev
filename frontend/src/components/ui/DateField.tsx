import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../i18n'
import { holidayName, loadHolidays } from '../../lib/holidays'
import { useEscapeClose } from '../../lib/escClose'
import { useBackClose } from '../../lib/backClose'

/**
 * **날짜 고르기** — 앱 전체 한 벌(2026-09-14).
 *
 * 브라우저 기본 날짜 입력(`input[type=date]`)은 달력을 **입력칸 아래로만** 띄우고 위치를 코드로 바꿀 수 없다.
 * 화면 아래쪽 입력칸(부가작업 「인도 완료」 등)에서 달력이 화면 밖·독 뒤로 잘려 날짜를 고를 수 없었다(제보).
 *
 * 그래서 달력을 직접 그린다.
 *   · 입력칸이 **화면 아래쪽 절반**에 있으면 달력을 **위로** 띄운다(창 아래가 독에 가려져도 안전하게)
 *   · 화면 좌우·위아래 밖으로 나가지 않게 자리를 맞춘다. 헤더의 넘침에 갇히지 않게 body 로 띄운다
 *   · 공휴일은 이름을 달고 붉게, 오늘은 테두리, 고를 수 없는 날(min·max 밖)은 흐리게
 *   · 값은 늘 `YYYY-MM-DD` — 기존 `input[type=date]` 자리에 그대로 바꿔 끼운다
 */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const POP_W = 288
/** 달력 대략 높이 — 위·아래 자리를 가를 때만 쓴다(실제 붙이는 자리는 칸 테두리 기준) */
const POP_H = 360

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (v: string | null | undefined): Date | null => {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

export function DateField({ value, onChange, min, max, disabled, ariaLabel, placeholder, style, clearable = false }: {
  value: string
  onChange: (v: string) => void
  /** 고를 수 있는 첫날·끝날(YYYY-MM-DD) */
  min?: string
  max?: string
  disabled?: boolean
  ariaLabel?: string
  placeholder?: string
  style?: React.CSSProperties
  /** 달력 아래 「지우기」 — 비워 둘 수 있는 칸만 */
  clearable?: boolean
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState<Date>(() => { const d = parse(value) ?? new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  /** 아래로 뜨면 top, 위로 뜨면 bottom — 위로 뜰 때 달력 **아랫변**을 칸 윗변에 붙여 높이와 상관없이 겹치지 않게 */
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 8, top: 8 })
  const [, setHolidaysTick] = useState(0)

  useEffect(() => { if (open) void loadHolidays().then(() => setHolidaysTick(n => n + 1)) }, [open])

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    const left = Math.min(Math.max(8, r.left), Math.max(8, vw - POP_W - 8))
    // 화면 아래쪽 절반이면 위로 — 창 아래 끝이 독에 가려져 있어도 달력이 보이게.
    // 위쪽 자리가 모자라면(달력 대략 높이보다 작으면) 아래로
    const preferAbove = (r.top + r.height / 2) > vh * 0.5 && r.top - 6 >= POP_H
    setPos(preferAbove ? { left, bottom: vh - r.top + 6 } : { left, top: Math.min(r.bottom + 6, Math.max(8, vh - POP_H - 8)) })
  }, [open])

  const close = () => setOpen(false)
  useEscapeClose(close, open)
  useBackClose(open, close)

  function openPicker() {
    if (disabled) return
    const d = parse(value) ?? new Date()
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
    setOpen(true)
  }

  const minD = parse(min), maxD = parse(max)
  const selectable = (d: Date) => (!minD || d >= minD) && (!maxD || d <= maxD)
  const today = ymd(new Date())

  // 6주 × 7일 — 달이 바뀌어도 달력 높이가 같게
  const start = new Date(month); start.setDate(1 - start.getDay())
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })

  const pick = (d: Date) => { if (!selectable(d)) return; onChange(ymd(d)); close() }

  const popup = (
    <>
      <div style={s.scrim} onClick={ev => { if (ev.target === ev.currentTarget) close() }} />
      <div role="dialog" aria-label={ariaLabel ?? t('날짜 선택')} style={{ ...s.pop, left: pos.left, ...(pos.bottom !== undefined ? { bottom: pos.bottom } : { top: pos.top }) }}>
        <div style={s.head}>
          <button type="button" style={s.nav} aria-label={t('이전 달')} onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>‹</button>
          <span style={s.title}>{month.getFullYear()}.{pad(month.getMonth() + 1)}</span>
          <button type="button" style={s.nav} aria-label={t('다음 달')} onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>›</button>
        </div>
        <div style={s.grid}>
          {WEEKDAYS.map((w, i) => <span key={w} style={{ ...s.wd, ...(i === 0 ? s.sun : i === 6 ? s.sat : {}) }}>{t(w)}</span>)}
          {days.map(d => {
            const key = ymd(d)
            const inMonth = d.getMonth() === month.getMonth()
            const ok = selectable(d)
            const hol = holidayName(key)
            const on = key === value
            return (
              <button
                key={key}
                type="button"
                disabled={!ok}
                title={hol ?? undefined}
                aria-label={`${key}${hol ? ` ${hol}` : ''}`}
                aria-pressed={on}
                onClick={() => pick(d)}
                style={{
                  ...s.day,
                  ...(!inMonth ? s.dayOut : {}),
                  ...((hol || d.getDay() === 0) && ok ? s.dayRed : {}),
                  ...(key === today ? s.dayToday : {}),
                  ...(on ? s.dayOn : {}),
                  ...(!ok ? s.dayOff : {}),
                }}
              >
                {d.getDate()}
              </button>
            )
          })}
        </div>
        <div style={s.foot}>
          {selectable(new Date()) && <button type="button" style={s.footBtn} onClick={() => pick(new Date())}>{t('오늘')}</button>}
          {clearable && value && <button type="button" style={s.footBtn} onClick={() => { onChange(''); close() }}>{t('지우기')}</button>}
        </div>
      </div>
    </>
  )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        style={{ ...s.trigger, ...(disabled ? s.triggerOff : {}), ...style }}
      >
        <span style={value ? s.val : s.ph}>{value || placeholder || t('날짜 선택')}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>
      {open && createPortal(popup, document.body)}
    </>
  )
}

const s: Record<string, React.CSSProperties> = {
  trigger: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    fontFamily: 'inherit', fontSize: 'var(--fs-input, var(--fs-label))', color: 'var(--body)',
    background: '#fff', border: 'var(--hairline)', borderRadius: 'var(--r-sm)',
    paddingTop: 0, paddingBottom: 0, paddingLeft: 10, paddingRight: 8,
    minHeight: 'var(--h-control)', minWidth: 132, cursor: 'pointer', boxSizing: 'border-box',
  },
  triggerOff: { cursor: 'default', opacity: 0.6 },
  val: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  ph: { color: 'var(--muted)', whiteSpace: 'nowrap' },
  scrim: { position: 'fixed', inset: 0, zIndex: 4000, background: 'transparent' },
  pop: {
    position: 'fixed', zIndex: 4001, width: POP_W, boxSizing: 'border-box',
    background: '#fff', border: 'var(--hairline)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-2)',
    padding: 10, fontSize: 14,
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  nav: { width: 36, height: 36, border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: 'var(--dark)', borderRadius: 999 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 },
  wd: { textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: '4px 0' },
  sun: { color: 'var(--req)' },
  sat: { color: 'var(--muted)' },
  day: {
    height: 36, border: '1px solid transparent', borderRadius: 999, background: 'transparent',
    fontFamily: 'inherit', fontSize: 14, color: 'var(--dark)', cursor: 'pointer', fontVariantNumeric: 'tabular-nums', padding: 0,
  },
  dayOut: { color: 'var(--line)' },
  dayRed: { color: 'var(--req)' },
  dayToday: { border: '1px solid var(--dark)' },
  dayOn: { background: 'var(--dark)', color: '#fff', border: '1px solid var(--dark)' },
  dayOff: { color: 'var(--line)', cursor: 'default', background: 'transparent' },
  foot: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6, minHeight: 28 },
  footBtn: { fontFamily: 'inherit', fontSize: 13, border: 'var(--hairline)', background: '#fff', borderRadius: 999, padding: '4px 12px', cursor: 'pointer', color: 'var(--dark)' },
}
