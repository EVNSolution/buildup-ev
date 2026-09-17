/**
 * **차량 판매건별 손익** — 지금 쓰는 엑셀(차량판매_손익_양식)의 셈을 그대로 옮긴다(2026-09-16 지시).
 *
 * 화면과 서버가 **같은 함수**를 쓴다. 금액 셈이 두 벌이면 합계와 줄이 언젠가 어긋나고,
 * 어긋난 쪽을 찾는 데 하루가 간다.
 *
 * 엑셀의 식:
 *   VAT      = ROUNDDOWN(공급가액 × 10%, 0)     ← 반올림이 아니라 **버림**이다
 *   공급대가 = 공급가액 + VAT
 *   입금 차액 = 공급대가 − 캐피탈 − 계약금
 *
 * ⚠️ VAT·공급대가·입금 차액은 **저장하지 않는다.** 적어 두면 공급가액을 고쳤을 때 둘이
 *    어긋나고, 어느 쪽이 맞는지 알 수 없어진다. 늘 여기서 낸다.
 */

/** 부가가치세율 — 바뀌면 여기 한 곳 */
export const VAT_RATE = 0.1;

/** 엑셀 `ROUNDDOWN(E*10%,0)` — 버림이다. 반올림하면 1원씩 어긋난다 */
export function vatOf(supply: number): number {
  return Math.floor((supply || 0) * VAT_RATE);
}

/** 공급대가(합계) = 공급가액 + VAT */
export function grossOf(supply: number): number {
  const s = supply || 0;
  return s + vatOf(s);
}

/**
 * 입금 차액 = 공급대가 − 캐피탈 − 계약금.
 * **음수가 정상이다** — 아직 안 들어온 돈이다(엑셀에서도 캐피탈 전에는 −계약금으로 남는다).
 */
export function payDiffOf(supply: number, deposit: number, capital: number): number {
  return grossOf(supply) - (capital || 0) - (deposit || 0);
}

/**
 * 공급대가(VAT 포함)에서 **공급가액**을 되짚는다 — 계약서의 특장 결제금액에서 첫 값을 채울 때 쓴다.
 *
 * 그냥 `/1.1` 하면 1원이 샌다. VAT 가 **버림**이라 `s + floor(s×10%)` 가 공급대가와 딱 맞는 `s` 가
 * 따로 있기 때문이다(예: 20,310,000 → 18,463,636 은 20,309,999, 18,463,637 이 딱 맞는다).
 * 그래서 어림값 둘레를 몇 칸 훑어 **딱 맞는 값**을 고르고, 없으면 가장 가까운 값을 준다.
 */
export function supplyFromGross(gross: number): number {
  const g = Math.max(0, Math.round(gross || 0));
  if (g === 0) return 0;
  const guess = Math.round(g / 1.1);
  let best = guess;
  let bestGap = Math.abs(grossOf(guess) - g);
  for (let s = guess - 2; s <= guess + 2; s++) {
    if (s < 0) continue;
    const gap = Math.abs(grossOf(s) - g);
    if (gap < bestGap) { best = s; bestGap = gap; }
    if (gap === 0) return s;
  }
  return best;
}

/**
 * 수익 = 공급가액 − 원가.
 * **VAT 를 뺀 공급가액 기준**이다 — VAT 는 우리 돈이 아니라 받아서 내는 돈이다.
 */
export function profitOf(supply: number, cost: number): number {
  return (supply || 0) - (cost || 0);
}

/** 수익률 — 공급가액이 0이면 비율이 없다(0% 로 쓰면 「손해」로 읽힌다) */
export function marginOf(supply: number, profit: number): number | null {
  return supply > 0 ? profit / supply : null;
}

/** 한 줄에서 읽어 낼 수 있는 값 전부 — 화면과 합계가 같은 것을 본다 */
export interface PnlDerived {
  vat: number;
  gross: number;
  pay_diff: number;
  profit: number;
  margin: number | null;
}

/** 한 줄이 읽어야 할 값 — 원가는 **한 칸**이고 나머지는 여기서 낸다 */
export interface PnlBase {
  supply_amount: number;
  deposit: number;
  capital: number;
  cost?: number;
  /**
   * **손으로 고친 VAT** — 없으면(null) 엑셀 식(버림 10%)을 쓴다(2026-09-17 지시로 자동 칸도 고칠 수 있게 됐다).
   * 세금계산서를 끊는 쪽이 반올림하면 1원이 다르다 — 그때 실제 계산서 값을 적는다.
   */
  vat_override?: number | null;
}

/** 그 줄의 VAT — 고친 값이 있으면 그것, 없으면 식 */
export function vatFor(row: Pick<PnlBase, 'supply_amount' | 'vat_override'>): number {
  return row.vat_override ?? vatOf(row.supply_amount);
}

export function deriveP(row: PnlBase): PnlDerived {
  const profit = profitOf(row.supply_amount, row.cost ?? 0);
  const vat = vatFor(row);
  const gross = (row.supply_amount || 0) + vat;
  return {
    vat,
    gross,
    pay_diff: gross - (row.capital || 0) - (row.deposit || 0),
    profit,
    margin: marginOf(row.supply_amount, profit),
  };
}

/**
 * **공급대가를 고쳤을 때** 공급가액·VAT 를 되짚는다.
 *
 * 공급대가는 저장하지 않는 값이라, 사람이 고치면 그 뿌리(공급가액)를 바꿔야 한다.
 * 공급가액은 딱 맞는 값을 고르고(`supplyFromGross`), 그래도 1원이 남으면 **VAT 를 고친 것으로** 둔다 —
 * 그래야 적은 공급대가가 **한 원도 다르지 않게** 그대로 보인다.
 */
export function fromGross(gross: number): { supply_amount: number; vat_override: number | null } {
  const g = Math.max(0, Math.round(gross || 0));
  const supply = supplyFromGross(g);
  const vat = g - supply;
  return { supply_amount: supply, vat_override: vat === vatOf(supply) ? null : vat };
}

/**
 * **VAT 를 고쳤을 때** — 식과 같으면 고친 것이 아니다(null 로 되돌린다).
 * 식과 같은 값을 「고친 값」으로 붙잡아 두면, 나중에 공급가액을 바꿔도 VAT 가 안 따라온다.
 */
export function vatOverrideFor(supply: number, vat: number): number | null {
  const v = Math.max(0, Math.round(vat || 0));
  return v === vatOf(supply) ? null : v;
}

/** 여러 줄의 합 — 엑셀 20행(합계)과 같다. 합계도 줄과 **같은 함수**로 낸다 */
export function sumP(rows: PnlBase[]) {
  const z = {
    count: rows.length,
    supply_amount: 0, vat: 0, gross: 0, deposit: 0, capital: 0, pay_diff: 0,
    cost: 0, profit: 0,
  };
  for (const r of rows) {
    const d = deriveP(r);
    z.supply_amount += r.supply_amount || 0;
    z.vat += d.vat;
    z.gross += d.gross;
    z.deposit += r.deposit || 0;
    z.capital += r.capital || 0;
    z.pay_diff += d.pay_diff;
    z.cost += r.cost || 0;
    z.profit += d.profit;
  }
  return { ...z, margin: marginOf(z.supply_amount, z.profit) };
}

/** `YYYY-MM` 인가 — 화면·주소에서 온 값을 믿지 않는다 */
export function isYearMonth(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** 그 달의 첫날·다음 달 첫날(둘 다 `YYYY-MM-DD`) — 조회 범위 */
export function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${ym}-01`, to: `${next}-01` };
}

/** 날짜(YYYY-MM-DD)에서 달(YYYY-MM) */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}
