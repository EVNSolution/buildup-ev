/**
 * 고객 마스터 — 같은 고객이 견적을 다시 넣을 때 지난 입력을 다시 안 치게 한다.
 *
 * 식별 키는 두 갈래다.
 *   · 생년월일(사업자번호)이 있으면 → **성명 + 생년월일**
 *   · 없으면                      → **성명 + 휴대폰**
 *
 * 왜 휴대폰까지 보는가 — 생년월일은 **견적 저장 단계에서 필수가 아니다**(계약서 단계에서야
 * 필수가 된다). 그래서 「성명 + 생년월일」만 키로 쓰면 견적을 낼 때마다 고객 행이 새로 생겼다.
 * 실제로 운영 고객의 절반이 생년월일 없이 쌓였다(2026-08-19 기준 24명 중 11명).
 * 휴대폰은 견적 저장에서 이미 필수라 늘 있고, **WARP CRM 도 이름+휴대폰으로 사람을 찾는다** —
 * 같은 기준을 쓰는 편이 두 시스템이 어긋나지 않는다.
 *
 * 이름만으로는 동명이인이 섞이고, 번호만으로는 가족이 한 번호를 쓸 때 섞인다. 그래서 늘 둘씩 본다.
 *
 * ⚠️ 조회는 **두 값이 모두 정확히 일치할 때만** 1건을 돌려준다.
 *    부분검색·목록 반환은 만들지 않는다 — 남의 연락처·주소가 새는 통로가 되기 때문이다.
 */
import { prisma } from '../lib/prisma.js';

/**
 * 자동 기입에 쓰는 필드.
 *
 * ⚠️ **이메일은 일부러 빠져 있다.** 같은 고객이라도 견적마다 받는 담당자 메일이 달라지는
 *    일이 잦아, 지난 값을 끌어오면 엉뚱한 사람에게 견적서가 나간다. 매번 새로 입력받는다.
 *    (customer.email 컬럼 자체는 남겨 견적 저장 시 그 견적의 값으로 갱신된다 —
 *     쓰기만 하고 자동 기입으로는 **읽지 않는다**)
 */
export interface CustomerMaster {
  id: number;
  name: string;
  ceo_name: string | null;
  phone: string | null;
  tel: string | null;
  address: string | null;
  address_detail: string | null;
  reg_no: string | null;
}

const SELECT = {
  id: true, name: true, ceo_name: true, phone: true, tel: true,
  address: true, address_detail: true, reg_no: true,
} as const;

/**
 * 자동 기입 조회(`GET /customers/lookup`)가 성립하는가 — **성명 + 생년월일 둘 다** 필요하다.
 *
 * ⚠️ 읽기 경로는 일부러 넓히지 않았다. 휴대폰까지 받아 주면 이름·번호를 넣어 보며
 *    남의 주소·연락처를 떠보는 통로가 된다. 중복은 **쓰기 경로**의 문제라 그쪽만 고친다.
 */
export function hasMasterKey(name?: string | null, regNo?: string | null): boolean {
  return Boolean(name?.trim()) && Boolean(regNo?.trim());
}

/**
 * (성명 + 생년월일/사업자번호) 완전일치 1건. 없으면 null.
 * 중복 행이 쌓여 있을 수 있어 **가장 최근 것**을 쓴다(마지막에 저장한 값이 최신).
 * 숨긴 고객은 제외한다 — 안 쓰기로 한 행을 자동 기입으로 되살리지 않는다.
 */
export async function findCustomerByKey(name: string, regNo: string): Promise<CustomerMaster | null> {
  if (!prisma || !hasMasterKey(name, regNo)) return null;
  return prisma.customer.findFirst({
    where: { name: name.trim(), reg_no: regNo.trim(), hidden_at: null },
    orderBy: { created_at: 'desc' },
    select: SELECT,
  });
}

