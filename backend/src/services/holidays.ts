import { prisma } from '../lib/prisma.js';
import { setHolidays, fromDbDate } from '@buildup-ev/shared/schedule';

/**
 * 공휴일 달력을 **서버 계산에 물린다.**
 *
 * 영업일 계산(`shared/schedule`)은 모듈 안에 달력 하나를 들고 있다. 부를 때마다
 * 목록을 넘기게 하면 한 군데만 빠뜨려도 화면과 서버가 다른 답을 내고, 그건
 * 「고를 수 있는데 저장이 거부된다」로 나타난다 — 예전에 겪은 사고다.
 *
 * ⚠️ DB 를 읽지 못해도 **멈추지 않는다.** 달력이 비면 주말만 빼는 예전 계산으로
 *    돌아가고, 한도가 짧게(빡빡하게) 나온다 — 한도는 넘기면 안 되는 쪽이라 안전하다.
 */
let loadedAt = 0;
/** 다시 읽는 간격 — 관리자가 공휴일을 고친 뒤 이 시간 안에 반영된다 */
const TTL_MS = 10 * 60 * 1000;

export async function loadHolidays(force = false): Promise<number> {
  if (!prisma) return 0;
  if (!force && Date.now() - loadedAt < TTL_MS) return -1;
  try {
    const rows = await prisma.holiday.findMany({
      where: { active: true },
      select: { day: true },
      orderBy: { day: 'asc' },
    });
    setHolidays(rows.map(r => fromDbDate(r.day)));
    loadedAt = Date.now();
    return rows.length;
  } catch (e) {
    console.error('[holidays] 달력을 읽지 못했습니다 — 주말만 빼고 계산합니다', e);
    return 0;
  }
}

/** 관리자가 공휴일을 고쳤을 때 — 다음 계산부터 새 달력을 쓴다 */
export function invalidateHolidays(): void {
  loadedAt = 0;
}
