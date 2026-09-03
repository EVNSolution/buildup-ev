/**
 * **커스텀 특장 옵션** — 단가표에 없는 사양을 영업이 직접 적어 넣는다.
 *
 * 실제 상담에서는 단가표에 없는 요구가 늘 나온다(작업등·사이드스텝 같은 것).
 * 지금까지는 메모에 적고 금액은 손으로 얹었는데, 그러면 견적서·계약서·주문 어디에도
 * 남지 않는다. 여기서 적은 것은 **특장 가격에 그대로 합산되어** 세 서류에 함께 나간다.
 *
 * ## 금액 기준 — 화면은 VAT 포함, 계산은 공급가
 * 영업이 보는 화면은 전부 VAT 포함가라, 여기서 적는 금액도 **VAT 포함**이다.
 * 계산은 공급가로 하므로 옵션DB 와 **같은 규칙**으로 되돌린다(`round(VAT포함 ÷ 1.1)`).
 * 옵션DB 도 그렇게 저장돼 있다 — 예: 46,530,000 ↔ 42,300,000.
 */

/** 한 줄. 영업이 옵션명과 금액을 직접 적는다. */
export interface CustomOption {
  /** 옵션명 — 견적서·계약서에 이 문구가 그대로 나간다 */
  name: string;
  /** 금액(원, **VAT 포함**) — 화면 기준 */
  price: number;
}

/** 옵션명 길이 상한 — 견적서 한 줄에 들어가야 한다 */
export const CUSTOM_OPTION_NAME_MAX = 40;
/** 한 견적에 넣을 수 있는 줄 수 — 견적서 한 장을 넘기지 않는 선 */
export const CUSTOM_OPTION_MAX_ROWS = 10;
/** 한 줄 금액 상한 — 오타로 0 을 더 붙이는 사고를 막는다 */
export const CUSTOM_OPTION_PRICE_MAX = 100_000_000;

/** 화면에서 편집 중인 줄 — 아직 반쪽만 적혀 있을 수 있다 */
export interface CustomOptionDraft {
  name: string;
  /** 빈칸은 `null` — `0` 은 「0원」이라는 뜻이라 다르다 */
  price: number | null;
}

export type RowState = 'empty' | 'partial' | 'ok';

/**
 * 한 줄의 상태.
 *
 * - `empty` — 둘 다 비었다. **없는 줄과 같다**(+ 만 누르고 안 적은 경우).
 * - `partial` — 한쪽만 적혔다. 이 상태로는 **임시저장조차 막는다** — 옵션명만 있고 금액이
 *   없으면 얼마를 받을지 모르고, 금액만 있고 이름이 없으면 무엇인지 모른 채 청구된다.
 * - `ok` — 둘 다 적혔다.
 */
export function rowState(row: CustomOptionDraft): RowState {
  const hasName = row.name.trim().length > 0;
  const hasPrice = row.price != null && Number.isFinite(row.price);
  if (!hasName && !hasPrice) return 'empty';
  if (hasName && hasPrice) return 'ok';
  return 'partial';
}

export interface CustomOptionsCheck {
  /** 저장해도 되는가 — `partial` 이 하나도 없어야 참 */
  ok: boolean;
  /** 사람에게 보여 줄 이유. `ok` 면 빈 문자열 */
  message: string;
  /** 저장할 줄만 추린 것(`empty` 는 버린다) */
  options: CustomOption[];
}

/**
 * 저장 전 검사 — **화면과 서버가 같은 함수를 쓴다.**
 * 화면에서만 막으면 예전 화면·직접 호출로 반쪽짜리가 들어온다.
 */
export function checkCustomOptions(rows: readonly CustomOptionDraft[]): CustomOptionsCheck {
  const fail = (message: string): CustomOptionsCheck => ({ ok: false, message, options: [] });

  if (rows.length > CUSTOM_OPTION_MAX_ROWS) {
    return fail(`추가 옵션은 ${CUSTOM_OPTION_MAX_ROWS}줄까지 넣을 수 있습니다.`);
  }

  const options: CustomOption[] = [];
  for (const [i, row] of rows.entries()) {
    const state = rowState(row);
    if (state === 'empty') continue;   // + 만 누르고 안 적은 줄 — 없는 것과 같다
    if (state === 'partial') {
      return fail(`추가 옵션 ${i + 1}번째 줄 — 옵션명과 금액을 모두 적어 주세요.`);
    }
    const name = row.name.trim();
    const price = Math.round(row.price as number);
    if (name.length > CUSTOM_OPTION_NAME_MAX) {
      return fail(`추가 옵션 ${i + 1}번째 줄 — 옵션명은 ${CUSTOM_OPTION_NAME_MAX}자까지 넣을 수 있습니다.`);
    }
    // 음수는 할인이 아니다 — 할인은 프로모션 칸이 따로 있다
    if (price < 0) return fail(`추가 옵션 ${i + 1}번째 줄 — 금액은 0원 이상이어야 합니다.`);
    if (price > CUSTOM_OPTION_PRICE_MAX) {
      return fail(`추가 옵션 ${i + 1}번째 줄 — 금액이 너무 큽니다. 다시 확인해 주세요.`);
    }
    options.push({ name, price });
  }
  return { ok: true, message: '', options };
}

/** 저장된 값 → 계산에 쓰는 줄 목록. 형태가 깨진 것은 버린다(옛 견적·손댄 JSON 대비) */
export function readCustomOptions(raw: unknown): CustomOption[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomOption[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const { name, price } = r as { name?: unknown; price?: unknown };
    if (typeof name !== 'string' || typeof price !== 'number') continue;
    if (!name.trim() || !Number.isFinite(price)) continue;
    out.push({ name: name.trim(), price: Math.round(price) });
  }
  return out.slice(0, CUSTOM_OPTION_MAX_ROWS);
}

/**
 * 공급가 — **옵션DB 와 같은 규칙**으로 VAT 를 되돌린다.
 * 옵션DB 가 `round(VAT포함 ÷ 1.1)` 로 저장돼 있어(46,530,000 ↔ 42,300,000)
 * 여기서만 다르게 하면 같은 금액이 견적서와 계약서에서 1원씩 어긋난다.
 */
export function customOptionSupply(price: number): number {
  return Math.round(price / 1.1);
}

/**
 * 공급가 합계 — `option_sum` 에 더해지는 값.
 *
 * ⚠️ **줄마다 반올림하지 않고 합계를 한 번만 반올림한다.** 줄마다 깎으면 그 오차가 쌓여
 *    ⑦ 특장 가격이 견적서에 찍힌 줄들의 세로 합과 어긋난다.
 *    실측: 500,000 + 300,000 을 줄마다 반올림하면 ⑦ 이 21,274,999원, 세로 합은
 *    21,275,000원으로 **1원 차이**가 났다. 한 번만 반올림하면 21,275,000원으로 맞는다.
 *    (`customOptionSupply` 는 한 줄짜리 환산이 필요한 자리에 남겨 둔다)
 */
export function customOptionsSupplySum(list: readonly CustomOption[]): number {
  return Math.round(list.reduce((a, o) => a + o.price, 0) / 1.1);
}
