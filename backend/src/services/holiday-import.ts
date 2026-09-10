import { prisma } from '../lib/prisma.js';
import { fromDbDate } from '@buildup-ev/shared/schedule';

/**
 * 공휴일 **불러오기** — 바깥에서 받아 오되, 그대로 믿지 않는다.
 *
 * ⚠️ 무료 공개 소스는 한국 공휴일을 **틀리게 준다.** 2026년을 대조해 보니
 *    nager.at 과 holidays.hyunbin.page **둘 다** 제헌절(7/17)을 공휴일로 넣고 있었다 —
 *    2008년에 공휴일에서 빠진 날이다. 그래서 받아 온 것은 언제나 **초안**이고,
 *    사람이 확인해 저장한 것만 계산에 쓰인다.
 *
 * 정본 소스는 공공데이터포털 특일정보(행정안전부)다. 서비스키(무료)가 있으면 그것을
 * 먼저 쓰고, 없으면 키 없이 되는 소스로 떨어진다. 어느 쪽이든 **초안**인 것은 같다.
 */
export type Draft = {
  day: string;
  name: string;
  /** 이미 표에 있는가 — 화면이 「새로 들어옴 / 이미 있음」을 가른다 */
  known: boolean;
  source: 'data.go.kr' | 'nager';
};

const KEY = () => (process.env['HOLIDAY_API_KEY'] ?? '').trim();

/** 공공데이터포털 특일정보 — 정본. 서비스키가 있을 때만 쓴다. */
async function fromDataGoKr(year: number): Promise<Omit<Draft, 'known'>[]> {
  const url = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
    + `?solYear=${year}&numOfRows=100&_type=json&ServiceKey=${encodeURIComponent(KEY())}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`특일정보 응답 ${res.status}`);
  const body = await res.json() as {
    response?: { body?: { items?: { item?: unknown } } };
  };
  const raw = body.response?.body?.items?.item;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map(x => x as { locdate?: number | string; dateName?: string; isHoliday?: string })
    .filter(x => (x.isHoliday ?? 'Y') === 'Y' && x.locdate)
    .map(x => {
      const s = String(x.locdate);
      return {
        day: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`,
        name: String(x.dateName ?? '공휴일').trim(),
        source: 'data.go.kr' as const,
      };
    });
}

/** 키 없이 되는 소스 — **거친 초안**이다(제헌절을 넣는 등 틀린 날이 섞인다) */
async function fromNager(year: number): Promise<Omit<Draft, 'known'>[]> {
  const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`nager 응답 ${res.status}`);
  const list = await res.json() as { date: string; localName: string }[];
  return list.map(x => ({ day: x.date, name: x.localName, source: 'nager' as const }));
}

/**
 * 그 해 초안을 받아 온다. **저장하지 않는다** — 화면이 보여 주고 사람이 고른다.
 */
export async function draftYear(year: number): Promise<{ rows: Draft[]; source: Draft['source']; note: string }> {
  const authoritative = KEY() !== '';
  const rows = authoritative ? await fromDataGoKr(year) : await fromNager(year);
  const have = prisma
    ? await prisma.holiday.findMany({
        where: { day: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) } },
        select: { day: true },
      })
    : [];
  const known = new Set(have.map(h => fromDbDate(h.day)));
  return {
    rows: rows
      .filter((r, i, a) => a.findIndex(x => x.day === r.day) === i)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(r => ({ ...r, known: known.has(r.day) })),
    source: authoritative ? 'data.go.kr' : 'nager',
    note: authoritative
      ? '행정안전부 특일정보에서 받았습니다. 그래도 저장 전에 확인해 주세요.'
      : '키 없이 쓰는 공개 소스라 틀린 날이 섞일 수 있습니다(예: 제헌절). 반드시 확인하고 저장하세요.',
  };
}
