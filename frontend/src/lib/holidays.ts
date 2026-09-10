import { setHolidays } from '@shared/schedule/businessDays'

/**
 * 공휴일 달력 — **서버와 같은 목록을 화면에도 물린다.**
 *
 * 납기 계산은 shared 에 한 벌만 있고, 양쪽이 같은 달력을 주입해야 답이 같아진다.
 * 어긋나면 「화면에서는 고를 수 있는데 저장이 거부되는」 상황이 된다.
 *
 * ⚠️ 받아오지 못해도 화면은 돈다 — 달력이 비면 주말만 빼는 계산이 되어 한도가
 *    짧게 나온다. 넘기면 안 되는 쪽이라 안전한 방향이다.
 */
let names = new Map<string, string>()
let loading: Promise<void> | null = null

export function holidayName(day: string): string | null {
  return names.get(day) ?? null
}

export async function loadHolidays(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    try {
      const res = await fetch('/api/v1/holidays', { credentials: 'include' })
      if (!res.ok) return
      const body = await res.json() as { data: { day: string; name: string }[] }
      names = new Map(body.data.map(h => [h.day, h.name]))
      setHolidays(names.keys())
    } catch {
      /* 못 받아도 화면은 돈다 — 주말만 빼는 계산으로 떨어진다 */
    }
  })()
  return loading
}

// ── 관리 ─────────────────────────────────────────────────────────────────────

export interface HolidayRow {
  day: string
  name: string
  source: string
  active: boolean
  memo: string | null
  updated_by?: string | null
  updated_at?: string
}

export interface HolidayDraft {
  day: string
  name: string
  known: boolean
  source: string
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `${what} (${res.status})`)
  }
  return (await res.json() as { data: T }).data
}

export async function fetchHolidayYear(year: number): Promise<HolidayRow[]> {
  return json(await fetch(`/api/v1/holidays/admin?year=${year}`, { credentials: 'include' }), '공휴일을 불러오지 못했습니다')
}

export async function importHolidayYear(year: number): Promise<{ rows: HolidayDraft[]; source: string; note: string }> {
  return json(await fetch(`/api/v1/holidays/import?year=${year}`, { credentials: 'include' }), '공휴일을 받아 오지 못했습니다')
}

export async function saveHolidayYear(
  year: number, days: { day: string; name: string; memo?: string | null; source?: string }[],
): Promise<{ saved: number }> {
  const r = await json<{ saved: number }>(await fetch('/api/v1/holidays', {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, days }),
  }), '공휴일을 저장하지 못했습니다')
  // 저장했으면 이 화면의 달력도 새로 받는다 — 방금 고친 값으로 납기를 재야 한다
  loading = null
  await loadHolidays()
  return r
}
