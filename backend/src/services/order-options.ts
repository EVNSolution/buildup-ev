/**
 * 선택값(코드) → 사람이 읽는 사양 목록.
 *
 * 발주서·주문 상세가 **같은 목록**을 보여야 한다. 배정 화면에서 미리 보는 발주서와
 * 특장사가 수락할 때 보는 발주서가 다르면 「그때 본 것과 다르다」는 말이 나온다.
 */
import { prisma } from '../lib/prisma.js';

export interface ResolvedOption {
  id: number;
  group_code: string;
  group_name: string;
  value_code: string;
  value_name: string;
}

/** 견적의 selections 를 사양 목록으로 편다. 이름을 못 찾는 코드는 버린다 */
export async function optionsFromSelections(
  selections: Record<string, string>,
): Promise<ResolvedOption[]> {
  if (!prisma) return [];
  const valueCodes = Object.values(selections).filter(Boolean);
  if (valueCodes.length === 0) return [];
  const values = await prisma.optionValue.findMany({
    where: { code: { in: valueCodes } },
    include: { group: { select: { code: true, name: true } } },
  });
  const vMap = new Map(values.map(v => [v.code, v]));
  return Object.entries(selections)
    .filter(([, vCode]) => vMap.has(vCode))
    .map(([gCode, vCode], idx) => {
      const v = vMap.get(vCode)!;
      return { id: idx, group_code: gCode, group_name: v.group.name, value_code: vCode, value_name: v.name };
    });
}
