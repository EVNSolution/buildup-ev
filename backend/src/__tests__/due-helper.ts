import { addBusinessDays, toDateInput } from '@buildup-ev/shared/schedule';
import { loadHolidays } from '../services/holidays.js';

/**
 * **수락 시험에 넣을 납기일** — 주말뿐 아니라 **공휴일도 피한** 영업일.
 *
 * 예전에는 「오늘 + 20일, 주말이면 월요일」로 골랐다. 2026-09-13 에 돌리니 10/5
 * (개천절 대체공휴일)가 나와 수락이 400 으로 막혔고, 경합·별지 시험 7개가 제품과
 * 무관하게 깨졌다. 날짜에 따라 붙었다 깨졌다 하는 시험은 믿을 수 없으므로
 * 서버와 **같은 달력·같은 계산**으로 고른다.
 *
 * 10 영업일 뒤 — 한도(20 영업일) 안쪽이면서 오늘보다 확실히 뒤다.
 */
export async function businessDue(days = 10): Promise<string> {
  await loadHolidays(true);
  return toDateInput(addBusinessDays(new Date(), days));
}
