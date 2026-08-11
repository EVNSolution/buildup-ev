/**
 * 견적 수정 이력 — 무엇이 언제 누구에 의해 바뀌었는지 필드 단위로 남긴다.
 *
 * 견적서·계약서가 오간 뒤 "왜 금액이 다르냐"는 이야기가 나오면 되짚을 수 있어야 한다.
 * 옵션·고객정보·할부조건 세 갈래를 같은 표(quote_change_log)에 쌓는다.
 *
 * ⚠️ **바뀐 필드만** 남긴다. 저장 버튼을 눌렀다는 사실이 아니라 값이 달라졌다는 사실이
 *    이력이다. 전부 남기면 실제 변경이 잡음에 묻힌다.
 */
import { prisma } from '../lib/prisma.js';

export type ChangeSection = 'options' | 'customer' | 'inputs';

/** 값 → 이력에 남길 문자열. 빈 값은 null(‘없음’)로 통일한다. */
function asText(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 300);
  return String(v).slice(0, 300);
}

/**
 * before/after 를 견줘 달라진 것만 기록한다.
 * @param fields 살펴볼 필드 목록. 넘기지 않으면 after 의 키 전부를 본다.
 * @returns 기록한 필드 수
 */
export async function logQuoteChanges(
  quoteId: number,
  section: ChangeSection,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changedBy: string,
  fields?: string[],
): Promise<number> {
  if (!prisma) return 0;
  const keys = fields ?? Object.keys(after);
  const rows = keys
    .map((f) => ({ f, o: asText(before[f]), n: asText(after[f]) }))
    .filter(({ o, n }) => o !== n)
    .map(({ f, o, n }) => ({
      quote_id: quoteId, section, field: f, old_value: o, new_value: n, changed_by: changedBy,
    }));
  if (!rows.length) return 0;
  await prisma.quoteChangeLog.createMany({ data: rows });
  return rows.length;
}

/** 한 견적의 수정 이력(최근 순). */
export async function listQuoteChanges(quoteId: number, limit = 200) {
  if (!prisma) return [];
  return prisma.quoteChangeLog.findMany({
    where: { quote_id: quoteId },
    orderBy: { changed_at: 'desc' },
    take: Math.min(limit, 500),
  });
}
