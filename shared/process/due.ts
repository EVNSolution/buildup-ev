/**
 * **납기까지 며칠 남았나** — 관리자 화면과 특장사 화면이 **같은 기준**을 쓴다.
 *
 * 화면마다 따로 계산하면 같은 주문이 한쪽에서는 「3일 전」, 다른 쪽에서는 아무 표시도
 * 없는 일이 생긴다. 납기는 두 사람이 같은 것을 보고 이야기해야 하는 값이다.
 */

/** 며칠 전부터 빨갛게 알릴지 */
export const DUE_SOON_DAYS = 3;

export type DueState =
  /** 납기가 지났다 — 가장 강한 표시, 가장 위 */
  | 'overdue'
  /** 사흘 안으로 다가왔다 */
  | 'soon'
  /** 아직 여유가 있다 */
  | 'normal'
  /** 납기가 안 잡혔다(수락 전) */
  | 'none';

export interface DueInfo {
  state: DueState;
  /** 남은 날. **지났으면 음수**(-2 = 이틀 지남) */
  days: number;
  /** 날짜 옆에 붙는 문구. 여유가 있으면 빈 문자열 */
  label: string;
  /**
   * 목록 정렬 기준 — **작을수록 위**.
   *
   * 남은 날을 그대로 쓴다. 지난 건은 음수라 저절로 맨 위로 올라가고,
   * 많이 지난 것일수록 더 위다. 그 다음이 오늘(0) → 하루 전 → 이틀 전 순이다.
   * 납기가 없는 건은 맨 아래.
   */
  sortKey: number;
}

/** 시각을 버리고 **날짜만** 비교한다 — 오후 6시에 본다고 「오늘이 지난 것」이 되면 안 된다 */
function atMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * `YYYY-MM-DD`(또는 ISO 문자열) 납기를 읽어 상태·문구·정렬값을 만든다.
 * 형태가 아니면 「없음」으로 본다 — 화면이 깨지지 않는다.
 */
export function dueInfo(due: string | null | undefined, now: Date = new Date()): DueInfo {
  const m = typeof due === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(due.trim()) : null;
  if (!m) return { state: 'none', days: 0, label: '', sortKey: Number.MAX_SAFE_INTEGER };

  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = Math.round((atMidnight(target) - atMidnight(now)) / DAY);

  if (days < 0) {
    return { state: 'overdue', days, label: `납기 ${-days}일 경과`, sortKey: days };
  }
  if (days === 0) return { state: 'soon', days, label: '납기 오늘', sortKey: 0 };
  if (days <= DUE_SOON_DAYS) return { state: 'soon', days, label: `납기 ${days}일 전`, sortKey: days };
  return { state: 'normal', days, label: '', sortKey: days };
}

/** 빨갛게 알려야 하는 상태인가 — 지났거나 사흘 안 */
export function dueNeedsAttention(info: DueInfo): boolean {
  return info.state === 'overdue' || info.state === 'soon';
}
