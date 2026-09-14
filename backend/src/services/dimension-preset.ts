import { prisma } from '../lib/prisma.js';

/**
 * **튜닝 후 치수** — 사양(특장형태 × 탑크기)으로 프리셋을 골라 서류에 넣는다.
 *
 * 예전에는 치수 데이터가 없어 튜닝 전 값을 그대로 복사했다. 탑을 올리면 높이·내측치수가
 * 분명히 바뀌는데 같은 숫자가 찍혀 **틀린 서류**가 나갔다(2026-09-14 제보).
 *
 * ⚠️ 값이 없으면 **빈칸**이다 — 튜닝 전 값으로 채우지 않는다. 틀린 숫자보다 빈칸이
 *    「아직 안 됐다」를 드러낸다. 프리셋 행이 없는 사양도, 행은 있는데 칸이 빈 경우도 같다.
 */
export interface DimensionPresetRow {
  car_length: number | null; car_width: number | null; car_height: number | null;
  inner_length: number | null; inner_width: number | null; inner_height: number | null;
  offset: number | null;
}

/** 서류에 넣을 튜닝 후 치수 — 없는 칸은 '' */
export interface AfterDimensions {
  length: number | ''; width: number | ''; height: number | '';
  bed_len: number | ''; bed_wid: number | ''; bed_hgt: number | '';
  offset: number | '';
}

const blank = (v: number | null | undefined): number | '' => (v == null ? '' : v);

export function afterDimensions(preset: DimensionPresetRow | null): AfterDimensions {
  return {
    length: blank(preset?.car_length), width: blank(preset?.car_width), height: blank(preset?.car_height),
    bed_len: blank(preset?.inner_length), bed_wid: blank(preset?.inner_width), bed_hgt: blank(preset?.inner_height),
    offset: blank(preset?.offset),
  };
}

/** 주문의 차종·옵션으로 프리셋 행을 찾는다. 특장형태·탑크기가 없거나 행이 없으면 null */
export async function findDimensionPreset(
  modelCode: string, selections: Record<string, string>,
): Promise<DimensionPresetRow | null> {
  const bodyType = selections['BODYTYPE'];
  const topSize = selections['TOP'];
  if (!prisma || !bodyType || !topSize) return null;
  return prisma.dimensionPreset.findUnique({
    where: { model_code_body_type_top_size: { model_code: modelCode, body_type: bodyType, top_size: topSize } },
  });
}

/**
 * 주문 상세 「사양」 탭의 **상세 제원** — 튜닝 후 값만.
 *
 * 차체제원(전장·전폭·전고)과 하대내측치수(장·폭·고). 튜닝 전 값은 싣지 않는다 — 현장이 볼 것은
 * 만들어야 할 결과다(지시 2026-09-14). **특장만 주문은 하대내측치수만** — 차량은 고객 것이라
 * 차체제원을 우리가 정하지 않는다. 값이 없는 칸은 null(화면에서 「—」).
 */
export interface OrderDetailDims {
  body_only: boolean;
  /** 특장만 주문이면 null — 칸 자체를 그리지 않는다 */
  body: { length: number | null; width: number | null; height: number | null } | null;
  bed: { length: number | null; width: number | null; height: number | null };
}

export async function orderDetailDims(orderId: number): Promise<OrderDetailDims | null> {
  if (!prisma) return null;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      options: { select: { group_code: true, value_code: true } },
      quote: { select: { model_code: true, selections: true, inputs: true } },
    },
  });
  if (!order) return null;
  // 서류 생성과 같은 규칙 — 주문에 옵션 행이 있으면 그것, 없으면 견적의 선택
  const selections: Record<string, string> = order.options.length > 0
    ? Object.fromEntries(order.options.map(o => [o.group_code, o.value_code]))
    : ((order.quote.selections ?? {}) as Record<string, string>);
  const p = await findDimensionPreset(order.quote.model_code, selections);
  const bodyOnly = (order.quote.inputs as { body_only?: unknown } | null)?.body_only === true;
  return {
    body_only: bodyOnly,
    body: bodyOnly ? null : { length: p?.car_length ?? null, width: p?.car_width ?? null, height: p?.car_height ?? null },
    bed: { length: p?.inner_length ?? null, width: p?.inner_width ?? null, height: p?.inner_height ?? null },
  };
}
