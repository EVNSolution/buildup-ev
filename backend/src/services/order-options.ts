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
  /**
   * 옵션 분류 — 「특장」·「옵션」은 특장사에 맡기는 축이고, 「차량옵션」(트림)은 차량 쪽이다.
   * 발주서는 특장사에 **지급하는** 서류라, 우리가 지급하는 차량은 실리지 않는다
   * (계약 제7조 — 베이스 차량은 갑이 을에게 지급한다).
   */
  category: string | null;
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
    include: { group: { select: { code: true, name: true, category: true } } },
  });
  const vMap = new Map(values.map(v => [v.code, v]));
  return Object.entries(selections)
    .filter(([, vCode]) => vMap.has(vCode))
    .map(([gCode, vCode], idx) => {
      const v = vMap.get(vCode)!;
      return {
        id: idx, group_code: gCode, group_name: v.group.name,
        value_code: vCode, value_name: v.name, category: v.group.category,
      };
    });
}
