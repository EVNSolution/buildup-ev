/**
 * 카탈로그 조회 — 컨피규레이터가 필요로 하는 **읽기 전용** 기준데이터.
 *
 * 로그인 화면(영업·관리자)과 공개 화면이 **같은 함수**를 쓴다. 공개용 조회를 따로 만들면
 * 한쪽 가격표만 낡는 일이 생긴다 — 같은 값을 두 번 만들지 않는다.
 *
 * ⚠️ 여기서 내려주는 것은 **가격표·규칙·세율**뿐이다. 개인정보는 한 줄도 다루지 않는다.
 *    공개 라우터가 이 함수만 쓰도록 해 두면, 공개 응답에 고객 정보가 섞일 자리가 없다.
 */
import { prisma } from '../lib/prisma.js';
import type { TaxConfig } from '@buildup-ev/shared/pricing';

export interface PricingBundle {
  groups: {
    code: string;
    category: string | null;
    name: string;
    select_type: string;
    required: boolean;
    values: { code: string; name: string; vivar_code: string | null; sort_order: number }[];
  }[];
  rules: unknown[];
  option_prices: Record<string, number>;
  tax: TaxConfig;
  tax_all: Record<string, number>;
  subsidy_national: { amount: number; sosang_rate: number } | null;
}

/** 차종 하나의 옵션·가격·세율 묶음. 차종이 없으면 null. */
export async function loadPricingBundle(modelCode: string, calcYear: number): Promise<PricingBundle | null> {
  if (!prisma) throw new Error('DB_UNAVAILABLE');

  const model = await prisma.vehicleModel.findUnique({ where: { code: modelCode }, select: { code: true } });
  if (!model) return null;

  const [ogms, rules, optPrices, taxRows, subsidyNat] = await Promise.all([
    prisma.optionGroupModel.findMany({
      where: { model_code: modelCode, group: { active: true } },
      include: {
        group: {
          include: { values: { where: { active: true }, orderBy: { sort_order: 'asc' } } },
        },
      },
      orderBy: { group: { sort_order: 'asc' } },
    }),
    prisma.optionRule.findMany(),
    prisma.optionPrice.findMany({ where: { model_code: modelCode } }),
    prisma.taxConfig.findMany(),
    prisma.subsidyNational.findFirst({ where: { model_code: modelCode, year: calcYear } }),
  ]);

  const groups = ogms.map(gm => ({
    code:        gm.group.code,
    category:    gm.group.category,
    name:        gm.group.name,
    select_type: gm.group.select_type,
    required:    gm.group.required,
    values:      gm.group.values.map(v => ({
      code: v.code, name: v.name, vivar_code: v.vivar_code, sort_order: v.sort_order,
    })),
  }));

  const option_prices: Record<string, number> = {};
  for (const op of optPrices) option_prices[op.value_code] = op.supply_price;

  const taxMap: Record<string, number> = {};
  for (const t of taxRows) taxMap[t.param_key] = Number(t.value);
  const tax: TaxConfig = {
    acq_tax_rate:         taxMap['acq_tax_rate']         ?? 0.05,
    special_acq_tax_rate: taxMap['special_acq_tax_rate'] ?? 0.02,
    acq_tax_relief_cap:   taxMap['acq_tax_relief_cap']   ?? 1_400_000,
    stamp:        taxMap['stamp']        ?? 2_500,
    plate:        taxMap['plate']        ?? 25_000,
    reg_agency:   taxMap['reg_agency']   ?? 50_000,
    delivery_fee: taxMap['delivery_fee'] ?? 179_000,
    etc_fee:      taxMap['etc_fee']      ?? 50_000,
  };

  return {
    groups,
    rules,
    option_prices,
    tax,
    // 총견적서 계산(calcQuote)에 필요한 전체 세율·부대비용 — 화면이 견적서와 같은 규칙을 쓰도록.
    tax_all: taxMap,
    subsidy_national: subsidyNat
      ? { amount: subsidyNat.amount, sosang_rate: Number(subsidyNat.sosang_rate ?? 0) }
      : null,
  };
}

/** 지역 이름 목록(시도·시군구 정렬). 지방보조금 조회 기준. */
export async function listRegionNames(): Promise<string[]> {
  if (!prisma) throw new Error('DB_UNAVAILABLE');
  const rows = await prisma.region.findMany({ orderBy: [{ sido: 'asc' }, { sigungu: 'asc' }] });
  return rows.map(r => r.name);
}

/** 지역·연도별 지방보조금. 없으면 null. */
export async function findLocalSubsidy(region: string, year: number) {
  if (!prisma) throw new Error('DB_UNAVAILABLE');
  const row = await prisma.subsidyLocal.findFirst({ where: { region, year } });
  return row ? { region, year, amount: row.amount, extra: row.extra ?? null } : null;
}
