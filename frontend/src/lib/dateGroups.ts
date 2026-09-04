import { useEffect, useMemo, useState } from 'react'

/**
 * **날짜별 묶음 + 접기** — 견적/주문 목록이 공통으로 쓴다.
 *
 * 목록이 쌓이면 「언제 것인지」가 먼저 필요한 정보가 된다. 기간을 손으로 넣는 필터
 * (시작일·종료일·조회 버튼)는 좁은 화면에서 한 줄을 통째로 먹으면서도,
 * 정작 자주 쓰는 「오늘 것만 보기」에는 매번 날짜 두 개를 골라야 했다.
 * 날짜로 묶어 접었다 펴면 그 일이 한 번의 누름이 된다.
 *
 * ⚠️ 서버가 최신순으로 주므로 **다시 정렬하지 않는다**(Map 이 넣은 순서를 지킨다).
 */
export function useDateGroups<T>(
  rows: T[],
  dateOf: (row: T) => string,
  /** 검색 중인가 — 검색 중에는 전부 편다(찾은 건이 접힌 날짜에 있으면 「없다」로 보인다) */
  searching: boolean,
): { groups: [string, T[]][]; isOpen: (date: string) => boolean; toggle: (date: string) => void } {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      const d = dateOf(r)
      const list = m.get(d)
      if (list) list.push(r); else m.set(d, [r])
    }
    return [...m.entries()]
    // dateOf 는 매 렌더 새 함수여도 되게 의존성에서 뺀다 — 날짜를 뽑는 규칙은 바뀌지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  /**
   * 가장 최근 날짜만 펼쳐 둔다 — 목록을 처음 열었을 때 오늘 것부터 보이게.
   * 검색 중에는 전부 편다.
   */
  useEffect(() => {
    if (searching) { setCollapsed(new Set()); return }
    if (groups.length > 1) setCollapsed(new Set(groups.slice(1).map(([d]) => d)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length, searching])

  return {
    groups,
    isOpen: (date: string) => !collapsed.has(date),
    toggle: (date: string) => setCollapsed(prev => {
      const next = new Set(prev)
      next.has(date) ? next.delete(date) : next.add(date)
      return next
    }),
  }
}
