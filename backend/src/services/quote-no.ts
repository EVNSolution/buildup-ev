/**
 * 견적번호(YY-NNNN) 채번 — **한 번 나간 번호는 다시 나오지 않는다.**
 *
 * 예전엔 "남아 있는 견적의 최대번호 +1" 이라, 견적을 지우면 그 번호가 되살아났다.
 * 견적서·계약서는 번호를 달고 고객에게 나가므로, 같은 번호가 다른 건에 붙으면
 * 어느 쪽이 진짜인지 나중에 가릴 수 없다. 그래서 발급 기록을 견적 행과 분리해
 * quote_no_counter 에 남긴다(견적을 지워도 이 값은 줄지 않는다).
 *
 * 동시에 두 명이 견적을 만들어도 겹치지 않게, 증가와 반환을 SQL 한 문장으로 처리한다
 * (UPDATE … RETURNING 은 행 잠금 아래서 실행된다 — 읽고-더하고-쓰기 사이가 벌어지지 않는다).
 */
import type { PrismaClient } from '@prisma/client';

/** 채번대장을 못 읽거나 자리수를 넘긴 경우 */
export class QuoteNoError extends Error {}

/** 연도 → 번호 앞자리(26) */
function prefixOf(year: number): string {
  return String(year).slice(-2);
}

/** 채번대장이 비어 있을 때의 출발점 = 그 해 이미 쓰인 최대 번호(없으면 0) */
async function seedFromExisting(
  client: Pick<PrismaClient, '$queryRaw' | '$queryRawUnsafe'>, year: number,
): Promise<number> {
  const prefix = prefixOf(year);
  const rows = await client.$queryRawUnsafe<{ max_seq: number | null }[]>(
    `SELECT MAX(SUBSTRING(quote_no FROM 4)::int) AS max_seq
       FROM quote
      WHERE quote_no ~ '^[0-9]{2}-[0-9]{4}$' AND LEFT(quote_no, 2) = $1`,
    prefix,
  );
  return Number(rows[0]?.max_seq ?? 0);
}

/**
 * 다음 견적번호를 발급한다. 발급 즉시 대장이 올라가므로, 이 번호는 두 번 나오지 않는다.
 *
 * @param year 발급 기준 연도(견적 생성일 기준)
 */
export async function nextQuoteNo(
  client: Pick<PrismaClient, '$queryRaw' | '$queryRawUnsafe'>, year: number,
): Promise<string> {
  const start = await seedFromExisting(client, year);

  // 대장이 없으면 기존 최대번호에서 이어서 시작하고, 있으면 그 값에 1을 더한다.
  // 두 요청이 겹쳐도 ON CONFLICT 쪽으로 떨어져 각자 다른 번호를 받는다.
  const rows = await client.$queryRawUnsafe<{ last_seq: number }[]>(
    `INSERT INTO quote_no_counter (year, last_seq)
          VALUES ($1, $2 + 1)
     ON CONFLICT (year) DO UPDATE
            SET last_seq = GREATEST(quote_no_counter.last_seq, $2) + 1,
                updated_at = CURRENT_TIMESTAMP
       RETURNING last_seq`,
    year, start,
  );

  const seq = Number(rows[0]?.last_seq);
  if (!Number.isFinite(seq) || seq <= 0) throw new QuoteNoError('견적번호 채번 실패');
  if (seq > 9999) throw new QuoteNoError(`${year}년 견적번호가 9999 를 넘었습니다`);

  return `${prefixOf(year)}-${String(seq).padStart(4, '0')}`;
}
