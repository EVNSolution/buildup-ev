/**
 * 고객 마스터 — 같은 고객이 견적을 다시 넣을 때 지난 입력을 다시 안 치게 한다.
 *
 * 식별 키 = **성명(상호) + 생년월일(사업자번호)** 둘 다.
 * 이름만으로는 동명이인이 섞이고, 사업자번호만으로는 개인 고객을 못 찾는다.
 *
 * ⚠️ 조회는 **두 값이 모두 정확히 일치할 때만** 1건을 돌려준다.
 *    부분검색·목록 반환은 만들지 않는다 — 남의 연락처·주소가 새는 통로가 되기 때문이다.
 */
import { prisma } from '../lib/prisma.js';

/** 자동 기입에 쓰는 필드. 이메일은 견적별로 달라지는 일이 많아 마스터에 두지 않는다. */
export interface CustomerMaster {
  id: number;
  name: string;
  ceo_name: string | null;
  phone: string | null;
  tel: string | null;
  address: string | null;
  reg_no: string | null;
  email: string | null;
}

const SELECT = {
  id: true, name: true, ceo_name: true, phone: true, tel: true,
  address: true, reg_no: true, email: true,
} as const;

/** 키가 성립하는가 — 둘 다 비어 있지 않아야 조회·갱신 대상이다. */
export function hasMasterKey(name?: string | null, regNo?: string | null): boolean {
  return Boolean(name?.trim()) && Boolean(regNo?.trim());
}

/**
 * (성명 + 생년월일/사업자번호) 완전일치 1건. 없으면 null.
 * 중복 행이 쌓여 있을 수 있어 **가장 최근 것**을 쓴다(마지막에 저장한 값이 최신).
 */
export async function findCustomerByKey(name: string, regNo: string): Promise<CustomerMaster | null> {
  if (!prisma || !hasMasterKey(name, regNo)) return null;
  return prisma.customer.findFirst({
    where: { name: name.trim(), reg_no: regNo.trim() },
    orderBy: { created_at: 'desc' },
    select: SELECT,
  });
}

/** 빈 문자열은 저장하지 않는다(null 로) — 빈 값으로 기존 값을 덮어쓰면 마스터가 망가진다. */
function clean(v?: string | null): string | null | undefined {
  if (v === undefined) return undefined;
  const t = (v ?? '').trim();
  return t ? t : null;
}

export interface CustomerUpsertInput {
  name: string;
  reg_no?: string | null;
  ceo_name?: string | null;
  email?: string | null;
  phone?: string | null;
  tel?: string | null;
  address?: string | null;
  created_by?: string | undefined;
}

/**
 * 견적 저장 시 고객 마스터 갱신 — 같은 키가 있으면 **갱신**, 없으면 생성.
 * 예전엔 견적마다 무조건 create 라 같은 고객 행이 계속 쌓였다.
 *
 * ⚠️ 값이 **있는 항목만** 덮어쓴다. 이번 견적에서 비워 둔 칸이 지난 견적에서 받아둔
 *    값을 지우면 안 된다(예: 주소를 안 적었다고 마스터 주소가 날아가는 일).
 *
 * @returns 연결할 customer.id
 */
export async function upsertCustomer(input: CustomerUpsertInput): Promise<number> {
  if (!prisma) throw new Error('DB_UNAVAILABLE');
  const name = input.name.trim();
  const regNo = clean(input.reg_no);

  // 빈 값(null)은 제외하고 채워진 것만 반영 — 마스터를 지우지 않기 위해서다.
  const patch: Record<string, string> = {};
  for (const [k, v] of Object.entries({
    ceo_name: clean(input.ceo_name), email: clean(input.email), phone: clean(input.phone),
    tel: clean(input.tel), address: clean(input.address), reg_no: regNo,
  })) {
    if (v) patch[k] = v;
  }

  const existing = hasMasterKey(name, regNo)
    ? await prisma.customer.findFirst({
      where: { name, reg_no: regNo as string },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    })
    : null;

  if (existing) {
    if (Object.keys(patch).length) {
      await prisma.customer.update({ where: { id: existing.id }, data: patch });
    }
    return existing.id;
  }

  const created = await prisma.customer.create({
    data: { name, created_by: input.created_by, ...patch },
    select: { id: true },
  });
  return created.id;
}