/** 같은 고객으로 볼 후보를 찾는 조건. */
export interface CustomerMatch {
  name: string;
  reg_no?: string | null;
  phone?: string;
  /** 생년월일이 비었거나 같은 행만 — Prisma 의 `in` 은 null 을 받지 않아 OR 로 쓴다 */
  OR?: { reg_no: string | null }[];
  /** 숨긴 고객에는 붙지 않는다 — 「안 쓰기로 한 행」이라 거기 붙으면 새 견적이 화면에서 사라진다 */
  hidden_at: null;
}

/**
 * 같은 고객을 찾는 조건들을 **순서대로** 낸다. 앞에서 찾으면 뒤는 보지 않는다.
 * 빈 배열이면 찾지 않고 새로 만든다.
 *
 * **이 함수가 「같은 사람인가」의 정의다.**
 *
 * 1. 생년월일이 있으면 → 성명 + 생년월일 (가장 확실하다)
 * 2. 휴대폰이 있으면   → 성명 + 휴대폰
 *
 * 2가 1의 뒤에 오는 이유 — 처음엔 생년월일 없이 저장하고(견적 단계에선 필수가 아니다),
 * 나중에 같은 고객에게 견적을 다시 내면서 생년월일을 채우는 일이 흔하다. 그때 1로만 찾으면
 * 못 찾아 **새 행이 생긴다**. 2로 한 번 더 보면 기존 행을 찾아 생년월일을 채워 넣는다.
 *
 * ⚠️ 다만 2에서는 **생년월일이 다른 행은 제외**한다. 이름·번호가 같아도 생년월일이 다르면
 *    다른 사람이다(가족이 한 번호를 쓰는 경우). 비어 있는 행만 같은 사람으로 본다.
 */
export function customerMatches(
  name?: string | null, regNo?: string | null, phone?: string | null,
): CustomerMatch[] {
  const n = (name ?? '').trim();
  if (!n) return [];
  const r = (regNo ?? '').trim();
  const p = (phone ?? '').trim();

  const out: CustomerMatch[] = [];
  if (r) out.push({ name: n, reg_no: r, hidden_at: null });
  if (p) {
    out.push(r
      // 생년월일이 비었거나 같은 행만 — 다른 생년월일은 다른 사람이다
      ? { name: n, phone: p, hidden_at: null, OR: [{ reg_no: null }, { reg_no: r }] }
      : { name: n, phone: p, hidden_at: null, reg_no: null });
  }
  return out;
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
  address_detail?: string | null;
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
    tel: clean(input.tel), address: clean(input.address), address_detail: clean(input.address_detail), reg_no: regNo,
  })) {
    if (v) patch[k] = v;
  }

  /*
   * 같은 고객 찾기 — 생년월일이 있으면 그걸로, 없으면 휴대폰으로.
   *
   * 후보가 여럿이면 **WARP 에 연결된 행을 먼저** 고른다. 안 그러면 새 견적이 연결 안 된
   * 행에 붙어, 애써 맺어 둔 CRM 연결이 옆으로 새 나간다(연결이 시작되면 바로 문제가 된다).
   * 그다음은 최신 행 — 마지막에 저장한 값이 가장 최근 정보다.
   */
  /*
   * 같은 고객 찾기 — 조건을 순서대로 시도한다(생년월일 → 휴대폰).
   *
   * 후보가 여럿이면 **WARP 에 연결된 행을 먼저** 고른다. 안 그러면 새 견적이 연결 안 된
   * 행에 붙어, 애써 맺어 둔 CRM 연결이 옆으로 새 나간다.
   * 그다음은 최신 행 — 마지막에 저장한 값이 가장 최근 정보다.
   */
  let existing: { id: number } | null = null;
  for (const where of customerMatches(name, regNo, clean(input.phone) ?? undefined)) {
    existing = await prisma.customer.findFirst({
      where: where as never,
      orderBy: [
        { warp_customer_id: { sort: 'desc', nulls: 'last' } },
        { created_at: 'desc' },
      ],
      select: { id: true },
    });
    if (existing) break;
  }

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
