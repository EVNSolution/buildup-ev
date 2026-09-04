import type { ApiQuote } from '@shared/types/index'

/**
 * 고객 이름으로 목록 좁히기 — **이미 불러온 결과 안에서** 거른다.
 *
 * 기간·상태 조건은 그대로 두고 그 안에서만 좁힌다("기존 날짜별 분류는 놔두고 그 중
 * 해당 고객건만"). 서버를 다시 부르지 않으니 글자를 칠 때마다 바로 줄어든다.
 *
 * 띄어쓰기와 대소문자는 무시한다 — 「홍 길동」으로 저장된 고객을 「홍길동」으로 찾는다.
 */
function norm(v: string): string {
  return v.replace(/\s+/g, '').toLowerCase()
}

export function matchesCustomer(q: ApiQuote, term: string): boolean {
  const t = norm(term)
  if (!t) return true            // 안 적었으면 전부 보여 준다
  const name = norm(q.customer?.name ?? '')
  return name.includes(t)
}

/** 이름으로 좁힌 목록. 빈 검색어면 원본 그대로(불필요한 새 배열을 만들지 않는다) */
export function filterByCustomer(quotes: ApiQuote[], term: string): ApiQuote[] {
  return norm(term) ? quotes.filter(q => matchesCustomer(q, term)) : quotes
}
